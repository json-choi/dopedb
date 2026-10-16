// Browser entry for a provider authorization that DopeDB Desktop started. The
// state stays unconsumed here; this page only routes to sign-in, explains an
// account mismatch, or continues to the provider once the browser account matches.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
import { auth } from "../../../../lib/auth";
import {
  providerAuthorizationStartDecision,
  providerAuthorizationStartPath,
  providerAuthorizationUrl,
  readProviderAuthorizationState,
} from "../../../../lib/provider-authorization-handoff";
import { localizedWorkspacePath } from "../../../../lib/workspace-locale";
import { getWorkspaceLocale } from "../../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../../lib/workspace-messages";

export const dynamic = "force-dynamic";

export default async function ProviderAuthorizationStartPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "";
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].providerAuthorization;
  const oauthState = await readProviderAuthorizationState(state);
  const session = oauthState
    ? await auth.api.getSession({
        headers: await headers(),
        query: { disableCookieCache: true },
      })
    : null;
  const decision = providerAuthorizationStartDecision({
    state: oauthState,
    sessionUserId: session?.user.id ?? null,
  });
  const signInPath = localizedWorkspacePath(
    `/auth/sign-in?returnTo=${encodeURIComponent(providerAuthorizationStartPath(state, locale))}`,
    locale,
  );
  if (decision === "sign_in") redirect(signInPath);
  if (decision === "redirect" && oauthState) {
    redirect(providerAuthorizationUrl(
      oauthState.provider as "planetScale" | "gcpCloudSql",
      state,
    ));
  }
  const mismatch = decision === "account_mismatch";
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(540px,100%)]">
        <IdentityCard>
          <IdentityEyebrow>
            {mismatch ? copy.mismatchEyebrow : copy.invalidEyebrow}
          </IdentityEyebrow>
          <IdentityTitle>
            {mismatch ? copy.mismatchTitle : copy.invalidTitle}
          </IdentityTitle>
          <IdentityBody>
            {mismatch ? copy.mismatchBody : copy.invalidBody}
          </IdentityBody>
          {mismatch ? (
            <IdentitySecondaryLink href={signInPath}>
              {copy.mismatchAction}
            </IdentitySecondaryLink>
          ) : null}
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
