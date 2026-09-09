import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The shared article primitive lives outside this independently locked package.
// Webpack traces that import without changing the package deployment root.
export default defineCloudflareConfig();
