import { getCloudflareContext } from "@opennextjs/cloudflare";

// Public, non-secret deployment receipt; no database, session, or identity token.
export function GET() {
  const { env } = getCloudflareContext();
  return Response.json({ service: "dopedb-workspace", versionId: env.CF_VERSION_METADATA.id }, {
    headers: { "cache-control": "no-store" },
  });
}
