// Canonical quiet environment marker for database rows. The localized kind name
// stays neutral; the small dot alone carries the operational status color.
export function EnvironmentBadge({
  kind,
  label,
}: {
  kind: "production" | "staging" | "test" | "development";
  label: string;
}) {
  return (
    <span
      data-environment={kind}
      className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:px-0.5 tw:font-mono tw:text-2xs tw:font-semibold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase"
    >
      <span
        aria-hidden="true"
        data-environment={kind}
        className="tw:size-1.5 tw:shrink-0 tw:rounded-full tw:bg-muted-foreground tw:data-[environment=development]:bg-success tw:data-[environment=staging]:bg-warning tw:data-[environment=production]:bg-danger"
      />
      {label}
    </span>
  );
}
