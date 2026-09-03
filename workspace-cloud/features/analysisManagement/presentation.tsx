// Presentation helpers format Analysis operational state without owning workflow state.
export function dateTime(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toLocaleString();
}
export function bytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function stateTone(state: string) {
  if (state === "succeeded") return "success";
  if (["failed", "cancelled", "stale", "revoked"].includes(state)) return "danger";
  return "neutral";
}

export function StatusPill({ value, label = value }: { value: string; label?: string }) {
  return (
    <span
      className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:bg-surface-inset tw:px-2 tw:py-1 tw:font-mono tw:text-2xs tw:text-muted-foreground tw:data-[tone=success]:border-success/25 tw:data-[tone=success]:bg-success/5 tw:data-[tone=success]:text-success tw:data-[tone=danger]:border-danger/25 tw:data-[tone=danger]:bg-danger/5 tw:data-[tone=danger]:text-danger"
      data-tone={stateTone(value)}
    >
      <i className="tw:size-1.5 tw:rounded-full tw:bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
