// Token-free landing page after a Desktop-started provider authorization. It
// reports only the provider and outcome; DopeDB Desktop re-reads integrations and
// continues any setup natively when the user returns to the app.
import { CompletionCard } from "../../../components/IdentityPage";
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
    <CompletionCard
      succeeded={succeeded}
      eyebrow={succeeded ? copy.succeededEyebrow : copy.failedEyebrow}
      title={title}
      body={body}
      openAppLabel={copy.openApp}
    />
  );
}
