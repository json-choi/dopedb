import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSiteAnalytics } from "../../../lib/analytics";

export async function POST(request: Request) {
  const response = (status: number) => new Response(null, {
    status, headers: { "cache-control": "no-store" },
  });
  if (request.headers.get("origin") !== "https://dopedb.dev"
    || request.headers.get("sec-fetch-site") !== "same-origin") return response(403);
  const point = await readSiteAnalytics(request);
  if (!point) return response(400);
  const { env } = getCloudflareContext();
  // The edge's client address is used only for its ephemeral request budget.
  // It is never written into the analytics point or application logs.
  const { success } = await env.SITE_ANALYTICS_LIMITER.limit({
    key: request.headers.get("cf-connecting-ip") || "unknown",
  });
  if (!success) return response(429);
  env.SITE_ANALYTICS.writeDataPoint({ indexes: [point[0]], blobs: point, doubles: [1] });
  return response(204);
}
