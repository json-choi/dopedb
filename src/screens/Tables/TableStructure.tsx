// Presents read-only column and key metadata for the current catalog table.

import type { CatalogTable } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";

export default function TableStructure({ table }: { table: CatalogTable }) {
  const { t } = useI18n();
  return (
    <div className="tw:grid tw:min-h-0 tw:flex-[0_1_280px] tw:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)] tw:gap-4 tw:overflow-auto tw:border-b tw:border-border-subtle tw:p-3 tw:@max-[920px]:grid-cols-1">
      <table className="tw:w-full tw:border-collapse tw:text-sm tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:px-2 tw:[&_th]:py-1 tw:[&_th]:text-left tw:[&_th]:font-semibold tw:[&_th]:text-muted-foreground tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:px-2 tw:[&_td]:py-1 tw:[&_td]:text-left">
        <thead>
          <tr>
            <th>{t("tables.column")}</th>
            <th>{t("tables.type")}</th>
            <th>{t("tables.nullable")}</th>
            <th>PK</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td className="tw:text-muted-foreground">{column.dataType}</td>
              <td>{column.nullable ? t("common.yes") : t("common.no")}</td>
              <td>{column.pk ? "PK" : ""}</td>
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
                  {index.columns.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <span> {t("common.none")}</span>
          )}
        </div>
        <div>
          <strong>{t("tables.foreignKeys")}</strong>
          {table.foreignKeys.length ? (
            <ul>
              {table.foreignKeys.map((foreignKey) => (
                <li
                  key={`${foreignKey.column}-${foreignKey.referencesTable}-${foreignKey.referencesColumn}`}
                >
                  {foreignKey.column} →{" "}
                  {foreignKey.referencesSchema
                    ? `${foreignKey.referencesSchema}.`
                    : ""}
                  {foreignKey.referencesTable}.{foreignKey.referencesColumn}
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
