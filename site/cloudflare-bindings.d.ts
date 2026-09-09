// Binding-only imports preserve the browser DOM types.
type Fetcher = import("@cloudflare/workers-types/index.ts").Fetcher;
type WorkerVersionMetadata = import("@cloudflare/workers-types/index.ts").WorkerVersionMetadata;
type AnalyticsEngineDataset = import("@cloudflare/workers-types/index.ts").AnalyticsEngineDataset;
type RateLimit = import("@cloudflare/workers-types/index.ts").RateLimit;
// Self-reference bindings expose HTTP only in this app.
type Service<_Entrypoint = unknown> = Fetcher;
