// The single schema comparison group row of the connection editor, shared by local and
// team connections. Spaces inside a name are kept while typing and only surrounding
// blanks are dropped when editing ends; existing same-engine groups are suggested.
import { useId } from "react";

import { PropertyRow, TextInput } from "../../design-system/components/FormControls";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionSchemaGroupField({
  profile,
}: {
  profile: ConnectionEditorController["profile"];
}) {
  const { t } = useI18n();
  const listId = `${useId().replace(/:/g, "")}-schema-groups`;
  const { form, set, flags, schemaGroupNames } = profile;
  const bound = profile.environmentContext.bound;
  const hintId = `${listId}-hint`;
  return (
    <PropertyRow label={t("connections.schemaGroup")} htmlFor="connection-schema-group">
      <div className="tw:grid tw:gap-1.5">
        <TextInput
          id="connection-schema-group"
          density="compact"
          value={form.schemaGroup ?? ""}
          disabled={!flags.canEditConnection}
          list={schemaGroupNames.length > 0 ? listId : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          onChange={(event) => set("schemaGroup", event.target.value || null)}
          onBlur={(event) => set("schemaGroup", event.target.value.trim() || null)}
          placeholder={t("connections.schemaGroupPlaceholder")}
        />
        {schemaGroupNames.length > 0 ? (
          <datalist id={listId}>
            {schemaGroupNames.map((name) => <option key={name} value={name} />)}
          </datalist>
        ) : null}
        <p id={hintId} className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t(bound ? "connections.schemaGroupProjectHint" : "connections.schemaGroupHint")}
        </p>
      </div>
    </PropertyRow>
  );
}
