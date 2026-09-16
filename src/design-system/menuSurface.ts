// Canonical keyboard and dismissal contract for portalled menu surfaces. One
// module owns focus entry, roving Arrow/Home/End movement, Escape and outside
// dismissal, and the trigger focus restore so PopupMenu, ToolbarMenu and their
// triggers cannot implement one half of the contract and drop the other.
import {
  useEffect,
  useEffectEvent,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { ownsFloatingTarget } from "./floating";

// A menu row is focusable when it is an enabled command, an enabled ARIA menu
// item, or the native input a check/radio row wraps.
const MENU_ITEM_SELECTOR =
  'button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"] input:not(:disabled), [role="menuitemradio"] input:not(:disabled)';

export function menuItems(root: HTMLElement | null) {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];
}

export function focusMenuEdge(
  root: HTMLElement | null,
  edge: "first" | "last" = "first",
) {
  const items = menuItems(root);
  const target = edge === "last" ? items[items.length - 1] : items[0];
  target?.focus();
  return Boolean(target);
}

// ArrowDown/ArrowUp/Home/End roving inside an open menu. Text entry rows keep
// their own caret movement, so only command and check rows are moved.
export function moveMenuFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  root: HTMLElement | null,
) {
  if (event.target instanceof HTMLTextAreaElement) return;
  if (
    event.target instanceof HTMLInputElement &&
    event.target.type !== "checkbox" &&
    event.target.type !== "radio"
  ) {
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = menuItems(root);
  if (items.length === 0) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === "Home") items[0]?.focus();
  else if (event.key === "End") items[items.length - 1]?.focus();
  else {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0 ? (direction > 0 ? 0 : items.length - 1) : current + direction;
    items[(next + items.length) % items.length]?.focus();
  }
}

// Which menu edge a trigger key should land on, or null when the key is not a
// menu-opening key. Keyboard activation of the trigger enters the menu too.
export function menuTriggerEntryEdge(
  event: ReactKeyboardEvent<HTMLElement>,
): "first" | "last" | null {
  if (event.key === "ArrowDown") return "first";
  if (event.key === "ArrowUp") return "last";
  return null;
}

// Escape and outside pointer dismissal. Escape restores the trigger because the
// user is still navigating by keyboard; an outside pointer leaves focus where
// the pointer put it.
export function useMenuDismiss({
  open,
  menuRef,
  triggerRef,
  onDismiss,
}: {
  open: boolean;
  menuRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  onDismiss: (options: { restoreFocus: boolean }) => void;
}) {
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current && ownsFloatingTarget(menuRef.current, target)) return;
      dismiss({ restoreFocus: false });
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss({ restoreFocus: true });
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuRef, open, triggerRef]);
}

// Menus that unmount from the outside (a command ran, the owner closed them)
// would otherwise drop keyboard focus onto document.body. Return it to the
// trigger, but only when focus really was inside and nothing else claimed it —
// a confirm dialog opened from a row keeps the focus it took.
export function useMenuFocusReturn({
  menuRef,
  triggerRef,
}: {
  menuRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const focusWasInside = useRef(false);
  useEffect(() => {
    // The trigger outlives the menu, so the node captured here is the one to
    // return focus to even though the menu node is gone by cleanup time.
    const trigger = triggerRef.current;
    const track = (event: FocusEvent) => {
      const menu = menuRef.current;
      focusWasInside.current = Boolean(
        menu && event.target instanceof Node && menu.contains(event.target),
      );
    };
    document.addEventListener("focusin", track);
    return () => {
      document.removeEventListener("focusin", track);
      if (!focusWasInside.current) return;
      window.requestAnimationFrame(() => {
        if (!trigger?.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        trigger.focus({ preventScroll: true });
      });
    };
  }, [menuRef, triggerRef]);
}
