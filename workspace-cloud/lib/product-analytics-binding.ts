import "server-only";
import type { AbortSignal as WorkerAbortSignal } from "@cloudflare/workers-types";

// No public URL or reusable bearer capability: this binding is provisioned only
// on the production Workspace Worker. The sink has no public routes.
export async function productAnalyticsBindingFetch(request: Request): Promise<{
  status: number;
  body: { cancel(): Promise<void> } | null;
}> {
  if (process.env.WORKSPACE_RUNTIME !== "cloudflare") {
    throw new Error("Product analytics binding unavailable");
  }
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return getCloudflareContext().env.PRODUCT_ANALYTICS.fetch(request.url, {
    method: request.method,
    headers: Array.from(request.headers.entries()),
    body: await request.text(),
    // Next's DOM types and workers-types describe the same runtime signal with
    // different Event declarations. Keep that type bridge at the binding edge.
    signal: request.signal as unknown as WorkerAbortSignal,
  });
}
