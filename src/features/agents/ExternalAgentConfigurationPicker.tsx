// Owns editable Project resource selection for external Agent configuration.
import { useEffect, useMemo, useState } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { databaseEngineLabel } from "../connections/domain";
import { githubSourceRevisionLabel } from "../knowledge/presentation";
import { AgentResourceChoiceRow, AgentWriteTargetRadio } from "./AgentResourceChoice";
import {
  EMPTY_AGENT_RESOURCE_SELECTION,
  activeAgentWriteTarget,
  isLastSelectedAgentResource,
  selectAgentWriteTarget,
  selectedAgentResources,
  toggleAgentResource,
  type AgentResourceSelection,
} from "./agentResourceSelectionRules";
import type { ExternalAgentConfig, ExternalAgentRequestSummary } from "./externalAgentDomain";
import { externalAgentResourceBoundaries } from "./externalAgentRequestModel";
import { agentResourceScopes } from "./useAgentScopeSelection";
import type {
  AgentDatabaseResourceChoice,
  AgentProjectResourceChoice,
  AgentSourceResourceChoice,
} from "./useAgentEnvironmentInventory";

export function ExternalAgentConfigurationPicker({
  request,
  projects,
  disabled,
  ensureAvailable,
  onApprove,
}: {
  request: ExternalAgentRequestSummary;
  projects: AgentProjectResourceChoice[];
  disabled: boolean;
  ensureAvailable: (
    environmentId: string,
    authorityConnectionId: ConnectionId,
    connectionIds: readonly ConnectionId[],
  ) => Promise<boolean>;
  onApprove: (config: ExternalAgentConfig) => void;
}) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<AgentResourceSelection>(
    EMPTY_AGENT_RESOURCE_SELECTION,
  );
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (selection.projectId !== null || projects.length === 0) return;
    const project = projects[0];
    const database = project.databases[0];
    const source = database ? undefined : project.sources[0];
    setSelection({
      projectId: project.id,
      databaseIds: database ? [database.connectionId] : [],
      sourceIds: source ? [source.sourceId] : [],
      writeConnectionId: null,
    });
  }, [projects, selection.projectId]);

  const resources = selectedAgentResources(projects, selection);
  const resourceCount = resources.databases.length + resources.sources.length;
  const writeConnectionId = activeAgentWriteTarget(
    resources.databases,
    selection.writeConnectionId,
  );
  const config = useMemo<ExternalAgentConfig | null>(() => {
    const anchorConnectionId =
      writeConnectionId
      ?? resources.databases[0]?.connectionId
      ?? resources.sources[0]?.authorityConnectionId;
    if (!resources.project || !anchorConnectionId || resourceCount === 0) return null;
    return {
      schemaVersion: 1,
      provider: request.provider,
      projectId: resources.project.id,
      anchorConnectionId,
      resourceScopes: agentResourceScopes(resources.databases, resources.sources),
      ...(writeConnectionId ? { writeConnectionId } : {}),
    };
  }, [request.provider, resourceCount, resources, writeConnectionId]);

  function toggle(resource: AgentDatabaseResourceChoice | AgentSourceResourceChoice) {
    if (disabled || preparing) return;
    setSelection((current) => toggleAgentResource(current, resource) ?? current);
  }

  function selectWriteTarget(target: ConnectionId | null) {
    setSelection(
      (current) => selectAgentWriteTarget(current, resources.databases, target) ?? current,
    );
  }

  async function approve() {
    if (!config || disabled || preparing) return;
    setPreparing(true);
    try {
      for (const boundary of externalAgentResourceBoundaries(
        resources.databases,
        resources.sources,
      )) {
        if (
          boundary.stale
          && !(await ensureAvailable(
            boundary.environmentId,
            boundary.authorityConnectionId,
            boundary.connectionIds,
          ))
        ) {
          return;
        }
      }
      onApprove(config);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)] tw:gap-5 tw:[overflow-wrap:anywhere]">
      <div>
        <h2 className="tw:m-0 tw:text-title tw:font-semibold">
          {t("agent.externalChooseResources")}
        </h2>
        <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("agent.externalChooseResourcesBody")}
        </p>
      </div>
      {projects.map((project) => (
        <section key={project.id} className="tw:grid tw:gap-2">
          <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-2">
            <Icon name="folder" className="tw:text-muted-foreground" />
            {project.name}
          </h3>
          <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:max-[760px]:grid-cols-1">
            {[...project.databases, ...project.sources].map((resource) => {
              const checked =
                resource.kind === "database"
                  ? selection.databaseIds.includes(resource.connectionId)
                  : selection.sourceIds.includes(resource.sourceId);
              return (
                <AgentResourceChoiceRow
                  key={resource.key}
                  layout="card"
                  icon={resource.kind === "database" ? "database" : "branch"}
                  label={
                    resource.kind === "database"
                      ? resource.databaseName
                      : resource.displayName
                  }
                  detail={
                    resource.kind === "database"
                      ? databaseEngineLabel(resource.engine)
                      : githubSourceRevisionLabel(resource.repository, resource.commitSha)
                  }
                  selection={{
                    checked,
                    disabled:
                      disabled
                      || preparing
                      || isLastSelectedAgentResource(checked, resourceCount),
                    onChange: () => toggle(resource),
                  }}
                />
              );
            })}
          </div>
        </section>
      ))}
      {resources.databases.length > 0 ? (
        <fieldset className="tw:m-0 tw:grid tw:min-w-0 tw:gap-2 tw:border-0 tw:p-0">
          <legend className="tw:text-sm tw:font-semibold">
            {t("agent.acpWriteTarget")}
          </legend>
          <AgentWriteTargetRadio
            layout="card"
            checked={writeConnectionId === null}
            disabled={disabled || preparing}
            label={t("agent.acpReadOnlyContext")}
            onChange={() => selectWriteTarget(null)}
          />
          {resources.databases
            .filter((database) => database.writable)
            .map((database) => (
              <AgentWriteTargetRadio
                key={database.connectionId}
                layout="card"
                checked={writeConnectionId === database.connectionId}
                disabled={disabled || preparing}
                label={database.databaseName}
                onChange={() => selectWriteTarget(database.connectionId)}
              />
            ))}
        </fieldset>
      ) : null}
      <Button
        variant="primary"
        disabled={disabled || preparing || !config}
        onClick={() => void approve()}
      >
        {t("agent.externalSaveConfig")}
      </Button>
    </div>
  );
}
