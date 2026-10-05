// Owns only the active input draft; committed cell edits are owned by the table reducer.
import { useRef, useState } from "react";
import { TextInput } from "../../design-system/components/FormControls";
import { useI18n } from "../../lib/i18n";

export default function EditableTableCell({ value, column, editable, nullable, changed, onDraftActive, onCommit }: {
  value: string | null;
  column: string;
  editable: boolean;
  nullable: boolean;
  changed: boolean;
  onDraftActive: (active: boolean) => void;
  onCommit: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const [inputOpen, setInputOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const settled = useRef(false);
  const dirty = useRef(false);
  function commit(next: string | null) {
    if (settled.current) return;
    settled.current = true;
    setInputOpen(false);
    onDraftActive(false);
    if (editable && next !== value) onCommit(next);
  }
  if (inputOpen && editable) {
    return <TextInput
      density="compact"
      autoFocus
      aria-label={t("tables.editCell", { column })}
      title={t("tables.editCellHelp")}
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => { dirty.current = true; setDraft(event.target.value); }}
      onBlur={() => commit(dirty.current ? draft : value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          settled.current = true;
          setInputOpen(false);
          onDraftActive(false);
        } else if (event.key === "Enter") {
          event.preventDefault();
          commit(dirty.current ? draft : value);
        } else if (nullable && (event.ctrlKey || event.metaKey) && event.key === "Backspace") {
          event.preventDefault();
          commit(null);
        }
      }}
    />;
  }
  return <span
    className="tw:block tw:min-h-4 tw:overflow-hidden tw:text-ellipsis tw:data-[changed=true]:font-semibold tw:data-[changed=true]:text-primary tw:data-[changed=true]:underline tw:data-[null=true]:italic tw:data-[null=true]:text-muted-foreground"
    data-changed={changed}
    data-null={value === null}
    title={editable ? t("tables.editCellHelp") : undefined}
    onDoubleClick={() => {
      if (!editable) return;
      dirty.current = false;
      settled.current = false;
      setDraft(value ?? "");
      setInputOpen(true);
      onDraftActive(true);
    }}

  >{value ?? "NULL"}</span>;
}
