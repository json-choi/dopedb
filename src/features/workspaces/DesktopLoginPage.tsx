// Self-contained native callback document using the hosted Workspace identity primitives.
// No external assets, account data, or callback credentials enter the rendered document.
import { renderToStaticMarkup } from "react-dom/server";
import { DopeDBMarkGraphic } from "../../design-system/components/DopeDBMarkGraphic";
import {
  IdentityBody, IdentityCard, IdentityEyebrow, IdentityPrimaryButton,
  IdentitySingleShell, IdentityTitle,
} from "../../design-system/components/WorkspaceIdentity";

export function renderDesktopLoginPage() {
  return renderToStaticMarkup(
    <html lang="en" data-page="__PAGE__" data-diagnostic="__DIAGNOSTIC__">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>DopeDB · Workspace</title>
      </head>
      <body>
        <IdentitySingleShell>
          <div className="tw:relative tw:z-[2] tw:inline-flex tw:items-center tw:gap-2.5 tw:font-semibold tw:tracking-[-0.025em]">
            <DopeDBMarkGraphic instanceId="local-login" className="tw:size-7 tw:text-primary" />
            <span className="tw:text-[16px]">DopeDB</span>
            <small className="tw:ml-1 tw:border-l tw:border-border tw:pl-3 tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.09em] tw:text-muted-foreground tw:uppercase">Workspace</small>
          </div>
          <div className="tw:m-auto tw:w-[min(540px,100%)] tw:py-12">
            <IdentityCard density="compact">
              <IdentityEyebrow><span id="login-eyebrow">Desktop sign-in</span></IdentityEyebrow>
              <IdentityTitle><span id="login-title">Return to DopeDB</span></IdentityTitle>
              <IdentityBody><span id="login-description">Return to the app to check your sign-in request.</span></IdentityBody>
              <form id="login-action" hidden action="__APP_URL__" method="get" data-primary-flow="desktop-login">
                <IdentityPrimaryButton type="submit">
                  <span id="login-action-label">Return to DopeDB</span>
                  <span aria-hidden="true">↗</span>
                </IdentityPrimaryButton>
              </form>
              <p id="login-hint" className="tw:mt-5 tw:text-xs tw:leading-body tw:text-muted-foreground">You can close this tab and return to the app.</p>
              <p id="login-diagnostic" hidden className="tw:mt-4 tw:font-mono tw:text-2xs tw:text-muted-foreground" />
            </IdentityCard>
          </div>
        </IdentitySingleShell>
      </body>
    </html>,
  );
}
