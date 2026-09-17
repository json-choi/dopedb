import { Button } from "../../design-system/components/Button";
import {
  PropertyRow,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import {
  LoadingLabel,
  StatusBadge,
} from "../../design-system/components/Status";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

type Profile = ConnectionEditorController["profile"];

export function ConnectionCloudflareD1Fields({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const { form, set, flags, validation, cloudflareD1 } = profile;
  const { isSharedTemplate, canEditConnection } = flags;
  const accountIsDiscovered = cloudflareD1.accounts.some(
    (account) => account.id === form.host,
  );
  const databaseIsDiscovered = cloudflareD1.databases.some(
    (database) => database.id === form.database,
  );

  return (
    <section className="tw:grid tw:gap-3">
      {!isSharedTemplate ? (
        <PropertyRow label={t("connections.authentication")}>
          <div className="tw:grid tw:min-w-0 tw:gap-1.5">
            <div className="tw:flex tw:min-h-control-md tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
              {cloudflareD1.pending ? (
                <LoadingLabel>
                  {t(
                    cloudflareD1.authenticating
                      ? "connections.cloudflareD1Authenticating"
                      : "connections.cloudflareD1CheckingConnection",
                  )}
                </LoadingLabel>
              ) : (
                <StatusBadge
                  tone={
                    cloudflareD1.auth?.authenticated ? "success" : "warning"
                  }
                >
                  {cloudflareD1.auth?.authenticated
                    ? t("connections.cloudflareD1Connected")
                    : t("connections.cloudflareD1NotConnected")}
                </StatusBadge>
              )}
              <Button
                size="compact"
                aria-describedby={
                  cloudflareD1.authenticationError
                    ? "connection-cloudflare-auth-error"
                    : undefined
                }
                disabled={
                  !canEditConnection ||
                  cloudflareD1.pending ||
                  !cloudflareD1.cliAvailable
                }
                onClick={cloudflareD1.connect}
              >
                {cloudflareD1.auth?.authenticated
                  ? t("connections.cloudflareD1ChangeAccount")
                  : t("connections.cloudflareD1ConnectAccount")}
              </Button>
            </div>
            {cloudflareD1.auth?.email ? (
              <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                {cloudflareD1.auth.email}
              </span>
            ) : null}
            {!cloudflareD1.cliAvailable ? (
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger" role="alert">
                {t("connections.cloudflareD1WranglerRequired")}
              </p>
            ) : cloudflareD1.authenticationError ? (
              <p
                id="connection-cloudflare-auth-error"
                className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger"
                role="alert"
              >
                {cloudflareD1.authenticationError}
              </p>
            ) : null}
          </div>
        </PropertyRow>
      ) : null}

      <PropertyRow
        label={t("connections.cloudflareAccount")}
        htmlFor="connection-host"
        validation={
          isSharedTemplate || cloudflareD1.auth?.authenticated
            ? validation.host
            : undefined
        }
      >
        {({ controlProps }) =>
          !isSharedTemplate && cloudflareD1.auth?.authenticated ? (
            <div className="tw:grid tw:min-w-0 tw:gap-1.5">
              <SelectInput
                {...controlProps()}
                density="compact"
                value={form.host}
                disabled={!canEditConnection}
                required
                onChange={(event) =>
                  cloudflareD1.selectAccount(event.target.value)
                }
              >
                <option value="">{t("connections.cloudflareD1SelectAccount")}</option>
                {form.host && !accountIsDiscovered ? (
                  <option value={form.host}>{form.host}</option>
                ) : null}
                {cloudflareD1.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name || account.id}
                  </option>
                ))}
              </SelectInput>
              <ResourceStatus
                pending={cloudflareD1.accountsPending}
                empty={
                  cloudflareD1.accountsLoaded &&
                  cloudflareD1.accounts.length === 0
                }
                error={cloudflareD1.accountsError}
                loadingLabel={t("connections.cloudflareD1AccountsLoading")}
                emptyLabel={t("connections.cloudflareD1NoAccounts")}
                refreshLabel={t("common.refresh")}
                onRefresh={cloudflareD1.refreshAccounts}
              />
            </div>
          ) : (
            <TextInput
              {...controlProps()}
              density="compact"
              value={form.host}
              disabled={!canEditConnection || !isSharedTemplate}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("connections.cloudflareD1ConnectFirst")}
              onChange={(event) => set("host", event.target.value)}
            />
          )
        }
      </PropertyRow>

      <PropertyRow
        label={t("connections.cloudflareD1Database")}
        htmlFor="connection-database"
        validation={
          isSharedTemplate || cloudflareD1.auth?.authenticated
            ? validation.database
            : undefined
        }
      >
        {({ controlProps }) =>
          !isSharedTemplate && cloudflareD1.auth?.authenticated ? (
            <div className="tw:grid tw:min-w-0 tw:gap-1.5">
              <SelectInput
                {...controlProps()}
                density="compact"
                value={form.database}
                disabled={!canEditConnection || !form.host}
                required
                onChange={(event) =>
                  cloudflareD1.selectDatabase(event.target.value)
                }
              >
                <option value="">{t("connections.cloudflareD1SelectDatabase")}</option>
                {form.database && !databaseIsDiscovered ? (
                  <option value={form.database}>{form.database}</option>
                ) : null}
                {cloudflareD1.databases.map((database) => (
                  <option key={database.id} value={database.id}>
                    {database.name || database.id}
                  </option>
                ))}
              </SelectInput>
              <ResourceStatus
                pending={cloudflareD1.databasesPending}
                empty={
                  cloudflareD1.databasesLoaded &&
                  cloudflareD1.databases.length === 0
                }
                error={cloudflareD1.databasesError}
                loadingLabel={t("connections.cloudflareD1DatabasesLoading")}
                emptyLabel={t("connections.cloudflareD1NoDatabases")}
                refreshLabel={t("common.refresh")}
                onRefresh={cloudflareD1.refreshDatabases}
              />
            </div>
          ) : (
            <TextInput
              {...controlProps()}
              density="compact"
              value={form.database}
              disabled={!canEditConnection || !isSharedTemplate}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("connections.cloudflareD1ConnectFirst")}
              onChange={(event) => set("database", event.target.value)}
            />
          )
        }
      </PropertyRow>
      {!isSharedTemplate ? (
        <p className="tw:m-0 tw:pl-[112px] tw:text-xs tw:leading-body tw:text-muted-foreground tw:@max-[560px]:pl-0">
          {t("connections.cloudflareD1AccountHint")}
        </p>
      ) : null}
    </section>
  );
}

function ResourceStatus({
  pending,
  empty,
  error,
  loadingLabel,
  emptyLabel,
  refreshLabel,
  onRefresh,
}: {
  pending: boolean;
  empty: boolean;
  error: string | null;
  loadingLabel: string;
  emptyLabel: string;
  refreshLabel: string;
  onRefresh: () => void;
}) {
  if (pending) {
    return <span className="tw:text-xs tw:text-muted-foreground">{loadingLabel}</span>;
  }
  if (error) {
    return (
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <span className="tw:text-xs tw:text-danger" role="alert">{error}</span>
        <Button size="xs" onClick={onRefresh}>{refreshLabel}</Button>
      </div>
    );
  }
  return empty ? (
    <span className="tw:text-xs tw:text-muted-foreground">{emptyLabel}</span>
  ) : null;
}
