// Projects schema-comparison labels, counts, and triggers for Explorer group, Project and
// connection rows. Each group carries the member-chosen baseline, so every chip agrees
// with the Schema Diff screen; `compareCatalogs` memoizes the comparison per snapshot pair.

import type { Catalog } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import {
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
  schemaGroupIsCompatible,
  type SchemaConnectionGroup,
  type SchemaDiffSummary,
  type TableSchemaDiff,
} from "../../lib/schemaDiff";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

export function schemaDiffForConnection(
  connection: ConnectionProfile,
  groupsByConnectionId: ReadonlyMap<string, SchemaConnectionGroup>,
  catalogs: Record<string, Catalog>,
): SchemaDiffSummary | null {
  const group = groupsByConnectionId.get(connection.id);
  const baseline = group && defaultSchemaBaseline(group);
  if (!baseline || baseline.id === connection.id) return null;
  const current = catalogs[connection.id];
  const baselineCatalog = catalogs[baseline.id];
  return current && baselineCatalog ? compareCatalogs(current, baselineCatalog) : null;
}

export function schemaTableDiffTitle(t: Translate, diff: TableSchemaDiff) {
  if (diff.added) return t("connections.schemaDiffTableAdded");
  if (diff.missing) return t("connections.schemaDiffTableMissing");
  return t("connections.schemaDiffTableChanged", {
    added: diff.addedColumns.length,
    missing: diff.missingColumns.length,
    changed: diff.changedColumns.length + (diff.relationChanged ? 1 : 0),
  });
}

type DiffCounts = ReturnType<typeof diffCounts>;

function SchemaDiffCounts({ counts }: { counts: DiffCounts }) {
  return (
    <span className="tw:inline-flex tw:gap-[2px] tw:font-mono tw:text-2xs tw:[font-variant-numeric:tabular-nums]">
      {counts.added > 0 ? <span className="tw:text-success">+{counts.added}</span> : null}
      {counts.missing > 0 ? <span className="tw:text-danger">−{counts.missing}</span> : null}
      {counts.changed > 0 ? <span className="tw:text-warning">~{counts.changed}</span> : null}
    </span>
  );
}

function summaryLabel(t: Translate, summary: string) {
  return summary === t("schemaDiff.openTitle")
    ? summary
    : t("schemaDiff.openSummary", { summary });
}

/** Opens one connection's comparison against its group baseline from its Explorer row. */
export function SchemaDiffTrigger({
  connection,
  groupsByConnectionId,
  catalogs,
  onOpen,
}: {
  connection: ConnectionProfile;
  groupsByConnectionId: ReadonlyMap<string, SchemaConnectionGroup>;
  catalogs: Record<string, Catalog>;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const group = groupsByConnectionId.get(connection.id);
  if (!group || group.connections.length < 2 || !onOpen) return null;
  const diff = schemaDiffForConnection(connection, groupsByConnectionId, catalogs);
  const counts = diff ? diffCounts(diff) : null;
  const title = !diff || !counts
    ? t("schemaDiff.openTitle")
    : diff.total === 0
      ? t("schemaDiff.inSync")
      : t("connections.schemaDiffTitle", counts);
  return (
    <Button
      size="tree"
      variant="ghost"
      title={title}
      aria-label={summaryLabel(t, title)}
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {!diff || !counts ? (
        <>
          <Icon name="columns" />
          <span>{t("connections.schemaDiffPendingChip")}</span>
        </>
      ) : diff.total === 0 ? (
        <Icon name="check" />
      ) : (
        <SchemaDiffCounts counts={counts} />
      )}
    </Button>
  );
}

/**
 * Opens a whole group's comparison and sums every member against the baseline. Explicit
 * schema groups and Project environment comparisons share it, so both read the same way.
 */
export function SchemaGroupCompareButton({
  group,
  catalogs,
  variant,
  primaryAction = false,
  onEnsureLoaded,
  onOpen,
}: {
  group: SchemaConnectionGroup;
  catalogs: Record<string, Catalog>;
  variant?: "ghost";
  /** The row's Enter action in tree keyboard navigation. */
  primaryAction?: boolean;
  onEnsureLoaded: (connectionId: string) => void;
  onOpen: (group: SchemaConnectionGroup) => void;
}) {
  const { t } = useI18n();
  const compatible = schemaGroupIsCompatible(group);
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
  const counts = diffs.reduce<DiffCounts>(
    (total, diff) => {
      const current = diffCounts(diff);
      return {
        added: total.added + current.added,
        missing: total.missing + current.missing,
        changed: total.changed + current.changed,
      };
    },
    { added: 0, missing: 0, changed: 0 },
  );
  const total = counts.added + counts.missing + counts.changed;
  const summary = !compatible
    ? t("schemaDiff.incompatibleTitle")
    : complete && total === 0
      ? t("schemaDiff.inSync")
      : complete
        ? t("connections.schemaDiffTitle", counts)
        : t("schemaDiff.openTitle");
  return (
    <Button
      size="tree"
      variant={variant}
      title={summary}
      aria-label={summaryLabel(t, summary)}
      data-tree-primary-action={primaryAction || undefined}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        for (const connection of group.connections) onEnsureLoaded(connection.id);
        onOpen(group);
      }}
    >
      {!compatible ? (
        <Icon name="alert" />
      ) : complete && total === 0 ? (
        <Icon name="check" />
      ) : complete ? (
        <SchemaDiffCounts counts={counts} />
      ) : (
        <span>{t("schemaDiff.open")}</span>
      )}
    </Button>
  );
}
