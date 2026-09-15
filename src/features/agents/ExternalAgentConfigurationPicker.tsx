// Owns editable Project resource selection for external Agent configuration.
import { useEffect, useMemo, useState } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { githubSourceRevisionLabel } from "../knowledge/presentation";
import type { ExternalAgentConfig, ExternalAgentRequestSummary } from "./externalAgentDomain";
import {
  EMPTY_EXTERNAL_AGENT_SELECTION,
  externalAgentResourceBoundaries,
  selectedExternalAgentResources,
  type ExternalAgentResourceSelection,
} from "./externalAgentRequestModel";
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
  ) => Promise<boolean>;
  onApprove: (config: ExternalAgentConfig) => void;
}) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<ExternalAgentResourceSelection>(
    EMPTY_EXTERNAL_AGENT_SELECTION,
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

  const resources = selectedExternalAgentResources(projects, selection);
  const resourceCount = resources.databases.length + resources.sources.length;
  const config = useMemo<ExternalAgentConfig | null>(() => {
    const anchorConnectionId =
      selection.writeConnectionId
      ?? resources.databases[0]?.connectionId
      ?? resources.sources[0]?.authorityConnectionId;
    if (!resources.project || !anchorConnectionId || resourceCount === 0) return null;
    return {
      schemaVersion: 1,
      provider: request.provider,
      projectId: resources.project.id,
      anchorConnectionId,
      resourceScopes: agentResourceScopes(resources.databases, resources.sources),
      ...(selection.writeConnectionId
        ? { writeConnectionId: selection.writeConnectionId }
        : {}),
    };
  }, [request.provider, resourceCount, resources, selection.writeConnectionId]);

  function toggle(resource: AgentDatabaseResourceChoice | AgentSourceResourceChoice) {
    if (disabled || preparing) return;
    setSelection((current) => {
      const sameProject = current.projectId === resource.projectId;
      const databaseIds = sameProject ? [...current.databaseIds] : [];
      const sourceIds = sameProject ? [...current.sourceIds] : [];
      if (resource.kind === "database") {
        const index = databaseIds.indexOf(resource.connectionId);
        if (index >= 0) databaseIds.splice(index, 1);
        else databaseIds.push(resource.connectionId);
      } else {
        const index = sourceIds.indexOf(resource.sourceId);
        if (index >= 0) sourceIds.splice(index, 1);
        else sourceIds.push(resource.sourceId);
      }
      if (databaseIds.length + sourceIds.length === 0) return current;
      return {
        projectId: resource.projectId,
        databaseIds,
        sourceIds,
        writeConnectionId:
          sameProject
          && current.writeConnectionId !== null
          && databaseIds.includes(current.writeConnectionId)
            ? current.writeConnectionId
            : null,
      };
    });
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
        <h2 className="tw:m-0 tw:text-base tw:font-semibold">
          {t("agent.externalChooseResources")}
        </h2>
        <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("agent.externalChooseResourcesBody")}
        </p>
      </div>
      {projects.map((project) => (
        <section key={project.id} className="tw:grid tw:gap-2">
          <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold">
            <Icon name="folder" className="tw:text-muted-foreground" />
            {project.name}
          </h3>
          <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:max-[760px]:grid-cols-1">
            {[...project.databases, ...project.sources].map((resource) => {
              const checked =
                resource.kind === "database"
                  ? selection.databaseIds.includes(resource.connectionId)
                  : selection.sourceIds.includes(resource.sourceId);
              const resourceDisabled =
                disabled || preparing || (checked && resourceCount === 1);
              return (
                <label
                  key={resource.key}
                  className="tw:flex tw:min-h-control-xl tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2 tw:data-[checked=true]:border-ring tw:data-[checked=true]:bg-selection tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55"
                  data-checked={checked}
                  data-disabled={resourceDisabled}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={resourceDisabled}
                    onChange={() => toggle(resource)}
                    className="tw:size-4 tw:accent-primary"
                  />
                  <Icon
                    name={resource.kind === "database" ? "database" : "branch"}
                    className="tw:text-muted-foreground"
                  />
                  <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
                    <span className="tw:truncate tw:text-sm tw:font-medium">
                      {resource.kind === "database"
                        ? resource.databaseName
                        : resource.displayName}
                    </span>
                    <span className="tw:truncate tw:text-xs tw:font-normal tw:text-muted-foreground">
                      {resource.kind === "database"
                        ? resource.engine
                        : githubSourceRevisionLabel(
                            resource.repository,
                            resource.commitSha,
                          )}
                    </span>
                  </span>
                </label>
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
          <label className="tw:flex tw:items-center tw:gap-2 tw:text-sm">
            <input
              type="radio"
              checked={selection.writeConnectionId === null}
              disabled={disabled || preparing}
              onChange={() =>
                setSelection((current) => ({ ...current, writeConnectionId: null }))
              }
              className="tw:size-4 tw:accent-primary"
            />
            {t("agent.acpReadOnlyContext")}
          </label>
          {resources.databases
            .filter((database) => database.writable)
            .map((database) => (
              <label
                key={database.connectionId}
                className="tw:flex tw:items-center tw:gap-2 tw:text-sm"
              >
                <input
                  type="radio"
                  checked={selection.writeConnectionId === database.connectionId}
                  disabled={disabled || preparing}
                  onChange={() =>
                    setSelection((current) => ({
                      ...current,
                      writeConnectionId: database.connectionId,
                    }))
                  }
                  className="tw:size-4 tw:accent-primary"
                />
                {database.databaseName}
              </label>
            ))}
        </fieldset>
      ) : null}
      <Button
        variant="primary"
        disabled={disabled || preparing || !config}
        data-modal-initial-focus
        onClick={() => void approve()}
      >
        {t("agent.externalSaveConfig")}
      </Button>
    </div>
  );
}
