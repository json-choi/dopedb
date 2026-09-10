// Canonical dense settings inventory. Every row shares one identity, state/meta,
// and action grid so mixed controls remain scannable without card-like whitespace.
import type { ReactNode } from "react";

export function SettingsSectionHeader({
  title,
  info,
  trailing,
}: {
  title: ReactNode;
  info?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="tw:flex tw:min-h-control-xl tw:items-center tw:justify-between tw:gap-3">
      <div className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2">
        <h3 className="tw:m-0 tw:truncate">{title}</h3>
        {info}
      </div>
      {trailing ? <div className="tw:shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function SettingsList({ children }: { children: ReactNode }) {
  return (
    <div className="tw:mt-2 tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:divide-y tw:divide-border-subtle">
      {children}
    </div>
  );
}

export function SettingsRow({
  identity,
  details,
  actions,
  children,
}: {
  identity: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tw:grid tw:min-h-[56px] tw:grid-cols-[minmax(180px,32%)_minmax(0,1fr)_76px] tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:px-3 tw:py-2 tw:@max-[640px]:grid-cols-[minmax(0,1fr)_76px]">
      <div className="tw:min-w-0 tw:@max-[640px]:col-start-1 tw:@max-[640px]:row-start-1">
        {identity}
      </div>
      {details ? (
        <div className="tw:min-w-0 tw:@max-[640px]:col-start-1 tw:@max-[640px]:row-start-2">
          {details}
        </div>
      ) : null}
      {actions ? (
        <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-[var(--ds-control-gap)] tw:@max-[640px]:col-start-2 tw:@max-[640px]:row-span-2 tw:@max-[640px]:row-start-1">
          {actions}
        </div>
      ) : null}
      {children ? (
        <div className="tw:col-start-2 tw:col-end-4 tw:min-w-0 tw:@max-[640px]:col-start-1 tw:@max-[640px]:col-end-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
