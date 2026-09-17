// Connection URL parsing is domain translation, not form presentation. Keeping
// it here lets the Tailwind editor stay focused on state and interaction while
// preserving support for SQL, SQLite, and multi-host MongoDB URLs.
import type { Engine } from "../../ipc/types";
import type { ConnectionProfile } from "./domain";
import {
  CONNECTION_DEFAULT_PORTS,
  connectionDefaultSslMode,
} from "./presets";

export type ParsedConnectionUrl = {
  update: Partial<ConnectionProfile>;
  password: string | null;
};

function unwrapConnectionUrlInput(raw: string): string {
  const trimmed = raw.trim();
  const assignment =
    /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/u.exec(trimmed);
  const value = (assignment?.[1] ?? trimmed).trim();
  return value.replace(/^['"`]+|['"`]+$/g, "");
}

const CONNECTION_META_PARAMETER_KEYS = new Set([
  "allowwrites",
  "connectionname",
  "env",
  "environment",
  "group",
  "name",
  "readonly",
  "schemagroup",
  "writes",
]);

const CONNECTION_SECRET_PARAMETER_KEYS = new Set([
  "accesstoken",
  "apikey",
  "clientsecret",
  "pass",
  "passwd",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
]);

function normalizedParameterKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]/g, "");
}

function isConnectionMetaParameter(key: string): boolean {
  return CONNECTION_META_PARAMETER_KEYS.has(normalizedParameterKey(key));
}

function isConnectionSecretParameter(key: string): boolean {
  return CONNECTION_SECRET_PARAMETER_KEYS.has(
    normalizedParameterKey(key),
  );
}

function isConnectionUrlControlParameter(key: string): boolean {
  const normalized = normalizedParameterKey(key);
  return normalized === "ssl" || normalized === "sslmode";
}

function isInternalConnectionParameter(key: string): boolean {
  return key.trim().toLowerCase().startsWith("dopedb.");
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function firstSearchParam(
  params: URLSearchParams,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = params.get(key);
    if (value != null && value !== "") return value;
  }
  return null;
}

function parseOptionalBoolean(value: string | null): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseUrlMetaParams(params: URLSearchParams, nameFallback: string) {
  return {
    name:
      firstSearchParam(params, [
        "name",
        "connectionName",
        "connection_name",
      ]) || nameFallback,
    env: firstSearchParam(params, ["env", "environment"]),
    readonlyDefault: parseOptionalBoolean(
      firstSearchParam(params, ["readonly", "readOnly", "read_only"]),
    ),
    allowWrites: parseOptionalBoolean(
      firstSearchParam(params, ["allowWrites", "allow_writes", "writes"]),
    ),
  };
}

function normalizeSslMode(engine: Engine, value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (["1", "true", "yes", "on"].includes(normalized)) return "require";
  if (["0", "false", "no", "off"].includes(normalized)) {
    return engine === "mysql" ? "disabled" : "disable";
  }
  if (engine === "mysql") {
    if (normalized === "disable") return "disabled";
    if (normalized === "prefer") return "preferred";
    if (normalized === "require") return "required";
    if (normalized === "verify-full") return "verify-identity";
  }
  return normalized;
}

function sqliteDatabaseFromUrl(url: URL): string {
  const path = decodeUrlPart(url.pathname);
  const normalizedPath = /^\/[a-z]:\//i.test(path)
    ? path.slice(1)
    : path;
  if (url.protocol === "file:") return normalizedPath;
  if (url.hostname && !url.pathname) return decodeUrlPart(url.hostname);
  if (url.hostname) return decodeUrlPart(`${url.hostname}${url.pathname}`);
  return normalizedPath;
}

function parseMongoConnectionUrl(text: string): ParsedConnectionUrl | null {
  const match =
    /^mongodb(\+srv)?:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/i.exec(
      text,
    );
  if (!match) return null;
  const [, srvFlag, rawUser, rawPass, hostPart, rawDatabase, rawQuery] =
    match;
  const srv = !!srvFlag;
  const database = rawDatabase ? decodeUrlPart(rawDatabase) : "";
  const params = new URLSearchParams(rawQuery ?? "");
  const extraParams: Record<string, string> = {};
  params.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (
      isConnectionMetaParameter(key) ||
      isConnectionSecretParameter(key) ||
      isInternalConnectionParameter(key)
    ) {
      return;
    }
    if (normalizedKey === "ssl" || normalizedKey === "tls") {
      const enabled = parseOptionalBoolean(value);
      if (enabled === true) extraParams.tls = "true";
      if (enabled === false) delete extraParams.tls;
      if (enabled !== null) return;
    }
    extraParams[key] = value;
  });
  if (srv) extraParams.srv = "true";

  const hosts = hostPart
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  let host: string;
  let port: number;
  if (hosts.length > 1) {
    host = hostPart;
    port = CONNECTION_DEFAULT_PORTS.mongodb;
  } else {
    const single = hosts[0] ?? "";
    const hostMatch = /^(.+?)(?::(\d+))?$/.exec(single);
    host = decodeUrlPart(hostMatch?.[1] ?? single);
    port = hostMatch?.[2]
      ? Number(hostMatch[2])
      : CONNECTION_DEFAULT_PORTS.mongodb;
  }

  const meta = parseUrlMetaParams(params, database || hosts[0] || "");
  const update: Partial<ConnectionProfile> = {
    name: meta.name,
    engine: "mongodb",
    provider: "auto",
    driverId: null,
    host,
    port,
    database,
    username: rawUser ? decodeUrlPart(rawUser) : "",
    sslmode: "prefer",
    extraParams,
  };
  if (meta.env) update.env = meta.env;
  if (meta.readonlyDefault != null) {
    update.readonlyDefault = meta.readonlyDefault;
  }
  if (meta.allowWrites != null) update.allowWrites = meta.allowWrites;

  return {
    update,
    password:
      (rawPass != null ? decodeUrlPart(rawPass) : "") ||
      firstSearchParam(params, ["password", "pass"]) ||
      null,
  };
}

function parseCloudflareD1Url(url: URL): ParsedConnectionUrl | null {
  let accountId = "";
  let databaseId = "";
  if (url.protocol === "d1:") {
    accountId = decodeUrlPart(url.hostname);
    databaseId = decodeUrlPart(url.pathname.replace(/^\/+/, ""));
  } else if (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "api.cloudflare.com"
  ) {
    const match =
      /^\/client\/v4\/accounts\/([^/]+)\/d1\/database\/([^/]+)(?:\/(?:query|raw))?\/?$/u.exec(
        url.pathname,
      );
    if (!match) return null;
    accountId = decodeUrlPart(match[1]);
    databaseId = decodeUrlPart(match[2]);
  } else {
    return null;
  }
  if (!accountId || !databaseId) return null;
  const meta = parseUrlMetaParams(url.searchParams, databaseId);
  const update: Partial<ConnectionProfile> = {
    name: meta.name,
    engine: "sqlite",
    provider: "cloudflareD1",
    driverId: "cloudflare-d1-wrangler",
    host: accountId,
    port: 443,
    database: databaseId,
    username: "",
    sslmode: "require",
    extraParams: {},
  };
  if (meta.env) update.env = meta.env;
  if (meta.readonlyDefault != null) update.readonlyDefault = meta.readonlyDefault;
  if (meta.allowWrites != null) update.allowWrites = meta.allowWrites;
  return {
    update,
    password: null,
  };
}

export function parseConnectionUrl(raw: string): ParsedConnectionUrl | null {
  const text = unwrapConnectionUrlInput(raw);
  if (!text) return null;
  const driverUrl = text.replace(/^jdbc:/i, "");
  if (/^mongodb(\+srv)?:\/\//i.test(driverUrl)) {
    return parseMongoConnectionUrl(driverUrl);
  }

  let url: URL;
  try {
    url = new URL(driverUrl);
  } catch {
    return null;
  }

  const d1 = parseCloudflareD1Url(url);
  if (d1) return d1;

  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  const engine: Engine | null =
    protocol === "postgres" || protocol === "postgresql"
      ? "postgres"
      : protocol === "mysql" || protocol === "mariadb"
        ? "mysql"
        : protocol === "sqlite" ||
            protocol === "sqlite3" ||
            protocol === "file"
          ? "sqlite"
          : protocol === "bigquery"
            ? "bigquery"
          : null;
  if (!engine) return null;

  const extraParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (
      isConnectionMetaParameter(key) ||
      isConnectionSecretParameter(key) ||
      isConnectionUrlControlParameter(key) ||
      isInternalConnectionParameter(key)
    ) {
      return;
    }
    extraParams[key] = value;
  });
  if (engine === "bigquery") {
    for (const key of Object.keys(extraParams)) {
      if (key !== "location" && key !== "maximumBytesBilled") {
        delete extraParams[key];
      }
    }
  }

  const sslmode = normalizeSslMode(
    engine,
    firstSearchParam(url.searchParams, [
      "sslmode",
      "ssl-mode",
      "sslMode",
      "ssl",
    ]),
  );
  const database =
    engine === "sqlite"
      ? sqliteDatabaseFromUrl(url)
      : decodeUrlPart(url.pathname.replace(/^\/+/, ""));
  const meta = parseUrlMetaParams(
    url.searchParams,
    database || url.hostname || "",
  );
  const update: Partial<ConnectionProfile> = {
    name: meta.name,
    engine,
    provider: engine === "bigquery" ? "generic" : "auto",
    driverId: null,
    host: engine === "sqlite" ? "localhost" : decodeUrlPart(url.hostname),
    port: url.port
      ? Number(url.port)
      : CONNECTION_DEFAULT_PORTS[engine],
    database,
    username: decodeUrlPart(url.username),
    sslmode: sslmode ?? connectionDefaultSslMode(engine),
    extraParams,
  };
  if (meta.env) update.env = meta.env;
  const schemaGroup = firstSearchParam(url.searchParams, [
    "schemaGroup",
    "schema_group",
    "schema-group",
    "group",
  ]);
  if (schemaGroup && engine !== "bigquery") update.schemaGroup = schemaGroup;
  if (meta.readonlyDefault != null) {
    update.readonlyDefault = meta.readonlyDefault;
  }
  if (meta.allowWrites != null) update.allowWrites = meta.allowWrites;
  if (engine === "bigquery") {
    update.username = "";
    update.port = CONNECTION_DEFAULT_PORTS.bigquery;
    update.readonlyDefault = true;
    update.allowWrites = false;
    update.sslmode = "require";
  }

  return {
    update,
    password: engine === "bigquery"
      ? null
      : decodeUrlPart(url.password) ||
        firstSearchParam(url.searchParams, ["password", "pass"]) ||
        null,
  };
}

export function connectionUrlNeedsDatabaseSelection(
  parsed: ParsedConnectionUrl,
): boolean {
  return (
    parsed.update.engine === "mongodb" &&
    !(parsed.update.database ?? "").trim()
  );
}

function encodedPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function urlHost(value: string): string {
  const host = value.trim();
  return host.includes(":") &&
    !host.includes(",") &&
    !host.startsWith("[")
    ? `[${host}]`
    : host;
}

function safeConnectionParameters(
  profile: ConnectionProfile,
): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(profile.extraParams)
    .filter(
      ([key]) =>
        key !== "srv" &&
        !isConnectionMetaParameter(key) &&
        !isConnectionSecretParameter(key) &&
        !isConnectionUrlControlParameter(key) &&
        !isInternalConnectionParameter(key),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => params.set(key, value));
  if (
    profile.engine === "postgres" ||
    profile.engine === "mysql"
  ) {
    params.set("sslmode", profile.sslmode);
  }
  return params;
}

function withQuery(base: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Produces the redacted URL projection shown by the property editor.
 * Credentials remain in the dedicated password state/keychain and DopeDB-only
 * introspection metadata never leaks into a driver URL.
 */
export function formatConnectionUrl(
  profile: ConnectionProfile,
): string {
  const params = safeConnectionParameters(profile);
  if (profile.engine === "sqlite" && profile.provider === "cloudflareD1") {
    const accountId = encodeURIComponent(profile.host.trim());
    const databaseId = encodeURIComponent(profile.database.trim());
    return `d1://${accountId}/${databaseId}`;
  }
  if (profile.engine === "sqlite") {
    const normalizedPath = profile.database.replace(/\\/g, "/");
    const path = encodedPath(normalizedPath);
    const base = normalizedPath.startsWith("/")
      ? `sqlite://${path}`
      : /^[a-z]:\//i.test(normalizedPath)
        ? `sqlite:///${path}`
        : `sqlite:${path}`;
    return withQuery(base, params);
  }

  const username = profile.username.trim()
    ? `${encodeURIComponent(profile.username.trim())}@`
    : "";
  if (profile.engine === "mongodb") {
    const srv = profile.extraParams.srv === "true";
    const scheme = srv ? "mongodb+srv" : "mongodb";
    const host = urlHost(profile.host);
    const authority =
      srv || host.includes(",") || !profile.port
        ? host
        : `${host}:${profile.port}`;
    const database = profile.database.trim()
      ? `/${encodeURIComponent(profile.database.trim())}`
      : "";
    return withQuery(
      `${scheme}://${username}${authority}${database}`,
      params,
    );
  }

  if (profile.engine === "bigquery") {
    const database = profile.database.trim()
      ? `/${encodeURIComponent(profile.database.trim())}`
      : "";
    return withQuery(
      `bigquery://${urlHost(profile.host)}${database}`,
      params,
    );
  }

  const scheme =
    profile.engine === "postgres" ? "postgresql" : "mysql";
  const host = urlHost(profile.host);
  const port = profile.port ? `:${profile.port}` : "";
  const database = profile.database.trim()
    ? `/${encodeURIComponent(profile.database.trim())}`
    : "";
  return withQuery(
    `${scheme}://${username}${host}${port}${database}`,
    params,
  );
}
