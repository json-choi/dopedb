// Render the official adapter's advertised choices without inventing config IDs
// or locally persisting a permission mode across sessions.
import { Icon } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { useI18n } from "../../lib/i18n";
import type { AcpSessionConfigOption, AgentProvider } from "./domain";

export function AcpConfigSelect({
  provider,
  option,
  disabled,
  onChange,
}: {
  provider: AgentProvider;
  option: AcpSessionConfigOption;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const choices = option.options?.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  ) ?? [];
  if (typeof option.currentValue !== "string" || choices.length === 0) return null;
  const isMode = option.category === "mode";
  const name = isMode ? t("agent.acpApprovalMode") : option.name;
  function choiceLabel(value: string, fallback: string) {
    if (isMode && provider === "claude") {
      switch (value) {
        case "default":
          return t("agent.acpApprovalDefault");
        case "acceptEdits":
          return t("agent.acpApprovalEdits");
        case "plan":
          return t("agent.acpApprovalPlan");
        case "auto":
          return t("agent.acpApprovalAuto");
        case "bypassPermissions":
          return t("agent.acpApprovalBypass");
      }
    }
    return fallback;
  }
  const current = choices.find((choice) => choice.value === option.currentValue);
  const label = current
    ? choiceLabel(current.value, current.name)
    : option.currentValue;
  return (
    <ToolbarMenu
      label={`${name}: ${label}`}
      align="end"
      triggerVariant="composer"
      disabled={disabled}
      trigger={
        <>
          {isMode ? <Icon name="shield" /> : null}
          <span className="tw:min-w-0 tw:flex-1 tw:truncate" title={label}>
            {label}
          </span>
          <Icon name="chevronDown" />
        </>
      }
    >
      {choices.map((choice) => (
        <ToolbarMenuItem
          key={choice.value}
          icon={
            <span
              aria-hidden="true"
              className="tw:grid tw:size-3.5 tw:shrink-0 tw:place-items-center"
            >
              {choice.value === option.currentValue ? <Icon name="check" /> : null}
            </span>
          }
          role="menuitemradio"
          aria-checked={choice.value === option.currentValue}
          title={choice.description}
          onClick={() => {
            if (choice.value !== option.currentValue) onChange(choice.value);
          }}
        >
          {choiceLabel(choice.value, choice.name)}
        </ToolbarMenuItem>
      ))}
      {isMode ? (
        <p className="tw:m-0 tw:mt-1 tw:border-t tw:border-border-subtle tw:px-2 tw:py-2 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("agent.acpApprovalBoundary")}
        </p>
      ) : null}
    </ToolbarMenu>
  );
}
