// Renders the immutable Job plan draft. All file, approval, and query effects stay
// in useJobPanelController; this leaf owns only accessible form projection.
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { useI18n } from "../../lib/i18n";
import type { JobErrorPolicy, JobFormat } from "./domain";
import { JOB_FORMATS, formatJobBytes, jobPreviewCell } from "./jobPanelPresentation";
import type { JobPanelController } from "./useJobPanelController";

export function JobPlanForm({ controller }: { controller: JobPanelController }) {
  const { t } = useI18n();
  const { model, commands } = controller;
  const {
    batchSize,
    busy,
    capability,
    customMapping,
    errorPolicy,
    format,
    inspection,
    kind,
    maxErrors,
    nullValues,
    relation,
    required,
    targets,
  } = model;

  return (
    <>
      <div
        className="tw:grid tw:grid-cols-2 tw:gap-1"
        role="group"
        aria-label={t("jobs.kind")}
      >
        <Button
          size="compact"
          active={kind === "export"}
          aria-pressed={kind === "export"}
          onClick={() => commands.resetPlan("export", format)}
        >
          <Icon name="download" />
          {t("jobs.export")}
        </Button>
        <Button
          size="compact"
          active={kind === "import"}
          aria-pressed={kind === "import"}
          onClick={() => commands.resetPlan("import", format)}
        >
          <Icon name="upload" />
          {t("jobs.import")}
        </Button>
      </div>

      <div className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(112px,0.45fr)] tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3 tw:@max-[760px]:grid-cols-1">
        <Field label={t("jobs.format")}>
          <SelectInput
            value={format}
            onChange={(event) => commands.resetPlan(kind, event.target.value as JobFormat)}
          >
            {JOB_FORMATS.map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " + ").toUpperCase()}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label={t("jobs.batchSize")}>
          <TextInput
            type="number"
            min={100}
            max={10_000}
            step={100}
            value={batchSize}
            onChange={(event) => commands.setBatchSize(Number(event.target.value))}
          />
        </Field>

        <div className="tw:col-span-full tw:flex tw:items-center tw:justify-between tw:gap-2 tw:@max-[760px]:col-span-1">
          <div className="tw:grid tw:min-w-0 tw:gap-1">
            <span className="tw:overflow-hidden tw:text-xs tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">
              {kind === "export" ? t("jobs.destination") : t("jobs.source")}
            </span>
            <strong className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
              {capability?.displayName ?? t("jobs.noFile")}
            </strong>
            {capability?.sizeBytes != null && (
              <small className="tw:overflow-hidden tw:text-xs tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">
                {formatJobBytes(capability.sizeBytes)}
              </small>
            )}
          </div>
          <Button
            size="compact"
            disabled={busy}
            onClick={() => void commands.chooseFile()}
          >
            <Icon name="folder" />
            {t("jobs.chooseFile")}
          </Button>
        </div>

        {kind === "import"
          && inspection
          && format !== "sql"
          && format !== "sql_gzip"
          && (
            <>
              {inspection.sampleRows.length > 0 && (
                <div className="tw:col-span-full tw:grid tw:min-w-0 tw:gap-2 tw:@max-[760px]:col-span-1">
                  <strong className="tw:text-sm">
                    {t("jobs.preview", { count: inspection.sampleRows.length })}
                  </strong>
                  <div className="tw:overflow-auto tw:border-y tw:border-border-subtle">
                    <table className="tw:w-full tw:border-collapse tw:text-xs tw:[&_td]:max-w-[140px] tw:[&_td]:overflow-hidden tw:[&_td]:border-r tw:[&_td]:border-border-subtle tw:[&_td]:px-2 tw:[&_td]:py-1 tw:[&_td]:text-left tw:[&_td]:text-ellipsis tw:[&_td]:whitespace-nowrap tw:[&_th]:max-w-[140px] tw:[&_th]:overflow-hidden tw:[&_th]:border-r tw:[&_th]:border-border-subtle tw:[&_th]:px-2 tw:[&_th]:py-1 tw:[&_th]:text-left tw:[&_th]:font-semibold tw:[&_th]:text-ellipsis tw:[&_th]:whitespace-nowrap tw:[&_th]:text-muted-foreground">
                      <thead>
                        <tr>
                          {inspection.fields.slice(0, 8).map((field) => (
                            <th key={field}>{field}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.sampleRows.map((row, index) => (
                          <tr key={index}>
                            {inspection.fields.slice(0, 8).map((field) => (
                              <td key={field} title={jobPreviewCell(row, field)}>
                                {jobPreviewCell(row, field)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="tw:col-span-full tw:grid tw:gap-2 tw:@max-[760px]:col-span-1">
                <CheckboxField
                  checked={customMapping}
                  onChange={(event) => commands.setCustomMapping(event.target.checked)}
                  label={t("jobs.customMapping")}
                />
                <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
                  {customMapping
                    ? t("jobs.customMappingHelp")
                    : t("jobs.autoMappingHelp", { count: inspection.fields.length })}
                </p>
                {customMapping && (
                  <div className="tw:max-h-[240px] tw:overflow-auto tw:border-y tw:border-border-subtle">
                    {inspection.fields.map((source) => (
                      <div
                        className="tw:grid tw:grid-cols-[minmax(72px,0.8fr)_auto_minmax(100px,1fr)_auto] tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:py-1 tw:last:border-b-0 tw:@max-[760px]:grid-cols-[minmax(72px,0.8fr)_auto_minmax(96px,1fr)]"
                        key={source}
                      >
                        <code
                          className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
                          title={source}
                        >
                          {source}
                        </code>
                        <Icon name="arrowRight" />
                        <SelectInput
                          density="compact"
                          value={targets[source] ?? ""}
                          onChange={(event) => commands.setTarget(source, event.target.value)}
                          aria-label={t("jobs.targetFor", { source })}
                        >
                          <option value="">{t("jobs.skipField")}</option>
                          {relation.columns.map((column) => (
                            <option key={column.name} value={column.name}>
                              {column.name}
                            </option>
                          ))}
                        </SelectInput>
                        <span className="tw:@max-[760px]:col-start-3">
                          <CheckboxField
                            checked={required[source] ?? false}
                            disabled={!targets[source]}
                            onChange={(event) => commands.setSourceRequired(source, event.target.checked)}
                            label={t("jobs.required")}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

        {kind === "import" && format !== "sql" && format !== "sql_gzip" && (
          <div className="tw:col-span-full tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(112px,0.55fr)] tw:gap-2 tw:@max-[760px]:col-span-1 tw:@max-[760px]:grid-cols-1">
            <Field label={t("jobs.onError")}>
              <SelectInput
                value={errorPolicy}
                onChange={(event) => commands.setErrorPolicy(event.target.value as JobErrorPolicy)}
              >
                <option value="stop">{t("jobs.stop")}</option>
                <option value="continue">{t("jobs.continue")}</option>
              </SelectInput>
            </Field>
            <Field label={t("jobs.maxErrors")}>
              <TextInput
                type="number"
                min={1}
                max={1_000_000}
                value={maxErrors}
                onChange={(event) => commands.setMaxErrors(Number(event.target.value))}
              />
            </Field>
            <div className="tw:col-span-full tw:@max-[760px]:col-span-1">
              <Field label={t("jobs.nullValues")}>
                <TextInput
                  value={nullValues}
                  onChange={(event) => commands.setNullValues(event.target.value)}
                  spellCheck={false}
                />
              </Field>
            </div>
          </div>
        )}

        {inspection && !inspection.resumable && (
          <p className="tw:col-span-full tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-[1.45] tw:text-warning tw:[&_.icon]:mt-0.5 tw:[&_.icon]:shrink-0 tw:@max-[760px]:col-span-1">
            <Icon name="alert" />
            {t("jobs.warningNotResumable")}
          </p>
        )}
        {inspection && (format === "sql" || format === "sql_gzip") && (
          <p className="tw:col-span-full tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-[1.45] tw:text-warning tw:[&_.icon]:mt-0.5 tw:[&_.icon]:shrink-0 tw:@max-[760px]:col-span-1">
            <Icon name="alert" />
            {t("jobs.warningSqlCritical")}
          </p>
        )}

      </div>
    </>
  );
}
