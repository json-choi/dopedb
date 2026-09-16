// The one panel that shows a result cell's full value: pretty-printed JSON when the
// value is (or parses to) an object/array, wrapped plain text otherwise. SQL,
// Tables, and Documents all render this rather than keeping a per-screen viewer.
// `presentation` only chooses the frame: "panel" brings its own inspector aside,
// "inline" renders inside a screen's existing inspector.
import { useEffect } from "react";

import { Button } from "../../design-system/components/Button";
import { InspectorHeader } from "../../design-system/components/Workbench";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import type { InspectedResultCell } from "./useResultCellInspector";

function render(value: unknown): { text: string; json: boolean } {
  if (value === null || value === undefined)
    return { text: "NULL", json: false };
  if (typeof value === "object")
    return { text: JSON.stringify(value, null, 2), json: true };
  const text = String(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object")
        return { text: JSON.stringify(parsed, null, 2), json: true };
    } catch {
      /* not JSON — fall through to plain text */
    }
  }
  return { text, json: false };
}

export default function ResultCellInspector({
  cell,
  onClose,
  presentation = "panel",
}: {
  cell: InspectedResultCell | null;
  onClose: () => void;
  presentation?: "panel" | "inline";
}) {
  const { t } = useI18n();
  const toast = useToast();
  // Escape closes from anywhere in the result surface; the grid clears its own
  // selection on the same key, so leaving the panel open would be jarring.
  useEffect(() => {
    if (!cell) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cell, onClose]);

  if (!cell) return null;
  const { text, json } = render(cell.value);
  const body = (
    <div>
      <InspectorHeader
        title={t("results.inspectorTitle", {
          column: cell.column,
          row: cell.rowNumber,
        })}
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
            <Button
              iconOnly
              size="xs"
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
  if (presentation === "inline") return body;
  return (
    <aside
      aria-label={t("results.inspectorLabel")}
      className="tw:w-[min(360px,40%)] tw:shrink-0 tw:overflow-auto tw:overscroll-contain tw:border-l tw:border-border-subtle tw:bg-card tw:p-3 tw:@max-[920px]:max-h-[42%] tw:@max-[920px]:w-auto"
    >
      {body}
    </aside>
  );
}
