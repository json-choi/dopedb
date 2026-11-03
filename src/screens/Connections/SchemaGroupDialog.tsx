// Names a connection's explicit schema comparison group, or renames or dissolves a whole
// group, from Database Explorer without drag. Existing same-engine group names are
// offered as suggestions so a typo does not silently start a second group. Persistence
// and the pending state belong to `useSchemaGroupEditor`; this dialog only edits a name.
import { useId, useState, type FormEvent } from "react";

import { Button } from "../../design-system/components/Button";
import { Field, TextInput } from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { SchemaGroupEditTarget } from "../../features/catalogExplorer/useSchemaGroupEditor";
import { useI18n } from "../../lib/i18n";
import { schemaGroupNames } from "../../lib/schemaDiff";

export default function SchemaGroupDialog({
  target,
  connections,
  saving,
  onSave,
  onRemove,
  onClose,
}: {
  target: SchemaGroupEditTarget;
  connections: readonly ConnectionProfile[];
  saving: boolean;
  onSave: (name: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId().replace(/:/g, "");
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const listId = `${id}-groups`;
  const current = target.kind === "connection"
    ? target.connection.schemaGroup?.trim() ?? ""
    : target.group.label;
  const engine = target.kind === "connection"
    ? target.connection.engine
    : target.group.connections[0]?.engine;
  const [name, setName] = useState(current);
  const suggestions = engine
    ? schemaGroupNames(connections, engine).filter((label) => label !== current)
    : [];
  const unchanged = name.trim() === current;
  const connectionName = (connection: ConnectionProfile) =>
    connection.name || connection.database || t("app.unnamed");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saving && !unchanged) onSave(name);
  }

  return (
    <ModalBackdrop onMouseDown={() => { if (!saving) onClose(); }}>
      <ModalSurface
        size="alert"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={saving}
        onRequestClose={onClose}
        dismissible={!saving}
      >
        <form className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col" onSubmit={submit}>
          <ModalHeader
            title={target.kind === "connection"
              ? t("connections.schemaGroup")
              : t("connections.schemaGroupRenameTitle")}
            titleId={titleId}
          />
          <div className="tw:grid tw:min-h-0 tw:min-w-0 tw:content-start tw:gap-4 tw:overflow-y-auto tw:p-5 tw:max-[640px]:p-4">
            <p id={descriptionId} className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
              {target.kind === "connection"
                ? t("connections.schemaGroupDialogConnection", {
                    connection: connectionName(target.connection),
                  })
                : t("connections.schemaGroupDialogGroup", {
                    count: target.group.connections.length,
                  })}
            </p>
            <Field label={t("connections.schemaGroupName")}>
              {({ controlProps }) => (
                <TextInput
                  {...controlProps()}
                  data-modal-initial-focus
                  value={name}
                  list={suggestions.length > 0 ? listId : undefined}
                  readOnly={saving}
                  placeholder={t("connections.schemaGroupPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            {suggestions.length > 0 ? (
              <datalist id={listId}>
                {suggestions.map((label) => <option key={label} value={label} />)}
              </datalist>
            ) : null}
          </div>
          <ModalFooter>
            {current ? (
              <span className="tw:mr-auto">
                <Button type="button" variant="dangerGhost" disabled={saving} onClick={onRemove}>
                  {target.kind === "connection"
                    ? t("connections.schemaGroupLeave")
                    : t("connections.schemaGroupDissolve")}
                </Button>
              </span>
            ) : null}
            <Button type="button" disabled={saving} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || unchanged || !name.trim()}>
              {t("common.save")}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
