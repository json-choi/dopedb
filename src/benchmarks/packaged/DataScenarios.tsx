// Packaged Explorer, result-grid, and retained-data scenarios. Their shared
// contract is deterministic large-data projection rather than product state ownership.
import { useMemo, useState } from "react";

import { VirtualTreeRows, type VirtualTreeRow } from "../../design-system/components/VirtualTreeRows";
import {
  indexActionSearchItems,
  searchActionItems,
  type ActionSearchItem,
} from "../../features/actionSearch/domain";
import DataGrid from "../../features/queryResults/DataGrid";
import type { QueryResult } from "../../ipc/types";
import {
  runPackagedBenchmarkBackend,
  type PackagedBackendAction,
  type PackagedBackendReceipt,
} from "../backend";
import { measurePackagedAction, waitForPackagedPaint } from "../packagedMetrics";
import {
  ACTION_SAMPLES,
  BenchmarkSurface,
  DENSE_GRID_COLUMN_COUNT,
  backendEvidence,
  finishBenchmark,
  queryResult,
  samples,
  useScenarioRunner,
} from "./benchmarkHarness";

export function ExplorerSearchScenario() {
  const fixture = useMemo(explorerFixture, []);
  const [visibleCount, setVisibleCount] = useState(0);
  const [searchLabels, setSearchLabels] = useState<string[]>([]);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  useScenarioRunner(scrollElement !== null, async () => {
    await measurePackagedAction("explorer-first-expand", () => {
      setVisibleCount(2_500);
    });
    await measurePackagedAction("explorer-secondary-expand", () => {
      setVisibleCount(5_000);
    });
    await samples("search-everywhere", 10, (index) => {
      const result = searchActionItems(fixture.index, `object-${4_990 + index}`);
      setSearchLabels(result.map((item) => item.label));
    });
    await finishBenchmark();
  });

  return (
    <BenchmarkSurface title="Explorer · 20 connections · 50 databases · 5,000 objects">
      <div className="tw:flex tw:min-h-0 tw:flex-1">
        <div
          ref={setScrollElement}
          className="tw:min-h-0 tw:w-1/2 tw:overflow-auto tw:border-r tw:border-border-subtle tw:p-2"
        >
          <VirtualTreeRows
            rows={fixture.rows.slice(0, visibleCount)}
            scrollElement={scrollElement}
          />
        </div>
        <ol className="tw:m-0 tw:min-h-0 tw:w-1/2 tw:overflow-auto tw:p-3 tw:text-sm">
          {searchLabels.map((label) => <li key={label}>{label}</li>)}
        </ol>
      </div>
    </BenchmarkSurface>
  );
}

function explorerFixture() {
  const items: ActionSearchItem[] = [];
  const rows: VirtualTreeRow[] = [];
  for (let index = 0; index < 5_000; index += 1) {
    const connection = index % 20;
    const database = index % 50;
    const label = `object-${index}`;
    items.push({
      id: `object:${index}`,
      kind: "databaseObject",
      label,
      detail: `connection-${connection} / database-${database}`,
      keywords: [`schema-${index % 25}`, `table-${index}`],
      run: () => undefined,
    });
    rows.push({
      key: `row-${index}`,
      render: () => (
        <div className="ds-object-row tw:pl-3 tw:text-ui" role="treeitem">
          {label}
        </div>
      ),
    });
  }
  return { rows, index: indexActionSearchItems(items) };
}

export function QueryResultScenario() {
  const largeResult = useMemo(() => queryResult(50_000), []);
  const [result, setResult] = useState<QueryResult>(() => queryResult(0));
  const [backendStatus, setBackendStatus] = useState(0);

  useScenarioRunner(true, async () => {
    await samples("query-first-batch", ACTION_SAMPLES, async () => {
      const receipt = await runPackagedBenchmarkBackend("query-first-batch");
      setResult(receiptResult(receipt));
      return backendEvidence(receipt);
    });

    setResult(largeResult);
    await waitForPackagedPaint();
    await samples("query-grid-scroll-50k", 10, async (index) => {
      const scroller = document.querySelector<HTMLElement>("[data-data-grid-scroll]");
      if (!scroller) throw new Error("grid scroller unavailable");
      if (scroller.scrollWidth <= scroller.clientWidth) {
        throw new Error("dense grid horizontal scroll unavailable");
      }
      const left = (index % 4) * 180;
      scroller.scrollTo({
        top: index % 2 === 0 ? scroller.scrollHeight : 0,
        left,
      });
      await waitForPackagedPaint();
      if (left > 0 && scroller.scrollLeft === 0) {
        throw new Error("dense grid horizontal scroll did not advance");
      }
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await measurePackagedAction("query-page-store-1m", async () => {
      const receipt = await runPackagedBenchmarkBackend("query-page-store-1m");
      setBackendStatus((status) => status + receipt.rowCount);
      return backendEvidence(receipt);
    });
    await runPackagedBenchmarkBackend("query-start-cancellable-export");
    for (const action of ["query-cancel", "query-export"] as const) {
      await measurePackagedAction(action, async () => {
        const receipt = await runPackagedBenchmarkBackend(action);
        setBackendStatus((status) => status + receipt.rowCount);
        return backendEvidence(receipt);
      });
    }
    await finishBenchmark();
  });

  return (
    <BenchmarkSurface title={`Query result · 50,000 rows × ${DENSE_GRID_COLUMN_COUNT} columns · backend ${backendStatus}`}>
      <DataGrid result={result} surface="workbench" />
    </BenchmarkSurface>
  );
}

function receiptResult(receipt: PackagedBackendReceipt): QueryResult {
  return {
    columns: receipt.columns,
    rows: receipt.rows,
    rowCount: receipt.rows.length,
    truncated: receipt.rowCount > receipt.rows.length,
    durationMs: receipt.backendRequestToFirstRowMs ?? 0,
  };
}

export function LongLivedDataScenario() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useScenarioRunner(true, async () => {
    for (const action of [
      "history-10k",
      "audit-100k",
      "local-history-50",
      "analysis-article-local-results",
    ] as const satisfies readonly PackagedBackendAction[]) {
      await samples(action, ACTION_SAMPLES, async () => {
        const receipt = await runPackagedBenchmarkBackend(action);
        setCounts((current) => ({ ...current, [action]: receipt.rowCount }));
        return backendEvidence(receipt);
      });
    }
    await finishBenchmark();
  });
  return (
    <BenchmarkSurface title="Long-lived data · bounded production pages">
      <pre className="tw:m-0 tw:min-h-0 tw:flex-1 tw:overflow-auto tw:p-4 tw:text-xs">
        {JSON.stringify(counts, null, 2)}
      </pre>
    </BenchmarkSurface>
  );
}
