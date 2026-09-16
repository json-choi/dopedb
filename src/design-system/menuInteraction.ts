// Canonical menu interaction contract. Menu surfaces supply presentation and
// commands; this module owns trigger keys, owned-item traversal, dismissal,
// and focus restoration across ordinary DOM descendants and owned portals.
import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { ownsFloatingTarget } from "./floating";

const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(",");
const MODAL_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(",");

export type MenuInitialFocus = "first" | "last" | null;
export type MenuCloseReason = "escape" | "outside-pointer" | "selection";

type MenuRegistration = {
  menu: HTMLElement;
  trigger: HTMLElement;
  close: (reason: MenuCloseReason) => void;
};

const openMenus: MenuRegistration[] = [];
let globalListenersInstalled = false;

export function isDialogKeyboardTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(MODAL_SELECTOR) !== null;
}

export function menuKeyboardOwner(node: Node | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  // A dialog starts a new keyboard scope, even when its portal is owned by a
  // menu. A menu opened inside that dialog remains its own nearest scope.
  const scope = node.closest<HTMLElement>(`[role="menu"], ${MODAL_SELECTOR}`);
  if (scope) return scope.matches('[role="menu"]') ? scope : null;

  let portal = node.closest<HTMLElement>("[data-floating-owner-id]");
  const visited = new Set<string>();
  while (portal) {
    const ownerId = portal.dataset.floatingOwnerId;
    if (!ownerId || visited.has(ownerId)) return null;
    visited.add(ownerId);
    const owner = document.getElementById(ownerId);
    if (!owner) return null;
    if (owner.matches(MODAL_SELECTOR)) return null;
    if (owner.matches('[role="menu"]')) return owner;
    portal = owner.closest<HTMLElement>("[data-floating-owner-id]");
  }
  return null;
}

function registrationForNode(node: Node | null) {
  const menu = menuKeyboardOwner(node);
  if (menu) {
    const direct = openMenus.find((registration) => registration.menu === menu);
    if (direct) return direct;
  }
  for (let index = openMenus.length - 1; index >= 0; index -= 1) {
    const registration = openMenus[index];
    if (node && ownsFloatingTarget(registration.menu, node)) return registration;
  }
  return null;
}

function isOwnedModalTarget(node: Node | null) {
  if (!(node instanceof Element)) return false;
  const modal = node.closest<HTMLElement>(MODAL_SELECTOR);
  if (!modal?.closest("[data-floating-owner-id]")) return false;
  return openMenus.some((registration) =>
    ownsFloatingTarget(registration.menu, node),
  );
}

function restoreTriggerFocus(registration: MenuRegistration) {
  window.requestAnimationFrame(() => {
    if (registration.trigger.isConnected) {
      registration.trigger.focus({ preventScroll: true });
    }
  });
}

function handleGlobalMenuEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || openMenus.length === 0) {
    return;
  }
  const target = event.target instanceof Node ? event.target : null;
  if (isOwnedModalTarget(target)) return;
  const registration =
    registrationForNode(target) ?? openMenus[openMenus.length - 1];
  event.preventDefault();
  event.stopImmediatePropagation();
  registration.close("escape");
  restoreTriggerFocus(registration);
}

function handleGlobalMenuPointer(event: PointerEvent) {
  if (openMenus.length === 0 || !(event.target instanceof Node)) return;
  for (let index = openMenus.length - 1; index >= 0; index -= 1) {
    const registration = openMenus[index];
    if (
      registration.trigger.contains(event.target) ||
      ownsFloatingTarget(registration.menu, event.target)
    ) {
      continue;
    }
    registration.close("outside-pointer");
  }
}

function installGlobalMenuListeners() {
  if (globalListenersInstalled || typeof window === "undefined") return;
  globalListenersInstalled = true;
  window.addEventListener("keydown", handleGlobalMenuEscape, true);
  document.addEventListener("pointerdown", handleGlobalMenuPointer, true);
}

function uninstallGlobalMenuListeners() {
  if (!globalListenersInstalled || openMenus.length > 0) return;
  globalListenersInstalled = false;
  window.removeEventListener("keydown", handleGlobalMenuEscape, true);
  document.removeEventListener("pointerdown", handleGlobalMenuPointer, true);
}

function isDisabledMenuItem(item: HTMLElement) {
  return (
    item.getAttribute("aria-disabled") === "true" ||
    (item instanceof HTMLButtonElement && item.disabled) ||
    (item instanceof HTMLInputElement && item.disabled)
  );
}

export function ownedMenuItems(menu: HTMLElement | null) {
  if (!menu || typeof document === "undefined") return [];
  return Array.from(
    document.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter(
    (item) =>
      menuKeyboardOwner(item) === menu &&
      !isDisabledMenuItem(item) &&
      !item.hidden &&
      !item.closest("[hidden], [inert], [aria-hidden='true']"),
  );
}

export function menuInitialFocusForTriggerKey(
  key: string,
): MenuInitialFocus {
  if (key === "ArrowUp") return "last";
  if (
    key === "Enter" ||
    key === " " ||
    key === "Spacebar" ||
    key === "ArrowDown"
  ) {
    return "first";
  }
  return null;
}

export function menuNavigationTargetIndex({
  key,
  currentIndex,
  itemCount,
}: {
  key: string;
  currentIndex: number;
  itemCount: number;
}) {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  const direction = key === "ArrowDown" ? 1 : -1;
  if (currentIndex < 0) return direction > 0 ? 0 : itemCount - 1;
  return (currentIndex + direction + itemCount) % itemCount;
}

function isEditableTextControl(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(target.type);
}

function shouldKeepMenuOpen(target: Element, item: HTMLElement) {
  const role = item.getAttribute("role");
  return (
    role === "menuitemcheckbox" ||
    role === "menuitemradio" ||
    item.getAttribute("aria-haspopup") === "dialog" ||
    target.closest("[data-menu-keep-open]") !== null
  );
}

export function useMenuInteractions({
  open,
  ready = true,
  menuRef,
  triggerRef,
  initialFocus,
  onRequestClose,
}: {
  open: boolean;
  ready?: boolean;
  menuRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  initialFocus: MenuInitialFocus;
  onRequestClose: (reason: MenuCloseReason) => void;
}) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const registration: MenuRegistration = {
      menu,
      trigger,
      close: (reason) => closeRef.current(reason),
    };
    openMenus.push(registration);
    installGlobalMenuListeners();
    return () => {
      const index = openMenus.indexOf(registration);
      if (index >= 0) openMenus.splice(index, 1);
      uninstallGlobalMenuListeners();
    };
  }, [menuRef, open, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !ready || !initialFocus) return;
    const items = ownedMenuItems(menuRef.current);
    const item = initialFocus === "first" ? items[0] : items[items.length - 1];
    item?.focus({ preventScroll: true });
  }, [initialFocus, menuRef, open, ready]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const menu = menuRef.current;
    if (
      event.defaultPrevented ||
      !menu ||
      menuKeyboardOwner(event.target as Node) !== menu ||
      isEditableTextControl(event.target)
    ) {
      return;
    }
    const items = ownedMenuItems(menu);
    const targetIndex = menuNavigationTargetIndex({
      key: event.key,
      currentIndex: items.indexOf(document.activeElement as HTMLElement),
      itemCount: items.length,
    });
    if (targetIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[targetIndex]?.focus({ preventScroll: true });
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    const menu = menuRef.current;
    const target = event.target;
    if (!menu || !(target instanceof Element)) return;
    const item = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    if (
      !item ||
      menuKeyboardOwner(item) !== menu ||
      isDisabledMenuItem(item) ||
      shouldKeepMenuOpen(target, item)
    ) {
      return;
    }
    triggerRef.current?.focus({ preventScroll: true });
    closeRef.current("selection");
  };

  return { onClick, onKeyDown };
}
