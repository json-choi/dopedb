// Account selector for Desktop approval. It prevents “add account” from
// silently re-authorizing whichever browser identity happened to be active.
"use client";

import { useState } from "react";
import { IdentityAccountChoice } from "../../components/Identity";
import { authClient } from "../../../lib/auth-client";
import { useDeviceAccounts } from "../../../lib/useDeviceAccounts";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { localizedProviderMessage } from "../../../lib/workspace-provider-copy";
import { useWorkspaceLocale } from "../../components/WorkspaceLocale";

export function DesktopAccountActions({
  currentUserId,
  returnPath,
}: {
  currentUserId: string;
  returnPath: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].desktopLogin;
  const { accounts, error: accountError } = useDeviceAccounts();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const returnTo = localizedWorkspacePath(
    returnPath,
    locale,
  );

  async function switchAccount(sessionToken: string) {
    setPending(true);
    setError("");
    const result = await authClient.multiSession.setActive({ sessionToken });
    if (result.error) {
      setPending(false);
      setError(result.error.message
        ? localizedProviderMessage(result.error.message, locale, copy.switchError)
        : copy.switchError);
      return;
    }
    location.assign(returnTo);
  }

  return (
    <div className="tw:mt-2 tw:grid tw:border-t tw:border-border">
      {accounts.filter((account) => account.user.id !== currentUserId).map((account) => (
        <IdentityAccountChoice
          key={account.user.id}
          name={account.user.name}
          email={account.user.email}
          onClick={() => void switchAccount(account.sessions[0].session.token)}
          disabled={pending}
        />
      ))}
      <a
        className="tw:flex tw:min-h-control-md tw:items-center tw:border-b tw:border-border tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:bg-surface-raised tw:hover:text-foreground"
        href={localizedWorkspacePath(
          `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
          locale,
        )}
      >
        {copy.otherAccount}
      </a>
      {error ? (
        <small className="tw:mt-2 tw:text-2xs tw:text-danger" role="alert">
          {error}
        </small>
      ) : null}
      {!error && accountError ? (
        <small className="tw:mt-2 tw:text-2xs tw:text-danger" role="alert">
          {accountError}
        </small>
      ) : null}
    </div>
  );
}
