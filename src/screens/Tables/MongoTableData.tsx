import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import DataGrid from "../../features/queryResults/DataGrid";
import { Icon } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import {
  DataGridStatusPill,
  WorkbenchButton,
  WorkbenchContainedBody,
  WorkbenchEmptyState,
  WorkbenchPane,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import type { ConnectionProfile } from "../../features/connections/domain";
import { useTablePageState } from "../../features/tableData/state";
import { useAgentSelection } from "../../features/agents/selectionContext";
import type { CatalogTable, QueryResult } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { documentsToGrid } from "../../lib/documentGrid";
import { useI18n } from "../../lib/i18n";
import { documentCountQuery, documentRowsQuery } from "../../lib/queries";
import { tableKey } from "../../lib/tableRef";
import Pager from "./Pager";

const PAGE = 100;

export default function MongoTableData({
  connection,
  table,
}: {
  connection: ConnectionProfile;
  table: CatalogTable;
}) {
  const { t } = useI18n();
  const agentSelection = useAgentSelection();
  const pageSize = PAGE;
  const key = tableKey(table);
  const [page, setPage] = useTablePageState(key);

  const rowsQuery = useQuery({
    ...documentRowsQuery({
      connectionId: connection.id,
      collection: table.name,
      pageSize,
      page,
    }),
    placeholderData: keepPreviousData,
  });
  const countQuery = useQuery(documentCountQuery(connection.id, table.name));
  const documentPage = rowsQuery.data ?? null;
  const total = countQuery.data ?? null;
  const busy = rowsQuery.isFetching;
  const error = rowsQuery.error ? errMessage(rowsQuery.error) : null;
  // A failed count leaves `total` null, which otherwise reads exactly like a count that
  // has not landed yet. Say so instead of silently dropping the range's denominator.
  const countUnavailable = countQuery.error != null;
  const fallbackColumns = useMemo(
    () => table.columns.map((column) => column.name),
    [table.columns],
  );
  const grid = useMemo(
    () => documentsToGrid(documentPage?.documents ?? [], fallbackColumns),
    [documentPage, fallbackColumns],
  );
  const result: QueryResult = {
    columns: grid.columns,
    rows: grid.rows,
    rowCount: grid.rows.length,
    truncated: documentPage?.truncated ?? false,
    durationMs: documentPage?.durationMs ?? 0,
  };
  const rows = result.rows.length;
  const from = rows === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + rows;

  return (
    <WorkbenchPane>
      <WorkbenchToolbar label={t("tables.pagination")}>
        <WorkbenchButton
          iconOnly
          disabled={busy}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={() => {
            void rowsQuery.refetch();
            void countQuery.refetch();
          }}
        >
          {busy ? "…" : <Icon name="refresh" />}
        </WorkbenchButton>
        <span className="tw:flex-1" />
        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          rows={rows}
          busy={busy}
          showRefresh={false}
          onPage={setPage}
          onRefresh={() => {
            void rowsQuery.refetch();
            void countQuery.refetch();
          }}
        />
      </WorkbenchToolbar>

      <WorkbenchContainedBody>
        {error && (
          <div className="tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
            {error}
          </div>
        )}
        <div
          data-busy={busy && Boolean(documentPage)}
          className="tw:relative tw:flex tw:min-h-0 tw:flex-1 tw:data-[busy=true]:pointer-events-none tw:data-[busy=true]:opacity-50"
        >
          {documentPage ? (
            <>
              <DataGrid
                result={result}
                surface="workbench"
                footerInset
                startIndex={page * pageSize}
                onCellClick={(_value, rowIndex, column) => {
                  agentSelection.select({
                    connectionId: connection.id,
                    database: table.database ?? connection.database,
                    schema: table.schema ?? null,
                    table: table.name,
                    column,
                    rowIndex: page * pageSize + rowIndex,
                    row: Object.fromEntries(
                      result.columns.map((name, index) => [
                        name,
                        result.rows[rowIndex]?.[index] ?? null,
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
              {rows === 0 && !busy && (
                <div className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:top-control-md tw:bottom-0 tw:flex tw:items-center tw:justify-center tw:bg-background/90 tw:text-ui tw:text-muted-foreground">
                  {t("tables.tableEmpty")}
                </div>
              )}
            </>
          ) : (
            !error &&
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
        </div>
      </WorkbenchContainedBody>
      {documentPage ? (
        <DataGridStatusPill
          title={[
            total != null
              ? t("tables.rowRangeTotal", {
                  from,
                  to,
                  total: total.toLocaleString(),
                })
              : t("tables.rowRange", { from, to }),
            countUnavailable ? t("tables.countUnavailable") : null,
            documentPage.truncated ? t("tables.truncated") : null,
            `${documentPage.durationMs} ms`,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {t("ide.queryRows", { count: rows })}
          {countUnavailable ? ` · ${t("tables.countUnavailable")}` : ""}
          {documentPage.truncated ? ` · ${t("tables.truncated")}` : ""}
        </DataGridStatusPill>
      ) : null}
    </WorkbenchPane>
  );
}
