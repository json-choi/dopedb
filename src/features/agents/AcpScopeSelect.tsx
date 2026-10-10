// The context menu exposes one flat Project resource set: independent database
// and source checkboxes plus a separate, optional single write target.

import type { ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import { useI18n } from "../../lib/i18n";
import {
  databaseEngineLabel,
  type ConnectionId,
} from "../connections/domain";
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
  onOpenSafety,
}: {
  knowledge: AcpChatController["setup"]["knowledge"];
  starting: boolean;
  onToggle: (resourceKey: string) => void;
  onWriteTarget: (connectionId: ConnectionId | null) => void;
  onOpenSafety: (connectionId: ConnectionId) => void;
}) {
  const { t } = useI18n();
  if (!knowledge.success) return null;
  // A started conversation keeps its exact grant: the menu still opens so the
  // pinned set and the reason are visible, but nothing in it can change.
  const locked = !knowledge.scopeChangeAllowed;

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

  const triggerTitle = locked
    ? `${accessibleSelection} · ${t("agent.acpScopeLocked")}`
    : accessibleSelection;
  const firstSelectedDatabase = knowledge.selectedDatabases[0];

  return (
    <span className="tw:min-w-0 tw:flex-1">
      <ToolbarMenu
        label={triggerTitle}
        align="start"
        triggerVariant="composer"
        menuSize="scope"
        disabled={starting || knowledge.reconfirmingEnvironmentId !== null}
        busy={starting || knowledge.reconfirmingEnvironmentId !== null}
        trigger={
          <span
            className="tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5"
            title={triggerTitle}
          >
            <span className="tw:min-w-0 tw:flex-1 tw:truncate">{projectName ?? visibleSelection}</span>
            {projectName ? (
              <span className="tw:shrink-0 tw:text-2xs tw:text-muted-foreground">
                {t("agent.acpResourceCountsCompact", { databases: databaseCount, sources: sourceCount })}
              </span>
            ) : null}
            {selectedCount > 0 ? (
              <span className="tw:shrink-0 tw:text-2xs tw:font-medium tw:text-foreground" title={accessMode}>
                {writeDatabase ? t("agent.acpWriteCompact") : t("agent.acpReadCompact")}
              </span>
            ) : null}
            <Icon
              name={locked ? "lock" : "chevronDown"}
              className="tw:shrink-0 tw:text-muted-foreground"
            />
          </span>
        }
      >
        {locked ? (
          <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:px-2 tw:py-1.5 tw:text-xs tw:leading-body tw:text-muted-foreground">
            <Icon name="lock" className="tw:mt-0.5 tw:shrink-0" />
            {t("agent.acpScopeLocked")}
          </p>
        ) : null}
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
                  locked ||
                  (selectedCount === 1 &&
                    knowledge.selectedResourceKeys.has(database.key))
                }
                icon="database"
                label={database.databaseName}
                detail={
                  database.bindingAlias
                    ? `${databaseEngineLabel(database.engine)} · ${database.bindingAlias}`
                    : databaseEngineLabel(database.engine)
                }
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
                  locked ||
                  (selectedCount === 1 &&
                    knowledge.selectedResourceKeys.has(source.key))
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
              disabled={locked}
              label={t("agent.acpReadOnlyContext")}
              onChange={() => onWriteTarget(null)}
            />
            {knowledge.selectedDatabases
              .filter((database) => database.writable)
              .map((database) => (
                <WriteTargetRadio
                  key={database.connectionId}
                  checked={knowledge.writeConnectionId === database.connectionId}
                  disabled={locked}
                  label={database.databaseName}
                  onChange={() => onWriteTarget(database.connectionId)}
                />
              ))}
            {firstSelectedDatabase &&
            !knowledge.selectedDatabases.some((database) => database.writable) ? (
              <>
                <p className="tw:m-0 tw:px-2 tw:py-1 tw:text-xs tw:leading-body tw:text-muted-foreground">
                  {t("agent.acpNoWritableDatabase")}
                </p>
                <ToolbarMenuItem
                  icon="lock"
                  onClick={() => onOpenSafety(firstSelectedDatabase.connectionId)}
                >
                  {t("agent.acpOpenSafety")}
                </ToolbarMenuItem>
              </>
            ) : null}
          </div>
        ) : null}
      </ToolbarMenu>
    </span>
  );
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
      data-checked={checked}
      data-disabled={disabled}
      data-menu-keep-open
      title={`${label} · ${detail}${reconfirm ? ` · ${t("agent.acpEnvironmentReconfirm")}` : ""}`}
      className="tw:flex tw:min-h-control-md tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:py-1 tw:text-foreground tw:data-[checked=true]:bg-selection tw:data-[checked=true]:text-selection-foreground tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55 tw:hover:bg-muted"
    >
      <input
        type="checkbox"
        role="menuitemcheckbox"
        aria-checked={checked}
        aria-disabled={disabled}
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
      {suffix ? <span className="tw:shrink-0">{suffix}</span> : null}
    </label>
  );
}

function WriteTargetRadio({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      data-checked={checked}
      data-disabled={disabled}
      data-menu-keep-open
      title={label}
      className="tw:flex tw:min-h-control-md tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:text-sm tw:font-medium tw:text-foreground tw:data-[checked=true]:bg-selection tw:data-[checked=true]:text-selection-foreground tw:data-[disabled=true]:cursor-default tw:data-[disabled=true]:opacity-55 tw:hover:bg-muted"
    >
      <input
        type="radio"
        role="menuitemradio"
        aria-checked={checked}
        aria-disabled={disabled}
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
