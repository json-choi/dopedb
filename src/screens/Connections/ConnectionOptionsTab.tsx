// Presents runtime-backed connection/session options from the profile view
// model; mutation and validation ownership remains in the feature controller.
import InfoTip from "../../components/InfoTip";
import {
  CheckboxField,
  Field,
  FieldValidationMessage,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../design-system/components/FormControls";
import {
  CONNECTION_AUTO_DISCONNECT_MAX_SECONDS,
  CONNECTION_AUTO_DISCONNECT_MIN_SECONDS,
  CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
  CONNECTION_KEEP_ALIVE_MAX_SECONDS,
  CONNECTION_KEEP_ALIVE_MIN_SECONDS,
  CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
  CONNECTION_STARTUP_SCRIPT_MAX_LENGTH,
  CONNECTION_STARTUP_SCRIPT_PARAMETER,
  CONNECTION_TIME_ZONE_PARAMETER,
  connectionOption,
} from "../../features/connections/options";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionOptionsTab({
  profile,
}: {
  profile: ConnectionEditorController["profile"];
}) {
  const { t } = useI18n();
  const { form, set, flags, options, validation } = profile;

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[760px] tw:gap-6">
      <section className="tw:grid tw:gap-4">
        <h3>{t("connections.connection")}</h3>

        <div className="tw:grid tw:gap-1">
          <CheckboxField
            label={t("connections.readOnlyDefault")}
            checked={form.readonlyDefault}
            onChange={(event) =>
              set("readonlyDefault", event.target.checked)
            }
          />
          <p className="tw:m-0 tw:pl-6 tw:text-sm tw:text-muted-foreground">
            {t("connections.readOnlyDefaultBody")}
          </p>
        </div>

        {!flags.isMongo ? (
          <div className="tw:grid tw:grid-cols-[220px_minmax(0,1fr)] tw:items-start tw:gap-3 tw:border-y tw:border-border-subtle tw:py-3 tw:@max-[620px]:grid-cols-1">
            <span className="tw:text-sm tw:font-medium tw:text-muted-foreground">
              {t("connections.transactionControl")}
            </span>
            <div className="tw:grid tw:gap-1">
              <strong className="tw:text-ui tw:font-medium tw:text-foreground">
                {t("connections.transactionAuto")}
              </strong>
              <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
                {t("connections.transactionOperationScoped")}
              </p>
            </div>
          </div>
        ) : null}

        {flags.supportsSqlSessionOptions ? (
          <Field
            label={t("connections.timeZone")}
            htmlFor="connection-time-zone"
            validation={validation.timeZone}
          >
            {({ controlProps }) => (
              <TextInput
                {...controlProps()}
                value={connectionOption(
                  form,
                  CONNECTION_TIME_ZONE_PARAMETER,
                )}
                onChange={(event) =>
                  options.setExtraParameter(
                    CONNECTION_TIME_ZONE_PARAMETER,
                    event.target.value,
                  )
                }
                placeholder={t("connections.timeZonePlaceholder")}
              />
            )}
          </Field>
        ) : null}

        {flags.supportsSqlSessionOptions ? (
          <div className="tw:grid tw:gap-2">
            <CheckboxField
              label={t("connections.keepAlive")}
              checked={flags.keepAliveEnabled}
              onChange={(event) =>
                options.toggleTimedConnectionOption(
                  CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
                  event.target.checked,
                  60,
                )
              }
            />
            <div className="tw:flex tw:items-center tw:gap-2 tw:pl-6">
              <div className="tw:w-32">
                <TextInput
                  id="connection-keep-alive"
                  type="number"
                  inputMode="numeric"
                  min={CONNECTION_KEEP_ALIVE_MIN_SECONDS}
                  max={CONNECTION_KEEP_ALIVE_MAX_SECONDS}
                  value={connectionOption(
                    form,
                    CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
                  )}
                  disabled={!flags.keepAliveEnabled}
                  aria-invalid={
                    validation.keepAlive?.tone === "danger" || undefined
                  }
                  aria-label={t("connections.keepAliveSeconds")}
                  onChange={(event) =>
                    options.setTimedConnectionOptionValue(
                      CONNECTION_KEEP_ALIVE_SECONDS_PARAMETER,
                      event.target.value,
                    )
                  }
                />
              </div>
              <span className="tw:shrink-0 tw:text-sm tw:text-muted-foreground">
                {t("connections.seconds")}
              </span>
            </div>
            {validation.keepAlive ? (
              <div className="tw:pl-6">
                <FieldValidationMessage validation={validation.keepAlive} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="tw:grid tw:gap-2">
          <CheckboxField
            label={t("connections.autoDisconnect")}
            checked={flags.autoDisconnectEnabled}
            onChange={(event) =>
              options.toggleTimedConnectionOption(
                CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
                event.target.checked,
                600,
              )
            }
          />
          <div className="tw:flex tw:items-center tw:gap-2 tw:pl-6">
            <div className="tw:w-32">
              <TextInput
                id="connection-auto-disconnect"
                type="number"
                inputMode="numeric"
                min={CONNECTION_AUTO_DISCONNECT_MIN_SECONDS}
                max={CONNECTION_AUTO_DISCONNECT_MAX_SECONDS}
                value={connectionOption(
                  form,
                  CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
                )}
                disabled={!flags.autoDisconnectEnabled}
                aria-invalid={
                  validation.autoDisconnect?.tone === "danger" || undefined
                }
                aria-label={t("connections.autoDisconnectSeconds")}
                onChange={(event) =>
                  options.setTimedConnectionOptionValue(
                    CONNECTION_AUTO_DISCONNECT_SECONDS_PARAMETER,
                    event.target.value,
                  )
                }
              />
            </div>
            <span className="tw:shrink-0 tw:text-sm tw:text-muted-foreground">
              {t("connections.seconds")}
            </span>
          </div>
          {validation.autoDisconnect ? (
            <div className="tw:pl-6">
              <FieldValidationMessage
                validation={validation.autoDisconnect}
              />
            </div>
          ) : null}
        </div>

        {flags.supportsStartupScript ? (
          <Field
            label={t("connections.startupScript")}
            htmlFor="connection-startup-script"
            hint={<InfoTip label={t("connections.startupScriptHint")} />}
            description={t("connections.startupScriptHint")}
            validation={validation.startupScript}
          >
            {({ controlProps }) => (
              <TextAreaInput
                {...controlProps()}
                value={connectionOption(
                  form,
                  CONNECTION_STARTUP_SCRIPT_PARAMETER,
                )}
                maxLength={CONNECTION_STARTUP_SCRIPT_MAX_LENGTH}
                onChange={(event) =>
                  options.setExtraParameter(
                    CONNECTION_STARTUP_SCRIPT_PARAMETER,
                    event.target.value,
                  )
                }
                placeholder={t("connections.startupScriptPlaceholder")}
              />
            )}
          </Field>
        ) : null}
      </section>

      <section className="tw:grid tw:gap-4 tw:border-t tw:border-border-subtle tw:pt-5">
        <h3>{t("connections.safety")}</h3>
        <Field
          label={t("connections.environment")}
          hint={<InfoTip label={t("connections.environmentHint")} />}
        >
          <SelectInput
            value={form.env ?? ""}
            onChange={(event) => set("env", event.target.value || null)}
          >
            <option value="">{t("common.none")}</option>
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </SelectInput>
        </Field>
      </section>
    </div>
  );
}
