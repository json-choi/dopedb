// Import binding types without replacing the browser DOM's Request/Response types.
type Fetcher = import("@cloudflare/workers-types/index.ts").Fetcher;
type Service = import("@cloudflare/workers-types/index.ts").Service;
type WorkerVersionMetadata = import("@cloudflare/workers-types/index.ts").WorkerVersionMetadata;

type D1Database = import("@cloudflare/workers-types/index.ts").D1Database;
