// Main destinations reuse the Explorer's exact environment commands.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../../components/Icon";
import { WorkspaceNavButton } from "../../design-system/components/AppChrome";
import type { KnowledgeEnvironmentFocus, KnowledgeEnvironmentView } from "../knowledge/domain";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { knowledgeInventoryQuery } from "../knowledge/inventory";

export function WorkspaceNavigation({ workspace, focus, onNavigate }: {
  workspace: ReactNode;
  focus: KnowledgeEnvironmentFocus | null;
  onNavigate: (environmentId: string | null, view: KnowledgeEnvironmentView) => void;
}) {
  const { t } = useI18n();
  const scope = useCatalogScope();
  const inventory = useQuery(knowledgeInventoryQuery(scope.key, scope.ready && (scope.workspaceKind === "personal" || scope.accountScope !== null)));
  const environmentId = focus?.environmentId ?? inventory.data?.projects[0]?.environments[0]?.id ?? null;
  return <div className="tw:grid tw:gap-4 tw:px-3 tw:pt-4 tw:pb-3">
    <div className="tw:min-w-0 tw:px-1 tw:pb-1">{workspace}</div>
    <nav className="tw:grid tw:gap-1" aria-label={t("ide.mainToolbar")}>
      <WorkspaceNavButton active={focus?.view !== "analyses"} icon={<Icon name="database" />} onClick={() => onNavigate(environmentId, "databases")}>{t("connections.environmentDatabases")}</WorkspaceNavButton>
      <WorkspaceNavButton active={focus?.view === "analyses"} icon={<Icon name="chart" />} onClick={() => onNavigate(environmentId, "analyses")}>{t("analysis.navigation")}</WorkspaceNavButton>
    </nav>
  </div>;
}
