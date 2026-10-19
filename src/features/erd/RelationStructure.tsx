// The one read-only structure view (columns, indexes, foreign keys) for a relation. Both the
// Tables structure panel (CatalogTable) and the Schema inspector (Catalog V2 relation) feed it
// through the adapters below, so the two screens cannot drift apart on what a structure shows.
import type {
  CatalogConstraint,
  CatalogIndexKey,
  CatalogRelationV2,
  CatalogTable,
} from "../../ipc/types";
import { relationDisplayName } from "../../lib/erdGraph";
import { useI18n } from "../../lib/i18n";

export type RelationStructureModel = {
  columns: { name: string; type: string; nullable: boolean; pk: boolean }[];
  constraints: CatalogConstraint[];
  indexes: {
    name: string;
    unique: boolean;
    keys: string;
    includedColumns: string[];
    predicate?: string | null;
  }[];
};

const keyText = (keys: CatalogIndexKey[]) =>
  keys.map((key) => key.column ?? key.expression ?? "?").join(", ");

export function structureFromTable(table: CatalogTable): RelationStructureModel {
  return {
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.dataType,
      nullable: column.nullable,
      pk: column.pk,
    })),
    constraints: table.constraints,
    indexes: table.indexes.map((index) => ({
      name: index.name,
      unique: index.unique,
      keys: index.keys.length ? keyText(index.keys) : index.columns.join(", "),
      includedColumns: index.includedColumns,
      predicate: index.predicate,
    })),
  };
}

export function structureFromRelation(
  relation: CatalogRelationV2,
): RelationStructureModel {
  return {
    columns: relation.columns.map((column) => ({
      name: column.name,
      type: column.nativeType,
      nullable: column.nullable,
      pk: false,
    })),
    constraints: relation.constraints,
    indexes: relation.indexes.map((index) => ({
      name: index.name,
      unique: index.unique,
      keys: keyText(index.keys),
      includedColumns: index.includedColumns,
      predicate: index.predicate,
    })),
  };
}

export default function RelationStructure({
  structure,
}: {
  structure: RelationStructureModel;
}) {
  const { t } = useI18n();
  const primaryKey =
    structure.constraints.find((constraint) => constraint.kind === "primary")
      ?.columns ??
    structure.columns.filter((column) => column.pk).map((column) => column.name);
  const foreignKeys = structure.constraints.filter(
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
    <div className="tw:grid tw:min-w-0 tw:gap-4 tw:text-sm">
      <table className="tw:w-full tw:border-collapse tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:px-2 tw:[&_th]:py-1 tw:[&_th]:text-left tw:[&_th]:font-semibold tw:[&_th]:text-muted-foreground tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:px-2 tw:[&_td]:py-1 tw:[&_td]:text-left">
        <thead>
          <tr>
            <th>{t("tables.column")}</th>
            <th>{t("tables.type")}</th>
            <th>{t("tables.nullable")}</th>
            <th>{t("schema.pk")}</th>
          </tr>
        </thead>
        <tbody>
          {structure.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td className="tw:text-muted-foreground">{column.type}</td>
              <td>{column.nullable ? t("common.yes") : t("common.no")}</td>
              <td>{primaryKeyLabel(column.name)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-4 tw:text-muted-foreground tw:[&_strong]:text-foreground tw:[&_ul]:mt-2 tw:[&_ul]:mb-0 tw:[&_ul]:pl-4">
        <div>
          <strong>{t("tables.indexes")}</strong>
          {structure.indexes.length ? (
            <ul>
              {structure.indexes.map((index) => (
                <li key={index.name}>
                  {index.name}
                  {index.unique ? ` (${t("tables.unique")})` : ""}:{" "}
                  <span className="tw:font-mono">({index.keys})</span>
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
                    {foreignKey.referencedRelation
                      ? relationDisplayName(foreignKey.referencedRelation)
                      : ""}
                    ({foreignKey.referencedColumns.join(", ")})
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
