// Presents one Knowledge Project and its database, source, and analysis resources.
// Connection catalog loading remains owned by DatabaseExplorer and is injected as a row renderer.
import type { ReactNode } from "react";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import {
  LoadingLabel,
  StatusDot,
  type StatusTone,
} from "../../design-system/components/Status";
import {
  TreeRowActions,
  TreeSectionButton,
} from "../../design-system/components/TreeControls";
import ToolbarMenu from "../../components/ToolbarMenu";
import type { ConnectionProfile } from "../../features/connections/domain";
import type {
  EnvironmentConnection,
  KnowledgeEnvironment,
  KnowledgeEnvironmentView,
  KnowledgeProject,
  KnowledgeSource,
} from "../../features/knowledge/domain";
import {
  knowledgeEnvironmentBadge,
  knowledgeRevisionLabel,
} from "../../features/knowledge/presentation";
import {
  flattenProjectEnvironmentResources,
  orderProjectDatabaseResources,
  preferredProjectEnvironment,
  projectResourceKey,
} from "../../features/catalogExplorer/projectResources";
import type { AnalysisArticleRecord } from "../../features/analysisArticles/domain";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { QueryResultPhase } from "../../lib/queryResultPhase";

interface AnalysisQueryState {
  data: AnalysisArticleRecord[] | undefined;
  error: unknown;
  isPending: boolean;
  refetch: () => Promise<unknown>;
}

type RenderConnection = (
  connection: ConnectionProfile,
  insideGroup?: boolean,
  treeParentKey?: string | null,
  treeLevel?: number,
  environment?: ReturnType<typeof knowledgeEnvironmentBadge>,
  projectEnvironmentId?: string,
  treeItemKey?: string,
  environmentBinding?: EnvironmentConnection,
) => ReactNode;

interface KnowledgeProjectTreeProps {
  project: KnowledgeProject;
  connections: ConnectionProfile[];
  projectEnvironmentIds: string[];
  environmentConnections: EnvironmentConnection[] | undefined;
  environmentConnectionsError: unknown;
  environmentConnectionsPhase: QueryResultPhase;
  sources: KnowledgeSource[] | undefined;
  sourcesError: unknown;
  sourcesPhase: QueryResultPhase;
  analysisQueries: Array<AnalysisQueryState | undefined>;
  sharedWorkspace: boolean;
  expanded: boolean;
  expandedResourceKeys: ReadonlySet<string>;
  deleting: boolean;
  unbindingBindingId: string | null;
  dropTargetEnvironmentId: string | null;
  dropTargetProjectId: string | null;
  activeEnvironmentId: string | null;
  activeView: KnowledgeEnvironmentView | null;
  activeResourceId: string | null;
  analysisFilter: string;
  databaseBindingOrder: readonly string[];
  renderConnection: RenderConnection;
  onToggleProject: () => void;
  onToggleResource: (resourceKey: string) => void;
  onAddEnvironment: () => void;
  onDeleteProject: () => void;
  onOpenEnvironment: (
    environmentId: string | null,
    view: KnowledgeEnvironmentView,
    resourceId?: string | null,
  ) => void;
  onNewConnection: (environmentId: string) => void;
  onRetryBindings: () => void;
  onRetrySources: () => void;
  onRemoveBinding: (binding: EnvironmentConnection) => void;
}

function sourceTone(source: KnowledgeSource): StatusTone {
  if (source.health === "ready") return "success";
  if (source.health === "failed") return "danger";
  return "warning";
}

function TreeLoadFailure({
  message,
  detail,
  retryLabel,
  treeItem,
  onRetry,
}: {
  message: string;
  detail: string;
  retryLabel: string;
  treeItem: { key: string; parentKey: string; level: number };
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      className="tw:flex tw:min-h-control-sm tw:w-full tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-left tw:font-sans tw:text-xs tw:text-danger tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
      onClick={onRetry}
      title={`${message}: ${detail}`}
      role="treeitem"
      aria-level={treeItem.level}
      data-explorer-tree-item
      data-explorer-tree-key={treeItem.key}
      data-explorer-tree-parent-key={treeItem.parentKey}
      data-tree-primary-action
      tabIndex={-1}
    >
      <Icon name="alert" className="tw:shrink-0" />
      <span className="tw:min-w-0 tw:flex-1 tw:truncate">{message}</span>
      <span className="tw:shrink-0">{retryLabel}</span>
    </button>
  );
}

export function KnowledgeProjectTree(props: KnowledgeProjectTreeProps) {
  const { t } = useI18n();
  const {
    project,
    expanded,
    deleting,
    activeEnvironmentId,
    onToggleProject,
    onAddEnvironment,
    onDeleteProject,
  } = props;
  const projectTreeKey = `project:${project.id}`;
  const activeEnvironmentBelongsToProject = project.environments.some(
    (environment) => environment.id === activeEnvironmentId,
  );

  return (
    <div className="tw:grid">
      <TreeSectionButton
        expanded={expanded}
        icon="folder"
        prominence="project"
        treeItem={{ key: projectTreeKey, parentKey: null, level: 1 }}
        selected={activeEnvironmentBelongsToProject && !expanded}
        actions={(
          <TreeRowActions>
            <Button
              iconOnly
              size="tree"
              variant="ghost"
              disabled={deleting}
              title={t("connections.addEnvironment")}
              aria-label={t("connections.addEnvironment")}
              tabIndex={-1}
              onClick={onAddEnvironment}
            >
              <Icon name="plus" />
            </Button>
            <ToolbarMenu
              icon="moreVertical"
              label={t("connections.projectMenu")}
              triggerVariant="treeAction"
              triggerTabIndex={-1}
            >
              <div role="none" data-menu-keep-open>
                <ConfirmButton
                  confirmLabel={t("connections.reallyDeleteProject")}
                  disabled={deleting}
                  presentation="menuItem"
                  size="compact"
                  tone="danger"
                  variant="ghost"
                  onConfirm={onDeleteProject}
                >
                  {t("connections.deleteProject")}
                </ConfirmButton>
              </div>
            </ToolbarMenu>
          </TreeRowActions>
        )}
        onToggle={onToggleProject}
      >
        {project.name}
      </TreeSectionButton>
      {expanded ? (
        <div className="tw:grid tw:border-l tw:border-border-strong tw:pl-1">
          <KnowledgeProjectResources
            {...props}
            projectTreeKey={projectTreeKey}
            activeEnvironmentBelongsToProject={activeEnvironmentBelongsToProject}
          />
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeProjectResources({
  project,
  connections,
  projectEnvironmentIds,
  environmentConnections,
  environmentConnectionsError,
  environmentConnectionsPhase,
  sources,
  sourcesError,
  sourcesPhase,
  analysisQueries,
  sharedWorkspace,
  expandedResourceKeys,
  unbindingBindingId,
  dropTargetEnvironmentId,
  dropTargetProjectId,
  activeEnvironmentId,
  activeView,
  activeResourceId,
  analysisFilter,
  databaseBindingOrder,
  renderConnection,
  onToggleResource,
  onAddEnvironment,
  onDeleteProject,
  onToggleProject,
  onOpenEnvironment,
  onNewConnection,
  onRetryBindings,
  onRetrySources,
  onRemoveBinding,
  projectTreeKey,
  activeEnvironmentBelongsToProject,
}: KnowledgeProjectTreeProps & {
  projectTreeKey: string;
  activeEnvironmentBelongsToProject: boolean;
}) {
  void onAddEnvironment;
  void onDeleteProject;
  void onToggleProject;
  const { t } = useI18n();
  const databaseKey = projectResourceKey(project.id, "databases");
  const sourceKey = projectResourceKey(project.id, "sources");
  const analysisKey = projectResourceKey(project.id, "analyses");
  const projectBindings = orderProjectDatabaseResources(
    flattenProjectEnvironmentResources(
      project,
      (environmentId) =>
        (environmentConnections ?? []).filter(
          (binding) => binding.projectEnvironmentId === environmentId,
        ),
    ),
    connections,
    databaseBindingOrder,
  );
  const projectSources = flattenProjectEnvironmentResources(
    project,
    (environmentId) =>
      (sources ?? []).filter(
        (source) => source.projectEnvironmentId === environmentId,
      ),
  );
  const projectAnalysisQueries = project.environments.map((environment) => ({
    environment,
    query: analysisQueries[projectEnvironmentIds.indexOf(environment.id)],
  }));
  const projectAnalyses = flattenProjectEnvironmentResources(
    project,
    (environmentId) =>
      analysisQueries[projectEnvironmentIds.indexOf(environmentId)]?.data ?? [],
  );
  const preferredEnvironment = preferredProjectEnvironment(
    project,
    activeEnvironmentId,
  );
  const databaseExpanded = expandedResourceKeys.has(databaseKey);
  const sourceExpanded = expandedResourceKeys.has(sourceKey);
  const analysisExpanded = expandedResourceKeys.has(analysisKey);
  const analysisNeedle = analysisFilter.trim().toLocaleLowerCase();
  const analysisFilterApplies =
    activeEnvironmentBelongsToProject && activeView === "analyses";
  const visibleProjectAnalyses = analysisFilterApplies
    ? projectAnalyses.filter(
        ({ resource: article }) =>
          (!analysisNeedle ||
            article.definition.title.toLocaleLowerCase().includes(analysisNeedle)),
      )
    : projectAnalyses;
  const activeAnalysisIsVisible = visibleProjectAnalyses.some(
    ({ resource: article }) => article.id === activeResourceId,
  );
  const analysisErrors = projectAnalysisQueries.flatMap(({ query }) =>
    query?.error ? [query.error] : [],
  );
  const analysisPending =
    sharedWorkspace && projectAnalysisQueries.some(({ query }) => query?.isPending);
  const analysisHasData = projectAnalysisQueries.some(
    ({ query }) => query?.data !== undefined,
  );
  const databaseTreeKey = `${projectTreeKey}:resource:databases`;
  const sourceTreeKey = `${projectTreeKey}:resource:sources`;
  const analysisTreeKey = `${projectTreeKey}:resource:analyses`;

  function openProjectResource(view: KnowledgeEnvironmentView) {
    if (!preferredEnvironment) {
      onAddEnvironment();
      return false;
    }
    onOpenEnvironment(preferredEnvironment.id, view);
    return true;
  }

  return (
    <div className="tw:grid">
      <div
        data-knowledge-project-databases-drop-id={project.id}
        data-drop-target={dropTargetProjectId === project.id}
        className="tw:rounded-xs tw:data-[drop-target=true]:bg-muted tw:data-[drop-target=true]:ring-2 tw:data-[drop-target=true]:ring-ring"
      >
        <TreeSectionButton
          expanded={databaseExpanded}
          icon="database"
          treeItem={{ key: databaseTreeKey, parentKey: projectTreeKey, level: 2 }}
          selected={activeEnvironmentBelongsToProject && activeView === "databases"}
          actions={(
            <TreeRowActions>
              <Button
                iconOnly
                size="tree"
                variant="ghost"
                title={t("connections.environmentAddDatabase")}
                aria-label={t("connections.environmentAddDatabase")}
                tabIndex={-1}
                onClick={() => {
                  if (openProjectResource("databases") && preferredEnvironment) {
                    onNewConnection(preferredEnvironment.id);
                  }
                }}
              >
                <Icon name="plus" />
              </Button>
            </TreeRowActions>
          )}
          onToggle={() => {
            onToggleResource(databaseKey);
            openProjectResource("databases");
          }}
        >
          {t("connections.environmentDatabases")}
        </TreeSectionButton>
      </div>
      {databaseExpanded ? (
        <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
          {environmentConnectionsPhase === "coldError" ||
          environmentConnectionsPhase === "staleError" ? (
            <TreeLoadFailure
              message={t("connections.environmentDatabaseLoadFailed")}
              detail={errMessage(environmentConnectionsError)}
              retryLabel={t("app.retry")}
              treeItem={{
                key: `${databaseTreeKey}:retry`,
                parentKey: databaseTreeKey,
                level: 3,
              }}
              onRetry={onRetryBindings}
            />
          ) : null}
          {environmentConnectionsPhase === "coldLoading" ? (
            <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
              <LoadingLabel>{t("common.loading")}</LoadingLabel>
            </div>
          ) : environmentConnections === undefined ? null : projectBindings.length > 0 ? (
            projectBindings.map(({ environment, resource: binding }) => {
              const connection = binding.connectionId
                ? connections.find(
                    (candidate) => candidate.id === binding.connectionId,
                  )
                : null;
              return connection
                ? renderConnection(
                    connection,
                    true,
                    databaseTreeKey,
                    3,
                    knowledgeEnvironmentBadge(environment.riskClass),
                    environment.id,
                    `binding:${binding.id}:connection:${connection.id}`,
                    binding,
                  )
                : (
                    <UnavailableBindingRow
                      key={binding.id}
                      binding={binding}
                      environment={environment}
                      treeParentKey={databaseTreeKey}
                      dropTargetEnvironmentId={dropTargetEnvironmentId}
                      removing={unbindingBindingId === binding.id}
                      onOpen={() =>
                        onOpenEnvironment(binding.projectEnvironmentId, "databases")
                      }
                      onRemove={() => onRemoveBinding(binding)}
                    />
                  );
            })
          ) : (
            <EmptyResourceRow
              treeKey={`${databaseTreeKey}:add`}
              parentKey={databaseTreeKey}
              label={t("connections.environmentAddDatabase")}
              onClick={() => openProjectResource("databases")}
            />
          )}
        </div>
      ) : null}

      <TreeSectionButton
        expanded={sourceExpanded}
        icon="branch"
        treeItem={{ key: sourceTreeKey, parentKey: projectTreeKey, level: 2 }}
        selected={activeEnvironmentBelongsToProject && activeView === "sources"}
        actions={(
          <TreeRowActions>
            <Button
              iconOnly
              size="tree"
              variant="ghost"
              title={t("connections.environmentAddSource")}
              aria-label={t("connections.environmentAddSource")}
              tabIndex={-1}
              onClick={() => openProjectResource("sources")}
            >
              <Icon name="plus" />
            </Button>
          </TreeRowActions>
        )}
        onToggle={() => {
          onToggleResource(sourceKey);
          openProjectResource("sources");
        }}
      >
        {t("connections.environmentDataSources")}
      </TreeSectionButton>
      {sourceExpanded ? (
        <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
          {sourcesPhase === "coldError" || sourcesPhase === "staleError" ? (
            <TreeLoadFailure
              message={t("connections.environmentSourceLoadFailed")}
              detail={errMessage(sourcesError)}
              retryLabel={t("app.retry")}
              treeItem={{
                key: `${sourceTreeKey}:retry`,
                parentKey: sourceTreeKey,
                level: 3,
              }}
              onRetry={onRetrySources}
            />
          ) : null}
          {sourcesPhase === "coldLoading" ? (
            <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
              <LoadingLabel>{t("common.loading")}</LoadingLabel>
            </div>
          ) : sources === undefined ? null : projectSources.length > 0 ? (
            projectSources.map(({ environment, resource: source }) => (
              <button
                key={source.sourceId}
                type="button"
                className="tw:flex tw:h-control-sm tw:min-h-control-sm tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-0 tw:pl-5 tw:text-left tw:font-sans tw:text-sm tw:font-normal tw:leading-ui tw:text-foreground tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() => onOpenEnvironment(environment.id, "sources")}
                title={`${environment.name} · ${source.provider === "github" ? "GitHub" : t("connections.environmentLocalFolder")} · ${knowledgeRevisionLabel(source.revision, {
                  dirty: t("knowledge.revisionDirty"),
                  snapshot: t("knowledge.revisionSnapshot"),
                })}`}
                role="treeitem"
                aria-level={3}
                data-explorer-tree-item
                data-explorer-tree-key={`source:${source.sourceId}`}
                data-explorer-tree-parent-key={sourceTreeKey}
                data-tree-primary-action
                tabIndex={-1}
              >
                <StatusDot tone={sourceTone(source)} />
                <Icon
                  name={source.provider === "github" ? "branch" : "folder"}
                  className="tw:shrink-0"
                />
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {source.displayName}
                </span>
              </button>
            ))
          ) : (
            <EmptyResourceRow
              treeKey={`${sourceTreeKey}:add`}
              parentKey={sourceTreeKey}
              label={t("connections.environmentAddSource")}
              onClick={() => openProjectResource("sources")}
            />
          )}
        </div>
      ) : null}

      <TreeSectionButton
        expanded={analysisExpanded}
        icon="chart"
        treeItem={{ key: analysisTreeKey, parentKey: projectTreeKey, level: 2 }}
        selected={
          activeEnvironmentBelongsToProject &&
          activeView === "analyses" &&
          !activeAnalysisIsVisible
        }
        onToggle={() => {
          onToggleResource(analysisKey);
          openProjectResource("analyses");
        }}
      >
        {t("connections.environmentAnalyses")}
      </TreeSectionButton>
      {analysisExpanded ? (
        <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
          {analysisPending && !analysisHasData ? (
            <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
              <LoadingLabel>{t("common.loading")}</LoadingLabel>
            </div>
          ) : null}
          {analysisErrors.length > 0 ? (
            <TreeLoadFailure
              message={t("connections.environmentAnalysisLoadFailed")}
              detail={analysisErrors.map(errMessage).join("\n")}
              retryLabel={t("app.retry")}
              treeItem={{
                key: `${analysisTreeKey}:retry`,
                parentKey: analysisTreeKey,
                level: 3,
              }}
              onRetry={() => {
                for (const { query } of projectAnalysisQueries) {
                  if (query?.error) void query.refetch();
                }
              }}
            />
          ) : null}
          {visibleProjectAnalyses.length > 0 ? (
            visibleProjectAnalyses.map(({ environment, resource: article }) => (
              <button
                key={article.id}
                type="button"
                data-selected={activeResourceId === article.id}
                className="tw:flex tw:h-control-sm tw:min-h-control-sm tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-0 tw:pl-5 tw:text-left tw:font-sans tw:text-sm tw:font-normal tw:leading-ui tw:text-foreground tw:data-[selected=true]:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() =>
                  onOpenEnvironment(environment.id, "analyses", article.id)
                }
                title={`${environment.name} · ${article.definition.title}`}
                role="treeitem"
                aria-level={3}
                aria-selected={activeResourceId === article.id}
                data-explorer-tree-item
                data-explorer-tree-key={`analysis:${article.id}`}
                data-explorer-tree-parent-key={analysisTreeKey}
                data-tree-primary-action
                tabIndex={-1}
              >
                <Icon name="chart" className="tw:shrink-0" />
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {article.definition.title}
                </span>
              </button>
            ))
          ) : !analysisPending && analysisErrors.length === 0 ? (
            <EmptyResourceRow
              treeKey={`${analysisTreeKey}:empty`}
              parentKey={analysisTreeKey}
              label={
                projectAnalyses.length > 0
                  ? t("analysis.noMatch")
                  : t("connections.environmentNoAnalyses")
              }
              onClick={() => openProjectResource("analyses")}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyResourceRow({
  treeKey,
  parentKey,
  label,
  onClick,
}: {
  treeKey: string;
  parentKey: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="tw:min-h-control-sm tw:cursor-pointer tw:border-0 tw:bg-transparent tw:px-5 tw:py-1 tw:text-left tw:font-sans tw:text-xs tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground"
      onClick={onClick}
      role="treeitem"
      aria-level={3}
      data-explorer-tree-item
      data-explorer-tree-key={treeKey}
      data-explorer-tree-parent-key={parentKey}
      data-tree-primary-action
      tabIndex={-1}
    >
      {label}
    </button>
  );
}

function UnavailableBindingRow({
  binding,
  environment,
  treeParentKey,
  dropTargetEnvironmentId,
  removing,
  onOpen,
  onRemove,
}: {
  binding: EnvironmentConnection;
  environment: KnowledgeEnvironment;
  treeParentKey: string;
  dropTargetEnvironmentId: string | null;
  removing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-knowledge-environment-drop-id={environment.id}
      data-drop-target={dropTargetEnvironmentId === environment.id}
      className="tw:group tw:relative tw:flex tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:items-stretch tw:text-sm tw:font-normal tw:leading-ui tw:text-muted-foreground tw:data-[drop-target=true]:bg-muted tw:data-[drop-target=true]:ring-2 tw:data-[drop-target=true]:ring-ring tw:hover:bg-muted"
      role="treeitem"
      aria-level={3}
      data-explorer-tree-item
      data-explorer-tree-key={`binding:${binding.id}`}
      data-explorer-tree-parent-key={treeParentKey}
      tabIndex={-1}
    >
      <button
        type="button"
        className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-0 tw:pl-5 tw:text-left tw:font-sans tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        onClick={onOpen}
        title={t("connections.environmentDatabaseUnavailable")}
        data-tree-primary-action
        tabIndex={-1}
      >
        <StatusDot tone="warning" />
        <Icon name="database" className="tw:shrink-0" />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate">
          {binding.alias || binding.connectionName}
        </span>
        <EnvironmentBadge
          environment={knowledgeEnvironmentBadge(environment.riskClass)}
        />
        <Icon name="alert" className="tw:shrink-0 tw:text-warning" />
      </button>
      <TreeRowActions>
        <ConfirmButton
          iconOnly
          label={t("connections.removeFromProject")}
          confirmLabel={t("connections.reallyRemoveFromProject")}
          disabled={removing}
          size="tree"
          tone="danger"
          variant="dangerGhost"
          onConfirm={onRemove}
        >
          <Icon name="trash" />
        </ConfirmButton>
      </TreeRowActions>
    </div>
  );
}
