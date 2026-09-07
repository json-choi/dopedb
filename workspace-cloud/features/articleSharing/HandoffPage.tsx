import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authoritativeSession } from "../../lib/authoritative-session";
import { env } from "../../lib/env";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { getWorkspaceLocale } from "../../lib/workspace-locale-server";
import { Brand } from "../../app/components/Brand";
import { LocaleSwitcher } from "../../app/components/LocaleSwitcher";
import { IdentityBody, IdentityCard, IdentityEyebrow, IdentitySecondaryLink, IdentitySingleShell, IdentityTitle } from "../../app/components/Identity";
import { articleSharingCopy } from "./copy";
import { inspectArticleInvitation } from "./acceptance";
import { articlePath, loadArticleSharing, type SharingScope } from "./store";
import { InvitationAcceptButton } from "./InvitationAcceptButton";

export async function HandoffPage({ invitationId, scope }: { invitationId?: string; scope?: SharingScope }) {
  const locale = await getWorkspaceLocale();
  const copy = articleSharingCopy[locale];
  const path = invitationId ? `/article-invitations/${invitationId}` : articlePath(scope!);
  const signInPath = localizedWorkspacePath(`/auth/sign-in?returnTo=${encodeURIComponent(localizedWorkspacePath(path, locale))}`, locale);
  const session = await authoritativeSession(new Request(`${env.appOrigin()}${path}`, { headers: await headers() }));
  if (!session) redirect(signInPath);
  const identity = { userId: session.user.id, sessionId: session.session.id };
  const resource = invitationId
    ? await inspectArticleInvitation(invitationId, identity)
    : await loadArticleSharing(scope!, identity);
  const targetPath = scope ? articlePath(scope) : resource && "path" in resource ? resource.path : null;
  const desktopUrl = targetPath ? `dopedb://article/${targetPath.replace("/open-article/", "")}` : undefined;
  const accepted = !invitationId || (resource && "accepted" in resource && resource.accepted);
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4"><Brand destination="marketing" /><LocaleSwitcher /></div>
      <div className="tw:m-auto tw:w-[min(620px,100%)] tw:py-8">
        <IdentityCard>
          <IdentityEyebrow>{invitationId ? copy.invitation : copy.open}</IdentityEyebrow>
          <IdentityTitle>{resource?.title ?? copy.unavailable}</IdentityTitle>
          <IdentityBody>{copy.email}: {session.user.email}</IdentityBody>
          {resource ? <>
            <div className="tw:grid tw:gap-1 tw:rounded-control tw:border tw:border-border tw:bg-surface-raised tw:p-4 tw:text-sm">
              <strong>{resource.workspaceName}</strong><span className="tw:text-muted-foreground">{resource.connectionName}</span>
            </div>
            {accepted ? <>
              <IdentityBody>{copy.steps}</IdentityBody>
              <IdentitySecondaryLink href={`https://dopedb.dev${locale === "ko" ? "/ko" : ""}#download`} target="_blank" rel="noopener noreferrer">{copy.download}</IdentitySecondaryLink>
              <IdentitySecondaryLink href={desktopUrl}>{copy.desktop}</IdentitySecondaryLink>
              <IdentityBody>{copy.manual}</IdentityBody>
              {resource.credentialMode !== "managed" ? <IdentityBody>{copy.local}</IdentityBody> : null}
            </> : <>
              <IdentityBody>{copy.scope}</IdentityBody>
              <IdentityBody>{resource.credentialMode === "managed" ? copy.managed : copy.local}</IdentityBody>
              <InvitationAcceptButton id={invitationId!} destination={"path" in resource ? resource.path : path} />
            </>}
          </> : <IdentityBody>{copy.unavailableBody}</IdentityBody>}
          <IdentitySecondaryLink href={signInPath}>{copy.account}</IdentitySecondaryLink>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
