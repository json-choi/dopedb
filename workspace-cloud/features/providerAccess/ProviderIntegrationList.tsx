"use client";

// Provider integration list owns setup and removal controls for cloud accounts
// and allowlisted dynamic-credential brokers; its controller owns their state.

import {
  ControlButton,
  ControlField,
  ControlInput,
  ControlLink,
  ControlSelect,
} from "../../app/components/Controls";
import type { ProviderAccountAccessController } from "./useProviderAccountAccess";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { localizedIntegrationDisplayName } from "../../lib/workspace-provider-copy";

export function ProviderIntegrationList({
  controller,
}: {
  controller: ProviderAccountAccessController;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].providerList;
  const common = workspaceMessages[locale].common;
  const {
    providers,
    integrations,
    managedConnections,
    managedConnectionsLoaded,
    setupProvider,
    neonConfiguration,
    vaultConfiguration,
    mutation,
    beginConnect,
    beginReconnect,
    connect,
    disconnect,
    setNeonConfiguration,
    setVaultConfiguration,
  } = controller;
  return (
    <div className="tw:grid tw:content-start tw:gap-7">
      <section className="tw:grid tw:gap-2">
        <div className="tw:grid tw:gap-1">
          <strong className="tw:text-xs tw:text-foreground">
            {copy.connectedTitle}
          </strong>
          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.connectedDescription}
          </small>
        </div>
        <div className="tw:grid tw:border-t tw:border-border">
          {integrations.map((integration) => {
            const provider = providers.find(
              (item) => item.id === integration.provider,
            );
            const databaseCount = managedConnections.filter(
              (item) => item.integrationId === integration.id,
            ).length;
            return (
              <article
                className="tw:grid tw:min-h-[72px] tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:border-b tw:border-border tw:py-3 tw:max-[640px]:grid-cols-1"
                key={integration.id}
              >
                <div className="tw:grid tw:min-w-0 tw:gap-1">
                  <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                    <strong className="tw:text-sm tw:text-foreground">
                      {localizedIntegrationDisplayName(
                        integration.displayName,
                        locale,
                      )}
                    </strong>
                    <span
                      className="tw:font-mono tw:text-2xs tw:uppercase tw:data-[status=active]:text-success tw:data-[status=reconnect_required]:text-danger"
                      data-status={integration.status}
                    >
                      {integration.status === "active"
                        ? copy.active
                        : common.reconnectRequired}
                    </span>
                  </span>
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {managedConnectionsLoaded
                      ? locale === "ko"
                        ? `${copy.databases} ${databaseCount}${common.countSuffix}`
                        : `${databaseCount} ${copy.databases}`
                      : copy.databasesUnavailable}
                    {" · "}{copy.lastChecked}{" "}
                    {new Date(integration.updatedAt).toLocaleString(
                      locale === "ko" ? "ko-KR" : "en-US",
                    )}
                  </small>
                  {integration.provider === "neon"
                    && integration.grantedScope?.includes(":personal:broad:") ? (
                      <small className="tw:text-2xs tw:leading-body tw:text-danger">
                        {copy.broadKeyWarning}
                      </small>
                    ) : null}
                </div>
                <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:max-[640px]:justify-start">
                  {provider ? (
                    <ControlButton
                      disabled={!provider.configured || mutation !== ""}
                      onClick={() => beginReconnect(integration)}
                    >
                      {copy.reconnect}
                    </ControlButton>
                  ) : null}
                  <ControlButton
                    tone="danger"
                    disabled={mutation !== ""}
                    onClick={() => void disconnect(integration)}
                  >
                    {copy.disconnect}
                  </ControlButton>
                </div>
              </article>
            );
          })}
          {integrations.length === 0 ? (
            <p className="tw:m-0 tw:border-b tw:border-border tw:py-6 tw:text-2xs tw:text-muted-foreground">
              {copy.empty}
            </p>
          ) : null}
        </div>
      </section>

      <section className="tw:grid tw:gap-2">
        <div className="tw:grid tw:gap-1">
          <strong className="tw:text-xs tw:text-foreground">
            {copy.connectTitle}
          </strong>
          <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.connectDescription}
          </small>
        </div>
        <div className="tw:grid tw:border-t tw:border-border">
          {providers.map((provider) => {
            const connectedCount = integrations.filter(
              (item) => item.provider === provider.id,
            ).length;
            return (
              <div
                className="tw:grid tw:min-h-[78px] tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:border-b tw:border-border tw:py-3 tw:max-[640px]:grid-cols-1"
                key={provider.id}
              >
                <div className="tw:grid tw:gap-1">
                  <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                    <strong className="tw:text-sm tw:text-foreground">
                      {provider.name}
                    </strong>
                    {provider.supportedEngines.map((engine) => (
                      <span
                        className="tw:border tw:border-border tw:bg-surface-inset tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground"
                        key={engine}
                      >
                        {engine}
                      </span>
                    ))}
                  </span>
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {copy.notes[provider.id as keyof typeof copy.notes] ?? provider.note}
                  </small>
                </div>
                <div className="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:max-[640px]:justify-start">
                  {connectedCount > 0 ? (
                    <span className="tw:font-mono tw:text-2xs tw:uppercase tw:text-primary">
                      {locale === "ko"
                        ? `${connectedCount}${common.countSuffix} ${copy.connected}`
                        : `${connectedCount} ${copy.connected}`}
                    </span>
                  ) : null}
                  <ControlButton
                    disabled={!provider.configured || mutation !== ""}
                    onClick={() => beginConnect(provider)}
                  >
                    {provider.configured
                      ? connectedCount > 0
                        ? copy.addAccount
                        : copy.connectAccount
                      : copy.serverSetup}
                  </ControlButton>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {setupProvider?.id === "neon" ? (
        <form
          className="tw:grid tw:grid-cols-1 tw:items-end tw:gap-3 tw:border-y tw:border-border tw:py-4 tw:lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void connect(setupProvider, neonConfiguration);
          }}
        >
          <p className="tw:col-span-full tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.neonDescriptionBeforeLink} {copy.neonDescriptionLink}
            {copy.neonDescriptionAfterLink}
          </p>
          <aside className="tw:col-span-full tw:grid tw:gap-3 tw:rounded-control tw:border tw:border-border tw:bg-surface-inset tw:p-3.5">
            <div className="tw:flex tw:flex-col tw:items-start tw:justify-between tw:gap-3 tw:sm:flex-row tw:sm:items-center">
              <div className="tw:grid tw:gap-1">
                <strong className="tw:text-xs tw:text-foreground">
                  {copy.neonGuide.title}
                </strong>
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.neonGuide.description}
                </small>
              </div>
              <ControlLink
                href="https://neon.com/docs/manage/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                {copy.neonGuide.openDocs}
              </ControlLink>
            </div>
            <ol className="tw:m-0 tw:grid tw:list-none tw:grid-cols-1 tw:gap-2 tw:p-0 tw:md:grid-cols-3">
              {[
                {
                  number: copy.neonGuide.firstNumber,
                  title: copy.neonGuide.firstTitle,
                  path: copy.neonGuide.firstPath,
                  body: copy.neonGuide.firstBody,
                },
                {
                  number: copy.neonGuide.secondNumber,
                  title: copy.neonGuide.secondTitle,
                  path: copy.neonGuide.secondPath,
                  body: copy.neonGuide.secondBody,
                },
                {
                  number: copy.neonGuide.thirdNumber,
                  title: copy.neonGuide.thirdTitle,
                  path: copy.neonGuide.thirdPath,
                  body: copy.neonGuide.thirdBody,
                },
              ].map((step) => (
                <li
                  key={step.number}
                  className="tw:grid tw:content-start tw:gap-2 tw:rounded-control tw:border tw:border-border tw:bg-surface tw:p-3"
                >
                  <span className="tw:font-mono tw:text-2xs tw:font-semibold tw:text-primary">
                    {step.number}
                  </span>
                  <strong className="tw:text-xs tw:text-foreground">
                    {step.title}
                  </strong>
                  <code className="tw:w-fit tw:max-w-full tw:overflow-x-auto tw:rounded-control tw:bg-surface-inset tw:px-2 tw:py-1 tw:text-2xs tw:text-foreground">
                    {step.path}
                  </code>
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {step.body}
                  </small>
                </li>
              ))}
            </ol>
            <div className="tw:flex tw:flex-col tw:gap-1 tw:border-t tw:border-border tw:pt-3 tw:sm:flex-row tw:sm:items-center tw:sm:gap-3">
              <strong className="tw:text-2xs tw:text-foreground">
                {copy.neonGuide.personalTitle}
              </strong>
              <code className="tw:w-fit tw:max-w-full tw:overflow-x-auto tw:rounded-control tw:bg-surface tw:px-2 tw:py-1 tw:text-2xs tw:text-foreground">
                {copy.neonGuide.personalPath}
              </code>
              <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {copy.neonGuide.personalBody}
              </small>
            </div>
            <p className="tw:m-0 tw:text-2xs tw:font-medium tw:leading-body tw:text-warning">
              {copy.neonGuide.caution}
            </p>
          </aside>
          <ControlField label={copy.neonApiKey}>
            <ControlInput
              type="password"
              autoComplete="off"
              value={neonConfiguration.apiKey}
              onChange={(event) =>
                setNeonConfiguration({
                  ...neonConfiguration,
                  apiKey: event.target.value,
                })
              }
              placeholder={copy.neonApiKeyPlaceholder}
              required
            />
          </ControlField>
          <ControlField label={copy.projectId}>
            <ControlInput
              value={neonConfiguration.projectId}
              onChange={(event) =>
                setNeonConfiguration({
                  ...neonConfiguration,
                  projectId: event.target.value,
                })
              }
              placeholder={copy.projectIdPlaceholder}
            />
          </ControlField>
          <ControlField label={copy.organizationId}>
            <ControlInput
              value={neonConfiguration.organizationId}
              onChange={(event) =>
                setNeonConfiguration({
                  ...neonConfiguration,
                  organizationId: event.target.value,
                })
              }
              placeholder="org-..."
            />
          </ControlField>
          <div className="tw:col-span-full tw:flex tw:justify-end">
            <ControlButton
              type="submit"
              tone="primary"
              size="field"
              disabled={mutation !== ""}
            >
              {copy.verifyConnect}
            </ControlButton>
          </div>
        </form>
      ) : null}

      {setupProvider?.id === "vault" ? (
        <form
          className="tw:grid tw:grid-cols-1 tw:items-end tw:gap-3 tw:border-y tw:border-border tw:py-4 tw:md:grid-cols-2 tw:xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void connect(setupProvider);
          }}
        >
          <aside className="tw:col-span-full tw:grid tw:gap-2 tw:rounded-control tw:border tw:border-border tw:bg-surface-inset tw:p-3.5">
            <div className="tw:flex tw:flex-col tw:items-start tw:justify-between tw:gap-3 tw:sm:flex-row tw:sm:items-center">
              <div className="tw:grid tw:gap-1">
                <strong className="tw:text-xs tw:text-foreground">
                  {copy.vaultGuide.title}
                </strong>
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.vaultGuide.description}
                </small>
              </div>
              <ControlLink
                href="https://developer.hashicorp.com/vault/docs/secrets/databases"
                target="_blank"
                rel="noreferrer"
              >
                {copy.vaultGuide.openDocs}
              </ControlLink>
            </div>
            <p className="tw:m-0 tw:text-2xs tw:font-medium tw:leading-body tw:text-warning">
              {copy.vaultGuide.caution}
            </p>
          </aside>

          <ControlField label={copy.vaultAddress}>
            <ControlInput
              type="url"
              value={vaultConfiguration.address}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                address: event.target.value,
              })}
              placeholder="https://vault.example.com"
              required
            />
          </ControlField>
          <ControlField label={copy.vaultNamespace}>
            <ControlInput
              value={vaultConfiguration.namespace}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                namespace: event.target.value,
              })}
              placeholder={copy.vaultOptional}
            />
          </ControlField>
          <ControlField label={copy.vaultAuthMount}>
            <ControlInput
              value={vaultConfiguration.authMount}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                authMount: event.target.value,
              })}
              required
            />
          </ControlField>
          <ControlField label={copy.vaultDatabaseMount}>
            <ControlInput
              value={vaultConfiguration.databaseMount}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                databaseMount: event.target.value,
              })}
              required
            />
          </ControlField>
          <ControlField label={copy.vaultDatabaseConnection}>
            <ControlInput
              value={vaultConfiguration.databaseConnection}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                databaseConnection: event.target.value,
              })}
              placeholder="dopedb-postgres"
              required
            />
          </ControlField>

          <ControlField label={copy.vaultRoleId}>
            <ControlInput
              type="password"
              autoComplete="off"
              value={vaultConfiguration.roleId}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                roleId: event.target.value,
              })}
              required
            />
          </ControlField>
          <ControlField label={copy.vaultSecretId}>
            <ControlInput
              type="password"
              autoComplete="off"
              value={vaultConfiguration.secretId}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                secretId: event.target.value,
              })}
              required
            />
          </ControlField>
          <ControlField label={copy.vaultReadRole}>
            <ControlInput
              value={vaultConfiguration.readRole}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                readRole: event.target.value,
              })}
              placeholder="dopedb-read"
              required
            />
          </ControlField>
          <ControlField label={copy.vaultWriteRole}>
            <ControlInput
              value={vaultConfiguration.writeRole}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                writeRole: event.target.value,
              })}
              placeholder={copy.vaultOptional}
            />
          </ControlField>

          <div className="tw:col-span-full tw:grid tw:gap-1 tw:border-t tw:border-border tw:pt-3">
            <strong className="tw:text-xs tw:text-foreground">
              {copy.vaultTargetTitle}
            </strong>
            <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {copy.vaultTargetDescription}
            </small>
          </div>
          <ControlField label={copy.vaultEngine}>
            <ControlSelect
              value={vaultConfiguration.engine}
              onChange={(event) => {
                const engine = event.target.value as "postgres" | "mysql";
                const previousDefault = vaultConfiguration.engine === "postgres"
                  ? "5432"
                  : "3306";
                setVaultConfiguration({
                  ...vaultConfiguration,
                  engine,
                  port: vaultConfiguration.port === previousDefault
                    ? engine === "postgres" ? "5432" : "3306"
                    : vaultConfiguration.port,
                });
              }}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </ControlSelect>
          </ControlField>
          <ControlField label={copy.vaultHost}>
            <ControlInput
              value={vaultConfiguration.host}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                host: event.target.value,
              })}
              placeholder="db.internal.example.com"
              required
            />
          </ControlField>
          <ControlField label={copy.vaultPort}>
            <ControlInput
              type="number"
              min={1}
              max={65_535}
              value={vaultConfiguration.port}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                port: event.target.value,
              })}
              required
            />
          </ControlField>
          <ControlField label={copy.vaultDatabase}>
            <ControlInput
              value={vaultConfiguration.database}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                database: event.target.value,
              })}
              required
            />
          </ControlField>

          <label className="tw:col-span-full tw:grid tw:grid-cols-[16px_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border tw:border-border tw:bg-surface tw:p-3">
            <input
              className="tw:mt-0.5 tw:size-4 tw:accent-primary"
              type="checkbox"
              checked={vaultConfiguration.production}
              onChange={(event) => setVaultConfiguration({
                ...vaultConfiguration,
                production: event.target.checked,
              })}
            />
            <span className="tw:grid tw:gap-1 tw:text-xs tw:text-foreground">
              {copy.vaultProduction}
              <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                {copy.vaultProductionDescription}
              </small>
            </span>
          </label>
          <div className="tw:col-span-full tw:flex tw:justify-end">
            <ControlButton
              type="submit"
              tone="primary"
              size="field"
              disabled={mutation !== ""}
            >
              {copy.verifyConnect}
            </ControlButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
