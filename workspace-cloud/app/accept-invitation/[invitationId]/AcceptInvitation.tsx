// Verified invitation acceptance with a multi-account escape hatch. Users can switch
// to an already signed-in identity or add the Google account that received the invite.
"use client";

import { useState } from "react";
import {
  IdentityAccountChoice,
  IdentityError,
  IdentityPrimaryButton,
  IdentitySecondaryLink,
} from "../../../../src/design-system/components/WorkspaceIdentity";
import { authClient } from "../../../lib/auth-client";
import { useDeviceAccounts } from "../../../lib/useDeviceAccounts";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { localizedProviderMessage } from "../../../lib/workspace-provider-copy";
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
  const [error, setError] = useState("");
  const { accounts, error: accountError } = useDeviceAccounts();

  async function accept() {
    setPending(true);
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setPending(false);
      setError(result.error.message
        ? localizedProviderMessage(result.error.message, locale, copy.acceptError)
        : copy.acceptError);
      return;
    }
    window.location.assign(localizedWorkspacePath("/settings", locale));
  }

  async function switchAccount(sessionToken: string) {
    setPending(true);
    const result = await authClient.multiSession.setActive({ sessionToken });
    if (result.error) {
      setPending(false);
      setError(result.error.message
        ? localizedProviderMessage(result.error.message, locale, copy.switchError)
        : copy.switchError);
      return;
    }
    window.location.reload();
  }

  return (
    <>
      <IdentityPrimaryButton onClick={accept} disabled={pending}>
        {pending ? copy.accepting : copy.accept}
        <span>→</span>
      </IdentityPrimaryButton>
      {accounts.length > 1 ? (
        <div className="tw:mt-4 tw:grid tw:border-t tw:border-border">
          <small className="tw:px-0 tw:pt-3 tw:pb-2 tw:text-2xs tw:text-muted-foreground">
            {copy.otherAccountQuestion}
          </small>
          {accounts.filter((account) => account.user.id !== currentUserId).map((account) => (
            <IdentityAccountChoice
              key={account.user.id}
              name={account.user.name}
              email={account.user.email}
              onClick={() =>
                void switchAccount(account.sessions[0].session.token)
              }
              disabled={pending}
            />
          ))}
        </div>
      ) : null}
      <IdentitySecondaryLink
        href={localizedWorkspacePath(
          `/auth/sign-in?returnTo=${encodeURIComponent(localizedWorkspacePath(`/accept-invitation/${invitationId}`, locale))}`,
          locale,
        )}
      >
        {copy.addAccount}
      </IdentitySecondaryLink>
      {error ? <IdentityError>{error}</IdentityError> : null}
      {!error && accountError ? (
        <IdentityError>{accountError}</IdentityError>
      ) : null}
    </>
  );
}
