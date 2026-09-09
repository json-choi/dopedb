import { getCloudflareContext } from "@opennextjs/cloudflare";

export function GET() {
  const { env } = getCloudflareContext();
  return Response.json({ service: "dopedb-site", versionId: env.CF_VERSION_METADATA.id }, {
    headers: { "cache-control": "no-store" },
  });
}
