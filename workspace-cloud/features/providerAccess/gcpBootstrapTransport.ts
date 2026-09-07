// Only an explicit setup-pending response permits repeating this POST. Keep the
// exact reviewed body, stop on session/scope changes, and never retry a save or
// an ambiguous network failure that may have completed server-side.
export async function requestGcpBootstrap(input: {
  url: string;
  body: string;
  expiresAt: string;
  signal: AbortSignal;
  onIamPending: () => void;
}) {
  const expiresAt = Date.parse(input.expiresAt);
  const deadline = Math.min(Date.now() + 10 * 60_000, expiresAt - 60_000);
  let lastPending: Response | null = null;
  while (Number.isFinite(deadline) && Date.now() < deadline) {
    input.signal.throwIfAborted();
    const response = await fetch(input.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: input.body,
      signal: AbortSignal.any([
        input.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      ]),
    }).catch(() => null);
    input.signal.throwIfAborted();
    if (!response && Date.now() >= deadline) return lastPending;
    if (response?.status !== 503) return response;
    const failure = await response.clone().json().catch(() => null);
    if (failure?.code !== "gcp_iam_propagation_pending"
      || !Number.isInteger(failure.retryAfterMs)
      || failure.retryAfterMs < 1_000 || failure.retryAfterMs > 30_000) return response;
    lastPending = response;
    if (Date.now() + failure.retryAfterMs >= deadline) break;
    input.signal.throwIfAborted();
    input.onIamPending();
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        input.signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, failure.retryAfterMs);
      const abort = () => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", abort);
        reject(input.signal.reason);
      };
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
    });
  }
  return lastPending ?? Response.json({ error: "Google Cloud authorization expired. Reconnect the account." }, { status: 410 });
}
