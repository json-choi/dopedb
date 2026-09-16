// Hosts cell inspection and staged row editing in a resizable, persisted table side panel.

import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import CellViewer from "../../components/CellViewer";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import RowEditor, {
  type RowEditorSubmission,
} from "../../components/RowEditor";
import {
  InspectorFooter,
  InspectorHeader,
} from "../../design-system/components/Workbench";
import type { CatalogTable, ScriptOperationProposal } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { Engine } from "../../ipc/types";
import type {
  PendingDelete,
  RowEditorState,
  SelectedCell,
  StagedWrite,
} from "../../features/tableData/domain";
import { createFrameCoalescer } from "../../lib/frameCoalescer";

const STORAGE_KEY = "dopedb:table-side-panel-width:v1";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 320;
const MAX_WIDTH = 480;
const KEYBOARD_STEP = 16;

function clampWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

function readWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
      ? stored
      : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function storeWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // A blocked or corrupt preference must not disable the table inspector.
  }
}

type Props = {
  engine: Engine;
  table: CatalogTable;
  selected: number | null;
  editor: RowEditorState | null;
  pendingDelete: PendingDelete | null;
  reviewing: boolean;
  staged: StagedWrite[];
  proposal: ScriptOperationProposal | null;
  running: boolean;
  catalogPending: boolean;
  selectedCell: SelectedCell | null;
  onSubmit: (write: RowEditorSubmission) => void;
  onCloseEditor: () => void;
  onCloseDelete: () => void;
  onArmDelete: () => void;
  onCloseReview: () => void;
  onRemoveStaged: (id: string) => void;
  onPrepare: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCloseCell: () => void;
};

export default function TableSidePanel(props: Props) {
  const { t } = useI18n();
  const [width, setWidth] = useState(readWidth);
  const {
    engine,
    table,
    selected,
    editor,
    pendingDelete,
    reviewing,
    staged,
    proposal,
    running,
    catalogPending,
    selectedCell,
  } = props;

  function commitWidth(nextWidth: number) {
    const clamped = clampWidth(nextWidth);
    setWidth(clamped);
    storeWidth(clamped);
  }

  function beginResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.focus();
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const widthAt = (clientX: number) =>
      clampWidth(startWidth + startX - clientX);
    const coalescer = createFrameCoalescer<number>(setWidth);
    const move = (next: MouseEvent) => {
      coalescer.push(widthAt(next.clientX));
    };
    const up = (next: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const nextWidth = widthAt(next.clientX);
      coalescer.push(nextWidth);
      coalescer.flush();
      storeWidth(nextWidth);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function resizeFromKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = width + KEYBOARD_STEP;
    if (event.key === "ArrowRight") nextWidth = width - KEYBOARD_STEP;
    if (event.key === "Home") nextWidth = MIN_WIDTH;
    if (event.key === "End") nextWidth = MAX_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    commitWidth(nextWidth);
  }

  const inspectorStyle = {
    "--table-side-panel-width": `${width}px`,
  } as CSSProperties;

  return (
    <aside
      style={inspectorStyle}
      className="tw:relative tw:w-[var(--table-side-panel-width)] tw:shrink-0 tw:overflow-auto tw:overscroll-contain tw:border-l tw:border-border-subtle tw:bg-card tw:p-3 tw:@max-[920px]:max-h-[42%] tw:@max-[920px]:w-auto tw:@max-[760px]:max-h-[44%]"
    >
      <div
        className="tw:absolute tw:inset-y-0 tw:-left-[3px] tw:z-[var(--ds-z-raised)] tw:w-[7px] tw:cursor-col-resize tw:hover:bg-ring/30 tw:focus-visible:bg-ring/30 tw:focus-visible:outline-none tw:active:bg-ring/30 tw:@max-[920px]:hidden"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("app.dragResize")}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={resizeFromKeyboard}
        onMouseDown={beginResize}
        onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
      />
      {editor && !reviewing && (
        <RowEditor
          key={`${editor.mode}-${selected}`}
          engine={engine}
          table={table}
          mode={editor.mode}
          initial={editor.initial}
          onSubmit={props.onSubmit}
          onCancel={props.onCloseEditor}
        />
      )}
      {pendingDelete && (
        <div>
          <InspectorHeader
            title={t("tables.deleteRow")}
            actions={
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                aria-label={t("common.cancel")}
                onClick={props.onCloseDelete}
              >
                <Icon name="close" />
              </Button>
            }
          />
          <div className="tw:mb-3 tw:flex tw:flex-col tw:gap-2">
            {Object.entries(pendingDelete.key).map(([key, value]) => (
              <div key={key}>
                <label className="tw:mb-px tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:overflow-hidden tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
                  {key}
                  <span className="tw:rounded-xs tw:border tw:border-primary tw:px-0.5 tw:text-2xs tw:font-bold tw:text-primary">
                    PK
                  </span>
                </label>
                <code>{value == null ? "NULL" : value}</code>
              </div>
            ))}
          </div>
          <InspectorFooter>
            <Button variant="primary" onClick={props.onArmDelete}>
              {t("tables.reviewDelete")}
            </Button>
            <Button onClick={props.onCloseDelete}>{t("common.cancel")}</Button>
          </InspectorFooter>
        </div>
      )}
      {reviewing && (
        <div>
          <InspectorHeader
            title={t("tables.stagedCount", { count: staged.length })}
            metadata={
              <span className="tw:text-muted-foreground">
                {t("tables.stagedAtomicHelp")}
              </span>
            }
            actions={
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                aria-label={t("common.close")}
                onClick={props.onCloseReview}
              >
                <Icon name="close" />
              </Button>
            }
          />
          <ol className="tw:m-0 tw:grid tw:list-none tw:gap-0 tw:p-0 tw:[&_li]:flex tw:[&_li]:items-start tw:[&_li]:justify-between tw:[&_li]:gap-2 tw:[&_li]:border-t tw:[&_li]:border-border-subtle tw:[&_li]:py-2 tw:[&_li>div]:min-w-0 tw:[&_strong]:block tw:[&_code]:mt-1 tw:[&_code]:block tw:[&_code]:[overflow-wrap:anywhere] tw:[&_code]:text-xs tw:[&_code]:text-muted-foreground">
            {staged.map((change, index) => (
              <li key={change.id}>
                <div>
                  <strong>
                    {change.rationale ||
                      t("tables.stagedChange", { index: index + 1 })}
                  </strong>
                  <code>{change.sql}</code>
                </div>
                {!proposal && (
                  <Button
                    iconOnly
                    size="xs"
                    variant="ghost"
                    onClick={() => props.onRemoveStaged(change.id)}
                    aria-label={t("common.delete")}
                  >
                    <Icon name="close" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <InspectorFooter>
            {!proposal ? (
              <Button
                variant="primary"
                disabled={staged.length === 0 || running || catalogPending}
                onClick={props.onPrepare}
              >
                {running ? t("common.loading") : t("tables.reviewAndApply")}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={running}
                  onClick={props.onApprove}
                >
                  {running
                    ? t("common.saving")
                    : t("approval.approveAndRunWrite")}
                </Button>
                <Button disabled={running} onClick={props.onReject}>
                  {t("approval.reject")}
                </Button>
              </>
            )}
          </InspectorFooter>
        </div>
      )}
      {selectedCell && !editor && !reviewing && (
        <CellViewer
          value={selectedCell.value}
          column={selectedCell.column}
          onClose={props.onCloseCell}
        />
      )}
    </aside>
  );
}
