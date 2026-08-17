// SQL table query, paging, filtering, and staged row-edit controller.
import { useEffect, useEffectEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CatalogTable,
  SafetySettings,
  ScriptOutcome,
} from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import { approveOperation, rejectOperation } from "../../features/operations/tauriAdapter";
import { runScript } from "../../features/queries/tauriAdapter";
import { proposeTableChanges } from "../../features/tableData/tauriAdapter";
import { useCatalogTableMetadata } from "../../features/tableData/catalogTable";
import type { RowEditorState } from "../../features/tableData/domain";
import { useAgentSelection } from "../../features/agents/selectionContext";
import { useTableDataState } from "../../features/tableData/state";
import {
  FILTER_DEBOUNCE_MS,
  sameFilters,
  TABLE_PAGE_SIZE,
} from "../../features/tableData/tableState";
import DataGrid from "../../features/queryResults/DataGrid";
import type { RowEditorSubmission } from "../../components/RowEditor";
import JobPanel from "../../features/jobs/JobPanel";
import Skeleton from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import DdlModal from "../Connections/DdlModal";
import {
  DataGridStatusPill,
  WorkbenchContainedBody,
  WorkbenchEmptyState,
  WorkbenchPane,
} from "../../design-system/components/Workbench";
import { tableCountQuery, tableRowsQuery } from "../../lib/queries";
import { tableKey } from "../../lib/tableRef";
import { useI18n } from "../../lib/i18n";
import {
  buildDelete,
  cellToInput,
  hasNonScalarPk,
  pkColumns,
} from "../../lib/sqlBuild";
import TableSidePanel from "./TableSidePanel";
import TableExpressionBar from "./TableExpressionBar";
import TableStructure from "./TableStructure";
import TableToolbar from "./TableToolbar";
import { useManualTransaction } from "../../features/queries/useManualTransaction";

export default function SqlTableData({
  connection,
  table: requestedTable,
  safety,
}: {
  connection: ConnectionProfile;
  table: CatalogTable;
  safety: SafetySettings;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const agentSelection = useAgentSelection();
  const manualTransaction = useManualTransaction(
    connection.id,
    requestedTable.database ?? connection.database,
  );
  const [ddlOpen, setDdlOpen] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const engine = connection.engine;
  const { table, catalogQueryResult, snapshotQuery } = useCatalogTableMetadata(
    connection.id,
    requestedTable,
    catalogEnabled,
  );

  const pageSize = Math.min(TABLE_PAGE_SIZE, safety.maxRows || TABLE_PAGE_SIZE);
  const key = tableKey(table);
  const {
    state: {
      writeError: writeErr,
      page,
      sort,
      filters,
      appliedFilters,
      whereExpression,
      appliedWhereExpression,
      orderByExpression,
      appliedOrderByExpression,
      selectedRow: selected,
      selectedCell: cellSel,
      editor,
      staged,
      reviewing,
      proposal: stagedProposal,
      confirmation: stagedConfirmation,
      running: stagedRunning,
      pendingDelete,
      structureOpen: structure,
      jobsOpen,
    },
    commands,
  } = useTableDataState(key);

  const rowsQuery = useQuery({
    ...tableRowsQuery({
      connectionId: connection.id,
      engine,
      table,
      filters: appliedFilters,
      whereExpression: appliedWhereExpression,
      orderByExpression: appliedOrderByExpression,
      sort,
      pageSize,
      page,
    }),
    // Paging and filtering repaint the same table's previous page. A table switch
    // never projects stale rows into the new table while its first page loads.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === key ? previousData : undefined,
  });
  const pageReady =
    rowsQuery.data !== undefined && !rowsQuery.isPlaceholderData;
  const countQuery = useQuery({
    ...tableCountQuery({
      connectionId: connection.id,
      engine,
      table,
      filters: appliedFilters,
      whereExpression: appliedWhereExpression,
    }),
    enabled: pageReady,
  });
  useEffect(() => {
    if (pageReady) setCatalogEnabled(true);
  }, [pageReady]);
  const result = rowsQuery.data?.result ?? null;
  const total = countQuery.data ?? null;
  const hasMore = rowsQuery.data?.hasMore ?? false;
  const busy = rowsQuery.isFetching;
  const err =
    writeErr ?? (rowsQuery.error ? errMessage(rowsQuery.error) : null);
  const catalogRelation = snapshotQuery.data?.relations.find(
    (candidate) =>
      candidate.object.name === table.name &&
      candidate.object.namespace === table.schema,
  );
  const settleFilters = useEffectEvent(() => commands.settleFilters());
  const clearSelectionAfterRowsChange = useEffectEvent(() => {
    commands.patch({
      selectedRow: null,
      selectedCell: null,
      writeError: null,
    });
  });

  // Settling a filter always returns to the first page; both land in one render so only the
  // final query key is ever fetched. The equality guard keeps this inert on mount and on a
  // table switch, where a stray timer would otherwise yank the user back to page 0.
  useEffect(() => {
    if (sameFilters(filters, appliedFilters)) return;
    const timer = window.setTimeout(() => {
      settleFilters();
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters, appliedFilters]);
  // Row editing needs a PK we can match on. No PK, or a PK whose rendered cell value can't
  // round-trip to a literal (binary/json/array/composite), both disable it — same as noPk.
  const nonScalarPk = hasNonScalarPk(table);
  const canEdit = pkColumns(table).length > 0 && !nonScalarPk;
  const activeFilters =
    Object.values(appliedFilters).filter((v) => v.trim()).length +
    (appliedWhereExpression.trim() ? 1 : 0);

  // Fresh rows landed, so any row/cell the user had selected now points at data that may
  // no longer be there, and a stale write error no longer describes what is on screen.
  useEffect(() => {
    clearSelectionAfterRowsChange();
  }, [rowsQuery.dataUpdatedAt]);

  const rows = result?.rowCount ?? 0;
  const from = rows === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rows;

  async function refreshRowsAndCount() {
    await rowsQuery.refetch();
    await countQuery.refetch();
    // Without this the toolbar refresh only ever reloads rows, so one failed
    // introspection would disable row editing for the whole life of the document.
    if (catalogQueryResult.error) await catalogQueryResult.refetch();
    if (snapshotQuery.error) await snapshotQuery.refetch();
  }

  function cycleSort(col: string) {
    commands.patch({
      orderByExpression: "",
      appliedOrderByExpression: "",
    });
    commands.cycleSort(col);
  }

  function applyWhereExpression(value: string) {
    commands.patch({
      whereExpression: value,
      appliedWhereExpression: value,
      page: 0,
    });
  }

  function applyOrderByExpression(value: string) {
    commands.patch({
      orderByExpression: value,
      appliedOrderByExpression: value,
      sort: null,
      page: 0,
    });
  }

  const selRow = selected != null && result ? result.rows[selected] : null;

  function rowMap(row: unknown[]): Record<string, string | null> {
    const m: Record<string, string | null> = {};
    result!.columns.forEach((c, i) => (m[c] = cellToInput(row[i])));
    return m;
  }

  function openEdit(mode: RowEditorState["mode"]) {
    const nextEditor =
      mode === "insert"
        ? { mode, initial: {} }
        : selRow
          ? { mode, initial: rowMap(selRow) }
          : editor;
    commands.patch({
      jobsOpen: false,
      editor: nextEditor,
      selectedCell: null,
    });
  }

  // Open a readable confirm (PK pairs) instead of staging a DELETE immediately —
  // Delete sits next to Duplicate, so a mis-click shouldn't be one approval from a wipe.
  function doDelete() {
    if (!selRow || !result) return;
    const pkVals: Record<string, string | null> = {};
    for (const c of pkColumns(table)) {
      const i = result.columns.indexOf(c.name);
      pkVals[c.name] = i >= 0 ? cellToInput(selRow[i]) : null;
    }
    commands.patch({
      pendingDelete: { key: pkVals, original: rowMap(selRow) },
      editor: null,
      selectedCell: null,
      jobsOpen: false,
    });
  }

  function stageWrite(write: RowEditorSubmission) {
    commands.stage({
      id: crypto.randomUUID(),
      sql: write.sql,
      rationale: write.rationale,
    });
  }

  // Confirmed: build the DELETE and add it to the staged transaction.
  function armDelete() {
    if (!pendingDelete) return;
    try {
      stageWrite({
        sql: buildDelete(
          engine,
          table,
          pendingDelete.key,
          pendingDelete.original,
        ),
        rationale: t("rowEditor.rationaleDelete", { table: table.name }),
        collapseSql: true,
      });
      commands.patch({ pendingDelete: null });
    } catch (e) {
      commands.patch({ writeError: errMessage(e) });
    }
  }

  function copyRow(asJson: boolean) {
    if (!selRow || !result) return;
    const text = asJson
      ? JSON.stringify(
          Object.fromEntries(
            result.columns.map((c, i) => [c, selRow[i] ?? null]),
          ),
          null,
          2,
        )
      : selRow
          .map((v) =>
            v == null
              ? ""
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v),
          )
          .join("\t");
    void navigator.clipboard.writeText(text);
    toast(t("tables.copyRow"));
  }

  async function prepareStagedChanges() {
    if (!staged.length || stagedRunning) return;
    const fingerprint = snapshotQuery.data?.fingerprint;
    if (!fingerprint) {
      commands.patch({
        writeError: snapshotQuery.error
          ? errMessage(snapshotQuery.error)
          : t("tables.catalogRequired"),
      });
      return;
    }
    commands.patch({ running: true, writeError: null });
    try {
      const proposal = await proposeTableChanges(
        connection.id,
        staged.map((change) => change.sql),
        fingerprint,
        table.database ?? connection.database,
      );
      commands.patch({ proposal, reviewing: true });
      if (!proposal.approvalRequired) {
        const outcome = await runScript(proposal.operationId);
        finishStagedChanges(outcome);
      }
    } catch (error) {
      commands.patch({ writeError: errMessage(error) });
    } finally {
      commands.patch({ running: false });
    }
  }

  async function approveStagedChanges() {
    if (!stagedProposal || stagedRunning) return;
    commands.patch({ running: true, writeError: null });
    try {
      await approveOperation(
        stagedProposal.operationId,
        stagedProposal.payloadHash,
        stagedProposal.confirmationPhrase ? stagedConfirmation : undefined,
      );
      finishStagedChanges(await runScript(stagedProposal.operationId));
    } catch (error) {
      commands.patch({ writeError: errMessage(error) });
    } finally {
      commands.patch({ running: false });
    }
  }

  async function rejectStagedChanges() {
    if (!stagedProposal || stagedRunning) return;
    try {
      await rejectOperation(
        stagedProposal.operationId,
        stagedProposal.payloadHash,
      );
    } catch (error) {
      commands.patch({ writeError: errMessage(error) });
    } finally {
      commands.patch({
        proposal: null,
        confirmation: "",
        reviewing: false,
      });
    }
  }

  function finishStagedChanges(outcome: ScriptOutcome) {
    const conflict = outcome.statements.find((statement) =>
      statement.error?.includes("optimistic concurrency conflict"),
    );
    if (!outcome.committed || conflict) {
      commands.patch({
        writeError:
          conflict?.error ??
          outcome.statements.find((statement) => statement.error)?.error ??
          t("tables.changeSetRolledBack"),
      });
      return;
    }
    toast(t("tables.rowsWritten", { count: outcome.statements.length }));
    commands.patch({
      staged: [],
      reviewing: false,
      proposal: null,
      confirmation: "",
      editor: null,
      pendingDelete: null,
      writeError: null,
    });
    void refreshRowsAndCount();
  }

  // An introspection failure leaves the table without columns, so the "no primary key"
  // reason would be a false diagnosis. Name the real cause first. A catalog that has
  // not been read yet — still disabled behind the first page, or in flight — is the
  // same false diagnosis in the other direction: the primary key was never looked at.
  const noEditTitle = catalogQueryResult.error
    ? t("tables.catalogLoadFailed", {
        error: errMessage(catalogQueryResult.error),
      })
    : catalogQueryResult.data === undefined
      ? t("tables.catalogRequired")
      : nonScalarPk
        ? t("tables.nonScalarPk")
        : t("tables.noTablePk");
  const panelOpen = reviewing || !!editor || !!cellSel || !!pendingDelete;

  return (
    <WorkbenchPane>
      <TableToolbar
        table={table}
        result={result}
        canEdit={canEdit}
        noEditTitle={noEditTitle}
        selected={selected}
        stagedCount={staged.length}
        activeFilters={activeFilters}
        page={page}
        pageSize={pageSize}
        total={total}
        hasMore={hasMore}
        rows={rows}
        busy={busy}
        jobsOpen={jobsOpen}
        catalogAvailable={!!catalogRelation}
        structureOpen={structure}
        manualTransaction={manualTransaction}
        writesEnabled={safety.allowWrites}
        onOpenEdit={openEdit}
        onDelete={doDelete}
        onReviewStaged={() =>
          commands.patch({
            reviewing: true,
            editor: null,
            pendingDelete: null,
            selectedCell: null,
          })
        }
        onDiscardStaged={() =>
          commands.patch({
            staged: [],
            reviewing: false,
            proposal: null,
          })
        }
        onClearFilters={() =>
          commands.patch({
            filters: {},
            appliedFilters: {},
            whereExpression: "",
            appliedWhereExpression: "",
          })
        }
        onPage={(nextPage) => commands.patch({ page: nextPage })}
        onRefresh={() => void refreshRowsAndCount()}
        onShowDdl={() => setDdlOpen(true)}
        onToggleJobs={() =>
          commands.patch({
            jobsOpen: !jobsOpen,
            reviewing: false,
            editor: null,
            pendingDelete: null,
            selectedCell: null,
          })
        }
        onToggleStructure={() => commands.patch({ structureOpen: !structure })}
        onCopyRow={copyRow}
      />

      <TableExpressionBar
        whereExpression={whereExpression}
        appliedWhereExpression={appliedWhereExpression}
        orderByExpression={orderByExpression}
        appliedOrderByExpression={appliedOrderByExpression}
        busy={busy}
        onWhereChange={(value) => commands.patch({ whereExpression: value })}
        onOrderByChange={(value) =>
          commands.patch({ orderByExpression: value })
        }
        onApplyWhere={applyWhereExpression}
        onApplyOrderBy={applyOrderByExpression}
      />

      <WorkbenchContainedBody>
        {structure && <TableStructure table={table} />}

        {err && (
          <div className="tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
            {err}
          </div>
        )}

        {/* Dim (not blank) the stale grid while paging/sorting/filtering re-queries. */}
        <div
          data-busy={busy && Boolean(result)}
          className="tw:flex tw:min-h-0 tw:flex-1 tw:data-[busy=true]:[&_[data-data-grid-scroll]]:pointer-events-none tw:data-[busy=true]:[&_[data-data-grid-scroll]]:opacity-50 tw:@max-[920px]:flex-col"
        >
          {result ? (
            result.rows.length ? (
              <DataGrid
                result={result}
                surface="workbench"
                footerInset
                startIndex={page * pageSize}
                sort={sort}
                onSort={cycleSort}
                filters={filters}
                onFilter={commands.filter}
                selectedRow={selected}
                onSelectRow={(selectedRow) => commands.patch({ selectedRow })}
                onCellClick={(value, i, column) => {
                  commands.patch({
                    selectedRow: i,
                    selectedCell: { value, column },
                    jobsOpen: false,
                  });
                  agentSelection.select({
                    connectionId: connection.id,
                    database: table.database ?? connection.database,
                    schema: table.schema ?? null,
                    table: table.name,
                    column,
                    rowIndex: page * pageSize + i,
                    row: Object.fromEntries(
                      result.columns.map((name, index) => [
                        name,
                        result.rows[i]?.[index] ?? null,
                      ]),
                    ),
                  });
                }}
                columnMeta={Object.fromEntries(
                  table.columns.map((column) => [
                    column.name,
                    { dataType: column.dataType, pk: column.pk },
                  ]),
                )}
              />
            ) : busy ? (
              // Reloading (filter cleared / table switched) — the stale zero-row result would
              // otherwise flash a wrong "Table is empty." against the now-live filter state.
              <WorkbenchEmptyState>
                {t("tables.loadingRows")}
              </WorkbenchEmptyState>
            ) : (
              // Loaded but zero rows: distinguish an empty table from a filter that matched nothing.
              <WorkbenchEmptyState icon="table">
                {activeFilters > 0
                  ? t("tables.noRowsFilter")
                  : t("tables.tableEmpty")}
              </WorkbenchEmptyState>
            )
          ) : (
            // No cached page for this table yet — the only place a cold load is visible.
            !err &&
            (busy ? (
              <div className="tw:flex-1 tw:p-3">
                <Skeleton lines={8} />
              </div>
            ) : (
              <WorkbenchEmptyState icon="table">
                {t("tables.noRows")}
              </WorkbenchEmptyState>
            ))
          )}

          {jobsOpen && catalogRelation ? (
            <JobPanel
              connectionId={connection.id}
              relation={catalogRelation}
              onClose={() => commands.patch({ jobsOpen: false })}
            />
          ) : panelOpen ? (
            <TableSidePanel
              engine={engine}
              table={table}
              selected={selected}
              editor={editor}
              pendingDelete={pendingDelete}
              reviewing={reviewing}
              staged={staged}
              proposal={stagedProposal}
              confirmation={stagedConfirmation}
              running={stagedRunning}
              catalogPending={snapshotQuery.isPending}
              selectedCell={cellSel}
              onSubmit={stageWrite}
              onCloseEditor={() => commands.patch({ editor: null })}
              onCloseDelete={() => commands.patch({ pendingDelete: null })}
              onArmDelete={armDelete}
              onCloseReview={() =>
                commands.patch({
                  reviewing: false,
                  proposal: null,
                  confirmation: "",
                })
              }
              onRemoveStaged={commands.removeStaged}
              onConfirmation={(confirmation) =>
                commands.patch({ confirmation })
              }
              onPrepare={() => void prepareStagedChanges()}
              onApprove={() => void approveStagedChanges()}
              onReject={() => void rejectStagedChanges()}
              onCloseCell={() => commands.patch({ selectedCell: null })}
            />
          ) : null}
        </div>
      </WorkbenchContainedBody>

      {result ? (
        <DataGridStatusPill
          title={[
            total != null
              ? t("tables.rowRangeTotal", {
                  from,
                  to,
                  total: total.toLocaleString(),
                })
              : t("tables.rowRange", { from, to }),
            result.truncated ? t("tables.truncated") : null,
            `${result.durationMs} ms`,
            selected != null
              ? t("tables.selectedRow", {
                  row: page * pageSize + selected + 1,
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {t("ide.queryRows", { count: result.rows.length })}
          {result.truncated ? ` · ${t("tables.truncated")}` : ""}
        </DataGridStatusPill>
      ) : null}
      {ddlOpen ? (
        <DdlModal
          connection={connection}
          table={table}
          onClose={() => setDdlOpen(false)}
        />
      ) : null}
    </WorkbenchPane>
  );
}
