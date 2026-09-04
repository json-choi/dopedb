// Presents the selected cloud provider or driver details from the catalog view
// model without loading or mutating catalog state itself.
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { StatusBadge } from "../../design-system/components/Status";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { ManagedAccessLauncher } from "../../features/providers/ManagedAccessDialog";
import { useI18n } from "../../lib/i18n";

export function ConnectionCatalogDetail({
  catalog,
  profile,
}: {
  catalog: ConnectionEditorController["catalog"];
  profile: ConnectionEditorController["profile"];
}) {
  const { t } = useI18n();
  const { navigation, clouds, drivers } = catalog;

  if (navigation.view === "clouds") {
    return (
      <>
        <div className="tw:flex tw:min-h-control-lg tw:shrink-0 tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:bg-card tw:px-4">
          <Icon name="key" />
          <strong className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {clouds.providerLabel(clouds.selected)}
          </strong>
        </div>
        <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:p-5">
          <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[760px] tw:gap-5">
            <section className="tw:grid tw:gap-3">
              <h3>{t("connections.clouds")}</h3>
              <div className="tw:grid tw:grid-cols-[20px_minmax(0,1fr)] tw:gap-3 tw:border-y tw:border-border-subtle tw:py-3">
                <Icon name="info" className="tw:mt-0.5 tw:text-info" />
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("connections.cloudCatalogDescription")}
                </p>
              </div>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                {clouds.selected === "gcpCloudSql" ? (
                  <Button
                    variant="primary"
                    onClick={(event) =>
                      clouds.openProviderCredentials(
                        clouds.selected,
                        event.currentTarget,
                      )
                    }
                  >
                    <Icon name="key" />
                    {t("connections.cloudCredentialDescription")}
                  </Button>
                ) : null}
                {!profile.identity.isNew ? (
                  <ManagedAccessLauncher
                    connectionId={profile.form.id}
                    provider={clouds.selected}
                    allowWrites={profile.form.allowWrites}
                  />
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </>
    );
  }

  if (drivers.selected) {
    const driver = drivers.selected;
    return (
      <>
        <div className="tw:flex tw:min-h-control-lg tw:shrink-0 tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:bg-card tw:px-4">
          <EngineMark engine={driver.engine} />
          <strong className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            {driver.name}
          </strong>
          <StatusBadge
            tone={
              driver.installState === "installed" ? "success" : "neutral"
            }
          >
            {drivers.status(driver)}
          </StatusBadge>
        </div>
        <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:p-5">
          <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[760px] tw:gap-5">
            <section className="tw:grid tw:gap-3">
              <h3>{t("connections.driverDetails")}</h3>
              <dl className="tw:grid tw:grid-cols-[140px_minmax(0,1fr)] tw:gap-x-4 tw:text-sm tw:[&>*]:border-b tw:[&>*]:border-border-subtle tw:[&>*]:py-2.5">
                <dt className="tw:text-muted-foreground">
                  {t("connections.engine")}
                </dt>
                <dd className="tw:m-0">{driver.engine}</dd>
                <dt className="tw:text-muted-foreground">
                  {t("connections.driverVersion")}
                </dt>
                <dd className="tw:m-0 tw:font-mono">{driver.version}</dd>
                <dt className="tw:text-muted-foreground">
                  {t("connections.driverInstallation")}
                </dt>
                <dd className="tw:m-0">{drivers.status(driver)}</dd>
                <dt className="tw:text-muted-foreground">
                  {t("connections.supportedProviders")}
                </dt>
                <dd className="tw:m-0 tw:flex tw:flex-wrap tw:gap-1">
                  {driver.supportedProviders.map((provider) => (
                    <span className="badge" key={provider}>
                      {drivers.providerLabel(driver, provider)}
                    </span>
                  ))}
                </dd>
              </dl>
              {driver.installMode === "managed" &&
              driver.installState === "available" ? (
                <div>
                  <Button
                    variant="primary"
                    disabled={drivers.installingId !== null}
                    onClick={() => void drivers.download(driver)}
                  >
                    <Icon name="download" />
                    {drivers.installingId === driver.id
                      ? t("connections.driverDownloading")
                      : t("connections.driverDownload")}
                  </Button>
                </div>
              ) : null}
            </section>
            <section className="tw:grid tw:gap-3">
              <h3>{t("connections.driverCapabilities")}</h3>
              <div className="tw:flex tw:flex-wrap tw:gap-2">
                {driver.capabilities.map((capability) => (
                  <span className="badge" key={capability}>
                    {t(`connections.driverCapability.${capability}`)}
                  </span>
                ))}
              </div>
            </section>
            <section className="tw:grid tw:grid-cols-[20px_minmax(0,1fr)] tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3">
              <Icon name="info" className="tw:mt-0.5 tw:text-info" />
              <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                {t("connections.driverCatalogScope")}
              </p>
            </section>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="tw:grid tw:min-h-0 tw:flex-1 tw:place-items-center tw:p-6 tw:text-center tw:text-sm tw:text-muted-foreground">
      {drivers.failed
        ? t("connections.problemDriverCatalogUnavailable")
        : t("connections.noDriverResults")}
    </div>
  );
}
