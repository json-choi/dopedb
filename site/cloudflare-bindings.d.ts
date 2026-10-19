// Binding-only imports preserve the browser DOM types.
type Fetcher = import("@cloudflare/workers-types/index.ts").Fetcher;
type WorkerVersionMetadata = import("@cloudflare/workers-types/index.ts").WorkerVersionMetadata;
// Self-reference bindings expose HTTP only in this app.
type Service<_Entrypoint = unknown> = Fetcher;
