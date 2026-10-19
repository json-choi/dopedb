// Canonical popup menu. `Menu` is the one floating surface (external anchor,
// shared keyboard/focus contract from menuInteraction); `MenuItem`,
// `MenuCheckbox` are its rows; `ToolbarMenu` is the thin trigger-owned wrapper
// that renders its own button and opens a `Menu` anchored to it.
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "../../components/Icon";
import {
  floatingPortalIsModalOwned,
  floatingPortalOwnerId,
  useAnchoredFloatingSurface,
} from "../floating";
import {
  menuInitialFocusForTriggerKey,
  type MenuInitialFocus,
  useMenuInteractions,
} from "../menuInteraction";
import { Tooltip } from "./Tooltip";

type MenuPlacement = "bottom-end" | "bottom-start" | "right-end" | "top-start";
type MenuSize = "default" | "narrow" | "account" | "scope" | "tasks";

export function Menu({
  id,
  children,
  anchorRef,
  getAnchorRect,
  placement = "bottom-end",
  size = "default",
  ariaLabel,
  onClick,
  onKeyDown,
  initialFocus = null,
  onRequestClose,
  onReferenceHidden,
}: {
  id?: string;
  children: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  /** Optional vendor-measured caret/cell geometry; the real anchor still owns focus. */
  getAnchorRect?: () => DOMRect;
  placement?: MenuPlacement;
  size?: MenuSize;
  ariaLabel?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  initialFocus?: MenuInitialFocus;
  onRequestClose?: () => void;
  onReferenceHidden?: () => void;
}) {
  const generatedId = useId();
  const menuId = id ?? `menu-${generatedId.replace(/:/g, "")}`;
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    refs,
    floatingStyles,
    placement: resolvedPlacement,
    isPositioned,
    middlewareData,
  } = useAnchoredFloatingSurface({ open: true, placement });
  const setMenu = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      refs.setFloating(node);
    },
    [refs],
  );
  const interactions = useMenuInteractions({
    open: true,
    ready: isPositioned,
    menuRef,
    triggerRef: anchorRef,
    initialFocus,
    onRequestClose: () => onRequestClose?.(),
  });

  useEffect(() => {
    refs.setReference(getAnchorRect
      ? { getBoundingClientRect: getAnchorRect, contextElement: anchorRef.current ?? undefined }
      : anchorRef.current);
    return () => refs.setReference(null);
  }, [anchorRef, getAnchorRect, refs]);

  useEffect(() => {
    if (!middlewareData.hide?.referenceHidden) return;
    onReferenceHidden?.();
  }, [middlewareData.hide?.referenceHidden, onReferenceHidden]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={setMenu}
      id={menuId}
      role="menu"
      aria-label={ariaLabel}
      data-placement={resolvedPlacement.split("-")[0]}
      data-floating-owner-id={floatingPortalOwnerId(anchorRef.current)}
      data-modal-owned={floatingPortalIsModalOwned(anchorRef.current)}
      data-size={size}
      className="tw:fixed tw:z-[var(--ds-z-popover)] tw:grid tw:max-h-[calc(100dvh-(var(--ds-viewport-gutter)*2))] tw:min-w-[var(--ds-menu-min-width)] tw:max-w-[min(var(--ds-menu-max-width),calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:gap-[var(--ds-segment-gap)] tw:overflow-auto tw:overscroll-contain tw:rounded-md tw:border tw:border-border-strong tw:bg-popover tw:p-1 tw:text-popover-foreground tw:shadow-popover tw:data-[modal-owned=true]:z-[var(--ds-z-modal-popover)] tw:data-[size=narrow]:w-[min(220px,calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=account]:w-[min(284px,calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=scope]:w-[min(var(--ds-schema-scope-menu-width),calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=tasks]:w-[min(380px,calc(100vw-(var(--ds-viewport-gutter)*2)))] tw:data-[size=tasks]:max-w-none"
      style={{
        ...floatingStyles,
        visibility: isPositioned ? "visible" : "hidden",
      }}
      onClick={(event) => {
        interactions.onClick(event);
        onClick?.(event);
      }}
      onKeyDown={(event) => {
        interactions.onKeyDown(event);
        onKeyDown?.(event);
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  ...props
}: {
  /** Optional leading icon; rows that bring their own mark may pass an element. */
  icon?: IconName | ReactElement;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  return (
    <button
      type="button"
      role="menuitem"
      className="tw:flex tw:min-h-control-md tw:w-full tw:min-w-[var(--ds-menu-min-width)] tw:cursor-pointer tw:items-center tw:justify-start tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:font-sans tw:text-left tw:text-ui tw:leading-ui tw:text-inherit tw:whitespace-nowrap tw:data-[tone=danger]:text-danger tw:aria-checked:bg-selection tw:aria-checked:text-selection-foreground tw:data-[selected=true]:bg-selection tw:data-[selected=true]:text-selection-foreground tw:disabled:cursor-default tw:disabled:opacity-45 tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:bg-muted tw:focus-visible:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring"
      {...props}
    >
      {typeof icon === "string" ? (
        <Icon name={icon} className="tw:shrink-0 tw:text-sm" />
      ) : icon}
      {children}
    </button>
  );
}

export function MenuCheckbox({
  children,
  checked,
  disabled,
  ...props
}: {
  children: ReactNode;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "children" | "type"
>) {
  return (
    <label
      data-checked={Boolean(checked)}
      data-disabled={Boolean(disabled)}
      className="tw:flex tw:min-h-control-md tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:text-ui tw:leading-ui tw:text-foreground tw:data-[checked=true]:bg-selection tw:data-[checked=true]:text-selection-foreground tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-45 tw:hover:bg-muted"
    >
      <input
        {...props}
        type="checkbox"
        role="menuitemcheckbox"
        aria-checked={Boolean(checked)}
        aria-disabled={Boolean(disabled)}
        checked={checked}
        disabled={disabled}
        className="tw:size-4 tw:accent-primary"
      />
      <span>{children}</span>
    </label>
  );
}

export function ToolbarMenu({
  label,
  icon,
  trigger,
  children,
  align = "end",
  disabled = false,
  busy = false,
  pressed,
  triggerVariant = "default",
  menuSize = "default",
  triggerTabIndex,
  openRequest,
}: {
  label: string;
  icon?: IconName;
  trigger?: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  disabled?: boolean;
  /** Disabled only while work is in progress: shows the progress cursor. */
  busy?: boolean;
  pressed?: boolean;
  triggerVariant?:
    | "default"
    | "compact"
    | "composer"
    | "badge"
    | "treeAction"
    | "treeBadge"
    | "gridHeader"
    | "statusBar";
  menuSize?: MenuSize;
  triggerTabIndex?: number;
  openRequest?: number;
}) {
  const generatedId = useId();
  const menuId = `toolbar-menu-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastOpenRequest = useRef(openRequest);
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<MenuInitialFocus>(null);

  useEffect(() => {
    if (
      openRequest === undefined ||
      openRequest === lastOpenRequest.current
    ) {
      return;
    }
    if (disabled) return;
    lastOpenRequest.current = openRequest;
    setInitialFocus("first");
    setOpen(true);
  }, [disabled, openRequest]);

  const close = useCallback(() => {
    setOpen(false);
    setInitialFocus(null);
  }, []);

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      data-custom={Boolean(trigger)}
      data-variant={triggerVariant}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      className="tw:inline-flex tw:size-control-md tw:min-h-control-md tw:min-w-control-md tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-0 tw:rounded-sm tw:border tw:border-transparent tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:leading-none tw:text-muted-foreground tw:shadow-none tw:data-[custom=true]:h-control-md tw:data-[custom=true]:w-auto tw:data-[custom=true]:min-w-0 tw:data-[custom=true]:gap-2 tw:data-[custom=true]:rounded-xs tw:data-[custom=true]:px-2 tw:data-[custom=true]:font-semibold tw:data-[custom=true]:text-foreground tw:data-[custom=true]:data-[variant=composer]:h-control-sm tw:data-[custom=true]:data-[variant=composer]:min-h-control-sm tw:data-[custom=true]:data-[variant=composer]:w-full tw:data-[custom=true]:data-[variant=composer]:justify-start tw:data-[custom=true]:data-[variant=composer]:gap-1.5 tw:data-[custom=true]:data-[variant=composer]:text-left tw:data-[custom=true]:data-[variant=composer]:text-ui tw:data-[custom=true]:data-[variant=composer]:font-medium tw:data-[custom=true]:data-[variant=badge]:h-auto tw:data-[custom=true]:data-[variant=badge]:min-h-control-xs tw:data-[custom=true]:data-[variant=badge]:gap-1 tw:data-[custom=true]:data-[variant=badge]:border-border-subtle tw:data-[custom=true]:data-[variant=badge]:px-1.5 tw:data-[custom=true]:data-[variant=badge]:text-2xs tw:data-[custom=true]:data-[variant=badge]:font-medium tw:data-[custom=true]:data-[variant=badge]:text-muted-foreground tw:data-[custom=true]:data-[variant=treeBadge]:h-[var(--ds-tree-badge-height)] tw:data-[custom=true]:data-[variant=treeBadge]:min-h-[var(--ds-tree-badge-height)] tw:data-[custom=true]:data-[variant=treeBadge]:gap-1 tw:data-[custom=true]:data-[variant=treeBadge]:border-border-subtle tw:data-[custom=true]:data-[variant=treeBadge]:px-1.5 tw:data-[custom=true]:data-[variant=treeBadge]:text-2xs tw:data-[custom=true]:data-[variant=treeBadge]:font-medium tw:data-[custom=true]:data-[variant=treeBadge]:text-muted-foreground tw:data-[custom=true]:data-[variant=statusBar]:h-full tw:data-[custom=true]:data-[variant=statusBar]:min-h-0 tw:data-[custom=true]:data-[variant=statusBar]:gap-1 tw:data-[custom=true]:data-[variant=statusBar]:rounded-none tw:data-[custom=true]:data-[variant=statusBar]:border-y-0 tw:data-[custom=true]:data-[variant=statusBar]:border-r-0 tw:data-[custom=true]:data-[variant=statusBar]:border-l-border-subtle tw:data-[custom=true]:data-[variant=statusBar]:px-1.5 tw:data-[custom=true]:data-[variant=statusBar]:text-xs tw:data-[custom=true]:data-[variant=statusBar]:font-normal tw:data-[custom=true]:data-[variant=statusBar]:text-muted-foreground tw:data-[custom=false]:data-[variant=treeAction]:size-control-xs tw:data-[custom=false]:data-[variant=treeAction]:min-h-control-xs tw:data-[custom=false]:data-[variant=treeAction]:min-w-control-xs tw:data-[custom=false]:data-[variant=treeAction]:rounded-xs tw:data-[custom=false]:data-[variant=compact]:size-control-sm tw:data-[custom=false]:data-[variant=compact]:min-h-control-sm tw:data-[custom=false]:data-[variant=compact]:min-w-control-sm tw:data-[custom=false]:data-[variant=compact]:rounded-xs tw:data-[custom=false]:data-[variant=gridHeader]:size-control-xs tw:data-[custom=false]:data-[variant=gridHeader]:min-h-control-xs tw:data-[custom=false]:data-[variant=gridHeader]:min-w-control-xs tw:data-[custom=false]:data-[variant=gridHeader]:rounded-xs tw:aria-expanded:border-transparent tw:aria-expanded:bg-selection tw:aria-expanded:text-selection-foreground tw:aria-pressed:border-transparent tw:aria-pressed:bg-selection tw:aria-pressed:text-selection-foreground tw:disabled:cursor-default tw:data-[busy=true]:disabled:cursor-progress tw:disabled:opacity-55 tw:hover:bg-muted tw:hover:text-foreground tw:data-[custom=true]:data-[variant=badge]:hover:border-ring tw:data-[custom=true]:data-[variant=badge]:hover:bg-transparent tw:data-[custom=true]:data-[variant=treeBadge]:hover:border-ring tw:data-[custom=true]:data-[variant=treeBadge]:hover:bg-transparent tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:[&_.icon]:shrink-0 tw:[&_.icon]:text-[length:var(--ds-icon-sm)]"
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
          setInitialFocus(null);
          setOpen(true);
        }
      }}
      onKeyDown={(event) => {
        const focus = menuInitialFocusForTriggerKey(event.key);
        if (!focus) return;
        event.preventDefault();
        event.stopPropagation();
        setInitialFocus(focus);
        setOpen(true);
      }}
    >
      {trigger ?? (icon ? <Icon name={icon} /> : null)}
    </button>
  );

  return (
    <span
      data-variant={triggerVariant}
      className="tw:inline-flex tw:min-w-0 tw:max-w-full tw:shrink-0 tw:data-[variant=statusBar]:h-full tw:[&>button]:max-w-full"
    >
      {trigger ? (
        triggerButton
      ) : (
        <Tooltip label={label}>{triggerButton}</Tooltip>
      )}
      {open ? (
        <Menu
          id={menuId}
          anchorRef={triggerRef}
          placement={align === "start" ? "bottom-start" : "bottom-end"}
          size={menuSize}
          ariaLabel={label}
          initialFocus={initialFocus}
          onRequestClose={close}
          onReferenceHidden={close}
        >
          {children}
        </Menu>
      ) : null}
    </span>
  );
}
