// Opt-in result inspection shared by SQL and Mongo surfaces. Grid callbacks already
// reject rows with decode failures; changing the result or page invalidates its value.
import { useRef, useState, type ComponentProps } from "react";
import CellViewer from "../../components/CellViewer";
import DataGrid from "./DataGrid";

type Props = ComponentProps<typeof DataGrid> & {
  inspectionKey?: unknown;
  inspectionDisabled?: boolean;
};

export default function InspectableResultGrid(props: Props) {
  const { inspectionKey, inspectionDisabled, onCellClick, ...gridProps } = props;
  const identity = inspectionKey ?? props.rowSource ?? props.result;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{
    identity: unknown;
    value: unknown;
    column: string;
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
        onCellClick={(value, row, column) => {
          if (inspectionDisabled) return;
          setSelected({ identity, value, column });
          onCellClick?.(value, row, column);
        }}
      />
      {current ? (
        <aside className="tw:max-h-[40%] tw:min-h-0 tw:shrink-0 tw:overflow-auto tw:border-t tw:border-border-subtle tw:p-3">
          <CellViewer
            value={current.value}
            column={current.column}
            exportFilename="selected-cell"
            closeOnEscape={false}
            onClose={close}
          />
        </aside>
      ) : null}
    </div>
  );
}
