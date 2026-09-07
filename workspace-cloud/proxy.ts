import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  workspaceLocaleCookie,
  workspaceLocaleFromPathname,
  workspaceLocaleHeader,
} from "./lib/workspace-locale";

export function proxy(request: NextRequest) {
  const locale = workspaceLocaleFromPathname(request.nextUrl.pathname);
  const localeIndependentPath = request.nextUrl.pathname.replace(/^\/ko(?=\/|$)/, "") || "/";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(workspaceLocaleHeader, locale);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.cookies.set(workspaceLocaleCookie, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  if (/^\/(?:analyses|article-invitations|open-article)\//.test(localeIndependentPath)) {
    // Publications can be revoked; private handoffs contain account identity.
    // Neither may survive in browser or shared caches after an access change.
    response.headers.set("cache-control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
