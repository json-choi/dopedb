"use client";

import { useEffect, useState } from "react";
import { ControlButton, ControlLink } from "../components/Controls";
import { NeonBranchManager } from "../../features/providerAccess/NeonBranchManager";
import { ProviderResourcePicker } from "../../features/providerAccess/ProviderResourcePicker";
import { useSharedDatabaseAccess } from "../../features/providerAccess/useSharedDatabaseAccess";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";

export function SharedDatabasePanel({
  workspaceId,
  initialIntegrationId = null,
  initialConnectionId = null,
}: {
  workspaceId: string;
  initialIntegrationId?: string | null;
  initialConnectionId?: string | null;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].sharedDatabases;
  const reconnectMessages = [
    workspaceMessages.en.providerAccess.gcpSessionExpired,
    workspaceMessages.ko.providerAccess.gcpSessionExpired,
  ];
  const controller = useSharedDatabaseAccess(workspaceId, initialIntegrationId);
  const [adding, setAdding] = useState(Boolean(initialIntegrationId));
  const managedByConnection = new Map(
    controller.managedConnections.map((item) => [item.connectionId, item]),
  );

  useEffect(() => {
    if (controller.loading || !initialConnectionId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`database-${initialConnectionId}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [controller.connections, controller.loading, initialConnectionId]);

  return (
    <section className="tw:grid tw:gap-5 tw:p-6 tw:max-[640px]:p-4">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-4 tw:max-[640px]:grid">
        <div className="tw:grid tw:gap-1">
          <strong className="tw:text-sm tw:text-foreground">
            {copy.title}
          </strong>
          <small className="tw:max-w-[44rem] tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.description}
          </small>
        </div>
        <ControlButton
          tone={adding ? "neutral" : "primary"}
          onClick={() => setAdding((current) => !current)}
          disabled={controller.loading}
        >
          {adding ? copy.closeAdd : copy.add}
        </ControlButton>
      </header>

      {adding ? (
        controller.integrations.length > 0 ? (
          <ProviderResourcePicker controller={controller} />
        ) : (
          <div className="tw:grid tw:gap-3 tw:border-y tw:border-border tw:py-5">
            <strong className="tw:text-xs tw:text-foreground">
              {copy.connectFirst}
            </strong>
            <p className="tw:m-0 tw:max-w-[42rem] tw:text-2xs tw:leading-body tw:text-muted-foreground">
              {copy.connectFirstDescription}
            </p>
            <div>
              <ControlLink
                href={localizedWorkspacePath(
                  `/settings?workspace=${encodeURIComponent(workspaceId)}&section=cloud-accounts`,
                  locale,
                )}
                data-tone="primary"
              >
                {copy.connectCloud}
              </ControlLink>
            </div>
          </div>
        )
      ) : null}

      {!controller.loading ? (
        <NeonBranchManager
          workspaceId={workspaceId}
          integrations={controller.integrations}
          managedConnections={controller.managedConnections}
        />
      ) : null}

      {controller.loading ? (
        <p className="tw:m-0 tw:border-y tw:border-border tw:py-5 tw:text-2xs tw:text-muted-foreground">
          {copy.loading}
        </p>
      ) : (
        <div className="tw:-mx-3 tw:grid tw:border-t tw:border-border">
          {controller.connections.map((connection) => {
            const managed = managedByConnection.get(connection.id);
            const focused = connection.id === initialConnectionId;
            const provider = controller.providers.find(
              (item) => item.id === managed?.provider,
            );
            const target = managed && provider
              ? provider.resourceLevels
                .map((level) => managed.resource[level.key])
                .filter(Boolean)
                .join(" / ")
              : "";
            return (
              <article
                className="tw:grid tw:min-h-[72px] tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-x-4 tw:gap-y-3 tw:border-b tw:border-border tw:px-3 tw:py-3 tw:outline-none tw:data-[focused=true]:bg-selection tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:max-[640px]:grid-cols-1"
                data-focused={focused}
                id={`database-${connection.id}`}
                key={connection.id}
                tabIndex={focused ? -1 : undefined}
              >
                <div className="tw:grid tw:min-w-0 tw:gap-1">
                  <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                    <strong className="tw:text-sm tw:text-foreground">
                      {connection.name}
                    </strong>
                    <span className="tw:border tw:border-border tw:bg-surface-inset tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground">
                      {connection.engine}
                    </span>
                  </span>
                  <small className="tw:truncate tw:text-2xs tw:leading-body tw:text-muted-foreground tw:max-[640px]:whitespace-normal">
                    {managed && provider
                      ? `${provider.name} · ${target}`
                      : copy.memberLocalDescription}
                  </small>
                </div>
                <div className="tw:grid tw:justify-items-end tw:gap-1 tw:max-[640px]:justify-items-start">
                  <strong className="tw:font-mono tw:text-2xs tw:uppercase tw:text-primary">
                    {connection.credentialMode === "managed"
                      ? copy.managedMode
                      : copy.localMode}
                  </strong>
                  <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[640px]:justify-start">
                    {managed ? (
                      <a
                        className="tw:text-2xs tw:text-muted-foreground tw:hover:text-foreground"
                        href={localizedWorkspacePath(
                          `/settings?workspace=${encodeURIComponent(workspaceId)}&section=cloud-accounts`,
                          locale,
                        )}
                      >
                        {copy.manageProvider}
                      </a>
                    ) : null}
                    <a
                      className="tw:text-2xs tw:text-muted-foreground tw:hover:text-foreground"
                      href={localizedWorkspacePath(
                        `/settings?workspace=${encodeURIComponent(workspaceId)}&section=database-access`,
                        locale,
                      )}
                    >
                      {copy.manageAccess}
                    </a>
                    {connection.accessMode === "manage" ? (
                      <ControlButton
                        tone="danger"
                        onClick={() => void controller.deleteSharedConnection(connection)}
                        disabled={Boolean(controller.mutation)}
                      >
                        {controller.mutation === `delete-connection:${connection.id}`
                          ? copy.removing
                          : copy.remove}
                      </ControlButton>
                    ) : null}
                  </span>
                </div>
                {focused && managed ? (
                  <div className="tw:col-span-full tw:grid tw:justify-items-start tw:gap-2 tw:border-t tw:border-border tw:pt-3 tw:max-[640px]:col-span-1">
                    <small
                      className="tw:max-w-[48rem] tw:text-2xs tw:leading-body tw:text-foreground"
                      role="status"
                    >
                      {copy.desktopRecovery}
                    </small>
                    {managed.provider === "gcpCloudSql"
                    && connection.accessMode === "manage" ? (
                      <>
                        <small className="tw:max-w-[48rem] tw:text-2xs tw:leading-body tw:text-muted-foreground">
                          {copy.repairDescription}
                        </small>
                        <ControlButton
                          onClick={() => void controller.repairManagedConnection(managed)}
                          disabled={Boolean(controller.mutation)}
                        >
                          {controller.mutation === `repair:${connection.id}`
                            ? copy.repairingManaged
                            : copy.repairManaged}
                        </ControlButton>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {controller.connections.length === 0 ? (
            <div className="tw:border-b tw:border-border tw:py-10 tw:text-center">
              <strong className="tw:block tw:text-xs tw:text-foreground">
                {copy.emptyTitle}
              </strong>
              <small className="tw:mt-1 tw:block tw:text-2xs tw:text-muted-foreground">
                {copy.emptyDescription}
              </small>
            </div>
          ) : null}
        </div>
      )}

      {controller.error ? (
        <div
          className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-3 tw:py-2 tw:max-[640px]:grid"
          role="alert"
        >
          <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-danger">
            {controller.error}
          </p>
          {reconnectMessages.some((message) => controller.error.includes(message))
          || /reconnect/i.test(controller.error) ? (
            <ControlLink
              href={localizedWorkspacePath(
                `/settings?workspace=${encodeURIComponent(workspaceId)}&section=cloud-accounts`,
                locale,
              )}
            >
              {copy.goToCloud}
            </ControlLink>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
