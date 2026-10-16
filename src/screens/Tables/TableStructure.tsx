// Presents read-only column and key metadata for the current catalog table. Primary-key
// positions follow key order and composite foreign keys stay one constraint.

import type { CatalogTable } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";

export default function TableStructure({ table }: { table: CatalogTable }) {
  const { t } = useI18n();
  const primaryKey = table.constraints.find(
    (constraint) => constraint.kind === "primary",
  )?.columns ?? table.columns.filter((column) => column.pk).map((column) => column.name);
  const foreignKeys = table.constraints.filter(
    (constraint) => constraint.kind === "foreign" && constraint.referencedRelation,
  );
  const primaryKeyLabel = (column: string) => {
    const position = primaryKey.indexOf(column);
    if (position < 0) return "";
    return primaryKey.length > 1
      ? `${t("schema.pk")} ${position + 1}`
      : t("schema.pk");
  };
  return (
    <div className="tw:grid tw:min-h-0 tw:flex-[0_1_280px] tw:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)] tw:gap-4 tw:overflow-auto tw:border-b tw:border-border-subtle tw:p-3 tw:@max-[920px]:grid-cols-1">
      <table className="tw:w-full tw:border-collapse tw:text-sm tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:px-2 tw:[&_th]:py-1 tw:[&_th]:text-left tw:[&_th]:font-semibold tw:[&_th]:text-muted-foreground tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:px-2 tw:[&_td]:py-1 tw:[&_td]:text-left">
        <thead>
          <tr>
            <th>{t("tables.column")}</th>
            <th>{t("tables.type")}</th>
            <th>{t("tables.nullable")}</th>
            <th>{t("schema.pk")}</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td className="tw:text-muted-foreground">{column.dataType}</td>
              <td>{column.nullable ? t("common.yes") : t("common.no")}</td>
              <td>{primaryKeyLabel(column.name)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-4 tw:text-sm tw:text-muted-foreground tw:[&_strong]:text-foreground tw:[&_ul]:mt-2 tw:[&_ul]:mb-0 tw:[&_ul]:pl-4">
        <div>
          <strong>{t("tables.indexes")}</strong>
          {table.indexes.length ? (
            <ul>
              {table.indexes.map((index) => (
                <li key={index.name}>
                  {index.name}
                  {index.unique ? ` (${t("tables.unique")})` : ""}:{" "}
                  <span className="tw:font-mono">({index.columns.join(", ")})</span>
                  {index.includedColumns.length > 0 ? (
                    <span className="tw:font-mono"> INCLUDE ({index.includedColumns.join(", ")})</span>
                  ) : null}
                  {index.predicate ? (
                    <span className="tw:font-mono"> WHERE {index.predicate}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <span> {t("common.none")}</span>
          )}
        </div>
        <div>
          <strong>{t("tables.foreignKeys")}</strong>
          {foreignKeys.length ? (
            <ul>
              {foreignKeys.map((foreignKey) => (
                <li key={foreignKey.name}>
                  {foreignKey.name}:{" "}
                  <span className="tw:font-mono">
                    ({foreignKey.columns.join(", ")}) →{" "}
                    {foreignKey.referencedRelation?.namespace
                      ? `${foreignKey.referencedRelation.namespace}.`
                      : ""}
                    {foreignKey.referencedRelation?.name}(
                    {foreignKey.referencedColumns.join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span> {t("common.none")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
