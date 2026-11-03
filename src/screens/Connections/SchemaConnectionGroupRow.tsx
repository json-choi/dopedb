// Presents an explicit schema group's header with its comparison summary and edit menu,
// then its member connections. Counts compare the member-chosen baseline against the
// shared live snapshots exactly as the Schema Diff screen does.

import type { ReactNode } from "react";

import EngineMark from "../../components/EngineMark";
import { MenuItem, ToolbarMenu } from "../../design-system/components/Menu";
import type { Catalog } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { SchemaConnectionGroup } from "../../lib/schemaDiff";
import { SchemaGroupCompareButton } from "./schemaDiffPresentation";

type Props = {
  group: SchemaConnectionGroup;
  activeGroupKey: string | null;
  dropTarget: boolean;
  catalogs: Record<string, Catalog>;
  onEnsureLoaded: (connectionId: string) => void;
  onOpenSchemaDiff: (group: SchemaConnectionGroup) => void;
  /** Absent when a member is a team connection, whose group the editor owns. */
  onEditGroup?: (group: SchemaConnectionGroup) => void;
  renderConnection: (
    connection: SchemaConnectionGroup["connections"][number],
    treeParentKey: string,
  ) => ReactNode;
};

export function SchemaConnectionGroupRow({
  group,
  activeGroupKey,
  dropTarget,
  catalogs,
  onEnsureLoaded,
  onOpenSchemaDiff,
  onEditGroup,
  renderConnection,
}: Props) {
  const { t } = useI18n();
  const engine = group.connections[0]?.engine;
  const treeKey = `schema-group:${group.key}`;

  return (
    <div
      data-schema-group-key={group.key}
      data-drop-target={dropTarget}
      className="tw:relative tw:my-1 tw:border-l tw:border-border-strong tw:pt-0 tw:pr-0 tw:pb-1 tw:pl-1 tw:transition-colors tw:data-[drop-target=true]:border-ring tw:data-[drop-target=true]:bg-muted"
    >
      <div
        data-active={activeGroupKey === group.key}
        className="tw:flex tw:min-h-control-sm tw:items-center tw:gap-1 tw:px-1 tw:text-xs tw:text-muted-foreground tw:data-[active=true]:text-primary"
        title={t("connections.schemaGroupTitle", { group: group.label })}
        role="treeitem"
        aria-level={1}
        aria-selected={activeGroupKey === group.key}
        data-explorer-tree-item
        data-explorer-tree-key={treeKey}
        tabIndex={-1}
      >
        {engine && <EngineMark engine={engine} size="tree" />}
        <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-bold tw:text-foreground">
          {group.label}
        </span>
        <SchemaGroupCompareButton
          group={group}
          catalogs={catalogs}
          primaryAction
          onEnsureLoaded={onEnsureLoaded}
          onOpen={onOpenSchemaDiff}
        />
        {onEditGroup ? (
          <ToolbarMenu
            icon="moreVertical"
            label={t("connections.schemaGroupMenu", { group: group.label })}
            triggerVariant="treeAction"
            triggerTabIndex={-1}
          >
            <MenuItem onClick={() => onEditGroup(group)}>
              {t("connections.schemaGroupEditGroup")}
            </MenuItem>
          </ToolbarMenu>
        ) : null}
      </div>
      {group.connections.map((connection) =>
        renderConnection(connection, treeKey),
      )}
    </div>
  );
}
