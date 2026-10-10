// Displays query outcomes and the recovery command owned by their exact connection.
// Errors are presented by their typed kind in translated copy (syntax, session
// statements, policy blocks, manual-transaction refusals, unknown outcomes) with a
// caret under the failing position and, for the latest run, a jump into the editor.
// A PostgreSQL error's DETAIL, HINT, and SQLSTATE get their own rows. Each failed
// script statement uses the same typed copy, server diagnostics, and caret for its
// own SQL. A kind without a verbatim diagnostic offers "Copy details" instead of
// inline backend text, and a moved shared connection offers its refresh.
import { DataGridStatusScope } from "../../design-system/components/DataGridStatusScope";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";

import { useToast } from "../../components/Toast";
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import InspectableResultGrid from "../queryResults/InspectableResultGrid";
import ResultToolbar from "../queryResults/ResultToolbar";
import {
  ResultWorkbenchFooter,
  ResultWorkbenchToolbar,
} from "../queryResults/ResultWorkbench";
import { gridCellText } from "../queryResults/dataGridSelection";
import { remapDecodeFailures } from "../queryResults/decodeFailures";
import {
  ResultMeta,
  SqlSnippet,
  WorkbenchContainedBody,
  WorkbenchEmptyState,
  WorkbenchScrollBody,
} from "../../design-system/components/Workbench";
import { Icon } from "../../components/Icon";
import type { ScriptStatementError } from "../../ipc/types";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { readsOidAliases } from "../queries/sqlWorkbenchModel";
import { refreshDesktopConnections } from "../workspaceAdmin/desktopConnections";
import ConnectionCredentialRecoveryNotice, {
  isCredentialRecoveryErrorKind,
} from "../connections/ConnectionCredentialRecoveryNotice";
import type { ConnectionProfile } from "../connections/domain";
import ManagedConnectionRecoveryNotice from "../connections/ManagedConnectionRecoveryNotice";
import {
  writeBlockRecoveryKind,
  writeBlockRecoveryOpensSafety,
  type WriteBlockRecoveryKind,
} from "../safetySettings/policy";
import StreamOutcome from "./StreamOutcome";
import { scriptStatementErrorCopy, sqlErrorCopy } from "./errorCopy";
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
  onRerun,
  onOpenActivity,
  errorNavigation,
}: {
  result: QueryServiceResultModel;
  connection: ConnectionProfile | null;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
  scriptStatementIndex?: number;
  /** Re-runs this session's SQL when its stored rows can no longer be read. */
  onRerun?: () => void;
  onOpenActivity?: () => void;
  errorNavigation?: SqlErrorNavigation | null;
}) {
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
        onRerun={onRerun}
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
  return (
    <SqlErrorCard
      error={result.error}
      prompt={result.prompt}
      connection={connection}
      onOpenSafety={onOpenSafety}
      onOpenActivity={onOpenActivity}
      navigation={errorNavigation}
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
  const filteredResult = useMemo(() => {
    if (!result) return { rows: [], sourceRows: [] as number[] };
    const sourceRows = result.rows.flatMap((row, index) =>
      !normalizedFilter ||
      row.some((value) =>
        gridCellText(value).toLocaleLowerCase().includes(normalizedFilter),
      )
        ? [index]
        : [],
    );
    return { rows: sourceRows.map((index) => result.rows[index]), sourceRows };
  }, [normalizedFilter, result]);
  const filteredRows = filteredResult.rows;
  const filteredDecodeFailures = remapDecodeFailures(
    result?.decodeFailures,
    filteredResult.sourceRows,
  );
  const visibleRows = filteredRows.slice(0, limit);
  const visibleDecodeFailures = filteredDecodeFailures.filter(
    (failure) => failure.rowIndex < visibleRows.length,
  );

  return (
    <DataGridStatusScope>
      <WorkbenchContainedBody>
        {result ? (
          <>
            <ResultWorkbenchToolbar
              columns={result.columns}
              rows={filteredRows}
              decodeFailures={filteredDecodeFailures}
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
            <InspectableResultGrid
              result={{
                ...result,
                rows: visibleRows,
                decodeFailures: visibleDecodeFailures,
                rowCount: filteredRows.length,
              }}
              inspectionKey={result}
              surface="workbench"
              footerInset
            />
            <ResultWorkbenchFooter
              visible={visibleRows.length}
              total={result.rows.length}
              onClearFilter={normalizedFilter ? () => setFilter("") : undefined}
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
              hint={readsOidAliases(sql) ? t("results.oidAliasHint") : undefined}
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
    </DataGridStatusScope>
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
          kind: statement.error.kind,
          message: statement.error.message,
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
              <ScriptStatementFailure
                sql={statement.sql}
                error={statement.error}
                connection={connection}
              />
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
                    decodeFailures={statement.result.decodeFailures}
                    filenameBase={`script-stmt${index + 1}-${stamp()}`}
                  />
                </div>
                <InspectableResultGrid
                  result={statement.result}
                  inspectionKey={statement.result}
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

/**
 * Line, column, and a caret under the offending character of the submitted SQL.
 * Tabs before the caret stay tabs so it lines up exactly under the text.
 */
function errorPosition(sql: string, position: number) {
  const codePoints = Array.from(sql);
  const index = Math.min(Math.max(position - 1, 0), codePoints.length);
  const lineStart =
    index === 0 ? 0 : codePoints.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = codePoints.indexOf("\n", index);
  const caretPrefix = codePoints
    .slice(lineStart, index)
    .map((value) => (value === "\t" ? "\t" : " "))
    .join("");
  return {
    line:
      codePoints.slice(0, index).filter((value) => value === "\n").length + 1,
    column: index - lineStart + 1,
    snippet:
      codePoints
        .slice(lineStart, lineEnd === -1 ? codePoints.length : lineEnd)
        .join("") +
      "\n" +
      caretPrefix +
      "^",
  };
}

/** A PostgreSQL server error's DETAIL, HINT, and SQLSTATE rows, when it sent them. */
function dbDiagnosticRows(error: {
  detail?: string | null;
  hint?: string | null;
  sqlstate?: string | null;
}) {
  return (
    [
      ["sql.errorDbDetail", error.detail],
      ["sql.errorHint", error.hint],
      ["sql.errorSqlstate", error.sqlstate],
    ] as const
  ).flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

/** Copies a reported reason that is not shown inline (it may be backend text). */
function CopyDetailsButton({ text }: { text: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Button
      size="compact"
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => toast(t("common.copied")))
          .catch(() => toast(t("results.copyFailed"), "error"))
      }
    >
      <Icon name="copy" />
      {t("sql.copyErrorDetails")}
    </Button>
  );
}

/**
 * Pulls the workspace so a shared connection whose revision moved is current
 * again, with the same resync the Explorer and workspace administration use.
 */
function SharedConnectionRefreshButton({ connectionId }: { connectionId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Button
      size="compact"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        void refreshDesktopConnections(queryClient, catalogScope.key, [connectionId])
          .then(() => toast(t("sql.connectionRefreshed")))
          .catch(() => toast(t("sql.connectionRefreshFailed"), "error"))
          .finally(() => setRefreshing(false));
      }}
    >
      <Icon name="refresh" />
      {refreshing ? t("common.refreshing") : t("sql.refreshConnection")}
    </Button>
  );
}

function ScriptStatementFailure({
  sql,
  error,
  connection,
}: {
  sql: string;
  error: ScriptStatementError;
  connection: ConnectionProfile | null;
}) {
  const { t } = useI18n();
  const copy = scriptStatementErrorCopy({ sql, error }, connection, t);
  const position = error.position !== null ? errorPosition(sql, error.position) : null;
  return (
    <div
      data-skipped={error.kind === "skipped"}
      className="tw:px-3 tw:py-2 tw:text-ui tw:text-danger tw:data-[skipped=true]:text-muted-foreground"
    >
      <p className="tw:m-0 tw:font-semibold">{copy.title}</p>
      {copy.message ? (
        <p className="tw:m-0 tw:mt-1 tw:leading-relaxed tw:text-foreground">{copy.message}</p>
      ) : null}
      {copy.detail ? (
        <pre className="tw:m-0 tw:mt-1 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:text-foreground tw:[overflow-wrap:anywhere]">
          {copy.detail}
        </pre>
      ) : null}
      {dbDiagnosticRows(error).map(({ label, value }) => (
        <p
          key={label}
          className="tw:m-0 tw:mt-1 tw:text-sm tw:text-foreground tw:[overflow-wrap:anywhere]"
        >
          <span className="tw:text-muted-foreground">{t(label)}: </span>
          <span className="tw:font-mono">{value}</span>
        </p>
      ))}
      {copy.copyable ? (
        <div className="tw:mt-2">
          <CopyDetailsButton text={copy.copyable} />
        </div>
      ) : null}
      {position ? (
        <pre className="tw:m-0 tw:mt-2 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre tw:text-foreground tw:[tab-size:4]">
          {t("sql.errorPositionAt", { line: position.line, column: position.column })}
          {"\n"}
          {position.snippet}
        </pre>
      ) : null}
    </div>
  );
}

/** The latest failed run's location mapped onto the live editor document. */
export type SqlErrorNavigation = {
  sessionId: string;
  line: number;
  column: number;
  jump: () => void;
};

function SqlErrorCard({
  error,
  prompt,
  connection,
  onOpenSafety,
  onOpenActivity,
  navigation,
}: {
  error: QueryServiceError;
  prompt: string;
  connection: ConnectionProfile | null;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
  onOpenActivity?: () => void;
  navigation?: SqlErrorNavigation | null;
}) {
  const { t } = useI18n();
  const position =
    error.position !== null ? errorPosition(error.sql, error.position) : null;
  const writeRecovery = connection
    ? writeBlockRecoveryKind(connection, error)
    : null;
  const copy = sqlErrorCopy(error, t, writeRecovery !== null);
  return (
    <div
      data-workbench-scroll-owner="document"
      className="scrollbar-sleek tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-auto tw:overscroll-contain tw:text-foreground"
    >
      {/* Only the title and translated message are announced, not every row. */}
      <div role="alert">
        <ResultMeta>
          <Icon name="alert" className="tw:text-danger" />
          <strong className="tw:text-danger">{copy.title}</strong>
          <span className="tw:text-muted-foreground"> · {error.at}</span>
          {copy.message ? <span className="tw:sr-only">{copy.message}</span> : null}
        </ResultMeta>
      </div>
      {error.kind === "managedConnectionRecoveryRequired" && connection ? (
        <ManagedConnectionRecoveryNotice connection={connection} />
      ) : null}
      {isCredentialRecoveryErrorKind(error.kind) && connection ? (
        <ConnectionCredentialRecoveryNotice
          connection={connection}
          errorKind={error.kind}
        />
      ) : null}
      {error.kind === "outcomeUnknown" && onOpenActivity ? (
        <InlineNotice
          tone="warning"
          icon="info"
          role="status"
          action={
            <Button size="compact" onClick={onOpenActivity}>
              {t("sql.outcomeUnknown.openActivity")}
            </Button>
          }
        >
          {t("sql.outcomeUnknown.guidance")}
        </InlineNotice>
      ) : null}
      <dl className="tw:m-0 tw:grid tw:grid-cols-[max-content_minmax(0,1fr)] tw:items-stretch tw:[&>*]:m-0 tw:[&>*]:border-b tw:[&>*]:border-border-subtle tw:[&>*]:px-3 tw:[&>*]:py-2 tw:[&>dd]:min-w-0 tw:[&>dt]:text-muted-foreground tw:max-[760px]:grid-cols-1 tw:max-[760px]:[&>dt]:border-b-0 tw:max-[760px]:[&>dt]:pb-0">
        {copy.message || copy.detail ? (
          <>
            <dt>{t("sql.errorMessage")}</dt>
            <dd>
              {copy.message ? (
                <p className="tw:m-0 tw:text-ui tw:leading-relaxed tw:whitespace-pre-wrap">
                  {copy.message}
                </p>
              ) : null}
              {copy.detail ? (
                <pre
                  data-framed={copy.message ? "true" : undefined}
                  className="tw:m-0 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere] tw:data-[framed=true]:mt-2"
                >
                  {copy.detail}
                </pre>
              ) : null}
              {copy.copyable || (error.kind === "sharedConnectionChanged" && connection) ? (
                <div className="ds-control-row tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  {error.kind === "sharedConnectionChanged" && connection ? (
                    <SharedConnectionRefreshButton connectionId={connection.id} />
                  ) : null}
                  {copy.copyable ? <CopyDetailsButton text={copy.copyable} /> : null}
                </div>
              ) : null}
            </dd>
          </>
        ) : null}
        {dbDiagnosticRows(error).map(({ label, value }) => (
          <Fragment key={label}>
            <dt>{t(label)}</dt>
            <dd className="tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
              {value}
            </dd>
          </Fragment>
        ))}
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
              <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3 tw:max-[760px]:flex-col">
                <pre className="tw:m-0 tw:min-w-0 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre tw:[tab-size:4]">
                  {navigation
                    ? t("sql.errorPositionInEditor", {
                        line: navigation.line,
                        column: navigation.column,
                      })
                    : t("sql.errorPositionAt", {
                        line: position.line,
                        column: position.column,
                      })}
                  {"\n"}
                  {position.snippet}
                </pre>
                {navigation ? (
                  <Button size="compact" onClick={navigation.jump}>
                    {t("sql.jumpToError")}
                  </Button>
                ) : null}
              </div>
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
