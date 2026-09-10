// Canonical searchable action popup. Feature screens supply real commands and
// grouping; this primitive owns the shared floating surface, search control,
// and dense result-row treatment.
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";

export type CommandMenuDismissReason = "escape" | "outside" | "selection";

export const CommandMenu = forwardRef<
  HTMLDivElement,
  {
    id?: string;
    placement?: "anchor" | "center";
    label: string;
    searchLabel: string;
    searchPlaceholder: string;
    searchValue: string;
    onSearchChange: (value: string) => void;
    onDismiss: (reason: CommandMenuDismissReason) => void;
    returnFocusRef: RefObject<HTMLElement | null>;
    children: ReactNode;
  }
>(function CommandMenu(
  {
    id,
    placement = "anchor",
    label,
    searchLabel,
    searchPlaceholder,
    searchValue,
    onSearchChange,
    onDismiss,
    returnFocusRef,
    children,
  },
  ref,
) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !surfaceRef.current?.contains(event.target) &&
        !returnFocusRef.current?.contains(event.target)
      ) {
        onDismiss("outside");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onDismiss, returnFocusRef]);

  function setRefs(node: HTMLDivElement | null) {
    surfaceRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  return (
    <div
      ref={setRefs}
      id={id}
      data-placement={placement}
      role="dialog"
      aria-label={label}
      className="tw:absolute tw:top-[calc(100%+var(--ds-popover-offset))] tw:left-0 tw:z-[var(--ds-z-popover)] tw:flex tw:max-h-[min(440px,calc(100dvh-var(--ds-space-6)))] tw:w-[min(320px,calc(100vw-var(--ds-space-6)))] tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-strong tw:bg-popover tw:text-popover-foreground tw:shadow-popover tw:data-[placement=center]:fixed tw:data-[placement=center]:top-1/2 tw:data-[placement=center]:left-1/2 tw:data-[placement=center]:-translate-x-1/2 tw:data-[placement=center]:-translate-y-1/2"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss("escape");
        window.requestAnimationFrame(() =>
          returnFocusRef.current?.focus({ preventScroll: true }),
        );
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button:not(:disabled)")) {
          onDismiss("selection");
        }
      }}
    >
      <div className="tw:border-b tw:border-border-subtle tw:p-2">
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          autoFocus
          data-modal-initial-focus
          className="tw:h-control-lg tw:w-full tw:rounded-none tw:border tw:border-input tw:bg-background tw:px-3 tw:font-sans tw:text-ui tw:text-foreground tw:shadow-control tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-ring tw:focus:ring-2 tw:focus:ring-ring/30"
        />
      </div>
      <div className="tw:grid tw:min-h-0 tw:gap-3 tw:overflow-y-auto tw:overscroll-contain tw:p-2">
        {children}
      </div>
    </div>
  );
});

export function CommandMenuGroup({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tw:grid tw:gap-0.5">
      <h3 className="tw:px-2 tw:py-1 tw:text-xs tw:font-semibold tw:text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function CommandMenuItem({
  leading,
  trailing,
  description,
  children,
  ...props
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children"
>) {
  return (
    <button
      type="button"
      className="tw:flex tw:min-h-control-lg tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:py-1.5 tw:font-sans tw:text-left tw:text-foreground tw:aria-selected:bg-selection tw:aria-selected:text-selection-foreground tw:aria-selected:hover:bg-selection tw:disabled:cursor-default tw:disabled:opacity-40 tw:hover:bg-muted tw:focus-visible:bg-muted tw:focus-visible:outline-none"
      {...props}
    >
      {leading ? (
        <span className="tw:grid tw:size-control-sm tw:shrink-0 tw:place-items-center">
          {leading}
        </span>
      ) : null}
      <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
        <span className="tw:truncate tw:text-sm">{children}</span>
        {description ? (
          <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
