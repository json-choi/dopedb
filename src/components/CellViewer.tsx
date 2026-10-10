// Side panel showing one cell's full value: pretty-printed JSON when the value is (or
// reads as) an object/array — re-indented without reparsing numbers, so no digit is
// lost — and wrapped plain text otherwise. Copy lifts the value to the clipboard with
// the grid's convention (NULL is empty); optional exports preserve the raw value
// through the caller's save path. A cell the backend shortened to fit its result
// page shows its preview with notice.
import { useEffect } from "react";
import { Button } from "../design-system/components/Button";
import { InlineNotice } from "../design-system/components/Status";
import { useI18n } from "../lib/i18n";
import { InspectorHeader } from "../design-system/components/Workbench";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import {
  cellClipboardText,
  formatByteSize,
  prettyJsonText,
} from "../lib/export";

function render(value: unknown): { text: string; json: boolean } {
  if (value === null || value === undefined) return { text: "NULL", json: false };
  if (typeof value === "object") return { text: JSON.stringify(value, null, 2), json: true };
  const text = String(value);
  const pretty = typeof value === "string" ? prettyJsonText(text) : null;
  return pretty === null ? { text, json: false } : { text: pretty, json: true };
}

export default function CellViewer({
  value,
  column,
  onClose,
  onExport,
  closeOnEscape = true,
  truncatedBytes,
}: {
  value: unknown;
  column: string;
  onClose: () => void;
  /** Present only when the caller has validated the selected result cell. */
  onExport?: (format: "csv" | "json") => void;
  closeOnEscape?: boolean;
  /** Original size of a value shortened to fit its result page; copy is refused. */
  truncatedBytes?: number | null;
}) {
  const { text, json } = render(value);
  const truncated = truncatedBytes !== null && truncatedBytes !== undefined;
  const { t } = useI18n();
  const toast = useToast();
  // Close on Escape — DataGrid uses Escape to clear cell selection, so leaving the panel
  // stuck open while the selection clears is jarring.
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);
  return (
    <div>
      <InspectorHeader
        title={column}
        actions={
          <>
            <Button
              size="compact"
              disabled={truncated}
              title={truncated ? t("results.truncatedCopyBlocked") : undefined}
              onClick={() =>
                navigator.clipboard
                  .writeText(cellClipboardText(value))
                  .then(() => toast(t("common.copied")))
                  .catch(() => toast(t("results.copyFailed"), "error"))
              }
            >
              <Icon name="copy" /> {t("common.copy")}
            </Button>
            {onExport && !truncated ? (
              <>
                <Button
                  size="compact"
                  title={t("results.exportCsv", { scope: t("results.selectedCell") })}
                  aria-label={t("results.exportCsv", { scope: t("results.selectedCell") })}
                  onClick={() => onExport("csv")}
                >
                  CSV
                </Button>
                <Button
                  size="compact"
                  title={t("results.exportJson", { scope: t("results.selectedCell") })}
                  aria-label={t("results.exportJson", { scope: t("results.selectedCell") })}
                  onClick={() => onExport("json")}
                >
                  JSON
                </Button>
              </>
            ) : null}
            <Button
              iconOnly
              size="compact"
              variant="ghost"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <Icon name="close" />
            </Button>
          </>
        }
      />
      {truncated ? (
        <InlineNotice tone="warning" icon="info" role="status">
          {t("results.truncatedCellNotice", {
            size: formatByteSize(truncatedBytes ?? 0),
          })}
        </InlineNotice>
      ) : null}
      <pre
        data-json={json}
        className="tw:m-0 tw:max-h-[60vh] tw:overflow-auto tw:text-sm tw:whitespace-pre-wrap tw:break-words tw:data-[json=true]:font-mono"
      >
        {text}
      </pre>
    </div>
  );
}
