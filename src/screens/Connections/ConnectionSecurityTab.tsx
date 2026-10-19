// Presents TLS and SSH alias properties from the profile model without owning
// file picking, option normalization, or validation state.
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import ConnectionFilePathField from "../../features/connections/ConnectionFilePathField";
import { CONNECTION_SSH_ALIAS_PARAMETER } from "../../features/connections/options";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionSecurityTab({
  profile,
}: {
  profile: ConnectionEditorController["profile"];
}) {
  const { t } = useI18n();
  const { form, set, flags, options, validation } = profile;

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[720px] tw:gap-5">
      <section className="tw:grid tw:gap-3">
        <h3>{t("connections.sslConfiguration")}</h3>
        {flags.isSqlite ? (
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            {t("connections.sqliteNoTls")}
          </p>
        ) : flags.isMongo ? (
          <>
            <CheckboxField
              id="connection-tls-control"
              label={t("connections.enableTls")}
              checked={flags.mongoTlsEnabled}
              onChange={(event) =>
                options.setMongoTls(event.target.checked)
              }
            />
            <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[620px]:grid-cols-1">
              <ConnectionFilePathField
                label={t("connections.caCertificate")}
                value={form.extraParams.tlsCAFile ?? ""}
                disabled={!flags.mongoTlsEnabled}
                placeholder="/path/to/ca.pem"
                onChange={(value) =>
                  options.setExtraParameter("tlsCAFile", value)
                }
                onBrowse={() =>
                  void options.pickExtraParameterFile("tlsCAFile")
                }
              />
              <ConnectionFilePathField
                label={t("connections.clientCertificateKey")}
                value={form.extraParams.tlsCertificateKeyFile ?? ""}
                disabled={!flags.mongoTlsEnabled}
                placeholder="/path/to/client.pem"
                onChange={(value) =>
                  options.setExtraParameter("tlsCertificateKeyFile", value)
                }
                onBrowse={() =>
                  void options.pickExtraParameterFile("tlsCertificateKeyFile")
                }
              />
            </div>
          </>
        ) : (
          <>
            <Field label={t("connections.sslMode")}>
              <SelectInput
                id="connection-tls-control"
                value={form.sslmode}
                onChange={(event) => set("sslmode", event.target.value)}
              >
                {flags.sqlSslModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="tw:grid tw:gap-3">
              {(
                [
                  [
                    "sslrootcert",
                    "connections.caCertificate",
                    "/path/to/ca.pem",
                  ],
                  [
                    "sslcert",
                    "connections.clientCertificate",
                    "/path/to/client.crt",
                  ],
                  [
                    "sslkey",
                    "connections.clientKey",
                    "/path/to/client.key",
                  ],
                ] as const
              ).map(([key, label, placeholder]) => (
                <ConnectionFilePathField
                  key={key}
                  label={t(label)}
                  value={form.extraParams[key] ?? ""}
                  disabled={!flags.sqlTlsEnabled}
                  placeholder={placeholder}
                  onChange={(value) => options.setExtraParameter(key, value)}
                  onBrowse={() => void options.pickExtraParameterFile(key)}
                />
              ))}
            </div>
          </>
        )}
      </section>
      {!flags.isSqlite ? (
        <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4">
          <h3>{t("connections.sshTunnel")}</h3>
          <Field label={t("connections.sshHostAlias")} htmlFor="connection-ssh-alias" validation={validation.sshAlias}>
            {({ controlProps }) => (
            <div className="tw:grid tw:gap-1.5">
              <TextInput
                {...controlProps({ "aria-describedby": "connection-ssh-alias-description" })}
                value={
                  form.extraParams[CONNECTION_SSH_ALIAS_PARAMETER] ?? ""
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={255}
                placeholder={t("connections.sshHostAliasPlaceholder")}
                onChange={(event) =>
                  options.setExtraParameter(
                    CONNECTION_SSH_ALIAS_PARAMETER,
                    event.target.value,
                  )
                }
              />
            </div>
            )}
          </Field>
          <p id="connection-ssh-alias-description" className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("connections.sshHostAliasHint")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
