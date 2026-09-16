// Side panel showing one cell's full value: pretty-printed JSON when the value is (or
// parses to) an object/array, wrapped plain text otherwise. Copy button lifts the
// displayed text to the clipboard; optional exports preserve the validated raw value.
import { useEffect } from "react";
import { Button } from "../design-system/components/Button";
import { useI18n } from "../lib/i18n";
import { InspectorHeader } from "../design-system/components/Workbench";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { downloadCsv, downloadJson } from "../lib/export";

function render(value: unknown): { text: string; json: boolean } {
  if (value === null || value === undefined) return { text: "NULL", json: false };
  if (typeof value === "object") return { text: JSON.stringify(value, null, 2), json: true };
  const s = String(value);
  if (typeof value === "string") {
    try {
      const p = JSON.parse(s);
      if (p && typeof p === "object") return { text: JSON.stringify(p, null, 2), json: true };
    } catch {
      /* not JSON — fall through to plain text */
    }
  }
  return { text: s, json: false };
}

export default function CellViewer({
  value,
  column,
  onClose,
  exportFilename,
  closeOnEscape = true,
}: {
  value: unknown;
  column: string;
  onClose: () => void;
  /** Present only when the caller has validated the selected result cell. */
  exportFilename?: string;
  closeOnEscape?: boolean;
}) {
  const { text, json } = render(value);
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
              onClick={() =>
                navigator.clipboard
                  .writeText(text)
                  .then(() => toast(t("common.copied")))
                  .catch(() => toast(t("results.copyFailed"), "error"))
              }
            >
              <Icon name="copy" /> {t("common.copy")}
            </Button>
            {exportFilename ? (
              <>
                <Button
                  size="compact"
                  title={t("results.exportCsv", { scope: t("results.selectedCell") })}
                  aria-label={t("results.exportCsv", { scope: t("results.selectedCell") })}
                  onClick={() => downloadCsv(exportFilename, [column], [[value]])}
                >
                  CSV
                </Button>
                <Button
                  size="compact"
                  title={t("results.exportJson", { scope: t("results.selectedCell") })}
                  aria-label={t("results.exportJson", { scope: t("results.selectedCell") })}
                  onClick={() => downloadJson(exportFilename, [column], [[value]])}
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
      <pre
        data-json={json}
        className="tw:m-0 tw:max-h-[60vh] tw:overflow-auto tw:text-sm tw:whitespace-pre-wrap tw:break-words tw:data-[json=true]:font-mono"
      >
        {text}
      </pre>
    </div>
  );
}
