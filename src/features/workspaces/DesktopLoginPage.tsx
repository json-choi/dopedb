// Build-time browser document for the native loopback listener. It shares the
// desktop primitives but never loads the application, credentials, or network assets.
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../../design-system/components/Button";
import { DopeDBMarkGraphic } from "../../design-system/components/DopeDBMarkGraphic";

export function renderDesktopLoginPage() {
  return renderToStaticMarkup(
    <html lang="en" data-theme="light" data-page="__PAGE__">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>DopeDB · Sign in</title>
      </head>
      <body className="tw:m-0 tw:bg-background tw:font-sans tw:text-body tw:text-foreground">
        <main className="tw:box-border tw:flex tw:min-h-svh tw:items-center tw:justify-center tw:p-6">
          <section aria-labelledby="login-title" className="tw:w-full tw:max-w-[420px]">
            <div className="tw:mb-10 tw:flex tw:items-center tw:gap-2 tw:text-title tw:font-semibold">
              <DopeDBMarkGraphic instanceId="local-login" size={32} />
              <span>DopeDB</span>
            </div>
            <h1 id="login-title" className="tw:m-0 tw:text-heading tw:leading-tight tw:font-bold">
              DopeDB
            </h1>
            <p id="login-description" className="tw:mt-4 tw:mb-6 tw:leading-body tw:text-muted-foreground">
              Return to DopeDB to check your sign-in request.
            </p>
            <form id="login-action" hidden action="__AUTHORIZE_PATH__" method="get" data-primary-flow="desktop-login">
              <Button type="submit" variant="primary" labelBehavior="wrap">
                <span id="login-action-label">Continue to sign in</span>
              </Button>
            </form>
            <p id="login-hint" className="tw:mt-6 tw:mb-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              Enable JavaScript to continue in this browser.
            </p>
          </section>
        </main>
      </body>
    </html>,
  );
}
