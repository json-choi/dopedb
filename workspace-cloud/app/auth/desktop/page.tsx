// Hosted sign-in and account selection precede one explicit Desktop authorization.
import { headers } from "next/headers";
import { Brand } from "../../components/Brand";
import { LocaleSwitcher } from "../../components/LocaleSwitcher";
import { IdentityBody, IdentityCard, IdentityError, IdentitySingleShell, IdentityTitle } from "../../components/Identity";
import { auth } from "../../../lib/auth";
import { env } from "../../../lib/env";
import { createDesktopApprovalNonce, desktopAuthorizationQuery, parseDesktopAuthorization } from "../../../lib/desktop-authorization";
import { getWorkspaceLocale } from "../../../lib/workspace-locale-server";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { DesktopAccountActions } from "./DesktopAccountActions";
import { SignInButton } from "../sign-in/SignInButton";
import { DesktopApproval } from "./DesktopApproval";

export const dynamic = "force-dynamic";

export default async function DesktopAuthorizationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const request = parseDesktopAuthorization(await searchParams);
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].desktopLogin;
  const requestHeaders = await headers();
  // A browser approval never inherits a native Bearer identity.
  const current = request && !requestHeaders.has("authorization")
    ? await auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } }) : null;
  const returnPath = request ? `/auth/desktop?${desktopAuthorizationQuery(request)}` : "/auth/desktop";
  return <IdentitySingleShell>
    <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
      <Brand destination="marketing" /><LocaleSwitcher />
    </div>
    <div className="tw:m-auto tw:w-[min(540px,100%)]">
      <IdentityCard>
        <IdentityTitle>{copy.title}</IdentityTitle>
        <IdentityBody>{copy.desktopDescription}</IdentityBody>
        {!request ? <IdentityError>{copy.invalidRequest}</IdentityError> : current ? <>
          <IdentityBody><strong>{current.user.name}</strong><br />{current.user.email}</IdentityBody>
          <DesktopAccountActions currentUserId={current.user.id} returnPath={returnPath} />
          <DesktopApproval request={request} nonce={createDesktopApprovalNonce(request, current.session.id, env.authSecret())} />
        </> : <SignInButton autoStart returnTo={localizedWorkspacePath(returnPath, locale)} />}
        <small className="tw:mt-4 tw:block tw:text-xs tw:text-muted-foreground">{copy.desktopExpires}</small>
      </IdentityCard>
    </div>
  </IdentitySingleShell>;
}
