// Canonical keyboard and pointer resize boundary. Feature owners keep the
// persisted dimension and pointer drag lifecycle; this primitive owns ARIA,
// bounded keyboard steps, and the caller's double-click/Enter action.
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEventHandler,
} from "react";
import { Tooltip } from "./Tooltip";

export type ResizeSeparatorOrientation = "horizontal" | "vertical";

export function resizeSeparatorNextValue({
  key,
  value,
  minimum,
  maximum,
  step,
}: {
  key: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
}) {
  const next =
    key === "Home"
      ? minimum
      : key === "End"
        ? maximum
        : key === "ArrowLeft" || key === "ArrowDown"
          ? value - step
          : key === "ArrowRight" || key === "ArrowUp"
            ? value + step
            : null;
  return next === null ? null : Math.min(maximum, Math.max(minimum, next));
}
type ResizeSeparatorProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "aria-label" | "onChange" | "onDoubleClick" | "onKeyDown" | "role"
> & {
  label: string;
  tooltip?: string;
  orientation: ResizeSeparatorOrientation;
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  onChange: (value: number) => void;
  onReset: () => void;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
};

export function ResizeSeparator({
  label,
  tooltip,
  orientation,
  value,
  minimum,
  maximum,
  step = 8,
  onChange,
  onReset,
  onMouseDown,
  className,
  ...props
}: ResizeSeparatorProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onReset();
      return;
    }
    const next = resizeSeparatorNextValue({
      key: event.key,
      value,
      minimum,
      maximum,
      step,
    });
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(next);
  };

  const separator = (
    <div
      {...props}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      tabIndex={0}
      title={tooltip ? undefined : label}
      className={`tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/45 ${className ?? ""}`}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
    />
  );
  return tooltip ? <Tooltip label={tooltip}>{separator}</Tooltip> : separator;
}
