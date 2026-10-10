// Presents free-form driver parameters and capabilities from the grouped
// profile/catalog view models.
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  FieldValidationMessage,
  TextInput,
} from "../../design-system/components/FormControls";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionAdvancedTab({
  profile,
  activeDriver,
}: {
  profile: ConnectionEditorController["profile"];
  activeDriver: ConnectionEditorController["catalog"]["drivers"]["active"];
}) {
  const { t } = useI18n();
  const { options } = profile;

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[840px] tw:gap-5">
      <section className="tw:grid tw:gap-3">
        <div className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <h3>{t("connections.advancedParameters")}</h3>
          <Button
            size="compact"
            onClick={options.addAdvancedParameter}
          >
            <Icon name="plus" />
            {t("connections.addParameter")}
          </Button>
        </div>
        {options.advancedRows.length === 0 ? (
          <p className="tw:m-0 tw:border-y tw:border-border-subtle tw:py-4 tw:text-sm tw:text-muted-foreground">
            {t("connections.noParameters")}
          </p>
        ) : (
          <div className="tw:grid tw:gap-2">
            {options.advancedRows.map((row) => {
              const issue = options.advancedParameterIssue(row);
              const issueId = `connection-parameter-${row.id}-issue`;
              return (
                <div key={row.id} className="tw:grid tw:gap-1">
                  <div className="ds-control-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:[--ds-row-control-size:var(--ds-control-md)]">
                    <TextInput
                      density="compact"
                      value={row.key}
                      aria-label={t("connections.parameterKey")}
                      aria-describedby={issue ? issueId : undefined}
                      onChange={(event) =>
                        options.updateAdvancedParameter(
                          row.id,
                          event.target.value,
                          row.value,
                        )
                      }
                    />
                    <TextInput
                      density="compact"
                      value={row.value}
                      aria-label={t("connections.parameterValue")}
                      onChange={(event) =>
                        options.updateAdvancedParameter(
                          row.id,
                          row.key,
                          event.target.value,
                        )
                      }
                    />
                    <Button
                      iconOnly
                      size="compact"
                      variant="ghost"
                      onClick={() => options.removeAdvancedParameter(row.id)}
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                    >
                      <Icon name="close" />
                    </Button>
                  </div>
                  {issue ? (
                    <FieldValidationMessage
                      id={issueId}
                      validation={{
                        tone: "warning",
                        message: issue === "reserved"
                          ? t("connections.parameterReserved")
                          : t("connections.parameterDuplicate"),
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {activeDriver ? (
        <section className="tw:grid tw:gap-3">
          <h3>{t("connections.driverCapabilities")}</h3>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            {activeDriver.capabilities.map((capability) => (
              <span key={capability} className="badge">
                {capability}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
