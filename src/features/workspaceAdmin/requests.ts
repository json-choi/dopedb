// Executes workspace administration operations and keeps a refused control-plane
// response as a typed error with its status, code and body. Screens decide which
// documented statuses they branch on; everything else becomes one localized message.
import { errDetails } from "../../ipc/types";
import type { I18nKey, Lang } from "../../lib/i18n";
import type { AccountId } from "../workspaces/domain";
import type { WorkspaceAdminOperation, WorkspaceAdminResponse } from "./domain";
import { workspaceAdminRequest } from "./tauriAdapter";

const HANGUL = /[가-힣]/;

function bodyField(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

export class WorkspaceAdminRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly serverMessage: string | null;
  readonly body: unknown;

  constructor(response: WorkspaceAdminResponse) {
    const serverMessage = bodyField(response.body, "error") ?? bodyField(response.body, "message");
    super(serverMessage ?? `workspace service returned ${response.status}`);
    this.name = "WorkspaceAdminRequestError";
    this.status = response.status;
    this.code = bodyField(response.body, "code");
    this.serverMessage = serverMessage;
    this.body = response.body;
  }
}

export function isAdminSuccess(response: WorkspaceAdminResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

/** Runs one operation and returns its successful body, or throws the refusal. */
export async function runWorkspaceAdmin(
  accountId: AccountId,
  operation: WorkspaceAdminOperation,
): Promise<unknown> {
  const response = await workspaceAdminRequest(accountId, operation);
  if (!isAdminSuccess(response)) throw new WorkspaceAdminRequestError(response);
  return response.body;
}

/** A rejected Bearer session, as opposed to a 401 relayed from an upstream service. */
export function isWorkspaceSessionRejected(error: unknown): boolean {
  if (error instanceof WorkspaceAdminRequestError) {
    return error.status === 401 && error.serverMessage === "Unauthorized";
  }
  return errDetails(error).kind === "authenticationRequired";
}

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/**
 * One user-facing sentence for a failed administration command. The server's own
 * sentence is shown only when it is written in the current UI language.
 */
export function workspaceAdminErrorMessage(
  error: unknown,
  i18n: { lang: Lang; t: Translate },
  fallback: I18nKey,
): string {
  if (isWorkspaceSessionRejected(error)) return i18n.t("workspaceAdmin.sessionExpired");
  if (error instanceof WorkspaceAdminRequestError) {
    const message = error.serverMessage;
    const matchesLanguage = message !== null
      && (i18n.lang === "ko" ? HANGUL.test(message) : !HANGUL.test(message));
    return matchesLanguage ? message : i18n.t(fallback);
  }
  const details = errDetails(error);
  if (details.kind === "timeout") return i18n.t("workspaceAdmin.timeout");
  if (details.kind === "network") return i18n.t("workspaceAdmin.unreachable");
  return i18n.t(fallback);
}
