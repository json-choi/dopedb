import { WorkerEntrypoint } from "cloudflare:workers";
import { identityMetadataResponse, issueWorkloadIdentity, issueAnalyticsIdentity } from "./workload-identity-core";

// Only the production Workspace service binding exposes this RPC entrypoint.
// The public HTTP entrypoint below never issues or returns a credential.
export class WorkspaceIdentity extends WorkerEntrypoint<IdentityEnv> {
  async fetch(request: Request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/token") {
      return new Response(null, { status: 404 });
    }
    return Response.json({ token: await issueWorkloadIdentity(this.env) }, {
      headers: { "cache-control": "private, no-store" },
    });
  }
}

export class AnalyticsIdentity extends WorkerEntrypoint<IdentityEnv> {
  async fetch(request: Request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/token") {
      return new Response(null, { status: 404 });
    }
    return Response.json({ token: await issueAnalyticsIdentity(this.env) }, {
      headers: { "cache-control": "private, no-store" },
    });
  }
}

export default {
  fetch(request, env) {
    try {
      return identityMetadataResponse(request, env);
    } catch {
      return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
    }
  },
} satisfies ExportedHandler<IdentityEnv>;
