import type {
  PointerEvent,
  RefObject,
} from "react";

import ConfirmButton from "../../components/ConfirmButton";
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import ToolbarMenu from "../../components/ToolbarMenu";
import {
  PopupMenu,
  PopupMenuCheckbox,
  PopupMenuItem,
} from "../../design-system/components/PopupMenu";
import {
  connectionAccessIssue,
  databaseDisplayLabel,
  type ConnectionProfile,
} from "../../features/connections/domain";
import { ProviderTargetLabel } from "../../features/connections/ProviderTargetLabel";
import { isDemoSqliteConnection } from "../../features/connections/presets";
import type {
  Catalog,
  CatalogOverview,
  CatalogTable,
  DatabaseSummary,
} from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { SchemaConnectionGroup } from "../../lib/schemaDiff";
import { SchemaDiffTrigger } from "./schemaDiffPresentation";
import CatalogTree from "./CatalogTree";
import type { CatalogTreeSearchResult } from "./CatalogTree";
import type {
  CatalogLoadIssue,
  DropTarget,
  ProjectDatabaseOrderDrag,
} from "../../features/catalogExplorer/catalogDomain";
import {
  nextSchemaScopeSelection,
  relationNamespace,
  selectedSchemaScope,
} from "../../features/catalogExplorer/scopeFilter";
import { databaseCatalogKey } from "./useCatalogTree";

const EMPTY_SCHEMA_GROUPS = new Map<string, SchemaConnectionGroup>();
const EMPTY_CATALOGS: Record<string, Catalog> = {};

type Props = {
  connection: ConnectionProfile;
  environmentBadge?: string | null;
  environmentDropId?: string;
  projectDatabaseOrder?: ProjectDatabaseOrderDrag;
  treeKey?: string;
  nested: boolean;
  selected: boolean;
  selectedTableKey: string | null;
  expanded: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  suppressClickRef: RefObject<boolean>;
  openMenuId: string | null;
  onOpenMenu: (id: string | null) => void;
  refreshingId: string | null;
  deletingId: string | null;
  showRowCounts: boolean;
  onShowRowCounts: (show: boolean) => void;
  schemaScopeSaving: boolean;
  onSetSchemaScope: (schemas: string[]) => void;
  overview?: CatalogOverview;
  fullCatalog?: Catalog;
  error?: CatalogLoadIssue;
  detailError?: CatalogLoadIssue;
  databases?: DatabaseSummary[];
  databaseOverviews: Record<string, CatalogOverview>;
  databaseCatalogs: Record<string, Catalog>;
  overviewErrorsByDatabase: Record<string, CatalogLoadIssue>;
  detailErrorsByDatabase: Record<string, CatalogLoadIssue>;
  treeScrollElement: HTMLDivElement | null;
  filter: string;
  activeSearchResultKey?: string | null;
  onSearchResultsChange?: (
    catalogKey: string,
    results: CatalogTreeSearchResult[],
  ) => void;
  groupByConnectionId: Map<string, SchemaConnectionGroup>;
  catalogs: Record<string, Catalog>;
  collapsedSections: Set<string>;
  objectSectionsOpen: Set<string>;
  onPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    connection: ConnectionProfile,
    projectDatabaseOrder?: ProjectDatabaseOrderDrag,
  ) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleOpen: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onWorkspaceDialog: (mode: "copy" | "credentials") => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUnbind?: () => void;
  unbinding?: boolean;
  onOpenSchemaDiff?: () => void;
  onOpenTable: (table: CatalogTable) => void;
  onRequestOverview: (database: string) => void;
  onForgetOverview: (database: string) => void;
  onRequestDetails: (database: string) => void;
  onRetryOverview: (database: string) => void;
  onRecoverAuthentication?: () => void;
  onRecoverManagedConnection?: () => void;
  managedConnectionRecoveryPending?: boolean;
  authenticationRecoveryPending?: boolean;
  authenticationRecoveryError?: CatalogLoadIssue;
  onToggleRelationSection: (key: string) => void;
  onToggleObjectSection: (kind: string) => void;
  revealRequest: number;
  revealDatabase: string | null;
  revealNamespace: string | null;
  treeParentKey: string | null;
  treeLevel: number;
};

export default function ConnectionNode(props: Props) {
  const { t } = useI18n();
  const { connection } = props;
  const environmentBadge =
    props.environmentBadge === undefined
      ? connection.env
      : props.environmentBadge;
  const accessLabelBase =
    connection.workspaceAccess === "view"
      ? t("workspace.accessView")
      : connection.workspaceAccess === "read"
        ? t("workspace.accessRead")
        : connection.workspaceAccess === "write"
          ? t("workspace.accessWrite")
          : connection.workspaceAccess === "manage"
            ? t("workspace.accessManage")
            : null;
  const accessLabel =
    accessLabelBase && connection.credentialMode === "managed"
      ? `${accessLabelBase} · ${t("workspace.managedCredentials")}`
      : accessLabelBase;
  const usesManagedCredentials =
    Boolean(accessLabelBase) && connection.credentialMode === "managed";
  const accessIssue = connectionAccessIssue(connection);
  const databaseLabel = databaseDisplayLabel(
    connection.engine,
    connection.database,
  );
  const description = `${connection.engine} · ${connection.host}${
    connection.engine !== "sqlite" ? `:${connection.port}` : ""
  } · ${databaseLabel}`;
  const isDropTarget =
    (props.dropTarget?.kind === "connection" &&
      props.dropTarget.id === connection.id) ||
    (props.dropTarget?.kind === "environment" &&
      props.dropTarget.id === props.environmentDropId);
  const orderDropPlacement =
    props.dropTarget?.kind === "projectDatabaseOrder" &&
    props.dropTarget.targetBindingId === props.projectDatabaseOrder?.bindingId
      ? props.dropTarget.placement
      : null;
  const availableSchemas = Array.from(
    new Set([
      ...(props.overview?.namespaces ?? []),
      ...(props.overview?.relations.map((relation) =>
        relationNamespace(connection, relation.schema),
      ) ?? []),
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const scopedSchemas = selectedSchemaScope(connection);
  const selectedSchemaCount =
    scopedSchemas.length === 0
      ? availableSchemas.length
      : availableSchemas.filter((schema) => scopedSchemas.includes(schema))
          .length;
  const connectionTreeKey = props.treeKey ?? `connection:${connection.id}`;
  const connectionMenuKey = props.treeKey ?? connection.id;
  const connectionMenuId = `connection-menu-${connectionMenuKey.replace(
    /[^A-Za-z0-9_-]/g,
    "-",
  )}`;
  const schemaGroup = props.groupByConnectionId.get(connection.id);

  return (
    <div className="tw:relative">
      <div
        data-connection-id={connection.id}
        data-knowledge-environment-drop-id={props.environmentDropId}
        data-project-database-binding-id={props.projectDatabaseOrder?.bindingId}
        data-project-database-project-id={props.projectDatabaseOrder?.projectId}
        data-project-database-block-first-binding-id={
          props.projectDatabaseOrder?.blockFirstBindingId
        }
        data-project-database-block-last-binding-id={
          props.projectDatabaseOrder?.blockLastBindingId
        }
        data-nested={props.nested}
        data-dragging={props.draggingId === connection.id}
        data-drop-target={isDropTarget}
        className="ds-object-row tw:group tw:relative tw:h-control-sm tw:min-h-control-sm tw:cursor-grab tw:touch-none tw:select-none tw:gap-1 tw:rounded-xs tw:py-0 tw:pr-[calc(var(--ds-control-xs)+var(--ds-space-1))] tw:text-sm tw:font-normal tw:leading-ui tw:active:cursor-grabbing tw:data-[nested=true]:pl-2 tw:data-[dragging=true]:opacity-50 tw:data-[drop-target=true]:bg-muted tw:data-[drop-target=true]:ring-2 tw:data-[drop-target=true]:ring-ring"
        role="treeitem"
        aria-expanded={props.expanded}
        aria-level={props.treeLevel}
        aria-selected={props.selected}
        aria-label={`${connection.name || t("app.unnamed")} · ${description}${environmentBadge ? ` · ${environmentBadge}` : ""}`}
        data-explorer-tree-item
        data-explorer-tree-key={connectionTreeKey}
        data-explorer-tree-parent-key={props.treeParentKey ?? undefined}
        data-tree-primary-action
        tabIndex={-1}
        onPointerDown={(event) =>
          props.onPointerDown(event, connection, props.projectDatabaseOrder)
        }
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onPointerCancel={props.onPointerCancel}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (props.suppressClickRef.current) {
            props.suppressClickRef.current = false;
            return;
          }
          if (props.selected) props.onToggleOpen();
          else props.onSelect();
        }}
      >
        {orderDropPlacement ? (
          <span
            aria-hidden="true"
            data-placement={orderDropPlacement}
            className="tw:pointer-events-none tw:absolute tw:right-0 tw:left-0 tw:z-[var(--ds-z-base)] tw:h-[var(--ds-border-width-strong)] tw:bg-ring tw:data-[placement=before]:top-0 tw:data-[placement=after]:bottom-0"
          />
        ) : null}
        <span
          className="tw:grid tw:w-3 tw:shrink-0 tw:place-items-center tw:text-2xs tw:text-muted-foreground"
          title={
            props.expanded
              ? t("connections.collapse")
              : t("connections.expand")
          }
          data-tree-expander
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleOpen();
          }}
        >
          <Icon
            name={props.expanded ? "chevronDown" : "chevronRight"}
          />
        </span>
        {!props.nested && (
          <EngineMark engine={connection.engine} size="tree" />
        )}
        <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1.5 tw:overflow-hidden">
          <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {connection.name || t("app.unnamed")}
          </span>
          {connection.providerTarget ? (
            <span className="tw:max-w-[42%] tw:min-w-0 tw:shrink tw:overflow-hidden">
              <ProviderTargetLabel target={connection.providerTarget} />
            </span>
          ) : null}
        </span>
        {connection.workspaceAccess === "local" &&
        connection.engine !== "mongodb" &&
        connection.engine !== "bigquery" &&
        availableSchemas.length > 0 ? (
          <span
            className="tw:shrink-0"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <ToolbarMenu
              label={t("connections.introspectionScope")}
              align="start"
              disabled={props.schemaScopeSaving}
              triggerVariant="treeBadge"
              menuSize="scope"
              trigger={`${selectedSchemaCount} of ${availableSchemas.length}`}
              triggerTabIndex={-1}
            >
              <div className="tw:grid tw:w-full">
                <div className="tw:flex tw:min-h-control-md tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2 tw:py-1">
                  <Icon
                    name="database"
                    className="tw:shrink-0 tw:text-muted-foreground"
                  />
                  <strong className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
                    {databaseLabel}
                  </strong>
                  <span className="tw:text-xs tw:text-muted-foreground">
                    {t("connections.discoveredSchemaCount", {
                      count: availableSchemas.length,
                    })}
                  </span>
                </div>
                <PopupMenuCheckbox
                  checked={scopedSchemas.length === 0}
                  disabled={props.schemaScopeSaving}
                  onChange={(event) => {
                    if (event.target.checked) props.onSetSchemaScope([]);
                  }}
                >
                  {t("connections.allSchemas")}
                </PopupMenuCheckbox>
                <div className="tw:grid tw:border-t tw:border-border-subtle tw:pt-1 tw:pl-4">
                  {availableSchemas.map((schema) => (
                    <PopupMenuCheckbox
                      key={schema}
                      checked={
                        scopedSchemas.length === 0 ||
                        scopedSchemas.includes(schema)
                      }
                      disabled={props.schemaScopeSaving}
                      onChange={(event) =>
                        props.onSetSchemaScope(
                          nextSchemaScopeSelection(
                            availableSchemas,
                            scopedSchemas,
                            schema,
                            event.target.checked,
                          ),
                        )
                      }
                    >
                      {schema}
                    </PopupMenuCheckbox>
                  ))}
                </div>
              </div>
            </ToolbarMenu>
          </span>
        ) : null}
        {environmentBadge ? (
          <EnvironmentBadge environment={environmentBadge} />
        ) : null}
        {accessLabel && (
          <span
            data-access={connection.workspaceAccess}
            className="tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:gap-[2px] tw:rounded-xs tw:border tw:border-border-subtle tw:px-1.5 tw:py-px tw:font-mono tw:text-2xs tw:text-muted-foreground tw:uppercase tw:data-[access=write]:border-primary tw:data-[access=write]:text-primary tw:data-[access=manage]:border-primary tw:data-[access=manage]:text-primary tw:@max-[270px]:size-[18px] tw:@max-[270px]:rounded-full tw:@max-[270px]:p-0"
            aria-label={accessLabel}
            title={accessLabel}
          >
            <span
              className="tw:hidden tw:size-1.5 tw:rounded-full tw:bg-current tw:@max-[270px]:block"
              aria-hidden="true"
            />
            <span className="tw:inline-flex tw:items-center tw:gap-1 tw:@max-[270px]:hidden">
              {usesManagedCredentials ? (
                <Icon
                  name="key"
                  className="tw:size-3 tw:shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              {accessLabelBase}
            </span>
          </span>
        )}
        <SchemaDiffTrigger
          connection={connection}
          groupsByConnectionId={props.groupByConnectionId}
          catalogs={props.catalogs}
          onOpen={props.onOpenSchemaDiff}
        />
        <div
          className="db-menu tw:pointer-events-none tw:absolute tw:top-1/2 tw:right-1 tw:-translate-y-1/2 tw:opacity-0 tw:transition-opacity tw:group-hover:pointer-events-auto tw:group-hover:opacity-100 tw:group-focus-within:pointer-events-auto tw:group-focus-within:opacity-100 tw:focus-within:pointer-events-auto tw:focus-within:opacity-100 tw:data-[open=true]:pointer-events-auto tw:data-[open=true]:z-[var(--ds-z-popover)] tw:data-[open=true]:opacity-100"
          data-open={props.openMenuId === connectionMenuKey}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              props.onOpenMenu(null);
              event.currentTarget
                .querySelector<HTMLButtonElement>(
                  "[data-connection-menu-trigger]",
                )
                ?.focus();
            }
          }}
        >
          <Button
            data-connection-menu-trigger
            data-tree-context-action
            iconOnly
            size="tree"
            variant="ghost"
            title={t("connections.connectionMenu")}
            aria-label={t("connections.connectionMenu")}
            aria-expanded={props.openMenuId === connectionMenuKey}
            aria-controls={connectionMenuId}
            tabIndex={-1}
            onClick={() =>
              props.onOpenMenu(
                props.openMenuId === connectionMenuKey
                  ? null
                  : connectionMenuKey,
              )
            }
          >
            <Icon name="moreVertical" />
          </Button>
          {props.openMenuId === connectionMenuKey ? (
            <PopupMenu id={connectionMenuId}>
              {connection.workspaceAccess === "local" ||
              connection.workspaceAccess === "manage" ? (
                <PopupMenuItem
                  onClick={() => {
                    props.onOpenMenu(null);
                    props.onEdit();
                  }}
                >
                  {t("connections.edit")}
                </PopupMenuItem>
              ) : null}
              {connection.workspaceAccess !== "view" &&
              connection.workspaceAccess !== "local" &&
              connection.engine !== "bigquery" &&
              connection.credentialMode === "memberLocal" ? (
                <PopupMenuItem
                  onClick={() => {
                    props.onOpenMenu(null);
                    props.onWorkspaceDialog("credentials");
                  }}
                >
                  {t("workspace.bindCredentialsShort")}
                </PopupMenuItem>
              ) : null}
              {connection.workspaceAccess === "local" ? (
                <PopupMenuItem
                  onClick={() => {
                    props.onOpenMenu(null);
                    props.onWorkspaceDialog("copy");
                  }}
                >
                  {t("workspace.copyToWorkspace")}
                </PopupMenuItem>
              ) : null}
              {connection.workspaceAccess !== "view" ? (
                <PopupMenuItem
                  disabled={props.refreshingId === connection.id}
                  onClick={() => {
                    props.onOpenMenu(null);
                    props.onRefresh();
                  }}
                >
                  {props.refreshingId === connection.id
                    ? t("common.working")
                    : t("connections.refreshSchema")}
                </PopupMenuItem>
              ) : null}
              {schemaGroup &&
              schemaGroup.connections.length > 1 &&
              props.onOpenSchemaDiff ? (
                <PopupMenuItem
                  onClick={() => {
                    props.onOpenMenu(null);
                    props.onOpenSchemaDiff?.();
                  }}
                >
                  {t("schemaDiff.open")}
                </PopupMenuItem>
              ) : null}
              <PopupMenuCheckbox
                checked={props.showRowCounts}
                onChange={(event) =>
                  props.onShowRowCounts(event.target.checked)
                }
              >
                {t("connections.showRowCounts")}
              </PopupMenuCheckbox>
              {props.onUnbind ? (
                <ConfirmButton
                  confirmLabel={t("connections.reallyRemoveFromProject")}
                  disabled={props.unbinding}
                  presentation="menuItem"
                  size="compact"
                  tone="danger"
                  variant="ghost"
                  onConfirm={props.onUnbind}
                >
                  {t("connections.removeFromProject")}
                </ConfirmButton>
              ) : connection.workspaceAccess === "local" ||
                connection.workspaceAccess === "manage" ? (
                <ConfirmButton
                  confirmLabel={t(
                    isDemoSqliteConnection(connection)
                      ? "connections.reallyDeleteDemo"
                      : "common.reallyDelete",
                  )}
                  disabled={props.deletingId === connection.id}
                  presentation="menuItem"
                  size="compact"
                  tone="danger"
                  variant="ghost"
                  onConfirm={props.onDelete}
                >
                  {t("common.delete")}
                </ConfirmButton>
              ) : null}
            </PopupMenu>
          ) : null}
        </div>
      </div>

      {props.expanded &&
        (props.databases && props.databases.length > 0 ? (
          props.databases.map((database) => {
            const key = databaseCatalogKey(connection.id, database.name);
            return (
              <CatalogTree
                key={key}
                connection={{ ...connection, database: database.name }}
                accessIssue={accessIssue}
                selected={props.selected}
                selectedTableKey={props.selectedTableKey}
                overview={props.databaseOverviews[key]}
                fullCatalog={props.databaseCatalogs[key]}
                error={props.overviewErrorsByDatabase[key]}
                detailError={props.detailErrorsByDatabase[key]}
                applySchemaScope={database.isDefault}
                initiallyOpen={database.isDefault}
                scrollElement={props.treeScrollElement}
                filter={props.filter}
                activeSearchResultKey={props.activeSearchResultKey}
                onSearchResultsChange={props.onSearchResultsChange}
                showRowCounts={props.showRowCounts}
                groupByConnectionId={
                  database.isDefault
                    ? props.groupByConnectionId
                    : EMPTY_SCHEMA_GROUPS
                }
                catalogs={
                  database.isDefault ? props.catalogs : EMPTY_CATALOGS
                }
                collapsedSections={props.collapsedSections}
                objectSectionsOpen={props.objectSectionsOpen}
                onOpenTable={props.onOpenTable}
                onRequestOverview={() =>
                  props.onRequestOverview(database.name)
                }
                onForgetOverview={() =>
                  props.onForgetOverview(database.name)
                }
                onRequestDetails={() =>
                  props.onRequestDetails(database.name)
                }
                onRetryOverview={() =>
                  props.onRetryOverview(database.name)
                }
                onRecoverAuthentication={props.onRecoverAuthentication}
                onRecoverManagedConnection={props.onRecoverManagedConnection}
                managedConnectionRecoveryPending={
                  props.managedConnectionRecoveryPending
                }
                authenticationRecoveryPending={
                  props.authenticationRecoveryPending
                }
                authenticationRecoveryError={props.authenticationRecoveryError}
                onResolveAccess={
                  accessIssue === "credentials"
                    ? () => props.onWorkspaceDialog("credentials")
                    : undefined
                }
                onToggleRelationSection={props.onToggleRelationSection}
                onToggleObjectSection={props.onToggleObjectSection}
                revealRequest={props.revealRequest}
                revealDatabase={props.revealDatabase}
                revealNamespace={props.revealNamespace}
                treeParentKey={connectionTreeKey}
                treeLevel={props.treeLevel + 1}
              />
            );
          })
        ) : (
          <CatalogTree
            connection={connection}
            accessIssue={accessIssue}
            selected={props.selected}
            selectedTableKey={props.selectedTableKey}
            overview={props.overview}
            fullCatalog={props.fullCatalog}
            error={props.error}
            detailError={props.detailError}
            initiallyOpen
            scrollElement={props.treeScrollElement}
            filter={props.filter}
            activeSearchResultKey={props.activeSearchResultKey}
            onSearchResultsChange={props.onSearchResultsChange}
            showRowCounts={props.showRowCounts}
            groupByConnectionId={props.groupByConnectionId}
            catalogs={props.catalogs}
            collapsedSections={props.collapsedSections}
            objectSectionsOpen={props.objectSectionsOpen}
            onOpenTable={props.onOpenTable}
            onRequestOverview={() =>
              props.onRequestOverview(connection.database)
            }
            onForgetOverview={() =>
              props.onForgetOverview(connection.database)
            }
            onRequestDetails={() =>
              props.onRequestDetails(connection.database)
            }
            onRetryOverview={() =>
              props.onRetryOverview(connection.database)
            }
            onRecoverAuthentication={props.onRecoverAuthentication}
            onRecoverManagedConnection={props.onRecoverManagedConnection}
            managedConnectionRecoveryPending={
              props.managedConnectionRecoveryPending
            }
            authenticationRecoveryPending={
              props.authenticationRecoveryPending
            }
            authenticationRecoveryError={props.authenticationRecoveryError}
            onResolveAccess={
              accessIssue === "credentials"
                ? () => props.onWorkspaceDialog("credentials")
                : undefined
            }
            onToggleRelationSection={props.onToggleRelationSection}
            onToggleObjectSection={props.onToggleObjectSection}
            revealRequest={props.revealRequest}
            revealDatabase={props.revealDatabase}
            revealNamespace={props.revealNamespace}
            treeParentKey={connectionTreeKey}
            treeLevel={props.treeLevel + 1}
          />
        ))}
    </div>
  );
}
