import {
  type ButtonHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "../design-system/components/Tooltip";
import { placeFloatingMenu, type FloatingMenuPosition } from "../lib/floatingMenu";
import { Icon, type IconName } from "./Icon";

function menuItems(root: HTMLElement | null) {
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"] input:not(:disabled), [role="menuitemradio"] input:not(:disabled)',
    ),
  ];
}

export default function ToolbarMenu({
  label,
  icon,
  trigger,
  children,
  align = "end",
  disabled = false,
  pressed,
  triggerVariant = "default",
  menuSize = "default",
  triggerTabIndex,
}: {
  label: string;
  icon?: IconName;
  trigger?: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  disabled?: boolean;
  pressed?: boolean;
  triggerVariant?:
    | "default"
    | "badge"
    | "treeAction"
    | "treeBadge"
    | "gridHeader"
    | "statusBar";
  menuSize?: "default" | "scope" | "tasks";
  triggerTabIndex?: number;
}) {
  const generatedId = useId();
  const menuId = `toolbar-menu-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);

  function close({ restoreFocus = false } = {}) {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const trigger = triggerRef.current?.getBoundingClientRect();
        const menu = menuRef.current?.getBoundingClientRect();
        if (!trigger || !menu) return;
        if (
          trigger.width === 0 ||
          trigger.height === 0 ||
          trigger.right <= 0 ||
          trigger.bottom <= 0 ||
          trigger.left >= window.innerWidth ||
          trigger.top >= window.innerHeight
        ) {
          close();
          return;
        }
        const rootStyle = getComputedStyle(document.documentElement);
        const gap =
          Number.parseFloat(rootStyle.getPropertyValue("--ds-popover-offset-lg")) || 6;
        const margin =
          Number.parseFloat(rootStyle.getPropertyValue("--ds-viewport-gutter")) || 8;
        setPosition(
          placeFloatingMenu(
            trigger,
            menu,
            { width: window.innerWidth, height: window.innerHeight },
            { align, gap, margin },
          ),
        );
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [align, open]);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) close();
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close({ restoreFocus: true });
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !position || !focusFirstOnOpen.current) return;
    focusFirstOnOpen.current = false;
    menuItems(menuRef.current)[0]?.focus();
  }, [open, position]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type !== "checkbox" &&
      event.target.type !== "radio"
    ) {
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items[items.length - 1]?.focus();
    else {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0 ? (direction > 0 ? 0 : items.length - 1) : current + direction;
      items[(next + items.length) % items.length]?.focus();
    }
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          data-placement={position?.placement}
          data-size={menuSize}
          className="tw:fixed tw:z-[var(--ds-z-popover)] tw:grid tw:max-h-[calc(100dvh-(var(--ds-viewport-gutter)*2))] tw:min-w-[var(--ds-menu-min-width)] tw:max-w-[min(var(--ds-menu-max-width),calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:gap-[var(--ds-segment-gap)] tw:overflow-auto tw:overscroll-contain tw:rounded-md tw:border tw:border-border-strong tw:bg-popover tw:p-1 tw:text-popover-foreground tw:shadow-popover tw:data-[size=scope]:w-[min(var(--ds-schema-scope-menu-width),calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=tasks]:w-[min(380px,calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=tasks]:max-w-none"
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            maxHeight: position?.maxHeight,
            visibility: position ? "visible" : "hidden",
          }}
          onKeyDown={moveFocus}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-menu-keep-open]")) return;
            if (target.closest('button:not(:disabled), [role="menuitem"]')) {
              triggerRef.current?.focus({ preventScroll: true });
              close();
            }
          }}
        >
          {children}
        </div>,
        document.body,
      )
    : null;

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      data-custom={Boolean(trigger)}
      data-variant={triggerVariant}
      className="tw:inline-flex tw:size-control-md tw:min-h-control-md tw:min-w-control-md tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-0 tw:rounded-sm tw:border tw:border-transparent tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:leading-none tw:text-muted-foreground tw:shadow-none tw:data-[custom=true]:h-control-md tw:data-[custom=true]:w-auto tw:data-[custom=true]:min-w-0 tw:data-[custom=true]:gap-2 tw:data-[custom=true]:rounded-xs tw:data-[custom=true]:px-2 tw:data-[custom=true]:font-semibold tw:data-[custom=true]:text-foreground tw:data-[custom=true]:data-[variant=badge]:h-auto tw:data-[custom=true]:data-[variant=badge]:min-h-control-xs tw:data-[custom=true]:data-[variant=badge]:gap-1 tw:data-[custom=true]:data-[variant=badge]:border-border-subtle tw:data-[custom=true]:data-[variant=badge]:px-1.5 tw:data-[custom=true]:data-[variant=badge]:text-2xs tw:data-[custom=true]:data-[variant=badge]:font-medium tw:data-[custom=true]:data-[variant=badge]:text-muted-foreground tw:data-[custom=true]:data-[variant=treeBadge]:h-[var(--ds-tree-badge-height)] tw:data-[custom=true]:data-[variant=treeBadge]:min-h-[var(--ds-tree-badge-height)] tw:data-[custom=true]:data-[variant=treeBadge]:gap-1 tw:data-[custom=true]:data-[variant=treeBadge]:border-border-subtle tw:data-[custom=true]:data-[variant=treeBadge]:px-1.5 tw:data-[custom=true]:data-[variant=treeBadge]:text-2xs tw:data-[custom=true]:data-[variant=treeBadge]:font-medium tw:data-[custom=true]:data-[variant=treeBadge]:text-muted-foreground tw:data-[custom=true]:data-[variant=statusBar]:h-full tw:data-[custom=true]:data-[variant=statusBar]:min-h-0 tw:data-[custom=true]:data-[variant=statusBar]:gap-1 tw:data-[custom=true]:data-[variant=statusBar]:rounded-none tw:data-[custom=true]:data-[variant=statusBar]:border-y-0 tw:data-[custom=true]:data-[variant=statusBar]:border-r-0 tw:data-[custom=true]:data-[variant=statusBar]:border-l-border-subtle tw:data-[custom=true]:data-[variant=statusBar]:px-1.5 tw:data-[custom=true]:data-[variant=statusBar]:text-xs tw:data-[custom=true]:data-[variant=statusBar]:font-normal tw:data-[custom=true]:data-[variant=statusBar]:text-muted-foreground tw:data-[custom=false]:data-[variant=treeAction]:size-control-xs tw:data-[custom=false]:data-[variant=treeAction]:min-h-control-xs tw:data-[custom=false]:data-[variant=treeAction]:min-w-control-xs tw:data-[custom=false]:data-[variant=treeAction]:rounded-xs tw:data-[custom=false]:data-[variant=gridHeader]:size-control-sm tw:data-[custom=false]:data-[variant=gridHeader]:min-h-control-sm tw:data-[custom=false]:data-[variant=gridHeader]:min-w-control-sm tw:data-[custom=false]:data-[variant=gridHeader]:rounded-xs tw:aria-expanded:border-transparent tw:aria-expanded:bg-selection tw:aria-expanded:text-selection-foreground tw:aria-pressed:border-transparent tw:aria-pressed:bg-selection tw:aria-pressed:text-selection-foreground tw:disabled:cursor-progress tw:disabled:opacity-55 tw:hover:bg-muted tw:hover:text-foreground tw:data-[custom=true]:data-[variant=badge]:hover:border-ring tw:data-[custom=true]:data-[variant=badge]:hover:bg-transparent tw:data-[custom=true]:data-[variant=treeBadge]:hover:border-ring tw:data-[custom=true]:data-[variant=treeBadge]:hover:bg-transparent tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:[&_.icon]:shrink-0 tw:[&_.icon]:text-[length:var(--ds-icon-sm)]"
      disabled={disabled}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-pressed={pressed}
      aria-controls={open ? menuId : undefined}
      tabIndex={triggerTabIndex}
      onClick={() => {
        if (open) close();
        else {
          setPosition(null);
          setOpen(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        focusFirstOnOpen.current = true;
        setPosition(null);
        setOpen(true);
      }}
    >
      {trigger ?? (icon ? <Icon name={icon} /> : null)}
    </button>
  );

  return (
    <span
      data-variant={triggerVariant}
      className="tw:inline-flex tw:shrink-0 tw:data-[variant=statusBar]:h-full"
    >
      {trigger ? (
        triggerButton
      ) : (
        <Tooltip label={label}>{triggerButton}</Tooltip>
      )}
      {menu}
    </span>
  );
}

export function ToolbarMenuItem({
  icon,
  children,
  ...props
}: {
  icon: IconName;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  return (
    <button
      type="button"
      role="menuitem"
      className="tw:flex tw:min-h-control-md tw:w-full tw:min-w-[var(--ds-menu-min-width)] tw:cursor-pointer tw:items-center tw:justify-start tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:font-sans tw:text-left tw:text-ui tw:leading-ui tw:text-inherit tw:whitespace-nowrap tw:aria-checked:bg-selection tw:aria-checked:text-selection-foreground tw:disabled:cursor-default tw:disabled:opacity-45 tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:bg-muted tw:focus-visible:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring"
      {...props}
    >
      <Icon name={icon} className="tw:shrink-0 tw:text-sm" />
      {children}
    </button>
  );
}
