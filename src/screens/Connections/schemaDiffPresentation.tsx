import type { Catalog } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import {
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
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
  const baseline = group && defaultSchemaBaseline(group);
  const current = catalogs[connection.id];
  const baselineCatalog = baseline ? catalogs[baseline.id] : undefined;
  const diff =
    baseline && baseline.id !== connection.id && current && baselineCatalog
      ? compareCatalogs(current, baselineCatalog)
      : null;
  const counts = diff ? diffCounts(diff) : null;
  const title = !diff
    ? t("schemaDiff.openTitle")
    : diff.total === 0
      ? t("connections.schemaDiffInSync")
      : t("connections.schemaDiffTitle", {
          added: counts?.added ?? 0,
          missing: counts?.missing ?? 0,
          changed: counts?.changed ?? 0,
        });
  return (
    <Button
      size="tree"
      variant="ghost"
      title={title}
      aria-label={t("schemaDiff.openTitle")}
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {!diff ? (
        <>
          <Icon name="columns" />
          <span>{t("connections.schemaDiffPendingChip")}</span>
        </>
      ) : diff.total === 0 ? (
        <Icon name="check" />
      ) : (
        <span className="tw:inline-flex tw:gap-[2px] tw:font-mono tw:text-2xs tw:[font-variant-numeric:tabular-nums]">
          {counts && counts.added > 0 ? (
            <span className="tw:text-success">+{counts.added}</span>
          ) : null}
          {counts && counts.missing > 0 ? (
            <span className="tw:text-danger">-{counts.missing}</span>
          ) : null}
          {counts && counts.changed > 0 ? (
            <span className="tw:text-warning">~{counts.changed}</span>
          ) : null}
        </span>
      )}
    </Button>
  );
}
