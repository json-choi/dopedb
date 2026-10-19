import { CompletionCard } from "../../../components/IdentityPage";
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
  return (
    <CompletionCard
      succeeded={connected}
      eyebrow={connected ? copy.connectedEyebrow : copy.failedEyebrow}
      title={connected ? copy.connectedTitle : copy.failedTitle}
      body={connected ? copy.connectedBody : copy.failedBody}
      openAppLabel={copy.openApp}
    />
  );
}
