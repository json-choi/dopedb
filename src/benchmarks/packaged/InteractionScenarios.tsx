// Packaged ERD, grid, pane-resize, and idle-runtime scenarios. Pointer helpers are
// kept with the surfaces whose continuity and focus contracts they measure.
import { useMemo, useState } from "react";

import {
  WorkbenchButton,
  WorkbenchScrollBody,
} from "../../design-system/components/Workbench";
import ErdCanvas from "../../features/erd/ErdCanvas";
import DataGrid from "../../features/queryResults/DataGrid";
import { useSidebarWidth } from "../../features/appShell/useSidebarWidth";
import type { CatalogSnapshot } from "../../ipc/types";
import { measurePackagedIdle, waitForPackagedPaint } from "../packagedMetrics";
import {
  ACTION_SAMPLES,
  BenchmarkSurface,
  FIXTURE_CONNECTION_ID,
  finishBenchmark,
  queryResult,
  samples,
  useScenarioRunner,
} from "./benchmarkHarness";

export function InteractionSurfacesScenario() {
  const snapshot = useMemo(erdSnapshot, []);
  const result = useMemo(() => queryResult(50_000), []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [surface, setSurface] = useState<"erd" | "workbench">("erd");
  const layout = useSidebarWidth("databaseExplorer");

  useScenarioRunner(true, async () => {
    await waitForSelector("[data-erd-neighborhood-toggle]");
    const toggle = document.querySelector<HTMLButtonElement>("[data-erd-neighborhood-toggle]");
    if (toggle?.getAttribute("aria-pressed") === "true") toggle.click();
    await waitForPackagedPaint();
    await waitForSelector(".react-flow__node");
    await samples("erd-drag-1k", ACTION_SAMPLES, (index) => {
      const node = document.querySelector<HTMLElement>(".react-flow__node");
      if (!node) throw new Error("ERD node unavailable");
      pointerDrag(node, 100 + index * 3, 120 + index * 3, 180 + index * 3, 190 + index * 3);
    });

    setSurface("workbench");
    await waitForPackagedPaint();
    await waitForSelector("[data-grid-resize-handle]");
    await samples("grid-and-pane-resize", 10, (index) => {
      const handle = document.querySelector<HTMLElement>("[data-grid-resize-handle]");
      if (!handle) throw new Error("grid resize handle unavailable");
      mouseDrag(handle, 200, 200 + (index % 5) * 24, 300, 300);
      layout.startDrag({ preventDefault: () => undefined, clientX: 300 });
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 320 + index }));
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: 340 + index }));
    });
    await samples("workbench-scroll-continuity", ACTION_SAMPLES, async (index) => {
      const documentScroller = document.querySelector<HTMLElement>(
        '[data-workbench-scroll-owner="document"]',
      );
      const gridScroller = document.querySelector<HTMLElement>("[data-data-grid-scroll]");
      const lastAction = document.querySelector<HTMLButtonElement>("[data-benchmark-last-action]");
      if (!documentScroller || !gridScroller || !lastAction) {
        throw new Error("workbench scroll surface unavailable");
      }

      documentScroller.scrollTop = documentScroller.scrollHeight;
      documentScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      gridScroller.scrollTop = gridScroller.scrollHeight;
      gridScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      lastAction.focus();

      layout.startDrag({ preventDefault: () => undefined, clientX: 300 });
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 320 + index * 8 }));
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: 320 + index * 8 }));
      await waitForPackagedPaint();

      const documentBottom = documentScroller.scrollHeight
        - documentScroller.clientHeight
        - documentScroller.scrollTop;
      if (documentBottom > 2 || gridScroller.scrollTop <= 0) {
        throw new Error("workbench scroll position was not preserved");
      }
      if (document.activeElement !== lastAction) {
        throw new Error("workbench focus was not preserved");
      }
    });
    await finishBenchmark();
  });

  return (
    <BenchmarkSurface title="Interactions · 1,000-node ERD · grid and sidebar resize">
      <div className="tw:flex tw:min-h-0 tw:flex-1">
        {surface === "erd" ? (
          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
            <ErdCanvas
              snapshot={snapshot}
              filter=""
              selectedKey={selectedKey}
              onSelect={(relation) => setSelectedKey(JSON.stringify(relation.object))}
              onOpen={() => undefined}
            />
          </div>
        ) : (
          <>
            <div style={{ width: layout.width }} className="tw:flex tw:min-h-0 tw:shrink-0 tw:flex-col tw:border-r tw:border-border-subtle">
              <DataGrid result={result} surface="workbench" />
            </div>
            <WorkbenchScrollBody aria-label="Scrollable workbench document">
              <div className="tw:flex tw:shrink-0 tw:flex-col tw:gap-2 tw:p-3">
                {Array.from({ length: 80 }, (_, index) => (
                  <p className="tw:m-0 tw:text-sm" key={index}>
                    Workbench document row {index + 1}
                  </p>
                ))}
                <WorkbenchButton data-benchmark-last-action>
                  Last document action
                </WorkbenchButton>
              </div>
            </WorkbenchScrollBody>
          </>
        )}
      </div>
    </BenchmarkSurface>
  );
}

function erdSnapshot(): CatalogSnapshot {
  return {
    schemaVersion: 2,
    connectionId: FIXTURE_CONNECTION_ID,
    engine: "sqlite",
    database: "benchmark",
    capturedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: "e".repeat(64),
    namespaces: [{ name: "main", comment: null }],
    relations: Array.from({ length: 1_000 }, (_, index) => ({
      object: {
        catalog: "benchmark",
        namespace: "main",
        name: `relation_${index}`,
        kind: "table" as const,
        nativeId: String(index),
      },
      comment: null,
      rowEstimate: 1_000,
      partitionParent: null,
      partitionChildren: [],
      columns: [{
        name: "id",
        ordinal: 1,
        nativeType: "INTEGER",
        typeFamily: "integer" as const,
        length: null,
        precision: null,
        scale: null,
        nullable: false,
        defaultExpression: null,
        generatedExpression: null,
        identity: true,
        autoIncrement: true,
        collation: null,
        comment: null,
        sensitivity: null,
      }],
      constraints: [],
      indexes: [],
    })),
    routines: [],
    otherObjects: [],
  };
}

function pointerDrag(
  target: HTMLElement,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const options = { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1 };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: startX, clientY: startY }));
  document.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: endX, clientY: endY }));
  document.dispatchEvent(new PointerEvent("pointerup", {
    ...options,
    buttons: 0,
    clientX: endX,
    clientY: endY,
  }));
}

function mouseDrag(
  target: HTMLElement,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
) {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: startX, clientY: startY }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: endX, clientY: endY }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: endX, clientY: endY }));
}

async function waitForSelector(selector: string) {
  for (let frame = 0; frame < 120; frame += 1) {
    if (document.querySelector(selector)) return;
    await waitForPackagedPaint();
  }
  throw new Error("benchmark surface did not become ready");
}

export function IdleRuntimeScenario() {
  useScenarioRunner(true, async () => {
    await measurePackagedIdle(10_000);
    await finishBenchmark();
  });
  return <BenchmarkSurface title="Idle runtime · 10 second IPC observation" />;
}
