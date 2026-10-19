// Administrator credential typed for one revocation: one username/password block per
// database whose credential this device lacks, an optional SSH host alias and the
// choice to keep it in this device's keychain. The values leave only through
// `onSubmit`; nothing is stored here beyond the draft in component state.
import { useState } from "react";
import { Button } from "../../../design-system/components/Button";
import { CheckboxField, Field, TextInput } from "../../../design-system/components/FormControls";
import { LoadingLabel } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { DirectInlineCredential } from "../../directAccess/domain";

interface Draft {
  username: string;
  password: string;
  sshAlias: string;
  saveToKeychain: boolean;
}

const EMPTY: Draft = { username: "", password: "", sshAlias: "", saveToKeychain: true };

export default function DirectAdminCredentialForm({
  databases,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  databases: ReadonlyArray<{ id: string; name: string }>;
  busy: boolean;
  error: string | null;
  onSubmit: (credentials: DirectInlineCredential[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftOf = (id: string) => drafts[id] ?? EMPTY;
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY), ...patch } }));
  const complete = databases.every((database) => {
    const draft = draftOf(database.id);
    return draft.username.trim() !== "" && draft.password !== "";
  });

  return (
    <form
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border tw:border-border-subtle tw:p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !complete) return;
        onSubmit(databases.map((database) => {
          const draft = draftOf(database.id);
          return {
            connectionId: database.id,
            username: draft.username.trim(),
            password: draft.password,
            sshAlias: draft.sshAlias.trim() === "" ? null : draft.sshAlias.trim(),
            saveToKeychain: draft.saveToKeychain,
          } as DirectInlineCredential;
        }));
      }}
    >
      {databases.map((database) => {
        const draft = draftOf(database.id);
        return (
          <fieldset key={database.id} className="tw:m-0 tw:grid tw:min-w-0 tw:gap-2 tw:border-0 tw:p-0">
            <legend className="tw:mb-1 tw:p-0 tw:text-ui tw:font-medium">
              {t("directAccess.lowering.credentialTitle", { database: database.name })}
            </legend>
            <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
              <Field label={t("directAccess.add.adminUser")}>
                {(binding) => (
                  <TextInput
                    {...binding.controlProps()}
                    density="compact"
                    value={draft.username}
                    maxLength={1024}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => update(database.id, { username: event.target.value })}
                  />
                )}
              </Field>
              <Field label={t("directAccess.add.adminPassword")}>
                {(binding) => (
                  <TextInput
                    {...binding.controlProps()}
                    density="compact"
                    type="password"
                    value={draft.password}
                    maxLength={1024}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => update(database.id, { password: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label={t("directAccess.add.sshAlias")} hint={t("directAccess.add.sshAliasHint")}>
              {(binding) => (
                <TextInput
                  {...binding.controlProps()}
                  density="compact"
                  value={draft.sshAlias}
                  maxLength={255}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => update(database.id, { sshAlias: event.target.value })}
                />
              )}
            </Field>
            <CheckboxField
              label={t("directAccess.lowering.saveToKeychain")}
              checked={draft.saveToKeychain}
              disabled={busy}
              onChange={(event) => update(database.id, { saveToKeychain: event.target.checked })}
            />
          </fieldset>
        );
      })}
      {error ? (
        <p role="alert" className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger">
          {error}
        </p>
      ) : null}
      <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        {busy ? <LoadingLabel>{t("directAccess.lowering.revoking")}</LoadingLabel> : null}
        <Button size="compact" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="compact" variant="primary" type="submit" disabled={busy || !complete}>
          {t("directAccess.lowering.revokeNow")}
        </Button>
      </div>
    </form>
  );
}
