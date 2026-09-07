// Packaged SQL editing and first-row scenarios. CodeMirror fixture settlement and
// streamed table evidence stay together because they define the SQL latency contract.
import { useState } from "react";
import { flushSync } from "react-dom";
import { Transaction } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

import SqlViewer from "../../components/SqlViewer";
import { formatSqlDocument } from "../../features/query/sqlFormatter";
import DataGrid from "../../features/queryResults/DataGrid";
import type { SqlStreamReceipt } from "../../features/queries/domain";
import { runSqlReadPage } from "../../features/queries/tauriAdapter";
import type { QueryResult } from "../../ipc/types";
import {
  measurePackagedAction,
  waitForPackagedPaint,
  type PackagedActionEvidence,
} from "../packagedMetrics";
import {
  ACTION_SAMPLES,
  BenchmarkSurface,
  DENSE_GRID_COLUMN_COUNT,
  FIXTURE_CONNECTION_ID,
  finishBenchmark,
  queryResult,
  samples,
  useScenarioRunner,
} from "./benchmarkHarness";

const SQL_RICH_EDITING_MAX_BYTES = 256 * 1024;

function sqlFixture(bytes: number) {
  const statement = "select id, email from benchmark_users where active = true;\n";
  return statement.repeat(Math.ceil(bytes / statement.length)).slice(0, bytes);
}

export function SqlEditorScenario() {
  const [value, setValue] = useState(() => sqlFixture(10 * 1024));
  const [view, setView] = useState<EditorView | null>(null);
  const [runCount, setRunCount] = useState(0);

  useScenarioRunner(view !== null, async () => {
    if (!view) return;
    const fixtures = [
      ["10k", 10 * 1024],
      ["100k", 100 * 1024],
      ["1m", 1024 * 1024],
    ] as const;

    for (const [label, size] of fixtures) {
      const source = sqlFixture(size);
      await setControlledSqlDocument(view, setValue, source);

      await samples(`sql-editor-${label}-type`, ACTION_SAMPLES, (index) => {
        const position = Math.max(0, view.state.doc.length - index);
        view.dispatch({ changes: { from: position, insert: " " } });
      });
      await settleSqlNavigationFixture(view, size);
      await samples(`sql-editor-${label}-cursor`, ACTION_SAMPLES, (index) => {
        const position = Math.floor(
          (view.state.doc.length * (index + 1)) / (ACTION_SAMPLES + 1),
        );
        view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      });
      for (let index = 0; index < 2; index += 1) {
        await setControlledSqlDocument(view, setValue, source);
        await measurePackagedAction(`sql-editor-${label}-format`, async () => {
          const formatted = await formatSqlDocument(view.state.doc.toString(), "sqlite");
          await setControlledSqlDocument(view, setValue, formatted);
        });
      }
      await samples(`sql-editor-${label}-run`, ACTION_SAMPLES, () => {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      if (label === "1m") {
        await waitForPackagedPaint();
        const scroller = view.scrollDOM;
        if (scroller.scrollHeight <= scroller.clientHeight) {
          throw new Error("SQL editor scroll surface unavailable");
        }
        await samples("sql-editor-1m-scroll", ACTION_SAMPLES, (index) => {
          if (index > 0 && scroller.scrollTop <= 0) {
            throw new Error("SQL editor viewport did not preserve its scroll position");
          }
          scroller.scrollTop = 0;
          scroller.scrollTop = Math.max(240, scroller.clientHeight / 2);
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          if (scroller.scrollTop <= 0) {
            throw new Error("SQL editor viewport did not accept a scroll position");
          }
        });
      }
    }
    await finishBenchmark();
  });

  return (
    <BenchmarkSurface title={`SQL editor · ${value.length} bytes · runs ${runCount}`}>
      <div
        data-workbench-scroll-owner="sql-editor"
        className="tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-background tw:[&>.dopedb-sql-viewer]:h-full tw:[&_.cm-editor]:h-full tw:[&_.cm-editor]:bg-background tw:[&_.cm-scroller]:min-h-0 tw:[&_.cm-scroller]:overflow-auto tw:[&_.cm-scroller]:overscroll-contain"
      >
        <SqlViewer
          value={value}
          editable
          engine="sqlite"
          minHeight="0px"
          onChange={setValue}
          onEditorReady={setView}
          onRun={() => setRunCount((count) => count + 1)}
        />
      </div>
    </BenchmarkSurface>
  );
}

async function settleSqlNavigationFixture(view: EditorView, bytes: number) {
  if (bytes <= SQL_RICH_EDITING_MAX_BYTES) {
    forceParsing(view, view.state.doc.length, 1_000);
  }
  await waitForPackagedPaint();
}

async function setControlledSqlDocument(
  view: EditorView,
  setValue: (value: string) => void,
  value: string,
) {
  flushSync(() => setValue(value));
  const matches = () => {
    const document = view.state.doc;
    const edgeLength = Math.min(64, value.length);
    return document.length === value.length
      && document.sliceString(0, edgeLength) === value.slice(0, edgeLength)
      && document.sliceString(document.length - edgeLength) === value.slice(-edgeLength);
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForPackagedPaint();
    if (matches()) return;
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: 0 },
    annotations: Transaction.addToHistory.of(false),
  });
  await waitForPackagedPaint();
  if (!matches()) throw new Error("controlled SQL benchmark document did not settle");
}

export function TableFirstRowScenario() {
  const [result, setResult] = useState<QueryResult>(() => queryResult(0));

  useScenarioRunner(true, async () => {
    await runTablePage("table-first-page-cold");
    for (let index = 0; index < ACTION_SAMPLES; index += 1) {
      await runTablePage("table-first-page");
    }
    await finishBenchmark();
  });

  async function runTablePage(action: "table-first-page-cold" | "table-first-page") {
    setResult(queryResult(0));
    await waitForPackagedPaint();
    await measurePackagedAction(action, async () => {
      const observation: {
        firstBatchAcceptedAtMs: number | null;
        stages: NonNullable<SqlStreamReceipt["benchmarkStages"]> | null;
      } = { firstBatchAcceptedAtMs: null, stages: null };
      const pageResult = await runSqlReadPage(
        FIXTURE_CONNECTION_ID,
        "SELECT * FROM benchmark_table LIMIT 101 OFFSET 0",
        "packaged-benchmark",
        undefined,
        {
          onFirstBatchAccepted: (acceptedAtMs) => {
            observation.firstBatchAcceptedAtMs = acceptedAtMs;
          },
          onComplete: (receipt) => {
            observation.stages = receipt.benchmarkStages ?? null;
          },
        },
      );
      if (pageResult.columns.length !== DENSE_GRID_COLUMN_COUNT) {
        throw new Error("Table benchmark fixture column count changed");
      }
      if (pageResult.rows.length !== 101) {
        throw new Error("Table benchmark fixture page size changed");
      }
      const rows = pageResult.rows.slice(0, 100);
      const visibleResult = {
        ...pageResult,
        rows,
        rowCount: rows.length,
        truncated: true,
      };
      const ipcPayloadBytes = new TextEncoder().encode(JSON.stringify({
        columns: pageResult.columns,
        rows: pageResult.rows,
      })).byteLength;
      const { stages } = observation;
      setResult(visibleResult);
      return {
        ipcPayloadBytes,
        retainedBytes: ipcPayloadBytes,
        sqliteTransactionCount: 0,
        backendRequestToFirstRowMs: stages?.firstRowMs ?? null,
        backendFirstRowToIpcBatchMs:
          stages?.firstRowMs != null && stages.firstIpcBatchMs != null
            ? Math.max(0, stages.firstIpcBatchMs - stages.firstRowMs)
            : null,
        operationClaimMs: stages?.operationClaimMs ?? null,
        poolConnectStartMs: stages?.poolConnectStartMs ?? null,
        poolConnectReadyMs: stages?.poolConnectReadyMs ?? null,
        backendExecuteStartMs: stages?.backendExecuteStartMs ?? null,
        firstRowMs: stages?.firstRowMs ?? null,
        firstIpcBatchMs: stages?.firstIpcBatchMs ?? null,
        ipcBatchAcceptedAtMs: observation.firstBatchAcceptedAtMs,
      } satisfies PackagedActionEvidence;
    });
  }

  return (
    <BenchmarkSurface title="Table data · local SQLite · first 100-row page">
      <DataGrid result={result} surface="workbench" />
    </BenchmarkSurface>
  );
}
