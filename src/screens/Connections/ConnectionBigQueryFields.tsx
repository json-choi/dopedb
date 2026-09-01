// BigQuery's official-CLI profile stays separate from socket/password fields.
import { Button } from "../../design-system/components/Button";
import {
  PropertyRow,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { SegmentedControl } from "../../design-system/components/SegmentedControl";
import {
  LoadingLabel,
  StatusBadge,
} from "../../design-system/components/Status";
import {
  BIGQUERY_DEFAULT_MAXIMUM_BYTES_BILLED,
  BIGQUERY_LOCATION_PARAMETER,
  BIGQUERY_MAXIMUM_BYTES_BILLED_PARAMETER,
} from "../../features/connections/connectionEditorModel";
import { bigQueryResourceInputMode } from "../../features/connections/bigQueryOnboardingModel";
import type { BigQueryAuthMode } from "../../features/connections/domain";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

type Controller = ConnectionEditorController;

export function ConnectionBigQueryFields({
  profile,
  drivers,
}: {
  profile: Controller["profile"];
  drivers: Controller["catalog"]["drivers"];
}) {
  const { t } = useI18n();
  const { form, set, flags, options, validation, bigQuery } = profile;
  const { isSharedTemplate, canEditConnection } = flags;
  const projectIsDiscovered = bigQuery.projects.some(
    (project) => project.id === form.host,
  );
  const datasetIsDiscovered = bigQuery.datasets.some(
    (dataset) => dataset.id === form.database,
  );
  const useProjectSelector =
    !isSharedTemplate &&
    bigQueryResourceInputMode(
      bigQuery.auth?.authenticated === true,
      bigQuery.projects.length,
    ) === "select";
  const useDatasetSelector =
    !isSharedTemplate &&
    bigQueryResourceInputMode(
      bigQuery.auth?.authenticated === true,
      bigQuery.datasets.length,
    ) === "select";
  const authOptions: ReadonlyArray<{
    value: BigQueryAuthMode;
    label: string;
  }> = [
    {
      value: "googleAccount",
      label: t("connections.bigQueryGoogleAccount"),
    },
    {
      value: "serviceAccount",
      label: t("connections.bigQueryServiceAccount"),
    },
  ];

  return (
    <section className="tw:grid tw:gap-3">
      {!isSharedTemplate ? (
        <>
          <PropertyRow label={t("connections.bigQueryAuthenticationMode")}>
            <SegmentedControl
              value={bigQuery.mode}
              options={authOptions}
              label={t("connections.bigQueryAuthenticationMode")}
              disabled={!canEditConnection || bigQuery.pending}
              onChange={bigQuery.setMode}
            />
          </PropertyRow>

          <PropertyRow label={t("connections.authentication")}>
            <div className="tw:flex tw:min-h-control-md tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
              {bigQuery.pending ? (
                <LoadingLabel>
                  {t(
                    bigQuery.preparingCli
                      ? "connections.bigQueryPreparingTools"
                      : "connections.bigQueryAuthenticating",
                  )}
                </LoadingLabel>
              ) : (
                <StatusBadge
                  tone={
                    bigQuery.auth?.authenticated ? "success" : "warning"
                  }
                >
                  {bigQuery.auth?.authenticated
                    ? t("connections.bigQueryConnected")
                    : t("connections.bigQueryNotConnected")}
                </StatusBadge>
              )}
              <Button
                size="compact"
                disabled={!canEditConnection || bigQuery.pending}
                onClick={
                  bigQuery.mode === "googleAccount"
                    ? bigQuery.connectGoogleAccount
                    : bigQuery.connectServiceAccount
                }
              >
                {bigQuery.mode === "googleAccount"
                  ? bigQuery.auth?.authenticated
                    ? t("connections.bigQueryChangeGoogleAccount")
                    : t("connections.bigQueryConnectGoogleAccount")
                  : bigQuery.auth?.authenticated
                    ? t("connections.bigQueryReplaceCredentialFile")
                    : t("connections.bigQueryChooseCredentialFile")}
              </Button>
            </div>
            {bigQuery.authenticationError ? (
              <p
                className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger"
                role="alert"
              >
                {bigQuery.authenticationError}
              </p>
            ) : null}
          </PropertyRow>
        </>
      ) : null}

      <PropertyRow
        label={t("connections.bigQueryProjectId")}
        htmlFor="connection-host"
        validation={validation.host}
      >
        {useProjectSelector ? (
          <SelectInput
            id="connection-host"
            density="compact"
            value={form.host}
            disabled={!canEditConnection}
            required
            aria-invalid={validation.host?.tone === "danger" || undefined}
            onChange={(event) => bigQuery.selectProject(event.target.value)}
          >
            <option value="">
              {t("connections.bigQuerySelectProject")}
            </option>
            {form.host && !projectIsDiscovered ? (
              <option value={form.host}>{form.host}</option>
            ) : null}
            {bigQuery.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name && project.name !== project.id
                  ? `${project.name} — ${project.id}`
                  : project.id}
              </option>
            ))}
          </SelectInput>
        ) : (
          <TextInput
            id="connection-host"
            density="compact"
            value={form.host}
            disabled={!canEditConnection}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={validation.host?.tone === "danger" || undefined}
            placeholder={t("connections.bigQueryProjectPlaceholder")}
            onChange={(event) => bigQuery.selectProject(event.target.value)}
          />
        )}
        {!isSharedTemplate && bigQuery.projectsError ? (
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <p
              className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger"
              role="alert"
            >
              {bigQuery.projectsError}
            </p>
            <Button size="xs" onClick={bigQuery.refreshProjects}>
              {t("common.refresh")}
            </Button>
          </div>
        ) : null}
        {!isSharedTemplate &&
        bigQuery.auth?.authenticated &&
        bigQuery.projectsLoaded &&
        bigQuery.projects.length === 0 &&
        !bigQuery.projectsError ? (
          <span className="tw:text-xs tw:text-muted-foreground" role="status">
            {t("connections.bigQueryNoProjects")}
          </span>
        ) : null}
        {!isSharedTemplate && bigQuery.projectsPending ? (
          <span className="tw:text-xs tw:text-muted-foreground" role="status">
            {t("connections.bigQueryProjectsLoading")}
          </span>
        ) : null}
      </PropertyRow>

      <PropertyRow
        label={t("connections.bigQueryDataset")}
        htmlFor="connection-database"
        validation={validation.database}
      >
        {useDatasetSelector ? (
          <SelectInput
            id="connection-database"
            density="compact"
            value={form.database}
            disabled={!canEditConnection}
            required
            aria-invalid={
              validation.database?.tone === "danger" || undefined
            }
            onChange={(event) => bigQuery.selectDataset(event.target.value)}
          >
            <option value="">
              {t("connections.bigQuerySelectDataset")}
            </option>
            {form.database && !datasetIsDiscovered ? (
              <option value={form.database}>{form.database}</option>
            ) : null}
            {bigQuery.datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.id}
              </option>
            ))}
          </SelectInput>
        ) : (
          <TextInput
            id="connection-database"
            density="compact"
            value={form.database}
            disabled={!canEditConnection}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={
              validation.database?.tone === "danger" || undefined
            }
            placeholder={t("connections.bigQueryDatasetPlaceholder")}
            onChange={(event) => bigQuery.selectDataset(event.target.value)}
          />
        )}
        {!isSharedTemplate && bigQuery.datasetsError ? (
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <p
              className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger"
              role="alert"
            >
              {bigQuery.datasetsError}
            </p>
            <Button size="xs" onClick={bigQuery.refreshDatasets}>
              {t("common.refresh")}
            </Button>
          </div>
        ) : null}
        {!isSharedTemplate &&
        form.host.trim() &&
        bigQuery.datasetsLoaded &&
        bigQuery.datasets.length === 0 &&
        !bigQuery.datasetsError ? (
          <span className="tw:text-xs tw:text-muted-foreground" role="status">
            {t("connections.bigQueryNoDatasets")}
          </span>
        ) : null}
        {!isSharedTemplate && bigQuery.datasetsPending ? (
          <span className="tw:text-xs tw:text-muted-foreground" role="status">
            {t("connections.bigQueryDatasetsLoading")}
          </span>
        ) : null}
      </PropertyRow>

      {!isSharedTemplate ? (
        <PropertyRow
          label={t("connections.bigQueryLocation")}
          htmlFor="connection-bigquery-location"
          validation={validation.bigQueryLocation}
        >
          <TextInput
            id="connection-bigquery-location"
            density="compact"
            value={form.extraParams[BIGQUERY_LOCATION_PARAMETER] ?? ""}
            disabled={!canEditConnection}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={
              validation.bigQueryLocation?.tone === "danger" || undefined
            }
            placeholder={t("connections.bigQueryLocationPlaceholder")}
            onChange={(event) =>
              options.setExtraParameter(
                BIGQUERY_LOCATION_PARAMETER,
                event.target.value,
              )
            }
          />
        </PropertyRow>
      ) : null}

      {!isSharedTemplate ? (
        <PropertyRow
          label={t("connections.bigQueryMaximumBytesBilled")}
          htmlFor="connection-bigquery-maximum-bytes-billed"
          validation={validation.bigQueryMaximumBytesBilled}
        >
          <TextInput
            id="connection-bigquery-maximum-bytes-billed"
            density="compact"
            type="number"
            min={1}
            max={10 * 1024 ** 4}
            value={
              form.extraParams[BIGQUERY_MAXIMUM_BYTES_BILLED_PARAMETER] ??
              BIGQUERY_DEFAULT_MAXIMUM_BYTES_BILLED
            }
            aria-invalid={
              validation.bigQueryMaximumBytesBilled?.tone === "danger" ||
              undefined
            }
            onChange={(event) =>
              options.setExtraParameter(
                BIGQUERY_MAXIMUM_BYTES_BILLED_PARAMETER,
                event.target.value,
              )
            }
          />
        </PropertyRow>
      ) : (
        <PropertyRow label={t("connections.environment")}>
          <SelectInput
            density="compact"
            value={form.env ?? ""}
            disabled={!canEditConnection}
            onChange={(event) => set("env", event.target.value || null)}
          >
            <option value="">{t("common.none")}</option>
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </SelectInput>
        </PropertyRow>
      )}

      <PropertyRow label={t("connections.bigQueryCliStatus")}>
        <div className="tw:flex tw:min-h-control-md tw:flex-wrap tw:items-center tw:gap-2">
          <StatusBadge
            tone={
              drivers.active?.installState === "installed"
                ? "success"
                : "warning"
            }
          >
            {drivers.active?.installState === "installed"
              ? t("connections.bigQueryCliReady")
              : bigQuery.preparingCli
                ? t("connections.bigQueryPreparingTools")
                : t("connections.bigQueryCliRequired")}
          </StatusBadge>
        </div>
      </PropertyRow>
      <p className="tw:m-0 tw:border-t tw:border-border-subtle tw:pt-3 tw:text-sm tw:leading-body tw:text-muted-foreground">
        {t(
          isSharedTemplate
            ? "connections.bigQuerySharedSecurityNote"
            : "connections.bigQuerySecurityNote",
        )}
      </p>
    </section>
  );
}
