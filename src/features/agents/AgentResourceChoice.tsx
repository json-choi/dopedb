// One resource choice row and one write-target radio shared by the in-app scope
// menu, the external Agent picker, and the read-only start review. The rules
// live in agentResourceSelectionRules.ts; this file only renders them.
import type { ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import { useI18n } from "../../lib/i18n";

/** "menu" rows live inside a ToolbarMenu; "card" rows live in a dialog. */
type ChoiceLayout = "menu" | "card";

export function AgentResourceChoiceRow({
  layout,
  icon,
  label,
  detail,
  suffix,
  reconfirm = false,
  selection,
}: {
  layout: ChoiceLayout;
  icon: IconName;
  label: string;
  detail: string;
  suffix?: ReactNode;
  reconfirm?: boolean;
  /** Omit for the read-only variant. */
  selection?: { checked: boolean; disabled: boolean; onChange: () => void };
}) {
  const { t } = useI18n();
  const detailText = reconfirm ? `${detail} · ${t("agent.acpEnvironmentReconfirm")}` : detail;
  const body = (
    <>
      <Icon name={icon} className="tw:shrink-0 tw:text-muted-foreground" />
      <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
        <span className="tw:truncate tw:text-sm tw:font-medium">{label}</span>
        <span className="tw:truncate tw:text-xs tw:font-normal tw:text-muted-foreground">
          {detailText}
        </span>
      </span>
      {suffix ? <span className="tw:max-w-[40%] tw:shrink-0 tw:text-xs">{suffix}</span> : null}
    </>
  );
  if (!selection) {
    return (
      <div className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2">
        {body}
      </div>
    );
  }
  const { checked, disabled, onChange } = selection;
  return (
    <label
      data-checked={checked}
      data-disabled={disabled}
      data-menu-keep-open={layout === "menu" ? true : undefined}
      title={`${label} · ${detailText}`}
      className={
        layout === "menu"
          ? "tw:flex tw:min-h-control-md tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:py-1 tw:text-foreground tw:data-[checked=true]:bg-selection tw:data-[checked=true]:text-selection-foreground tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55 tw:hover:bg-muted"
          : "tw:flex tw:min-h-control-xl tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2 tw:data-[checked=true]:border-ring tw:data-[checked=true]:bg-selection tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55"
      }
    >
      <input
        type="checkbox"
        role={layout === "menu" ? "menuitemcheckbox" : undefined}
        aria-checked={layout === "menu" ? checked : undefined}
        aria-disabled={layout === "menu" ? disabled : undefined}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="tw:size-4 tw:shrink-0 tw:accent-primary"
      />
      {body}
    </label>
  );
}

export function AgentWriteTargetRadio({
  layout,
  checked,
  disabled,
  label,
  onChange,
}: {
  layout: ChoiceLayout;
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      data-checked={checked}
      data-disabled={disabled}
      data-menu-keep-open={layout === "menu" ? true : undefined}
      title={label}
      className={
        layout === "menu"
          ? "tw:flex tw:min-h-control-md tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:text-sm tw:font-medium tw:text-foreground tw:data-[checked=true]:bg-selection tw:data-[checked=true]:text-selection-foreground tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55 tw:hover:bg-muted"
          : "tw:flex tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:text-sm tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55"
      }
    >
      <input
        type="radio"
        role={layout === "menu" ? "menuitemradio" : undefined}
        aria-checked={layout === "menu" ? checked : undefined}
        aria-disabled={layout === "menu" ? disabled : undefined}
        name="agent-write-target"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="tw:size-4 tw:shrink-0 tw:accent-primary"
      />
      <span className="tw:min-w-0 tw:truncate">{label}</span>
    </label>
  );
}
