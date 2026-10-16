// Public CLI account identity shared by setup and chat. Authentication stays
// in the official CLI; this component never reads a credential or starts login.
import { useI18n } from "../../lib/i18n";
import type { AgentCliInfo } from "./domain";

export function AgentAccountIdentity({ cli }: { cli: AgentCliInfo | null | undefined }) {
  const { t } = useI18n();
  if (!cli?.authenticated) return null;
  const identity = cli.accountEmail ?? (cli.authMethod === "apiKey"
    ? t("agentTools.apiKeyAccount") : t("agentTools.accountIdentityUnavailable"));
  return <span className="tw:block tw:min-w-0 tw:truncate tw:text-xs tw:text-muted-foreground" title={t("agentTools.cliAccount", { account: identity })}>
    {identity}{cli.accountPlan ? ` · ${cli.accountPlan}` : ""}
  </span>;
}
