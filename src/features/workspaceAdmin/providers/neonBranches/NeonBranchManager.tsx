// Neon safe-branch administration inside Settings → Providers → Shared databases. It
// discovers Neon project targets from managed connections and each integration's
// operation history, then mounts one keyed panel per project so selection, drafts and
// the reconcile timer never leak across projects, integration generations or scopes.
import { useId, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput } from "../../../../design-system/components/FormControls";
import { ProgressBar } from "../../../../design-system/components/Progress";
import { SettingsSectionHeader } from "../../../../design-system/components/SettingsList";
import { useI18n } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import type { Integration, ManagedConnection } from "../domain";
import { neonOperationsBelongTo } from "./branchOperations";
import { neonOperationBusy } from "./domain";
import {
  neonProjectTargets,
  neonReferenceFingerprint,
  type NeonOperationCatalog,
  type NeonProjectTarget,
} from "./model";
import NeonBranchBrowser from "./NeonBranchBrowser";
import NeonBranchCreateForm from "./NeonBranchCreateForm";
import NeonOperationHistory from "./NeonOperationHistory";
import NeonSafeRunTracker from "./NeonSafeRunTracker";
import { neonBranchOperationsQuery } from "./queries";
import { useNeonBranchManager } from "./useNeonBranchManager";

export interface NeonBranchManagerProps {
  scope: WorkspaceAdminScope;
  integrations: Integration[];
  managedConnections: ManagedConnection[];
}

export default function NeonBranchManager({
  scope,
  integrations,
  managedConnections,
}: NeonBranchManagerProps) {
  const { lang } = useI18n();
  const neonIntegrations = useMemo(
    () => integrations.filter((integration) => (
      integration.provider === "neon" && integration.status === "active"
    )),
    [integrations],
  );
  // Operation history also names projects that no shared database references yet.
  const catalogs = useQueries({
    queries: neonIntegrations.map((integration) => neonBranchOperationsQuery(
      scope,
      integration,
      neonReferenceFingerprint(managedConnections, integration.id),
    )),
  });
  const operationCatalogs: NeonOperationCatalog[] = neonIntegrations.flatMap((integration, index) => {
    const catalog = catalogs[index]?.data;
    return catalog && neonOperationsBelongTo(catalog, integration)
      ? [{ integration, operations: catalog.operations }]
      : [];
  });
  const targets = neonProjectTargets(integrations, managedConnections, operationCatalogs, lang);
  const [targetKey, setTargetKey] = useState("");
  const target = targets.find((item) => item.key === targetKey) ?? targets[0] ?? null;
  if (!target) return null;
  return (
    <NeonProjectPanel
      key={`${target.key}:${target.integration.generation}`}
      scope={scope}
      target={target}
      targets={targets}
      onSelectTarget={setTargetKey}
      managedConnections={managedConnections}
    />
  );
}

function NeonProjectPanel({
  scope,
  target,
  targets,
  onSelectTarget,
  managedConnections,
}: {
  scope: WorkspaceAdminScope;
  target: NeonProjectTarget;
  targets: readonly NeonProjectTarget[];
  onSelectTarget: (key: string) => void;
  managedConnections: readonly ManagedConnection[];
}) {
  const { t } = useI18n();
  const titleId = useId();
  const createFormId = useId();
  const controller = useNeonBranchManager({ scope, target, managedConnections });
  const { busy, refreshing, showCreate, inventory } = controller;
  const working = busy || refreshing || controller.operations.some(neonOperationBusy);

  return (
    <section
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <SettingsSectionHeader
          title={<span id={titleId}>{t("workspaceNeonBranches.title")}</span>}
          trailing={(
            <div className="ds-control-row tw:flex tw:items-center tw:gap-[var(--ds-control-gap)]">
              <Button
                size="compact"
                iconOnly
                title={t("common.refresh")}
                disabled={busy || refreshing}
                onClick={controller.refresh}
              >
                <Icon name="refresh" />
              </Button>
              <Button
                size="compact"
                aria-expanded={showCreate}
                aria-controls={showCreate ? createFormId : undefined}
                disabled={busy || !inventory}
                onClick={controller.toggleCreate}
              >
                <Icon name={showCreate ? "close" : "plus"} />
                {t(showCreate
                  ? "workspaceNeonBranches.closeCreate"
                  : "workspaceNeonBranches.createSafeBranch")}
              </Button>
            </div>
          )}
        />
        <p className="tw:m-0 tw:max-w-[680px] tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceNeonBranches.description")}
        </p>
      </div>

      <div className="tw:h-0.5">
        {working ? (
          <ProgressBar value={null} density="compact" label={t("workspaceNeonBranches.progress")} />
        ) : null}
      </div>

      {targets.length > 1 ? (
        <div className="tw:max-w-[420px]">
          <Field label={t("workspaceNeonBranches.neonProject")}>
            <SelectInput
              density="compact"
              value={target.key}
              disabled={busy}
              onChange={(event) => onSelectTarget(event.target.value)}
            >
              {targets.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
      ) : (
        <p className="tw:m-0 tw:truncate tw:font-mono tw:text-xs tw:text-muted-foreground">
          {t("workspaceNeonBranches.project", { project: target.projectId })}
        </p>
      )}

      <NeonSafeRunTracker controller={controller} />
      <NeonBranchCreateForm id={createFormId} controller={controller} />
      <NeonBranchBrowser controller={controller} />
      <NeonOperationHistory controller={controller} />
    </section>
  );
}
