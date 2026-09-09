// Cloudflare D1 owns Workspace control-plane state. Historical PostgreSQL
// migration tooling uses drizzle/schema.postgres.ts explicitly.
export * from "./d1/schema";
