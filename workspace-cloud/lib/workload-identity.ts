import "server-only";
import { boundedJsonResponse } from "./bounded-json-response";

/** Obtain identity through the runtime binding, never from a client-controlled header. */
export async function workloadOidcToken(): Promise<string | null> {
  if (process.env.WORKSPACE_RUNTIME !== "cloudflare") return null;
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = getCloudflareContext();
  const response = await env.WORKLOAD_IDENTITY.fetch("https://identity.dopedb.dev/token", {
    method: "POST",
  });
  const body = await boundedJsonResponse(response, 8 * 1_024);
  if (!response.ok || !body || typeof body !== "object" || !("token" in body)
    || typeof body.token !== "string" || body.token.length < 100
    || body.token.length > 4 * 1_024 || /\s/.test(body.token)) {
    throw new Error("Production workload identity is unavailable");
  }
  return body.token;
}
