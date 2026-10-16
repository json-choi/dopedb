// Routes "re-read my memberships" from administration surfaces (a created workspace,
// a scheduled or cancelled deletion, or shared connections a grant, provider change or
// restore re-templated) to the one shell-owned account lifecycle, so every native
// authority refresh and cache replacement keeps a single owner.
const WORKSPACE_MEMBERSHIP_REFRESH_EVENT = "dopedb:request-workspace-membership-refresh";

interface MembershipRefreshRequest {
  answer: Promise<void> | null;
}

/**
 * Resolves once a membership snapshot read after this call has been published.
 * Rejects when that refresh failed or no account lifecycle is mounted to answer.
 */
export function requestWorkspaceMembershipRefresh(): Promise<void> {
  const request: MembershipRefreshRequest = { answer: null };
  window.dispatchEvent(
    new CustomEvent<MembershipRefreshRequest>(WORKSPACE_MEMBERSHIP_REFRESH_EVENT, {
      detail: request,
    }),
  );
  return request.answer
    ?? Promise.reject(new Error("workspace membership refresh is unavailable"));
}

/** The first mounted owner answers; any later listener leaves the request alone. */
export function onWorkspaceMembershipRefreshRequested(refresh: () => Promise<void>) {
  const listener = (event: Event) => {
    const request = (event as CustomEvent<MembershipRefreshRequest>).detail;
    if (request.answer) return;
    request.answer = refresh();
  };
  window.addEventListener(WORKSPACE_MEMBERSHIP_REFRESH_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_MEMBERSHIP_REFRESH_EVENT, listener);
}
