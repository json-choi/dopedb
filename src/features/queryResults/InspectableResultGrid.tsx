// Opt-in result inspection shared by SQL and Mongo surfaces. Grid callbacks already
// reject cells that failed to decode; changing the result or page invalidates its value.
// A selected cell exports through the native save dialog with a completion toast.
import { useRef, useState, type ComponentProps } from "react";
import CellViewer from "../../components/CellViewer";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import DataGrid from "./DataGrid";
import { saveRendererExport } from "./resultExports";

type Props = ComponentProps<typeof DataGrid> & {
  inspectionKey?: unknown;
  inspectionDisabled?: boolean;
};

export default function InspectableResultGrid(props: Props) {
  const { inspectionKey, inspectionDisabled, onCellClick, ...gridProps } = props;
  const { t } = useI18n();
  const toast = useToast();
  const identity = inspectionKey ?? props.rowSource ?? props.result;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{
    identity: unknown;
    value: unknown;
    column: string;
    truncatedBytes: number | null;
  } | null>(null);
  const current = !inspectionDisabled && selected?.identity === identity ? selected : null;
  const close = () => {
    setSelected(null);
    surfaceRef.current?.querySelector<HTMLElement>('[data-grid-focus][tabindex="0"]')?.focus();
  };
  return (
    <div
      ref={surfaceRef}
      className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape" && current && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <DataGrid
        {...gridProps}
        onCellClick={(value, row, column, detail) => {
          if (inspectionDisabled) return;
          setSelected({
            identity,
            value,
            column,
            truncatedBytes: detail?.truncatedBytes ?? null,
          });
          onCellClick?.(value, row, column, detail);
        }}
      />
      {current ? (
        <aside className="tw:max-h-[40%] tw:min-h-0 tw:shrink-0 tw:overflow-auto tw:border-t tw:border-border-subtle tw:p-3">
          <CellViewer
            value={current.value}
            column={current.column}
            onExport={(format) =>
              void saveRendererExport(
                format,
                "selected-cell",
                [current.column],
                [[current.value]],
                t,
                toast,
              )
            }
            closeOnEscape={false}
            truncatedBytes={current.truncatedBytes}
            onClose={close}
          />
        </aside>
      ) : null}
    </div>
  );
}
