import { useMemo, useState } from "react";

import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import DataGrid from "../queryResults/DataGrid";
import ResultToolbar from "../queryResults/ResultToolbar";
import {
  ResultWorkbenchFooter,
  ResultWorkbenchToolbar,
  resultCellText,
} from "../queryResults/ResultWorkbench";
import {
  ResultMeta,
  SqlSnippet,
  WorkbenchContainedBody,
  WorkbenchEmptyState,
  WorkbenchScrollBody,
} from "../../design-system/components/Workbench";
import { Icon } from "../../components/Icon";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import type { ConnectionProfile } from "../connections/domain";
import {
  writeBlockRecoveryKind,
  writeBlockRecoveryOpensSafety,
  type WriteBlockRecoveryKind,
} from "../safetySettings/policy";
import StreamOutcome from "./StreamOutcome";
import type {
  QueryServiceError,
  QueryServiceResult as QueryServiceResultModel,
} from "./domain";

const PAGE_STEP = 200;

export default function QueryServiceResult({
  result,
  connection,
  onOpenSafety,
  scriptStatementIndex,
}: {
  result: QueryServiceResultModel;
  connection: ConnectionProfile | null;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
  scriptStatementIndex?: number;
}) {
  const { t } = useI18n();
  if (result.kind === "none") {
    return (
      <WorkbenchEmptyState icon="table">
        <EmptyResultMessage />
      </WorkbenchEmptyState>
    );
  }
  if (result.kind === "materialized") {
    return (
      <MaterializedResult
        sql={result.sql}
        outcome={result.outcome}
        at={result.at}
        maxRows={result.maxRows}
      />
    );
  }
  if (result.kind === "stream") {
    return (
      <StreamOutcome
        stream={result.stream}
        sql={result.sql}
        maxRows={result.maxRows}
      />
    );
  }
  if (result.kind === "script") {
    return (
      <ScriptResults
        outcome={result.outcome}
        at={result.at}
        statementIndex={scriptStatementIndex}
        connection={connection}
        onOpenSafety={onOpenSafety}
      />
    );
  }
  if (result.kind === "unavailable") {
    return (
      <WorkbenchEmptyState icon="table">
        <span>
          {result.reason === "legacyResultFormat"
            ? t("results.legacyUnavailable")
            : result.reason}
        </span>
      </WorkbenchEmptyState>
    );
  }
  return (
    <SqlErrorCard
      error={result.error}
      prompt={result.prompt}
      connection={connection}
      onOpenSafety={onOpenSafety}
    />
  );
}

function EmptyResultMessage() {
  const { t } = useI18n();
  return <>{t("sql.resultsEmpty")}</>;
}

function MaterializedResult({
  sql,
  outcome,
  at,
  maxRows,
}: Omit<Extract<QueryServiceResultModel, { kind: "materialized" }>, "kind">) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE_STEP);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const result = outcome.result;
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredRows = useMemo(() => {
    if (!result || !normalizedFilter) return result?.rows ?? [];
    return result.rows.filter((row) =>
      row.some((value) =>
        resultCellText(value).toLocaleLowerCase().includes(normalizedFilter),
      ),
    );
  }, [normalizedFilter, result]);
  const visibleRows = filteredRows.slice(0, limit);

  return (
    <WorkbenchContainedBody>
      {result ? (
        <>
          <ResultWorkbenchToolbar
            columns={result.columns}
            rows={filteredRows}
            filenameBase={`query-${stamp()}`}
            filterOpen={filterOpen}
            filter={filter}
            onToggleFilter={() => {
              setFilterOpen((open) => !open);
              if (filterOpen) setFilter("");
            }}
            onFilterChange={(value) => {
              setFilter(value);
              setLimit(PAGE_STEP);
            }}
          />
          <DataGrid
            result={{
              ...result,
              rows: visibleRows,
              rowCount: filteredRows.length,
            }}
            surface="workbench"
            footerInset
          />
          <ResultWorkbenchFooter
            visible={visibleRows.length}
            total={result.rows.length}
            duration={result.durationMs}
            truncated={result.truncated}
            maxRows={maxRows}
            showMoreCount={Math.min(
              PAGE_STEP,
              filteredRows.length - visibleRows.length,
            )}
            onShowMore={
              filteredRows.length > limit
                ? () => setLimit((current) => current + PAGE_STEP)
                : undefined
            }
          />
        </>
      ) : (
        <ResultMeta>
          <SqlSnippet>{sql}</SqlSnippet>
          {" · "}
          {outcome.manualTransaction
            ? t("sql.writeStaged")
            : outcome.committed
              ? t("sql.writeCommitted")
              : t("sql.noRowsReturned")}
          {outcome.affected !== null && (
            <> · {t("sql.affected", { count: outcome.affected })}</>
          )}{" "}
          · {at}
        </ResultMeta>
      )}
    </WorkbenchContainedBody>
  );
}

function ScriptResults({
  outcome,
  at,
  statementIndex,
  connection,
  onOpenSafety,
}: Omit<Extract<QueryServiceResultModel, { kind: "script" }>, "kind"> & {
  statementIndex?: number;
  connection: ConnectionProfile | null;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
}) {
  const { t } = useI18n();
  const summary = outcome.allReads
    ? t("sql.readOnlyScript")
    : outcome.manualTransaction
      ? t("sql.scriptStaged")
      : outcome.committed
        ? t("sql.committed")
        : t("sql.failedRolledBack");
  const statements =
    statementIndex === undefined
      ? outcome.statements.map((statement, index) => ({ statement, index }))
      : outcome.statements[statementIndex]
        ? [
            {
              statement: outcome.statements[statementIndex],
              index: statementIndex,
            },
          ]
        : [];
  const fillsResultPane = statementIndex !== undefined;
  const recoveryKinds = connection === null
    ? []
    : statements.flatMap(({ statement }) => {
        if (!statement.error) return [];
        const kind = writeBlockRecoveryKind(connection, {
          kind: null,
          message: statement.error,
          sql: statement.sql,
        });
        return kind ? [kind] : [];
      });
  const hasSafetyRecovery = recoveryKinds.length > 0;
  const canOpenSafety = recoveryKinds.some(writeBlockRecoveryOpensSafety);
  const content = (
    <>
      <ResultMeta>
        {summary} ·{" "}
        {t("sql.statementCount", { count: outcome.statements.length })} · {at}
      </ResultMeta>
      {hasSafetyRecovery && connection ? (
        <InlineNotice
          tone="warning"
          icon="info"
          role="status"
          action={canOpenSafety ? (
            <Button
              size="compact"
              onClick={() => onOpenSafety(connection.id)}
            >
              {t("sql.writeBlock.reviewSafety", {
                connection: connection.name,
              })}
            </Button>
          ) : undefined}
        >
          {t(
            canOpenSafety
              ? "sql.writeBlock.scriptGuidance"
              : "sql.writeBlock.scriptUnavailableGuidance",
          )}
        </InlineNotice>
      ) : null}
      {statements.map(({ statement, index }) => (
          <section
            key={`${index}:${statement.sql}`}
            data-fill={fillsResultPane}
            className="tw:flex tw:min-h-0 tw:flex-col tw:border-t tw:border-border-subtle tw:pt-2 tw:data-[fill=true]:flex-1"
          >
            <ResultMeta>
              <span className="tw:inline-block tw:min-w-4 tw:font-semibold">
                {index + 1}
              </span>
              <SqlSnippet>{statement.sql}</SqlSnippet>
            </ResultMeta>
            {statement.error ? (
              <div className="tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
                {statement.error}
              </div>
            ) : statement.result ? (
              <>
                <div className="tw:mx-3 tw:my-1 tw:text-sm tw:text-muted-foreground">
                  {t(
                    statement.result.truncated
                      ? "agent.rowsTruncated"
                      : "agent.rows",
                    { count: statement.result.rowCount },
                  )}{" "}
                  · {statement.result.durationMs} ms
                  {" · "}
                  <ResultToolbar
                    columns={statement.result.columns}
                    rows={statement.result.rows}
                    filenameBase={`script-stmt${index + 1}-${stamp()}`}
                  />
                </div>
                <DataGrid
                  result={statement.result}
                  surface={fillsResultPane ? "workbench" : "embedded"}
                />
              </>
            ) : (
              <div className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
                {t("sql.affected", { count: statement.affected ?? 0 })}
              </div>
            )}
          </section>
        ))}
    </>
  );
  return fillsResultPane ? (
    <WorkbenchContainedBody>{content}</WorkbenchContainedBody>
  ) : (
    <WorkbenchScrollBody>{content}</WorkbenchScrollBody>
  );
}

function errorPosition(sql: string, position: number) {
  const codePoints = Array.from(sql);
  const index = Math.min(Math.max(position - 1, 0), codePoints.length);
  const lineStart =
    index === 0 ? 0 : codePoints.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = codePoints.indexOf("\n", index);
  const column = index - lineStart;
  return {
    line:
      codePoints.slice(0, index).filter((value) => value === "\n").length + 1,
    column: column + 1,
    snippet:
      codePoints
        .slice(lineStart, lineEnd === -1 ? codePoints.length : lineEnd)
        .join("") +
      "\n" +
      " ".repeat(column) +
      "^",
  };
}

function SqlErrorCard({
  error,
  prompt,
  connection,
  onOpenSafety,
}: {
  error: QueryServiceError;
  prompt: string;
  connection: ConnectionProfile | null;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
}) {
  const { t } = useI18n();
  const position =
    error.position !== null ? errorPosition(error.sql, error.position) : null;
  const writeRecovery = connection
    ? writeBlockRecoveryKind(connection, error)
    : null;
  return (
    <div
      data-workbench-scroll-owner="document"
      className="scrollbar-sleek tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-auto tw:overscroll-contain tw:text-foreground"
      role="alert"
    >
      <ResultMeta>
        <Icon name="alert" className="tw:text-danger" />
        <strong className="tw:text-danger">{t("sql.errorTitle")}</strong>
        <span className="tw:text-muted-foreground"> · {error.at}</span>
      </ResultMeta>
      <dl className="tw:m-0 tw:grid tw:grid-cols-[max-content_minmax(0,1fr)] tw:items-stretch tw:[&>*]:m-0 tw:[&>*]:border-b tw:[&>*]:border-border-subtle tw:[&>*]:px-3 tw:[&>*]:py-2 tw:[&>dd]:min-w-0 tw:[&>dt]:text-muted-foreground tw:max-[760px]:grid-cols-1 tw:max-[760px]:[&>dt]:border-b-0 tw:max-[760px]:[&>dt]:pb-0">
        <dt>{t("sql.errorKind")}</dt>
        <dd>
          <code className="tw:font-mono tw:text-sm">
            {error.kind ?? t("common.unknown")}
          </code>
        </dd>
        <dt>{t("sql.errorMessage")}</dt>
        <dd>
          <pre className="tw:m-0 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
            {error.message}
          </pre>
        </dd>
        {writeRecovery && connection ? (
          <WriteBlockRecoveryRow
            kind={writeRecovery}
            connection={connection}
            onOpenSafety={onOpenSafety}
          />
        ) : null}
        {position ? (
          <>
            <dt>{t("sql.errorPosition")}</dt>
            <dd>
              <pre className="tw:m-0 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
                {t("sql.errorPositionAt", {
                  line: position.line,
                  column: position.column,
                })}
                {"\n"}
                {position.snippet}
              </pre>
            </dd>
          </>
        ) : null}
      </dl>
      <details className="tw:border-b tw:border-border-subtle">
        <summary className="tw:min-h-control-md tw:cursor-pointer tw:px-3 tw:py-2 tw:text-ui tw:text-muted-foreground">
          {t("sql.errorContext")}
        </summary>
        <pre className="tw:m-0 tw:max-h-[280px] tw:overflow-auto tw:border-t tw:border-border-subtle tw:bg-background tw:p-3 tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
          {prompt}
        </pre>
      </details>
    </div>
  );
}

function WriteBlockRecoveryRow({
  kind,
  connection,
  onOpenSafety,
}: {
  kind: WriteBlockRecoveryKind;
  connection: ConnectionProfile;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
}) {
  const { t } = useI18n();
  let permission: string;
  let guidance: string;
  switch (kind) {
    case "deviceSafety":
      permission = t("sql.writeBlock.permissionDeviceSafety");
      guidance = t("sql.writeBlock.guidanceDeviceSafety", {
        connection: connection.name,
      });
      break;
    case "localSafety":
      permission = t("sql.writeBlock.permissionLocalSafety");
      guidance = t("sql.writeBlock.guidanceLocalSafety", {
        connection: connection.name,
      });
      break;
    case "managedCredential":
      permission = t("sql.writeBlock.permissionManagedCredential");
      guidance = t("sql.writeBlock.guidanceManagedCredential", {
        connection: connection.name,
      });
      break;
    case "schemaSafety":
      permission = t("sql.writeBlock.permissionSchemaSafety");
      guidance = t("sql.writeBlock.guidanceSchemaSafety", {
        connection: connection.name,
      });
      break;
    case "schemaUnavailable":
      permission = t("sql.writeBlock.permissionSchemaUnavailable");
      guidance = t("sql.writeBlock.guidanceSchemaUnavailable", {
        connection: connection.name,
      });
      break;
    case "workspaceGrant":
      permission = t("sql.writeBlock.permissionWorkspaceGrant");
      guidance = t("sql.writeBlock.guidanceWorkspaceGrant", {
        connection: connection.name,
      });
      break;
    case "workspacePolicy":
      permission = t("sql.writeBlock.permissionWorkspacePolicy");
      guidance = t("sql.writeBlock.guidanceWorkspacePolicy", {
        connection: connection.name,
      });
      break;
    case "workspacePolicyAndDevice":
      permission = t("sql.writeBlock.permissionWorkspacePolicyAndDevice");
      guidance = t("sql.writeBlock.guidanceWorkspacePolicyAndDevice", {
        connection: connection.name,
      });
      break;
  }
  const canModifyHere = writeBlockRecoveryOpensSafety(kind);
  return (
    <>
      <dt>{t("sql.writeBlock.requiredPermission")}</dt>
      <dd>
        <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3 tw:max-[760px]:flex-col">
          <div className="tw:min-w-0 tw:flex-1">
            <strong className="tw:block tw:text-ui tw:text-foreground">
              {permission}
            </strong>
            <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {guidance}
            </p>
          </div>
          {canModifyHere ? <div className="tw:shrink-0">
            <Button
              size="compact"
              onClick={() => onOpenSafety(connection.id)}
            >
              {t("sql.writeBlock.openSafety", {
                connection: connection.name,
              })}
            </Button>
          </div> : null}
        </div>
      </dd>
    </>
  );
}
