import type { ReactNode } from "react";

import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import type { Catalog } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import {
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
  schemaGroupIsCompatible,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";

type Props = {
  group: SchemaConnectionGroup;
  activeGroupKey: string | null;
  dropTarget: boolean;
  catalogs: Record<string, Catalog>;
  onEnsureLoaded: (connectionId: string) => void;
  onOpenSchemaDiff: (group: SchemaConnectionGroup) => void;
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
  renderConnection,
}: Props) {
  const { t } = useI18n();
  const engine = group.connections[0]?.engine;
  const baseline = defaultSchemaBaseline(group);
  const baselineCatalog = baseline ? catalogs[baseline.id] : undefined;
  const targets = group.connections.filter(
    (connection) => connection.id !== baseline?.id,
  );
  const diffs = baselineCatalog
    ? targets.flatMap((connection) => {
        const catalog = catalogs[connection.id];
        return catalog ? [compareCatalogs(catalog, baselineCatalog)] : [];
      })
    : [];
  const complete = targets.length > 0 && diffs.length === targets.length;
  const counts = diffs.reduce(
    (total, diff) => {
      const current = diffCounts(diff);
      total.added += current.added;
      total.missing += current.missing;
      total.changed += current.changed;
      return total;
    },
    { added: 0, missing: 0, changed: 0 },
  );
  const total = counts.added + counts.missing + counts.changed;
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
        <button
          type="button"
          className="tw:inline-flex tw:min-h-control-xs tw:min-w-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-[2px] tw:rounded-xs tw:border tw:border-border-subtle tw:bg-transparent tw:px-1.5 tw:font-mono tw:text-2xs tw:font-medium tw:whitespace-nowrap tw:text-muted-foreground tw:hover:border-ring tw:hover:text-primary"
          title={t("schemaDiff.openTitle")}
          aria-label={t("schemaDiff.openTitle")}
          data-tree-primary-action
          tabIndex={-1}
          onClick={() => {
            for (const connection of group.connections) {
              onEnsureLoaded(connection.id);
            }
            onOpenSchemaDiff(group);
          }}
        >
          {!schemaGroupIsCompatible(group) ? (
            <Icon name="alert" />
          ) : complete && total === 0 ? (
            <Icon name="check" />
          ) : complete ? (
            <span className="tw:inline-flex tw:gap-[2px] tw:font-mono tw:[font-variant-numeric:tabular-nums]">
              {counts.added > 0 ? (
                <span className="tw:text-success">+{counts.added}</span>
              ) : null}
              {counts.missing > 0 ? (
                <span className="tw:text-danger">−{counts.missing}</span>
              ) : null}
              {counts.changed > 0 ? (
                <span className="tw:text-warning">~{counts.changed}</span>
              ) : null}
            </span>
          ) : (
            <span>{t("schemaDiff.open")}</span>
          )}
        </button>
      </div>
      {group.connections.map((connection) =>
        renderConnection(connection, treeKey),
      )}
    </div>
  );
}
