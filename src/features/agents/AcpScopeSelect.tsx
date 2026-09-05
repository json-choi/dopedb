// The context menu exposes one flat Project resource set: independent database
// and source checkboxes plus a separate, optional single write target.

import type { ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import ToolbarMenu from "../../components/ToolbarMenu";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import { useI18n } from "../../lib/i18n";
import type { ConnectionEngine, ConnectionId } from "../connections/domain";
import {
  githubSourceRevisionLabel,
  knowledgeEnvironmentBadge,
} from "../knowledge/presentation";
import type { AcpChatController } from "./useAcpChatController";

export function AcpScopeSelect({
  knowledge,
  starting,
  onToggle,
  onWriteTarget,
}: {
  knowledge: AcpChatController["setup"]["knowledge"];
  starting: boolean;
  onToggle: (resourceKey: string) => void;
  onWriteTarget: (connectionId: ConnectionId | null) => void;
}) {
  const { t } = useI18n();
  if (!knowledge.success) return null;

  const databaseCount = knowledge.selectedDatabases.length;
  const sourceCount = knowledge.selectedSources.length;
  const selectedCount = databaseCount + sourceCount;
  const projectName = knowledge.selectedProject?.name;
  const writeDatabase = knowledge.selectedDatabases.find(
    (database) => database.connectionId === knowledge.writeConnectionId,
  );
  const accessMode = writeDatabase
    ? t("agent.acpWriteTargetNamed", { database: writeDatabase.databaseName })
    : t("agent.acpReadOnlyContext");
  const visibleSelection = projectName
    ? t("agent.acpResourceScopeTrigger", {
        project: projectName,
        databases: databaseCount,
        sources: sourceCount,
        mode: accessMode,
      })
    : t("agent.acpSelectResources");
  const accessibleSelection = projectName
    ? t("agent.acpCurrentResourceScope", {
        project: projectName,
        databases: databaseCount,
        sources: sourceCount,
        mode: accessMode,
      })
    : t("agent.acpSelectResources");

  return (
    <span className="tw:col-start-3 tw:w-full tw:min-w-[4rem] tw:max-w-[18rem] tw:justify-self-end">
      <ToolbarMenu
        label={accessibleSelection}
        align="end"
        menuSize="scope"
        disabled={
          starting ||
          !knowledge.scopeChangeAllowed ||
          knowledge.reconfirmingEnvironmentId !== null
        }
        trigger={
          <span
            className="tw:flex tw:min-w-0 tw:max-w-[17rem] tw:items-center tw:gap-1.5"
            title={accessibleSelection}
          >
            <span className="tw:min-w-0 tw:truncate">{visibleSelection}</span>
            {selectedCount > 0 ? (
              <span className="tw:shrink-0 tw:rounded-full tw:bg-muted tw:px-1.5 tw:text-2xs tw:font-semibold tw:text-muted-foreground">
                {selectedCount}
              </span>
            ) : null}
            <Icon
              name="chevronDown"
              className="tw:shrink-0 tw:text-muted-foreground"
            />
          </span>
        }
      >
        {knowledge.projects.map((project, projectIndex) => (
          <div
            key={project.id}
            role="group"
            aria-label={project.name}
            data-separated={projectIndex > 0}
            className="tw:grid tw:gap-0.5 tw:data-[separated=true]:mt-1 tw:data-[separated=true]:border-t tw:data-[separated=true]:border-border-subtle tw:data-[separated=true]:pt-1"
          >
            <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:px-2 tw:pt-1.5 tw:pb-1">
              <Icon name="folder" className="tw:shrink-0 tw:text-muted-foreground" />
              <span className="tw:min-w-0 tw:truncate tw:text-xs tw:font-semibold tw:text-foreground">
                {project.name}
              </span>
            </div>
            {project.databases.length > 0 ? (
              <ResourceGroupLabel>{t("agent.acpDatabaseResources")}</ResourceGroupLabel>
            ) : null}
            {project.databases.map((database) => (
              <ResourceCheckbox
                key={database.key}
                checked={knowledge.selectedResourceKeys.has(database.key)}
                disabled={
                  selectedCount === 1 &&
                  knowledge.selectedResourceKeys.has(database.key)
                }
                icon="database"
                label={database.databaseName}
                detail={databaseEngineLabel(database.engine)}
                suffix={
                  <EnvironmentBadge
                    environment={knowledgeEnvironmentBadge(database.riskClass)}
                  />
                }
                reconfirm={database.needsReconfirmation}
                onChange={() => onToggle(database.key)}
              />
            ))}
            {project.sources.length > 0 ? (
              <ResourceGroupLabel>{t("agent.acpSourceResources")}</ResourceGroupLabel>
            ) : null}
            {project.sources.map((source) => (
              <ResourceCheckbox
                key={source.key}
                checked={knowledge.selectedResourceKeys.has(source.key)}
                disabled={
                  selectedCount === 1 &&
                  knowledge.selectedResourceKeys.has(source.key)
                }
                icon="branch"
                label={source.displayName}
                detail={githubSourceRevisionLabel(
                  source.repository,
                  source.commitSha,
                )}
                reconfirm={source.needsReconfirmation}
                onChange={() => onToggle(source.key)}
              />
            ))}
          </div>
        ))}

        {knowledge.selectedProject ? (
          <div
            role="radiogroup"
            aria-label={t("agent.acpWriteTarget")}
            data-menu-keep-open
            className="tw:mt-1 tw:grid tw:gap-0.5 tw:border-t tw:border-border-subtle tw:pt-1"
          >
            <ResourceGroupLabel>{t("agent.acpWriteTarget")}</ResourceGroupLabel>
            <WriteTargetRadio
              checked={knowledge.writeConnectionId === null}
              label={t("agent.acpReadOnlyContext")}
              onChange={() => onWriteTarget(null)}
            />
            {knowledge.selectedDatabases
              .filter((database) => database.writable)
              .map((database) => (
                <WriteTargetRadio
                  key={database.connectionId}
                  checked={knowledge.writeConnectionId === database.connectionId}
                  label={database.databaseName}
                  onChange={() => onWriteTarget(database.connectionId)}
                />
              ))}
            {knowledge.selectedDatabases.length > 0 &&
            !knowledge.selectedDatabases.some((database) => database.writable) ? (
              <p className="tw:m-0 tw:px-2 tw:py-1 tw:text-xs tw:leading-body tw:text-muted-foreground">
                {t("agent.acpNoWritableDatabase")}
              </p>
            ) : null}
          </div>
        ) : null}
      </ToolbarMenu>
    </span>
  );
}

function databaseEngineLabel(engine: ConnectionEngine) {
  switch (engine) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    case "mongodb":
      return "MongoDB";
    case "bigquery":
      return "BigQuery";
  }
}

function ResourceGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div
      role="presentation"
      className="tw:px-2 tw:pt-1 tw:pb-0.5 tw:text-2xs tw:font-semibold tw:tracking-[0.05em] tw:text-muted-foreground tw:uppercase"
    >
      {children}
    </div>
  );
}

function ResourceCheckbox({
  checked,
  disabled,
  icon,
  label,
  detail,
  suffix,
  reconfirm,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  icon: IconName;
  label: string;
  detail: string;
  suffix?: ReactNode;
  reconfirm: boolean;
  onChange: () => void;
}) {
  const { t } = useI18n();
  return (
    <label
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled}
      data-menu-keep-open
      className="tw:flex tw:min-h-control-md tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:py-1 tw:text-foreground tw:aria-checked:bg-selection tw:aria-checked:text-selection-foreground tw:aria-disabled:cursor-default tw:aria-disabled:opacity-55 tw:hover:bg-muted"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="tw:size-4 tw:shrink-0 tw:accent-primary"
      />
      <Icon name={icon} className="tw:shrink-0 tw:text-muted-foreground" />
      <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
        <span className="tw:truncate tw:text-sm tw:font-medium">{label}</span>
        <span className="tw:truncate tw:text-xs tw:font-normal tw:text-muted-foreground">
          {detail}
          {reconfirm ? ` · ${t("agent.acpEnvironmentReconfirm")}` : ""}
        </span>
      </span>
      {suffix}
    </label>
  );
}

function WriteTargetRadio({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      role="menuitemradio"
      aria-checked={checked}
      data-menu-keep-open
      className="tw:flex tw:min-h-control-md tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:text-sm tw:font-medium tw:text-foreground tw:aria-checked:bg-selection tw:aria-checked:text-selection-foreground tw:hover:bg-muted"
    >
      <input
        type="radio"
        name="agent-write-target"
        checked={checked}
        onChange={onChange}
        className="tw:size-4 tw:accent-primary"
      />
      <span className="tw:min-w-0 tw:truncate">{label}</span>
    </label>
  );
}
