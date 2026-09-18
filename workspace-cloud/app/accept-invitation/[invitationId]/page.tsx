import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "../../../lib/auth";
import { isUuid } from "../../../lib/http";
import { Brand } from "../../components/Brand";
import { LocaleSwitcher } from "../../components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../../src/design-system/components/WorkspaceIdentity";
import { AcceptInvitation } from "./AcceptInvitation";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { getWorkspaceLocale } from "../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../lib/workspace-messages";

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].invitation;
  if (!isUuid(invitationId)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const returnTo = localizedWorkspacePath(`/accept-invitation/${invitationId}`, locale);
    redirect(localizedWorkspacePath(
      `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
      locale,
    ));
  }
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(540px,100%)]">
        <IdentityCard>
          <IdentityEyebrow>{copy.eyebrow}</IdentityEyebrow>
          <IdentityTitle>{copy.title}</IdentityTitle>
          <IdentityBody>
            {copy.descriptionBeforeEmail}{copy.descriptionBeforeEmail ? " " : ""}
            {session.user.email}{copy.descriptionAfterEmail}
          </IdentityBody>
          <AcceptInvitation
            invitationId={invitationId}
            currentUserId={session.user.id}
          />
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
