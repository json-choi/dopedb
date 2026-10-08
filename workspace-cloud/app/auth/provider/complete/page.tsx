// Token-free landing page after a Desktop-started provider authorization. It
// reports only the provider and outcome; DopeDB Desktop re-reads integrations and
// continues any setup natively when the user returns to the app.
import { Brand } from "../../../components/Brand";
import { LocaleSwitcher } from "../../../components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySecondaryLink,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../../../src/design-system/components/WorkspaceIdentity";
import { desktopWorkspaceAccessCallbackUrl } from "../../../../lib/desktop-deep-link";
import { getWorkspaceLocale } from "../../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../../lib/workspace-messages";

export default async function ProviderAuthorizationCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].providerAuthorization;
  const provider = params.provider === "gcpCloudSql" ? "gcpCloudSql" : "planetScale";
  const succeeded = provider === "gcpCloudSql"
    ? params.status === "authorised"
    : params.status === "connected";
  const status = succeeded ? "connected" : "failed";
  const title = !succeeded
    ? copy.failedTitle
    : provider === "gcpCloudSql"
      ? copy.gcpAuthorisedTitle
      : copy.planetScaleConnectedTitle;
  const body = !succeeded
    ? copy.failedBody
    : provider === "gcpCloudSql"
      ? copy.gcpAuthorisedBody
      : copy.planetScaleConnectedBody;
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
            {succeeded ? "✓" : "×"}
          </div>
          <IdentityEyebrow>
            {succeeded ? copy.succeededEyebrow : copy.failedEyebrow}
          </IdentityEyebrow>
          <IdentityTitle>{title}</IdentityTitle>
          <IdentityBody>{body}</IdentityBody>
          <IdentitySecondaryLink href={desktopWorkspaceAccessCallbackUrl}>
            {copy.openApp}
          </IdentitySecondaryLink>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
