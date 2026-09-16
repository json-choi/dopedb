// Coordinates one roving focus order across mounted and virtual Explorer tree rows.

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type RefObject,
} from "react";

export type TreeKeyboardItem = Readonly<{
  key: string;
  parentKey: string | null;
  selected?: boolean;
}>;

type ResolvedTreeKeyboardItem = TreeKeyboardItem & {
  element: HTMLElement | null;
  virtualRoot: HTMLElement | null;
};

const TREE_ITEM_SELECTOR = "[data-explorer-tree-item]";
const VIRTUAL_TREE_SELECTOR = "[data-virtual-tree-list]";
export const VIRTUAL_TREE_FOCUS_EVENT = "dopedb:virtual-tree-focus";

const virtualTreeItems = new WeakMap<HTMLElement, readonly TreeKeyboardItem[]>();

export function registerVirtualTreeItems(
  root: HTMLElement,
  items: readonly TreeKeyboardItem[],
) {
  virtualTreeItems.set(root, items);
  return () => {
    virtualTreeItems.delete(root);
  };
}

function mountedTreeItems(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(TREE_ITEM_SELECTOR)];
}

function collectTreeItems(root: HTMLElement): ResolvedTreeKeyboardItem[] {
  const items: ResolvedTreeKeyboardItem[] = [];
  const nodes = root.querySelectorAll<HTMLElement>(
    `${TREE_ITEM_SELECTOR}, ${VIRTUAL_TREE_SELECTOR}`,
  );
  for (const node of nodes) {
    if (node.matches(VIRTUAL_TREE_SELECTOR)) {
      for (const item of virtualTreeItems.get(node) ?? []) {
        items.push({ ...item, element: null, virtualRoot: node });
      }
      continue;
    }
    if (node.closest(VIRTUAL_TREE_SELECTOR)) continue;
    const key = node.dataset.explorerTreeKey;
    if (!key) continue;
    items.push({
      key,
      parentKey: node.dataset.explorerTreeParentKey ?? null,
      selected: node.getAttribute("aria-selected") === "true",
      element: node,
      virtualRoot: null,
    });
  }
  return items;
}

export function treeKeyboardMoveTarget(
  items: readonly TreeKeyboardItem[],
  currentKey: string,
  key: "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "End" | "Home",
) {
  const currentIndex = items.findIndex((item) => item.key === currentKey);
  if (items.length === 0 || currentIndex < 0) return null;
  if (key === "Home") return items[0]?.key ?? null;
  if (key === "End") return items[items.length - 1]?.key ?? null;
  if (key === "ArrowDown") {
    return items[Math.min(items.length - 1, currentIndex + 1)]?.key ?? null;
  }
  if (key === "ArrowUp") {
    return items[Math.max(0, currentIndex - 1)]?.key ?? null;
  }
  if (key === "ArrowLeft") return items[currentIndex]?.parentKey ?? null;
  return items.find((item) => item.parentKey === currentKey)?.key ?? null;
}

export function virtualTreeFocusIndex(
  rows: readonly { treeItem?: Pick<TreeKeyboardItem, "key"> }[],
  key: string,
) {
  return rows.findIndex((row) => row.treeItem?.key === key);
}

function setRovingItem(root: HTMLElement, key: string | null) {
  for (const item of mountedTreeItems(root)) {
    item.tabIndex = item.dataset.explorerTreeKey === key ? 0 : -1;
  }
}

export function useTreeKeyboardNavigation(
  rootRef: RefObject<HTMLElement | null>,
) {
  const focusedKeyRef = useRef<string | null>(null);
  const focusedIndexRef = useRef(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = collectTreeItems(root);
    if (items.length === 0) return;
    let key = focusedKeyRef.current;
    if (!key || !items.some((item) => item.key === key)) {
      key =
        items.find((item) => item.selected)?.key ??
        items[Math.min(focusedIndexRef.current, items.length - 1)]?.key ??
        null;
      focusedKeyRef.current = key;
    }
    setRovingItem(root, key);
  });

  const focusKey = useCallback((key: string) => {
    const root = rootRef.current;
    if (!root) return;
    const items = collectTreeItems(root);
    const index = items.findIndex((item) => item.key === key);
    const item = items[index];
    if (!item) return;
    focusedKeyRef.current = key;
    focusedIndexRef.current = index;
    const mounted = mountedTreeItems(root).find(
      (candidate) => candidate.dataset.explorerTreeKey === key,
    );
    setRovingItem(root, key);
    if (mounted) {
      mounted.scrollIntoView({ block: "nearest" });
      mounted.focus({ preventScroll: true });
      return;
    }
    item.virtualRoot?.dispatchEvent(
      new CustomEvent(VIRTUAL_TREE_FOCUS_EVENT, { detail: { key } }),
    );
  }, [rootRef]);

  const restoreFocus = useCallback(() => {
    const key = focusedKeyRef.current;
    if (!key) return;
    requestAnimationFrame(() => focusKey(key));
  }, [focusKey]);

  const onFocusCapture: FocusEventHandler<HTMLElement> = useCallback(
    (event) => {
      const root = rootRef.current;
      const item = event.target instanceof Element
        ? event.target.closest<HTMLElement>(TREE_ITEM_SELECTOR)
        : null;
      if (!root || !item || !root.contains(item)) return;
      const key = item.dataset.explorerTreeKey;
      if (!key) return;
      const items = collectTreeItems(root);
      focusedKeyRef.current = key;
      focusedIndexRef.current = Math.max(
        0,
        items.findIndex((candidate) => candidate.key === key),
      );
      setRovingItem(root, key);
    },
    [rootRef],
  );

  const onKeyDown: KeyboardEventHandler<HTMLElement> = useCallback(
    (event) => {
      const root = rootRef.current;
      const item = event.target instanceof Element
        ? event.target.closest<HTMLElement>(TREE_ITEM_SELECTOR)
        : null;
      if (!root || !item || !root.contains(item)) return;
      const currentKey = item.dataset.explorerTreeKey;
      if (!currentKey) return;
      const expanded = item.getAttribute("aria-expanded");
      const expander = item.matches("[data-tree-expander]")
        ? item
        : item.querySelector<HTMLElement>("[data-tree-expander]");
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const contextAction = item.querySelector<HTMLElement>(
          "[data-tree-context-action]",
        );
        if (!contextAction) return;
        event.preventDefault();
        event.stopPropagation();
        contextAction.click();
        contextAction.focus({ preventScroll: true });
        return;
      }
      if (event.key === "ArrowRight" && expanded === "false" && expander) {
        event.preventDefault();
        event.stopPropagation();
        expander.click();
        return;
      }
      if (event.key === "ArrowLeft" && expanded === "true" && expander) {
        event.preventDefault();
        event.stopPropagation();
        expander.click();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        const primary = item.matches("[data-tree-primary-action]")
          ? item
          : item.querySelector<HTMLElement>("[data-tree-primary-action]");
        (primary ?? item).click();
        return;
      }
      if (![
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "End",
        "Home",
      ].includes(event.key)) {
        return;
      }
      const items = collectTreeItems(root);
      const target = treeKeyboardMoveTarget(
        items,
        currentKey,
        event.key as Parameters<typeof treeKeyboardMoveTarget>[2],
      );
      if (!target || target === currentKey) return;
      event.preventDefault();
      event.stopPropagation();
      focusKey(target);
    },
    [focusKey, rootRef],
  );

  return { focusKey, onFocusCapture, onKeyDown, restoreFocus };
}
