// Read-only schema differences grouped by relation. Before/after definitions are
// always visible, wrap at the workbench width, and keep exact text selectable.
import { useMemo } from "react";
import { Icon } from "../../components/Icon";
import { WorkbenchScrollBody } from "../../design-system/components/Workbench";
import { useI18n, type I18nKey } from "../../lib/i18n";
import type { SchemaDiffStatus, SchemaObjectDiff, SchemaObjectType } from "../../lib/schemaDiff";

const OBJECT_LABELS: Record<SchemaObjectType, I18nKey> = {
  table: "schemaDiff.objectTable",
  view: "schemaDiff.objectView",
  column: "schemaDiff.objectColumn",
  index: "schemaDiff.objectIndex",
  foreignKey: "schemaDiff.objectForeignKey",
};

export const STATUS_LABELS: Record<Exclude<SchemaDiffStatus, "same">, I18nKey> = {
  added: "schemaDiff.statusAdded",
  missing: "schemaDiff.statusMissing",
  changed: "schemaDiff.statusChanged",
};

export function SchemaDiffResults({ objects }: { objects: SchemaObjectDiff[] }) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const byTable = new Map<string, SchemaObjectDiff[]>();
    for (const object of objects) {
      const members = byTable.get(object.tableKey) ?? [];
      members.push(object);
      byTable.set(object.tableKey, members);
    }
    return [...byTable];
  }, [objects]);

  return (
    <WorkbenchScrollBody aria-label={t("schemaDiff.detailTitle")}>
      {groups.map(([table, members]) => {
        const relation = members.length === 1 && members[0].path === table && members[0].status !== "changed"
          ? members[0]
          : null;
        return (
          <section key={table} aria-label={table} className="tw:shrink-0">
            <h3 className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-muted tw:px-3 tw:py-2 tw:text-sm tw:font-medium tw:normal-case tw:tracking-normal">
              <Icon name="table" className="tw:mt-0.5 tw:shrink-0 tw:text-muted-foreground" />
              <code className="tw:min-w-0 tw:flex-1 tw:select-text tw:font-mono tw:font-normal tw:[overflow-wrap:anywhere]">{table}</code>
              {relation ? (
                <>
                  <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">{t(OBJECT_LABELS[relation.objectType])}</span>
                  <DiffStatus status={relation.status} />
                </>
              ) : null}
            </h3>
            {relation ? null : members.map((object) => (
              <div key={object.id} className="tw:border-b tw:border-border-subtle tw:px-3 tw:py-2">
                <div className="tw:flex tw:items-start tw:gap-2">
                  <span className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-0.5">
                    <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">{t(OBJECT_LABELS[object.objectType])}</span>
                    {object.path !== object.tableKey ? (
                      <code className="tw:min-w-0 tw:select-text tw:font-mono tw:text-sm tw:font-normal tw:[overflow-wrap:anywhere]">{object.label}</code>
                    ) : null}
                  </span>
                  <DiffStatus status={object.status} />
                </div>
                <dl className="tw:m-0 tw:mt-1.5 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-x-3 tw:gap-y-2 tw:@max-[440px]:grid-cols-1">
                  <SchemaDefinition label={t("schemaDiff.baselineValue")} value={object.baselineValue} comparison={object.targetValue} change={object.status === "added" ? null : "removed"} />
                  <SchemaDefinition label={t("schemaDiff.targetValue")} value={object.targetValue} comparison={object.baselineValue} change={object.status === "missing" ? null : "added"} />
                </dl>
              </div>
            ))}
          </section>
        );
      })}
    </WorkbenchScrollBody>
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
  const current = Array.from(value);
  const other = Array.from(comparison);
  let start = 0;
  let end = 0;
  while (start < Math.min(current.length, other.length) && current[start] === other[start]) start += 1;
  while (end < Math.min(current.length, other.length) - start && current[current.length - end - 1] === other[other.length - end - 1]) end += 1;
  const prefix = current.slice(0, start).join("");
  const difference = current.slice(start, current.length - end).join("");
  const suffix = end ? current.slice(-end).join("") : "";
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
