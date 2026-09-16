import type { ScriptOperationProposal } from "../../ipc/types";
import type { GridSort } from "../../lib/sqlBuild";

export type RowEditorState = {
  mode: "insert" | "edit" | "duplicate";
  initial: Record<string, string | null>;
};

export type StagedWrite = {
  id: string;
  sql: string;
  rationale?: string;
};

export type PendingDelete = {
  key: Record<string, string | null>;
  original: Record<string, string | null>;
};

export type TableDataState = {
  viewKey: string;
  writeError: string | null;
  page: number;
  sort: GridSort | null;
  filters: Record<string, string>;
  appliedFilters: Record<string, string>;
  whereExpression: string;
  appliedWhereExpression: string;
  orderByExpression: string;
  appliedOrderByExpression: string;
  selectedRow: number | null;
  editor: RowEditorState | null;
  staged: StagedWrite[];
  reviewing: boolean;
  proposal: ScriptOperationProposal | null;
  running: boolean;
  pendingDelete: PendingDelete | null;
  structureOpen: boolean;
  jobsOpen: boolean;
};
