import { Brand } from "../../components/Brand";
import { LocaleSwitcher } from "../../components/LocaleSwitcher";
import {
  IdentityCard,
  IdentityError,
  IdentityEyebrow,
} from "../../components/Identity";
import { safeReturnTo } from "../../../lib/http";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { getWorkspaceLocale } from "../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { SignInButton } from "./SignInButton";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].signIn;
  const errorMessages: Record<string, string> = {
    oauth_state_missing: copy.errors.oauthStateMissing,
    oauth_state_invalid: copy.errors.oauthStateInvalid,
    email_not_verified: copy.errors.emailNotVerified,
    oauth_failed: copy.errors.oauthFailed,
  };
  const returnTo = localizedWorkspacePath(
    safeReturnTo(params.returnTo ?? null),
    locale,
  );
  return (
    <main
      className="tw:relative tw:grid tw:min-h-[100dvh] tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:overflow-hidden tw:px-[clamp(22px,4vw,64px)] tw:py-[clamp(22px,3vw,42px)]"
      id="main-content"
    >
      <div className="tw:relative tw:z-[1] tw:flex tw:items-center tw:justify-between">
        <Brand destination="marketing" />
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-border tw:bg-surface/80 tw:px-3 tw:py-2 tw:font-mono tw:text-2xs tw:font-medium tw:text-muted-foreground tw:backdrop-blur tw:max-[720px]:hidden">
            <i className="tw:size-1.5 tw:rounded-full tw:bg-success" />
            {copy.status}
          </span>
          <LocaleSwitcher />
        </div>
      </div>
      <section className="tw:relative tw:z-[1] tw:m-auto tw:grid tw:w-[min(1280px,100%)] tw:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.72fr)] tw:items-center tw:gap-[clamp(48px,8vw,120px)] tw:py-[clamp(68px,10vh,128px)] tw:max-[860px]:grid-cols-1 tw:max-[860px]:gap-12">
        <div>
          <IdentityEyebrow>{copy.eyebrow}</IdentityEyebrow>
          <h1 className="tw:my-7 tw:max-w-[760px] tw:font-serif tw:text-[clamp(54px,6.4vw,92px)] tw:leading-[0.96] tw:font-normal tw:tracking-[-0.055em] tw:text-balance">
            {copy.headlineFirst}
            <br />{copy.headlineSecond}
          </h1>
          <p className="tw:max-w-[610px] tw:text-[17px] tw:leading-[1.8] tw:text-[var(--ds-text-secondary)]">
            {copy.body}
          </p>
          <dl className="tw:mt-12 tw:grid tw:grid-cols-3 tw:border-y tw:border-border tw:max-[640px]:grid-cols-1 tw:max-[640px]:border-b-0">
            {[
              [copy.sharedTerm, copy.sharedDetail],
              [copy.personalTerm, copy.personalDetail],
              [copy.managedTerm, copy.managedDetail],
            ].map(([term, detail]) => (
              <div className="tw:border-r tw:border-border tw:px-4 tw:py-4 tw:first:pl-0 tw:last:border-r-0 tw:max-[640px]:border-r-0 tw:max-[640px]:border-b tw:max-[640px]:px-0" key={term}>
                <dt className="tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.08em] tw:text-primary tw:uppercase">
                  {term}
                </dt>
                <dd className="tw:mt-2 tw:ml-0 tw:text-xs tw:text-muted-foreground">
                  {detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <IdentityCard density="compact">
          <IdentityEyebrow>{copy.cardEyebrow}</IdentityEyebrow>
          <h2 className="tw:mt-10 tw:mb-3 tw:font-serif tw:text-[36px] tw:leading-tight tw:font-normal tw:tracking-[-0.035em] tw:text-balance tw:max-[480px]:text-[32px]">
            {copy.title}
          </h2>
          <p className="tw:text-[14px] tw:leading-[1.75] tw:text-muted-foreground">
            {copy.description}
          </p>
          {params.error ? (
            <IdentityError>
              {errorMessages[params.error] ?? copy.errors.generic}
            </IdentityError>
          ) : null}
          <SignInButton returnTo={returnTo} />
          <p className="tw:mt-5 tw:mb-0 tw:text-2xs tw:leading-[1.7] tw:text-muted-foreground">
            {copy.legalBeforeTerms}{" "}
            <a
              href={`https://dopedb.dev${locale === "ko" ? "/ko" : ""}/terms`}
              target="_blank"
              rel="noreferrer"
              className="tw:font-medium tw:text-foreground tw:underline tw:underline-offset-2 tw:hover:text-primary"
            >
              {copy.terms}
            </a>
            {" "}{copy.legalBetween}{" "}
            <a
              href={`https://dopedb.dev${locale === "ko" ? "/ko" : ""}/privacy`}
              target="_blank"
              rel="noreferrer"
              className="tw:font-medium tw:text-foreground tw:underline tw:underline-offset-2 tw:hover:text-primary"
            >
              {copy.privacy}
            </a>
            {copy.legalAfter}
          </p>
        </IdentityCard>
      </section>
      <footer className="tw:relative tw:z-[1] tw:flex tw:items-center tw:justify-between tw:border-t tw:border-border tw:pt-4 tw:font-mono tw:text-2xs tw:text-muted-foreground">
        <span>DopeDB workspace control plane</span>
      </footer>
    </main>
  );
}
