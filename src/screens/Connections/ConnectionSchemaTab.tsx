// Presents discovered namespaces and saved introspection scope from the schema
// controller; the screen does not query catalog adapters directly.
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  TextInput,
} from "../../design-system/components/FormControls";
import { OBJECT_PATTERN_PARAMETER } from "../../features/catalogExplorer/scopeFilter";
import {
  catalogLoadIssue,
  catalogLoadIssueMessage,
} from "../../features/catalogExplorer/catalogDomain";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionSchemaTab({
  profile,
  schema,
}: {
  profile: ConnectionEditorController["profile"];
  schema: ConnectionEditorController["schema"];
}) {
  const { t } = useI18n();
  const { form, set, options } = profile;

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[720px] tw:gap-5">
      <section className="tw:grid tw:gap-3">
        <h3>{t("connections.introspectionScope")}</h3>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("connections.introspectionScopeBody")}
        </p>
        {!profile.identity.persisted ? (
          <div className="tw:rounded-sm tw:border tw:border-border-subtle tw:bg-card tw:p-3 tw:text-sm tw:text-muted-foreground">
            {t("connections.schemaScopeSaveFirst")}
          </div>
        ) : schema.status.error ? (
          <div className="tw:flex tw:items-start tw:gap-2 tw:rounded-sm tw:border tw:border-danger tw:bg-card tw:p-3 tw:text-sm tw:text-danger">
            <span className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
              {catalogLoadIssueMessage(
                t,
                catalogLoadIssue(schema.status.error),
              )}
            </span>
            <Button
              size="compact"
              disabled={schema.status.fetching}
              onClick={() => void schema.refresh()}
            >
              <Icon name="refresh" />
              {t("common.refresh")}
            </Button>
          </div>
        ) : !schema.status.dataReady ? (
          <div className="tw:text-sm tw:text-muted-foreground">
            {t("connections.loadingSchemaScope")}
          </div>
        ) : schema.discovered.length === 0 ? (
          <div className="tw:rounded-sm tw:border tw:border-border-subtle tw:bg-card tw:p-3 tw:text-sm tw:text-muted-foreground">
            {t("connections.noSchemasDiscovered")}
          </div>
        ) : (
          <div className="tw:grid tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:bg-card">
            <div className="tw:flex tw:min-h-10 tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-muted/40 tw:px-3">
              <Icon
                name="database"
                className="tw:text-muted-foreground"
              />
              <strong className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-ui tw:font-medium">
                {form.database}
              </strong>
              <span className="tw:text-xs tw:text-muted-foreground">
                {t("connections.discoveredSchemaCount", {
                  count: schema.discovered.length,
                })}
              </span>
            </div>
            <div className="tw:grid tw:gap-1 tw:p-2 tw:pl-8">
              <CheckboxField
                label={t("connections.allSchemas")}
                checked={schema.selected.length === 0}
                indeterminate={
                  schema.selected.length > 0 &&
                  schema.selected.length < schema.discovered.length
                }
                onChange={(event) => {
                  if (event.target.checked) schema.setScope([]);
                }}
              />
              <div className="tw:my-1 tw:h-px tw:bg-border-subtle" />
              {schema.discovered.map((namespace) => (
                <CheckboxField
                  key={namespace}
                  label={
                    <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                        {namespace}
                      </span>
                      <span className="tw:text-xs tw:tabular-nums tw:text-muted-foreground">
                        {schema.relationCounts.get(namespace) ?? 0}
                      </span>
                    </span>
                  }
                  checked={
                    schema.selected.length === 0 ||
                    schema.selected.includes(namespace)
                  }
                  onChange={(event) =>
                    schema.toggleScope(namespace, event.target.checked)
                  }
                />
              ))}
            </div>
          </div>
        )}
        <Field
          label={t("connections.objectNamePattern")}
          hint={t("connections.objectNamePatternHint")}
        >
          <TextInput
            value={form.extraParams[OBJECT_PATTERN_PARAMETER] ?? ""}
            onChange={(event) =>
              options.setExtraParameter(
                OBJECT_PATTERN_PARAMETER,
                event.target.value,
              )
            }
            placeholder="audit_*"
          />
        </Field>
      </section>

      <div className="tw:h-px tw:bg-border-subtle" />

      <section className="tw:grid tw:gap-3">
        <h3>{t("connections.schemaComparison")}</h3>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("connections.schemasBody")}
        </p>
        <Field label={t("connections.schemaGroup")}>
          <TextInput
            value={form.schemaGroup ?? ""}
            onChange={(event) =>
              set("schemaGroup", event.target.value.trim() || null)
            }
            placeholder={t("connections.schemaGroupPlaceholder")}
          />
        </Field>
      </section>
    </div>
  );
}
