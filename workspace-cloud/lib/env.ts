// Server-only environment access. Values are read lazily so static pages can build
// without production secrets; request handlers fail closed when configuration is absent.
import "server-only";

const PRODUCT_ANALYTICS_WORKER_HOST = /^dopedb-product-analytics\.[a-z0-9-]+\.workers\.dev$/;
const WORKSPACE_SCHEDULER_WORKER_HOST = /^dopedb-workspace-scheduler\.[a-z0-9-]+\.workers\.dev$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function appOrigin(): string {
  const raw = required("BETTER_AUTH_URL");
  const url = new URL(raw);
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BETTER_AUTH_URL must be an HTTPS origin");
  }
  return url.origin;
}

function authSecret(): string {
  const value = required("BETTER_AUTH_SECRET");
  if (value.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  return value;
}

function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function vaultBrokerOrigins(): readonly string[] {
  const raw = optional("VAULT_BROKER_ORIGINS");
  if (!raw) return [];
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 16) {
    throw new Error("VAULT_BROKER_ORIGINS must contain 1 to 16 HTTPS origins");
  }
  const origins = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("VAULT_BROKER_ORIGINS contains an invalid URL");
    }
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || url.port === "80"
    ) {
      throw new Error("VAULT_BROKER_ORIGINS accepts exact HTTPS origins only");
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error("VAULT_BROKER_ORIGINS contains a duplicate origin");
  }
  return origins;
}

function githubKnowledgePrivateKey(): string | null {
  const value = optional("GITHUB_KNOWLEDGE_APP_PRIVATE_KEY");
  if (!value) return null;
  const key = value.includes("BEGIN RSA PRIVATE KEY") || value.includes("BEGIN PRIVATE KEY")
    ? value.replaceAll("\\n", "\n")
    : Buffer.from(value, "base64").toString("utf8");
  if (
    !key.includes("-----BEGIN")
    || !key.includes("PRIVATE KEY-----")
    || !key.includes("-----END")
  ) {
    throw new Error("GITHUB_KNOWLEDGE_APP_PRIVATE_KEY is not a PEM private key");
  }
  return key;
}

function productAnalyticsCloudflareToken(): string | null {
  const value = optional("PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN");
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN is invalid");
  }
  return value;
}

function productAnalyticsRelayEnabled(): boolean {
  const value = optional("PRODUCT_ANALYTICS_RELAY_ENABLED");
  if (value === null || value === "0") return false;
  if (value === "1") return true;
  throw new Error("PRODUCT_ANALYTICS_RELAY_ENABLED must be 0 or 1");
}

function productAnalyticsCloudflareUrl(): string | null {
  const value = optional("PRODUCT_ANALYTICS_CLOUDFLARE_URL");
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PRODUCT_ANALYTICS_CLOUDFLARE_URL is invalid");
  }
  if (
    url.protocol !== "https:"
    || !PRODUCT_ANALYTICS_WORKER_HOST.test(url.hostname)
    || url.username
    || url.password
    || url.pathname !== "/v1/events"
    || url.search
    || url.hash
  ) {
    throw new Error("PRODUCT_ANALYTICS_CLOUDFLARE_URL must be the approved analytics Worker endpoint");
  }
  return url.toString();
}

function workspaceBackgroundSchedulerEnabled(): boolean {
  const value = optional("WORKSPACE_BACKGROUND_SCHEDULER_ENABLED");
  if (value === null || value === "0") return false;
  if (value === "1") return true;
  throw new Error("WORKSPACE_BACKGROUND_SCHEDULER_ENABLED must be 0 or 1");
}

function knowledgeGraphBuildsEnabled(): boolean {
  const value = optional("KNOWLEDGE_GRAPH_BUILDS_ENABLED");
  if (value === null || value === "0") return false;
  if (value === "1") return true;
  throw new Error("KNOWLEDGE_GRAPH_BUILDS_ENABLED must be 0 or 1");
}

function workspaceBackgroundSchedulerToken(): string | null {
  const value = optional("WORKSPACE_BACKGROUND_SCHEDULER_TOKEN");
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("WORKSPACE_BACKGROUND_SCHEDULER_TOKEN is invalid");
  }
  return value;
}

function workspaceBackgroundSchedulerUrl(): string | null {
  const value = optional("WORKSPACE_BACKGROUND_SCHEDULER_URL");
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WORKSPACE_BACKGROUND_SCHEDULER_URL is invalid");
  }
  if (
    url.protocol !== "https:"
    || !WORKSPACE_SCHEDULER_WORKER_HOST.test(url.hostname)
    || url.username
    || url.password
    || url.pathname !== "/v1/kick"
    || url.search
    || url.hash
  ) {
    throw new Error("WORKSPACE_BACKGROUND_SCHEDULER_URL must be the approved scheduler Worker endpoint");
  }
  return url.toString();
}

export const env = {
  appOrigin,
  authSecret,
  cronSecret: () => optional("CRON_SECRET"),
  credentialKey: () => required("WORKSPACE_CREDENTIAL_KEY"),
  databaseUrl: () => required("DATABASE_URL"),
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  githubKnowledgeAppId: () => optional("GITHUB_KNOWLEDGE_APP_ID"),
  githubKnowledgeAppSlug: () => optional("GITHUB_KNOWLEDGE_APP_SLUG"),
  githubKnowledgeClientId: () => optional("GITHUB_KNOWLEDGE_CLIENT_ID"),
  githubKnowledgeClientSecret: () => optional("GITHUB_KNOWLEDGE_CLIENT_SECRET"),
  githubKnowledgePrivateKey,
  githubKnowledgeWebhookSecret: () => optional("GITHUB_KNOWLEDGE_WEBHOOK_SECRET"),
  knowledgeGraphBuildsEnabled,
  planetScaleClientId: () => optional("PLANETSCALE_CLIENT_ID"),
  planetScaleClientSecret: () => optional("PLANETSCALE_CLIENT_SECRET"),
  productAnalyticsCloudflareToken,
  productAnalyticsCloudflareUrl,
  productAnalyticsRelayEnabled,
  resendApiKey: () => optional("RESEND_API_KEY"),
  vaultBrokerOrigins,
  workspaceInvitationFrom: () => optional("WORKSPACE_INVITATION_FROM"),
  workspaceBackgroundSchedulerEnabled,
  workspaceBackgroundSchedulerToken,
  workspaceBackgroundSchedulerUrl,
  workspaceKmsKeyName: () => required("WORKSPACE_KMS_KEY_NAME"),
  workspaceKmsWifAudience: () => required("WORKSPACE_KMS_WIF_AUDIENCE"),
  workspaceKmsServiceAccountEmail: () => required("WORKSPACE_KMS_SERVICE_ACCOUNT_EMAIL"),
};
