// Verified invitation acceptance. After a successful accept the page shows an
// "Open DopeDB" hand-off to the Desktop app (also as a plain link, since custom-scheme
// links can fail silently) with the download page as the fallback.
"use client";

import { useState } from "react";
import {
  IdentityBody,
  IdentityError,
  IdentityPrimaryButton,
  IdentitySecondaryLink,
} from "../../../../src/design-system/components/WorkspaceIdentity";
import { authClient } from "../../../lib/auth-client";
import { desktopWorkspaceAccessCallbackUrl } from "../../../lib/desktop-deep-link";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { localizedServerMessage } from "../../../lib/workspace-server-message";
import { AccountSwitchBlock } from "../../components/IdentityPage";
import { useWorkspaceLocale } from "../../components/WorkspaceLocale";

export function AcceptInvitation({
  invitationId,
  currentUserId,
}: {
  invitationId: string;
  currentUserId: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].invitation;
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setPending(true);
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setPending(false);
      setError(result.error.message
        ? localizedServerMessage(result.error.message, locale, copy.acceptError)
        : copy.acceptError);
      return;
    }
    setAccepted(true);
  }

  if (accepted) {
    return (
      <>
        <IdentityBody>{copy.acceptedBody}</IdentityBody>
        <IdentitySecondaryLink href={desktopWorkspaceAccessCallbackUrl}>
          {copy.openApp}
        </IdentitySecondaryLink>
        <IdentityBody>
          {copy.openAppLinkHint}{" "}
          <a className="tw:break-all tw:underline" href={desktopWorkspaceAccessCallbackUrl}>
            {desktopWorkspaceAccessCallbackUrl}
          </a>
        </IdentityBody>
        <IdentitySecondaryLink
          href={`https://dopedb.dev${locale === "ko" ? "/ko" : ""}#download`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.download}
        </IdentitySecondaryLink>
      </>
    );
  }

  return (
    <>
      <IdentityPrimaryButton onClick={accept} disabled={pending}>
        {pending ? copy.accepting : copy.accept}
        <span>→</span>
      </IdentityPrimaryButton>
      <AccountSwitchBlock
        currentUserId={currentUserId}
        returnTo={`/accept-invitation/${invitationId}`}
      />
      {error ? <IdentityError>{error}</IdentityError> : null}
    </>
  );
}
