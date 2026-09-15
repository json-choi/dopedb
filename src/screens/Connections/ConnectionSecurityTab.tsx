// Presents TLS and SSH alias properties from the profile model without owning
// file picking, option normalization, or validation state.
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  FieldValidationMessage,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
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
              <Field label={t("connections.caCertificate")}>
                <div className="ds-control-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
                  <TextInput
                    value={form.extraParams.tlsCAFile ?? ""}
                    disabled={!flags.mongoTlsEnabled}
                    onChange={(event) =>
                      options.setExtraParameter(
                        "tlsCAFile",
                        event.target.value,
                      )
                    }
                    placeholder="/path/to/ca.pem"
                  />
                  <Button
                    disabled={!flags.mongoTlsEnabled}
                    onClick={() =>
                      void options.pickExtraParameterFile("tlsCAFile")
                    }
                  >
                    {t("connections.browse")}
                  </Button>
                </div>
              </Field>
              <Field label={t("connections.clientCertificateKey")}>
                <div className="ds-control-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
                  <TextInput
                    value={
                      form.extraParams.tlsCertificateKeyFile ?? ""
                    }
                    disabled={!flags.mongoTlsEnabled}
                    onChange={(event) =>
                      options.setExtraParameter(
                        "tlsCertificateKeyFile",
                        event.target.value,
                      )
                    }
                    placeholder="/path/to/client.pem"
                  />
                  <Button
                    disabled={!flags.mongoTlsEnabled}
                    onClick={() =>
                      void options.pickExtraParameterFile(
                        "tlsCertificateKeyFile",
                      )
                    }
                  >
                    {t("connections.browse")}
                  </Button>
                </div>
              </Field>
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
                <Field key={key} label={t(label)}>
                  <div className="ds-control-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
                    <TextInput
                      value={form.extraParams[key] ?? ""}
                      disabled={!flags.sqlTlsEnabled}
                      onChange={(event) =>
                        options.setExtraParameter(key, event.target.value)
                      }
                      placeholder={placeholder}
                    />
                    <Button
                      disabled={!flags.sqlTlsEnabled}
                      onClick={() =>
                        void options.pickExtraParameterFile(key)
                      }
                    >
                      {t("connections.browse")}
                    </Button>
                  </div>
                </Field>
              ))}
            </div>
          </>
        )}
      </section>
      {!flags.isSqlite ? (
        <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4">
          <h3>{t("connections.sshTunnel")}</h3>
          <Field label={t("connections.sshHostAlias")}>
            <div className="tw:grid tw:gap-1.5">
              <TextInput
                id="connection-ssh-alias"
                value={
                  form.extraParams[CONNECTION_SSH_ALIAS_PARAMETER] ?? ""
                }
                aria-invalid={
                  validation.sshAlias?.tone === "danger" || undefined
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
              {validation.sshAlias ? (
                <FieldValidationMessage validation={validation.sshAlias} />
              ) : null}
            </div>
          </Field>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("connections.sshHostAliasHint")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
