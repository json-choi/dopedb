// Bounded desktop stream projection. The grid and exports consume the immutable
// chunk source directly; this component never flattens a partial result. A small
// polite live region announces the outcome instead of the whole grid being live.
import { DataGridStatusScope } from "../../design-system/components/DataGridStatusScope";

import { type SqlStreamViewState } from "../queries/domain";
import { readsOidAliases } from "../queries/sqlWorkbenchModel";
import InspectableResultGrid from "../queryResults/InspectableResultGrid";
import {
  ResultWorkbenchFooter,
  ResultWorkbenchToolbar,
} from "../queryResults/ResultWorkbench";
import {
  ResultMeta,
  SqlSnippet,
  WorkbenchContainedBody,
} from "../../design-system/components/Workbench";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";

export default function StreamOutcome({
  stream,
  sql,
  maxRows,
  onRerun,
}: {
  stream: SqlStreamViewState;
  sql: string;
  maxRows: number;
  /** Re-runs the query when its stored rows can no longer be read back. */
  onRerun?: () => void;
}) {
  const { t } = useI18n();
  const running = stream.phase === "connecting" || stream.phase === "streaming";
  const partial = stream.phase !== "complete";
  const phaseLabel =
    stream.phase === "cancelled"
      ? t("sql.cancelled")
      : stream.phase === "outcome_unknown"
        ? t("sql.outcomeUnknownShort")
        : stream.phase === "error"
          ? t("sql.errorTitle")
          : t("sql.running");
  const announcement =
    stream.phase === "complete"
      ? t("results.liveComplete", {
          count: stream.rowCount,
          duration: stream.durationMs ?? 0,
        })
      : stream.phase === "cancelled"
        ? t("sql.cancelled")
        : stream.phase === "error" || stream.phase === "outcome_unknown"
          ? t("results.liveFailed")
          : "";

  return (
    <DataGridStatusScope>
      <span className="tw:sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <WorkbenchContainedBody>
        {stream.columns.length === 0 ? (
          <ResultMeta>
            <SqlSnippet>{sql}</SqlSnippet>
            {" · "}
            {running ? t("sql.running") : phaseLabel}
          </ResultMeta>
        ) : (
          <>
            <ResultWorkbenchToolbar
              columns={stream.columns}
              rowSource={stream.rowSource}
              filenameBase={`query-${stamp()}`}
              partial={partial}
            />
            <InspectableResultGrid
              result={{
                columns: stream.columns,
                rows: [],
                rowCount: stream.rowCount,
                truncated: stream.truncated,
                durationMs: stream.durationMs ?? 0,
              }}
              inspectionKey={stream}
              rowSource={stream.rowSource}
              surface="workbench"
              footerInset
              onRerun={onRerun}
            />
            <ResultWorkbenchFooter
              visible={stream.rowCount}
              total={stream.rowCount}
              duration={stream.durationMs}
              state={phaseLabel}
              truncated={stream.truncated}
              maxRows={maxRows}
              hint={readsOidAliases(sql) ? t("results.oidAliasHint") : undefined}
            />
          </>
        )}
      </WorkbenchContainedBody>
    </DataGridStatusScope>
  );
}
