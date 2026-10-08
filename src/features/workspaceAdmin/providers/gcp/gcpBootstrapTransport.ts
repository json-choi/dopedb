// Sends the reviewed Google Cloud prepare request. Only an explicit
// IAM-propagation-pending refusal permits resending it, unchanged, until ten
// minutes pass or the setup is a minute from expiring. Every other refusal and
// any transport failure (which may have completed server-side) ends the attempt.
import type { AccountId } from "../../../workspaces/domain";
import { runWorkspaceAdmin, WorkspaceAdminRequestError } from "../../requests";
import { iamPropagationRetryAfterMs, type PrepareGcpSetupOperation } from "./gcpModel";

const PROPAGATION_WINDOW_MS = 10 * 60_000;
const SETUP_EXPIRY_MARGIN_MS = 60_000;

/** The attempt was abandoned locally; nothing more should be shown for it. */
export class GcpBootstrapCancelled extends Error {
  constructor() {
    super("Google Cloud setup attempt cancelled");
    this.name = "GcpBootstrapCancelled";
  }
}

/** The setup authorization cannot last long enough for another safe attempt. */
export class GcpSetupExpired extends Error {
  constructor() {
    super("Google Cloud setup authorization expired");
    this.name = "GcpSetupExpired";
  }
}

function waitFor(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new GcpBootstrapCancelled());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function prepareGcpSetupWithPropagationRetry(input: {
  accountId: AccountId;
  operation: PrepareGcpSetupOperation;
  setupExpiresAt: string;
  signal: AbortSignal;
  onIamPending: () => void;
}): Promise<unknown> {
  const deadline = Math.min(
    Date.now() + PROPAGATION_WINDOW_MS,
    Date.parse(input.setupExpiresAt) - SETUP_EXPIRY_MARGIN_MS,
  );
  let lastPending: WorkspaceAdminRequestError | null = null;
  while (Number.isFinite(deadline) && Date.now() < deadline) {
    if (input.signal.aborted) throw new GcpBootstrapCancelled();
    try {
      const body = await runWorkspaceAdmin(input.accountId, input.operation);
      if (input.signal.aborted) throw new GcpBootstrapCancelled();
      return body;
    } catch (error) {
      if (error instanceof GcpBootstrapCancelled || input.signal.aborted) {
        throw new GcpBootstrapCancelled();
      }
      if (!(error instanceof WorkspaceAdminRequestError) || error.status !== 503) throw error;
      const retryAfterMs = iamPropagationRetryAfterMs(error.body);
      if (retryAfterMs === null) throw error;
      lastPending = error;
      if (Date.now() + retryAfterMs >= deadline) break;
      input.onIamPending();
      await waitFor(retryAfterMs, input.signal);
    }
  }
  throw lastPending ?? new GcpSetupExpired();
}
