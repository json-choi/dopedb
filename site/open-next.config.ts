import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Identity-scoped pages and APIs stay dynamic; no shared application cache.
export default defineCloudflareConfig();
