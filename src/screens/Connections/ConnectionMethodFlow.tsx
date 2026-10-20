// Hosts the two credential-method flows of a new team connection inside the editor: the
// provider-managed import (account, resource, review) and per-member DopeDB accounts
// (endpoint, administrator credential, scope). The flows' own steps and controllers live
// in workspaceAdmin/providers/databases; this component only provides their scope,
// the provider-account requirement and the way back to the editor's own form.
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "../../design-system/components/Button";
import { InlineNotice, LoadingLabel } from "../../design-system/components/Status";
import { markConnectionEditorReturn } from "../../features/connections/connectionEditorShellBridge";
import type { CredentialMethodState } from "../../features/connections/useConnectionCredentialMethod";
import type { WorkspaceAdminScope } from "../../features/workspaceAdmin/domain";
import { requestWorkspaceAdmin } from "../../features/workspaceAdmin/navigationRequest";
import { invalidateProviderReads } from "../../features/workspaceAdmin/providers/accounts/providerReads";
import AddDirectDatabase from "../../features/workspaceAdmin/providers/databases/AddDirectDatabase";
import AddManagedDatabase from "../../features/workspaceAdmin/providers/databases/AddManagedDatabase";
import { providerInventoryQuery } from "../../features/workspaceAdmin/providers/queries";
import { useI18n } from "../../lib/i18n";
import { ConnectionCredentialMethodRow } from "./ConnectionCredentialMethodRow";

export function ConnectionMethodFlow({
  scope,
  credentialMethod,
  busy,
}: {
  scope: WorkspaceAdminScope;
  credentialMethod: CredentialMethodState;
  busy: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const managed = credentialMethod.method === "providerManaged";
  const inventory = useQuery({ ...providerInventoryQuery(scope), enabled: managed });

  const backToEditor = () => credentialMethod.setMethod("memberAccount");
  // Provider accounts are connected in Workspace management → Providers, which opens
  // over this editor and returns to it with the draft intact.
  const connectAccount = () => {
    markConnectionEditorReturn();
    requestWorkspaceAdmin("workspace-providers");
  };
  const integrations = inventory.data?.integrations ?? [];

  return (
    <div className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-y-auto tw:p-5 tw:[container-type:inline-size]">
      <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[840px] tw:gap-4">
        <ConnectionCredentialMethodRow credentialMethod={credentialMethod} disabled={busy} />
        {managed ? (
          inventory.data ? (
            integrations.some((integration) => integration.status === "active") ? (
              <AddManagedDatabase
                scope={scope}
                providers={inventory.data.providers}
                integrations={integrations}
                onCancel={backToEditor}
                onImported={(database) => void credentialMethod.finish(database)}
                onAlreadyShared={() => void invalidateProviderReads(queryClient, scope)}
                onConnectAccount={connectAccount}
                onBusyChange={credentialMethod.setBusy}
              />
            ) : (
              <div
                data-primary-flow
                className="tw:grid tw:min-w-0 tw:gap-2 tw:rounded-sm tw:border tw:border-border-subtle tw:p-4"
              >
                <strong className="tw:text-ui tw:font-semibold tw:text-foreground">
                  {t("workspaceProviderDatabases.connectFirst")}
                </strong>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t(integrations.length > 0
                    ? "workspaceProviderDatabases.reconnectFirstDescription"
                    : "workspaceProviderDatabases.connectFirstDescription")}
                </p>
                <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
                  <Button size="compact" variant="ghost" onClick={backToEditor}>
                    {t("common.cancel")}
                  </Button>
                  <Button size="compact" variant="primary" autoFocus onClick={connectAccount}>
                    {t("workspaceProviderDatabases.openAccounts")}
                  </Button>
                </div>
              </div>
            )
          ) : inventory.isError ? (
            <InlineNotice
              tone="warning"
              icon="alert"
              action={(
                <Button
                  size="compact"
                  disabled={inventory.isFetching}
                  onClick={() => void inventory.refetch()}
                >
                  {t("workspaceAdmin.retry")}
                </Button>
              )}
            >
              {t("workspaceProviderDatabases.inventoryError")}
            </InlineNotice>
          ) : (
            <span className="tw:py-2 tw:text-sm">
              <LoadingLabel>{t("workspaceProviderDatabases.loading")}</LoadingLabel>
            </span>
          )
        ) : (
          <AddDirectDatabase
            scope={scope}
            onCancel={backToEditor}
            onRegistered={(database) => void credentialMethod.finish(database)}
            onBusyChange={credentialMethod.setBusy}
          />
        )}
      </div>
    </div>
  );
}
