// Server-only sink: the analytics identity can append to one table and cannot
// read events, create query jobs, or use Workspace KMS/customer-resource grants.
export type BigQueryEnv = {
  ANALYTICS_IDENTITY: { fetch(request: Request): Promise<Response> };
  BIGQUERY_PROJECT: string;
  BIGQUERY_DATASET: string;
  BIGQUERY_TABLE: string;
  BIGQUERY_WIF_AUDIENCE: string;
  BIGQUERY_SERVICE_ACCOUNT: string;
};

type Row = Record<string, string | number | null> & { event_id: string };

export class BigQueryDeliveryError extends Error {
  constructor(readonly stage: "identity" | "federation" | "credential" | "insert", readonly status: number) {
    super("Analytics upstream unavailable");
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error("Analytics upstream unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) throw new Error("Analytics response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid analytics response");
  }
  return value;
}

function token(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 32768 || /\s/.test(value)) {
    throw new Error("Invalid analytics credential");
  }
  return value;
}

async function post(url: string, body: unknown, signal: AbortSignal, accessToken?: string) {
  const stage = url.includes("sts.googleapis.com") ? "federation"
    : url.includes("iamcredentials.googleapis.com") ? "credential" : "insert";
  const response = await fetch(url, {
    method: "POST", redirect: "manual", signal,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => { throw new BigQueryDeliveryError(stage, 0); });
  if (!response.ok) throw new BigQueryDeliveryError(stage, response.status);
  return responseJson(response);
}

export async function appendBigQuery(env: BigQueryEnv, rows: Row[]) {
  if (env.BIGQUERY_PROJECT !== "dopedb-503203"
    || env.BIGQUERY_DATASET !== "product_analytics"
    || env.BIGQUERY_TABLE !== "events_raw"
    || env.BIGQUERY_SERVICE_ACCOUNT !== "dopedb-analytics-ingest@dopedb-503203.iam.gserviceaccount.com"
    || env.BIGQUERY_WIF_AUDIENCE !== "//iam.googleapis.com/projects/461953058911/locations/global/workloadIdentityPools/dopedb-analytics/providers/cloudflare") {
    throw new Error("Invalid analytics destination");
  }
  const signal = AbortSignal.timeout(12_000);
  const identity = await responseJson(await env.ANALYTICS_IDENTITY.fetch(new Request(
    "https://identity.dopedb.dev/token", { method: "POST", signal },
  )));
  const federation = await post("https://sts.googleapis.com/v1/token", {
    audience: env.BIGQUERY_WIF_AUDIENCE,
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    subjectToken: token(identity.token),
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
  }, signal);
  const credential = await post(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.BIGQUERY_SERVICE_ACCOUNT}:generateAccessToken`,
    { scope: ["https://www.googleapis.com/auth/bigquery.insertdata"], lifetime: "900s" },
    signal, token(federation.access_token),
  );
  const result = await post(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${env.BIGQUERY_PROJECT}/datasets/${env.BIGQUERY_DATASET}/tables/${env.BIGQUERY_TABLE}/insertAll`,
    { skipInvalidRows: false, ignoreUnknownValues: false,
      rows: rows.map((row) => ({ insertId: row.event_id, json: row })) },
    signal, token(credential.accessToken),
  );
  // insertAll may report partial failure with HTTP 200. Retries preserve event_id;
  // the canonical events view deduplicates beyond Google's best-effort insertId.
  if (result.kind !== "bigquery#tableDataInsertAllResponse"
    || (result.insertErrors !== undefined &&
      (!Array.isArray(result.insertErrors) || result.insertErrors.length !== 0))) {
    throw new Error("Analytics insert was not acknowledged");
  }
}
