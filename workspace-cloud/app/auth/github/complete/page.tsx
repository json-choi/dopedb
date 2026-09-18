import { Brand } from "../../../components/Brand";
import { LocaleSwitcher } from "../../../components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../../../src/design-system/components/WorkspaceIdentity";
import { getWorkspaceLocale } from "../../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../../lib/workspace-messages";

export default async function GithubInstallationCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const connected = (await searchParams).status === "connected";
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].githubInstallation;
  const status = connected ? "connected" : "failed";
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(540px,100%)]">
        <IdentityCard>
          <div
            data-status={status}
            className="tw:mb-9 tw:grid tw:size-[54px] tw:place-items-center tw:rounded-surface tw:text-[23px] tw:text-[var(--ds-text-inverse)] tw:data-[status=connected]:bg-success tw:data-[status=failed]:bg-danger"
          >
            {connected ? "✓" : "×"}
          </div>
          <IdentityEyebrow>
            {connected ? copy.connectedEyebrow : copy.failedEyebrow}
          </IdentityEyebrow>
          <IdentityTitle>
            {connected ? copy.connectedTitle : copy.failedTitle}
          </IdentityTitle>
          <IdentityBody>
            {connected ? copy.connectedBody : copy.failedBody}
          </IdentityBody>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
