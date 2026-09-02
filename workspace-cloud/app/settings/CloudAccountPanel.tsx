"use client";

import { GcpCloudSetup } from "../../features/providerAccess/GcpCloudSetup";
import { ProviderIntegrationList } from "../../features/providerAccess/ProviderIntegrationList";
import { useProviderAccountAccess } from "../../features/providerAccess/useProviderAccountAccess";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";

export function CloudAccountPanel({
  workspaceId,
  gcpSetupId = null,
}: {
  workspaceId: string;
  gcpSetupId?: string | null;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].cloudAccounts;
  const controller = useProviderAccountAccess(workspaceId, gcpSetupId);
  const configuringGcp = Boolean(controller.gcpSetupId);

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
        <span className="tw:whitespace-nowrap tw:font-mono tw:text-2xs tw:uppercase tw:text-primary">
          {copy.proof}
        </span>
      </header>

      {controller.loading ? (
        <p className="tw:m-0 tw:border-y tw:border-border tw:py-5 tw:text-2xs tw:text-muted-foreground">
          {copy.loading}
        </p>
      ) : configuringGcp ? (
        <GcpCloudSetup controller={controller} />
      ) : (
        <ProviderIntegrationList controller={controller} />
      )}

      {!configuringGcp && controller.error ? (
        <p
          className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-danger"
          role="alert"
        >
          {controller.error}
        </p>
      ) : null}
    </section>
  );
}
