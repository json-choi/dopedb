// Shared frame of the hosted identity pages: brand and locale header over one centered
// card (`IdentityPage`), the token-free outcome card shown after a browser step the
// Desktop app started (`CompletionCard`), and the multi-account escape hatch of the
// invitation pages (`AccountSwitchBlock`).
"use client";

import { useState, type ReactNode } from "react";
import {
  IdentityAccountChoice,
  IdentityBody,
  IdentityCard,
  IdentityError,
  IdentityEyebrow,
  IdentitySecondaryLink,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../src/design-system/components/WorkspaceIdentity";
import { authClient } from "../../lib/auth-client";
import { desktopWorkspaceAccessCallbackUrl } from "../../lib/desktop-deep-link";
import { useDeviceAccounts } from "../../lib/useDeviceAccounts";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { localizedServerMessage } from "../../lib/workspace-server-message";
import { Brand } from "./Brand";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { useWorkspaceLocale } from "./WorkspaceLocale";

export function IdentityPage({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand />
        <LocaleSwitcher />
      </div>
      <div
        className={wide
          ? "tw:m-auto tw:w-[min(620px,100%)] tw:py-8"
          : "tw:m-auto tw:w-[min(540px,100%)]"}
      >
        <IdentityCard>{children}</IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}

export function CompletionCard({
  succeeded,
  eyebrow,
  title,
  body,
  openAppLabel,
}: {
  succeeded: boolean;
  eyebrow: string;
  title: string;
  body: string;
  openAppLabel: string;
}) {
  return (
    <IdentityPage>
      <div
        data-status={succeeded ? "connected" : "failed"}
        className="tw:mb-9 tw:grid tw:size-[54px] tw:place-items-center tw:rounded-surface tw:text-[23px] tw:text-[var(--ds-text-inverse)] tw:data-[status=connected]:bg-success tw:data-[status=failed]:bg-danger"
      >
        {succeeded ? "✓" : "×"}
      </div>
      <IdentityEyebrow>{eyebrow}</IdentityEyebrow>
      <IdentityTitle>{title}</IdentityTitle>
      <IdentityBody>{body}</IdentityBody>
      <IdentitySecondaryLink href={desktopWorkspaceAccessCallbackUrl}>
        {openAppLabel}
      </IdentitySecondaryLink>
    </IdentityPage>
  );
}

export function AccountSwitchBlock({
  currentUserId,
  returnTo,
}: {
  currentUserId: string;
  /** Unlocalized path of the page to come back to after signing in. */
  returnTo: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].invitation;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { accounts, error: accountError } = useDeviceAccounts();

  async function switchAccount(sessionToken: string) {
    setPending(true);
    const result = await authClient.multiSession.setActive({ sessionToken });
    if (result.error) {
      setPending(false);
      setError(result.error.message
        ? localizedServerMessage(result.error.message, locale, copy.switchError)
        : copy.switchError);
      return;
    }
    window.location.reload();
  }

  return (
    <>
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
              onClick={() => void switchAccount(account.sessions[0].session.token)}
              disabled={pending}
            />
          ))}
        </div>
      ) : null}
      <IdentitySecondaryLink
        href={localizedWorkspacePath(
          `/auth/sign-in?returnTo=${encodeURIComponent(localizedWorkspacePath(returnTo, locale))}`,
          locale,
        )}
      >
        {copy.addAccount}
      </IdentitySecondaryLink>
      {error ? <IdentityError>{error}</IdentityError> : null}
      {!error && accountError ? <IdentityError>{accountError}</IdentityError> : null}
    </>
  );
}
