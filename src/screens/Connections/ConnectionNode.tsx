// Connection row of the Database Explorer tree plus the catalog subtrees it
// owns. The row is a `role="treeitem"` with a single roving tab stop; expand and
// collapse belong to the explorer container's arrow-key contract, so the chevron
// only exposes `data-tree-toggle` for pointer users.
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
import { SchemaDiffBadge } from "./schemaDiffPresentation";
import CatalogTree from "./CatalogTree";
import type { CatalogTreeSearchResult } from "./CatalogTree";
import type { DropTarget } from "../../features/catalogExplorer/catalogDomain";
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
  nested: boolean;
  /**
   * `aria-level` of this connection row. The explorer counts the real
   * Project/Environment/folder depth above it, so `nested` stays a purely
   * visual flag and never approximates the level.
   */
  level: number;
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
  error?: string;
  detailError?: string;
  databases?: DatabaseSummary[];
  databaseOverviews: Record<string, CatalogOverview>;
  databaseCatalogs: Record<string, Catalog>;
  overviewErrorsByDatabase: Record<string, string>;
  detailErrorsByDatabase: Record<string, string>;
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
  onOpenTable: (table: CatalogTable) => void;
  onRequestOverview: (database: string) => void;
  onForgetOverview: (database: string) => void;
  onRequestDetails: (database: string) => void;
  onRetryOverview: (database: string) => void;
  onToggleRelationSection: (key: string) => void;
  onToggleObjectSection: (kind: string) => void;
  revealRequest: number;
  revealDatabase: string | null;
  revealNamespace: string | null;
};

export default function ConnectionNode(props: Props) {
  const { t } = useI18n();
  const { connection } = props;
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
  const description = `${connection.engine} · ${connection.host}${
    connection.engine !== "sqlite" ? `:${connection.port}` : ""
  } · ${connection.database}`;
  const isDropTarget =
    props.dropTarget?.kind === "connection" &&
    props.dropTarget.id === connection.id;
  const availableSchemas = Array.from(
    new Set([
      ...(props.overview?.namespaces ?? []),
      ...(props.overview?.relations.map((relation) =>
        relationNamespace(connection, relation.schema),
      ) ?? []),
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const connectionLevel = props.level;
  const scopedSchemas = selectedSchemaScope(connection);
  const selectedSchemaCount =
    scopedSchemas.length === 0
      ? availableSchemas.length
      : availableSchemas.filter((schema) => scopedSchemas.includes(schema))
          .length;

  return (
    <div className="tw:relative">
      <div
        data-connection-id={connection.id}
        data-nested={props.nested}
        data-dragging={props.draggingId === connection.id}
        data-drop-target={isDropTarget}
        className="ds-object-row tw:group tw:relative tw:touch-none tw:select-none tw:gap-1 tw:rounded-xs tw:pr-[calc(var(--ds-control-sm)+var(--ds-space-1))] tw:text-ui tw:font-medium tw:leading-ui tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[nested=true]:pl-2 tw:data-[dragging=true]:opacity-50 tw:data-[drop-target=true]:bg-muted tw:data-[drop-target=true]:ring-2 tw:data-[drop-target=true]:ring-ring"
        role="treeitem"
        aria-selected={props.selected}
        aria-expanded={props.expanded}
        aria-level={connectionLevel}
        aria-label={`${connection.name || t("app.unnamed")} · ${description}`}
        tabIndex={-1}
        onPointerDown={(event) => props.onPointerDown(event, connection)}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onPointerCancel={props.onPointerCancel}
        onClick={() => {
          if (props.suppressClickRef.current) {
            props.suppressClickRef.current = false;
            return;
          }
          if (props.selected) props.onToggleOpen();
          else props.onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (props.selected) props.onToggleOpen();
            else props.onSelect();
            return;
          }
          // The connection menu trigger sits inside a `treeitem`, so it is not a
          // Tab stop of its own. The platform context-menu keys open it from the
          // row itself; focus moves to the trigger so the menu's own Escape
          // handler still has somewhere to return to.
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>(
                "[data-connection-menu-trigger]",
              )
              ?.focus({ preventScroll: true });
            props.onOpenMenu(
              props.openMenuId === connection.id ? null : connection.id,
            );
          }
        }}
      >
        <span
          data-tree-toggle
          aria-hidden="true"
          className="tw:grid tw:w-3 tw:shrink-0 tw:place-items-center tw:text-2xs tw:text-muted-foreground"
          title={
            props.expanded
              ? t("connections.collapse")
              : t("connections.expand")
          }
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
        <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-px">
          <span className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {connection.name || t("app.unnamed")}
          </span>
          {connection.providerTarget ? (
            <ProviderTargetLabel target={connection.providerTarget} />
          ) : null}
        </span>
        {connection.workspaceAccess === "local" &&
        connection.engine !== "mongodb" &&
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
            >
              <div className="tw:grid tw:w-full">
                <div className="tw:flex tw:min-h-control-md tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2 tw:py-1">
                  <Icon
                    name="database"
                    className="tw:shrink-0 tw:text-muted-foreground"
                  />
                  <strong className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
                    {connection.database}
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
        {connection.env ? (
          <EnvironmentBadge environment={connection.env} />
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
        {(!props.nested || !connection.env) && (
          <SchemaDiffBadge
            connection={connection}
            groupsByConnectionId={props.groupByConnectionId}
            catalogs={props.catalogs}
          />
        )}
        <div
          className="db-menu tw:pointer-events-none tw:absolute tw:top-1/2 tw:right-1 tw:-translate-y-1/2 tw:opacity-0 tw:transition-opacity tw:group-hover:pointer-events-auto tw:group-hover:opacity-100 tw:group-focus-within:pointer-events-auto tw:group-focus-within:opacity-100 tw:focus-within:pointer-events-auto tw:focus-within:opacity-100 tw:data-[open=true]:pointer-events-auto tw:data-[open=true]:z-[var(--ds-z-popover)] tw:data-[open=true]:opacity-100"
          data-open={props.openMenuId === connection.id}
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
            iconOnly
            size="xs"
            variant="ghost"
            tabIndex={-1}
            title={t("connections.connectionMenu")}
            aria-label={t("connections.connectionMenu")}
            aria-expanded={props.openMenuId === connection.id}
            aria-controls={`connection-menu-${connection.id}`}
            onClick={() =>
              props.onOpenMenu(
                props.openMenuId === connection.id ? null : connection.id,
              )
            }
          >
            <Icon name="moreVertical" />
          </Button>
          {props.openMenuId === connection.id ? (
            <PopupMenu id={`connection-menu-${connection.id}`}>
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
              <PopupMenuCheckbox
                checked={props.showRowCounts}
                onChange={(event) =>
                  props.onShowRowCounts(event.target.checked)
                }
              >
                {t("connections.showRowCounts")}
              </PopupMenuCheckbox>
              {connection.workspaceAccess === "local" ||
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
                level={connectionLevel + 1}
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
            level={connectionLevel + 1}
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
          />
        ))}
    </div>
  );
}
