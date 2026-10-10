// Tiny toast system: context + hook + a fixed corner stack with success/error
// variants. useToast() returns `toast(msg, variant?, action?)`. A plain toast
// auto-dismisses after 3s; one with an action stays 10s so keyboard and pointer
// users can reach it. Every toast pauses while hovered or focused, and Escape
// or a click dismisses it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "../design-system/components/Button";
import { useI18n } from "../lib/i18n";

type Variant = "success" | "error";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  msg: string;
  variant: Variant;
  action?: ToastAction;
}

type ToastFn = (msg: string, variant?: Variant, action?: ToastAction) => void;

const PLAIN_TOAST_MS = 3000;
const ACTION_TOAST_MS = 10_000;

const Ctx = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  const pause = useCallback((id: number) => {
    window.clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
  }, []);

  const dismiss = useCallback((id: number) => {
    pause(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, [pause]);

  const schedule = useCallback((item: Pick<ToastItem, "id" | "action">) => {
    pause(item.id);
    timersRef.current.set(
      item.id,
      window.setTimeout(
        () => dismiss(item.id),
        item.action ? ACTION_TOAST_MS : PLAIN_TOAST_MS,
      ),
    );
  }, [dismiss, pause]);

  const toast = useCallback<ToastFn>((msg, variant = "success", action) => {
    const id = idRef.current++;
    // cap the stack so a burst can't overflow off-screen
    setToasts((current) => [...current, { id, msg, variant, action }].slice(-4));
    schedule({ id, action });
  }, [schedule]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      {/* live region so screen readers announce toasts */}
      <div
        className="tw:pointer-events-none tw:fixed tw:right-4 tw:bottom-4 tw:z-[var(--ds-z-toast)] tw:flex tw:flex-col tw:gap-2 tw:max-[640px]:right-3 tw:max-[640px]:bottom-3 tw:max-[640px]:left-3"
        role="region"
        aria-label={t("ide.notifications")}
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            data-variant={item.variant}
            className="tw:pointer-events-auto tw:flex tw:min-w-[180px] tw:max-w-[360px] tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:border-l-[3px] tw:border-l-success tw:bg-card tw:px-4 tw:py-3 tw:text-ui tw:text-foreground tw:shadow-popover tw:animate-[toast-in_150ms_ease-out] tw:data-[variant=error]:border-l-danger tw:max-[640px]:w-full tw:max-[640px]:min-w-0 tw:max-[640px]:max-w-none"
            role={item.variant === "error" ? "alert" : "status"}
            onClick={() => dismiss(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              dismiss(item.id);
            }}
            onMouseEnter={() => pause(item.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) schedule(item);
            }}
            onFocus={() => pause(item.id)}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) return;
              if (!event.currentTarget.matches(":hover")) schedule(item);
            }}
          >
            <span className="tw:min-w-0 tw:flex-1 tw:[overflow-wrap:anywhere]">{item.msg}</span>
            {item.action ? (
              // The click also bubbles to the toast, which dismisses it.
              <Button size="compact" onClick={item.action.onClick}>
                {item.action.label}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
