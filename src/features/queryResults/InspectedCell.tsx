// The one wiring of a selected result cell to the cell viewer: copy plus a validated
// single-cell CSV/JSON export through the native save dialog. Inline result grids and the
// table-data side panel both render this, so the cell's export path has one owner.
import CellViewer from "../../components/CellViewer";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import { saveRendererExport } from "./resultExports";

export default function InspectedCell({
  value,
  column,
  truncatedBytes,
  closeOnEscape,
  onClose,
}: {
  value: unknown;
  column: string;
  /** Original size of a value shortened to fit its result page; copy and export are refused. */
  truncatedBytes?: number | null;
  closeOnEscape?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <CellViewer
      value={value}
      column={column}
      onExport={(format) =>
        void saveRendererExport(
          format,
          "selected-cell",
          [column],
          [[value]],
          t,
          toast,
        )
      }
      closeOnEscape={closeOnEscape}
      truncatedBytes={truncatedBytes}
      onClose={onClose}
    />
  );
}
