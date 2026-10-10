// Read-only schema differences grouped by relation identity (schema, name), headed by
// the `schema.table` path shared with the CLI, in a focusable results region.
// Before/after definitions are always visible, wrap at the workbench width, keep exact
// text selectable, and window through the shared virtual row primitive for large diffs.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { WorkbenchScrollBody } from "../../design-system/components/Workbench";
import {
  VirtualTreeRows,
  type VirtualTreeRow,
} from "../../design-system/components/VirtualTreeRows";
import { useI18n, type I18nKey } from "../../lib/i18n";
import {
  SCHEMA_DIFF_SCOPE,
  type SchemaDiffAspect,
  type SchemaDiffStatus,
  type SchemaObjectDiff,
  type SchemaObjectType,
} from "../../lib/schemaDiff";

/** One label per compared or uncompared property; the Desktop scope copy is built from it. */
export const SCHEMA_DIFF_ASPECT_LABELS: Record<SchemaDiffAspect, I18nKey> = {
  relationPresence: "schemaDiff.aspect.relationPresence",
  relationKind: "schemaDiff.aspect.relationKind",
  columnPresence: "schemaDiff.aspect.columnPresence",
  columnType: "schemaDiff.aspect.columnType",
  columnNullability: "schemaDiff.aspect.columnNullability",
  primaryKey: "schemaDiff.aspect.primaryKey",
  indexPresence: "schemaDiff.aspect.indexPresence",
  indexKeys: "schemaDiff.aspect.indexKeys",
  indexUniqueness: "schemaDiff.aspect.indexUniqueness",
  foreignKeyTargets: "schemaDiff.aspect.foreignKeyTargets",
  columnOrder: "schemaDiff.aspect.columnOrder",
  columnDefault: "schemaDiff.aspect.columnDefault",
  generatedColumn: "schemaDiff.aspect.generatedColumn",
  identity: "schemaDiff.aspect.identity",
  collation: "schemaDiff.aspect.collation",
  checkConstraint: "schemaDiff.aspect.checkConstraint",
  uniqueConstraint: "schemaDiff.aspect.uniqueConstraint",
  indexMethod: "schemaDiff.aspect.indexMethod",
  indexPredicate: "schemaDiff.aspect.indexPredicate",
  indexInclude: "schemaDiff.aspect.indexInclude",
  indexSortOrder: "schemaDiff.aspect.indexSortOrder",
  indexValidity: "schemaDiff.aspect.indexValidity",
  foreignKeyAction: "schemaDiff.aspect.foreignKeyAction",
  foreignKeyDeferrable: "schemaDiff.aspect.foreignKeyDeferrable",
  foreignKeyValidation: "schemaDiff.aspect.foreignKeyValidation",
  viewDefinition: "schemaDiff.aspect.viewDefinition",
  partitioning: "schemaDiff.aspect.partitioning",
  comment: "schemaDiff.aspect.comment",
  trigger: "schemaDiff.aspect.trigger",
  routine: "schemaDiff.aspect.routine",
  type: "schemaDiff.aspect.type",
  sequence: "schemaDiff.aspect.sequence",
};

/** States exactly what the comparison covers, whatever its result. */
export function SchemaDiffScope() {
  const { t } = useI18n();
  const list = (aspects: readonly SchemaDiffAspect[]) =>
    aspects.map((aspect) => t(SCHEMA_DIFF_ASPECT_LABELS[aspect])).join(", ");
  return (
    <p className="tw:m-0 tw:shrink-0 tw:border-b tw:border-border-subtle tw:px-3 tw:py-1.5 tw:text-xs tw:text-muted-foreground">
      {t("schemaDiff.scopeCompared", { list: list(SCHEMA_DIFF_SCOPE.compared) })}{" "}
      {t("schemaDiff.scopeNotCompared", { list: list(SCHEMA_DIFF_SCOPE.notCompared) })}
    </p>
  );
}

const OBJECT_LABELS: Record<SchemaObjectType, I18nKey> = {
  table: "schemaDiff.objectTable",
  view: "schemaDiff.objectView",
  materializedView: "schemaDiff.objectMaterializedView",
  column: "schemaDiff.objectColumn",
  index: "schemaDiff.objectIndex",
  foreignKey: "schemaDiff.objectForeignKey",
};

// Relation-level values carry the catalog's relation kind; show it in the UI language.
const RELATION_KIND_LABELS: Partial<Record<string, I18nKey>> = {
  table: "schemaDiff.objectTable",
  view: "schemaDiff.objectView",
  materialized_view: "schemaDiff.objectMaterializedView",
};

const RELATION_TYPES = new Set<SchemaObjectType>([
  "table",
  "view",
  "materializedView",
]);

export const STATUS_LABELS: Record<Exclude<SchemaDiffStatus, "same">, I18nKey> = {
  added: "schemaDiff.statusAdded",
  missing: "schemaDiff.statusMissing",
  changed: "schemaDiff.statusChanged",
};

const DIFF_ROW_ESTIMATE = 64;

export function SchemaDiffResults({ objects }: { objects: SchemaObjectDiff[] }) {
  const { t } = useI18n();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element?.parentElement instanceof HTMLDivElement
      ? element.parentElement
      : null);
  }, []);
  const displayValue = useCallback(
    (object: SchemaObjectDiff, value: string) => {
      const label = RELATION_TYPES.has(object.objectType)
        ? RELATION_KIND_LABELS[value]
        : undefined;
      return label ? t(label) : value;
    },
    [t],
  );
  const rows = useMemo(() => {
    // Group by the (schema, name) identity: the dotted display path of two relations
    // whose names contain dots can coincide.
    const byRelation = new Map<string, SchemaObjectDiff[]>();
    for (const object of objects) {
      const members = byRelation.get(object.relationKey) ?? [];
      members.push(object);
      byRelation.set(object.relationKey, members);
    }
    const rows: VirtualTreeRow[] = [];
    for (const [relationKey, members] of byRelation) {
      const whole = members.length === 1
        && RELATION_TYPES.has(members[0].objectType)
        && members[0].status !== "changed"
        ? members[0]
        : null;
      rows.push({
        key: `relation:${relationKey}`,
        render: () => (
          <RelationHeading
            relation={members[0].relation}
            relationType={members[0].relationType}
            whole={whole}
          />
        ),
      });
      if (whole) continue;
      for (const object of members) {
        rows.push({
          key: `object:${object.id}`,
          render: () => (
            <ObjectDifference
              object={object}
              baselineValue={displayValue(object, object.baselineValue)}
              targetValue={displayValue(object, object.targetValue)}
            />
          ),
        });
      }
    }
    return rows;
  }, [displayValue, objects]);

  return (
    <WorkbenchScrollBody
      role="region"
      tabIndex={0}
      aria-label={t("schemaDiff.detailTitle")}
    >
      <div ref={attachList} className="tw:shrink-0">
        <VirtualTreeRows
          rows={rows}
          scrollElement={scrollElement}
          estimateSize={DIFF_ROW_ESTIMATE}
        />
      </div>
    </WorkbenchScrollBody>
  );
}

function RelationHeading({
  relation,
  relationType,
  whole,
}: {
  relation: string;
  /** The relation's kind; its icon matches the Explorer's table, view or matview. */
  relationType: SchemaObjectDiff["relationType"];
  whole: SchemaObjectDiff | null;
}) {
  const { t } = useI18n();
  return (
    <h3 className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-muted tw:px-3 tw:py-2 tw:text-sm tw:font-medium tw:normal-case tw:tracking-normal">
      <Icon name={relationType} className="tw:mt-0.5 tw:shrink-0 tw:text-muted-foreground" />
      <code className="tw:min-w-0 tw:flex-1 tw:select-text tw:font-mono tw:font-normal tw:[overflow-wrap:anywhere]">{relation}</code>
      {whole ? (
        <>
          <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">{t(OBJECT_LABELS[whole.objectType])}</span>
          <DiffStatus status={whole.status} />
        </>
      ) : null}
    </h3>
  );
}

function ObjectDifference({
  object,
  baselineValue,
  targetValue,
}: {
  object: SchemaObjectDiff;
  baselineValue: string;
  targetValue: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
      <div className="tw:flex tw:items-start tw:gap-2">
        <span className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-0.5">
          <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">{t(OBJECT_LABELS[object.objectType])}</span>
          {RELATION_TYPES.has(object.objectType) ? null : (
            <code className="tw:min-w-0 tw:select-text tw:font-mono tw:text-sm tw:font-normal tw:[overflow-wrap:anywhere]">{object.label}</code>
          )}
        </span>
        <DiffStatus status={object.status} />
      </div>
      <dl className="tw:m-0 tw:mt-1.5 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-x-3 tw:gap-y-2 tw:@max-[440px]:grid-cols-1">
        <SchemaDefinition label={t("schemaDiff.baselineValue")} value={baselineValue} comparison={targetValue} change={object.status === "added" ? null : "removed"} />
        <SchemaDefinition label={t("schemaDiff.targetValue")} value={targetValue} comparison={baselineValue} change={object.status === "missing" ? null : "added"} />
      </dl>
    </div>
  );
}

function DiffStatus({ status }: { status: SchemaObjectDiff["status"] }) {
  const { t } = useI18n();
  return (
    <span data-status={status} className="tw:shrink-0 tw:text-xs tw:font-medium tw:whitespace-nowrap tw:data-[status=added]:text-success tw:data-[status=missing]:text-danger tw:data-[status=changed]:text-warning">
      {t(STATUS_LABELS[status])}
    </span>
  );
}

function SchemaDefinition({ label, value, comparison, change }: {
  label: string;
  value: string;
  comparison: string;
  change: "added" | "removed" | null;
}) {
  // Keep shared text readable while emphasizing the exact differing span.
  // Code points avoid splitting a non-ASCII identifier's surrogate pair.
  const { prefix, difference, suffix } = useMemo(() => {
    const current = Array.from(value);
    const other = Array.from(comparison);
    let start = 0;
    let end = 0;
    while (start < Math.min(current.length, other.length) && current[start] === other[start]) start += 1;
    while (end < Math.min(current.length, other.length) - start && current[current.length - end - 1] === other[other.length - end - 1]) end += 1;
    return {
      prefix: current.slice(0, start).join(""),
      difference: current.slice(start, current.length - end).join(""),
      suffix: end ? current.slice(-end).join("") : "",
    };
  }, [comparison, value]);
  return (
    <div className="tw:min-w-0">
      <dt className="tw:sr-only tw:@max-[440px]:not-sr-only tw:@max-[440px]:mb-1 tw:@max-[440px]:text-xs tw:@max-[440px]:text-muted-foreground">{label}</dt>
      <dd data-change={change} className="tw:m-0 tw:grid tw:grid-cols-[12px_minmax(0,1fr)] tw:gap-1 tw:rounded-xs tw:px-2 tw:py-1 tw:text-sm tw:data-[change=removed]:bg-danger-muted tw:data-[change=added]:bg-success/10">
        <span aria-hidden="true" data-change={change} className="tw:font-mono tw:data-[change=removed]:text-danger tw:data-[change=added]:text-success">{change === "removed" ? "−" : change === "added" ? "+" : ""}</span>
        <code className="tw:min-w-0 tw:select-text tw:font-mono tw:font-normal tw:leading-relaxed tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
          <span className="tw:text-muted-foreground">{prefix}</span>
          <span data-change={change} className="tw:font-medium tw:data-[change=removed]:text-danger tw:data-[change=added]:text-success">{difference}</span>
          <span className="tw:text-muted-foreground">{suffix}</span>
        </code>
      </dd>
    </div>
  );
}
