// A settings link can name one exact workspace plus ids that only mean anything
// inside it. Deciding that here keeps the rule in one place: an explicit request
// this account cannot open is refused instead of being served from another
// workspace, and the refusal looks the same whether the workspace is missing,
// invisible, or simply not this account's.

const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceIdParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && workspaceIdPattern.test(value) ? value : null;
}

export type WorkspaceRequestScope = {
  /** The workspace that may be administered, or null when none may be. */
  activeWorkspaceId: string | null;
  /** An explicit request that this account cannot open. Never substituted. */
  unavailable: boolean;
  /** The active workspace is the exact one the link asked for. */
  scopeMatched: boolean;
};

export function resolveWorkspaceRequestScope({
  requestedParam,
  visibleWorkspaceIds,
  sessionWorkspaceId,
}: {
  requestedParam: string | string[] | undefined;
  visibleWorkspaceIds: readonly string[];
  sessionWorkspaceId: string | null | undefined;
}): WorkspaceRequestScope {
  const requested = Array.isArray(requestedParam)
    ? requestedParam.length > 0
    : typeof requestedParam === "string" && requestedParam !== "";
  const requestedId = workspaceIdParam(requestedParam);
  if (requested) {
    const matched = requestedId !== null && visibleWorkspaceIds.includes(requestedId);
    return {
      activeWorkspaceId: matched ? requestedId : null,
      unavailable: !matched,
      scopeMatched: matched,
    };
  }
  const sessionMatch = typeof sessionWorkspaceId === "string"
    && visibleWorkspaceIds.includes(sessionWorkspaceId)
    ? sessionWorkspaceId
    : null;
  return {
    activeWorkspaceId: sessionMatch ?? visibleWorkspaceIds[0] ?? null,
    unavailable: false,
    scopeMatched: false,
  };
}
