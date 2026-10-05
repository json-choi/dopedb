// Builds one optimistic UPDATE per row; drafts retain the original values across re-queries.
import type { CatalogTable, Engine } from "../../ipc/types";
import { buildUpdate, hasNonScalarPk, pkColumns } from "../../lib/sqlBuild";
import type { StagedWrite } from "./domain";

export function cellEditKey(table: CatalogTable, original: Record<string, string | null>) {
  return Object.fromEntries(pkColumns(table).map((column) => [column.name, original[column.name]]));
}

export function sameCellEditRow(write: StagedWrite, key: Record<string, string | null>) {
  return !!write.cellEdit && Object.keys(key).length > 0 && Object.keys(key).length === Object.keys(write.cellEdit.key).length && Object.keys(key).every((column) => write.cellEdit!.key[column] === key[column]);
}

export function stageCellEdit(
  staged: StagedWrite[], engine: Engine, table: CatalogTable,
  original: Record<string, string | null>, column: string, value: string | null,
): StagedWrite[] {
  const metadata = table.columns.find((candidate) => candidate.name === column);
  const key = cellEditKey(table, original);
  if (!metadata || metadata.pk || (!metadata.nullable && value === null) ||
      !Object.keys(key).length || hasNonScalarPk(table) || Object.values(key).some((v) => v == null)) {
    throw new Error("Cell edit requires a writable column and a complete scalar primary key");
  }
  const existing = staged.find((write) => sameCellEditRow(write, key));
  const initial = existing?.cellEdit?.original ?? original;
  const values = { ...existing?.cellEdit?.values, [column]: value };
  if (value === initial[column]) delete values[column];
  const remaining = staged.filter((write) => write !== existing);
  if (!Object.keys(values).length) return remaining;
  const write: StagedWrite = {
    id: existing?.id ?? crypto.randomUUID(),
    sql: buildUpdate(engine, table, key, values, initial),
    cellEdit: { key, original: initial, values },
  };
  // Preserve statement order when another mutation follows this row's edit.
  return existing ? staged.map((candidate) => candidate === existing ? write : candidate) : [...remaining, write];
}
