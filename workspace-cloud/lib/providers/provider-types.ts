// Provider-neutral contracts for redacted resource discovery and one-time database
// leases. Secret-bearing adapters narrow external responses into these shapes.

export type ManagedEngine = "postgres" | "mysql";
export type ManagedAccessMode = "read" | "write" | "schema";
export type ManagedSslMode = "verify-ca" | "verify-full";
export type ProviderProductionClassification = true | false | "unknown";

export type NeonProviderResourceTarget = {
  provider: "neon";
  projectId: string;
  branchId: string;
  name: string;
  currentState: "init" | "resetting" | "ready" | "archived" | "unknown";
  pendingState: "init" | "resetting" | "ready" | "archived" | "unknown" | null;
  default: boolean;
  protected: boolean;
};

export type ProviderResourceItem = {
  id: string;
  name: string;
  value: string;
  kind?: ManagedEngine;
  production?: ProviderProductionClassification;
  ready?: boolean;
  safeMigrations?: boolean;
  providerTarget?: NeonProviderResourceTarget;
};

export type ManagedProviderLease = {
  externalCredentialId: string;
  externalCredentialKind: "iamToken" | "password" | "role";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslmode: ManagedSslMode;
  tlsServerCaPem?: string;
  schemaOwner?: string;
  connector?: {
    kind: "gcpCloudSqlAuthProxy";
    instanceConnectionName: string;
    accessToken: string;
    networkMode: "PUBLIC" | "PRIVATE_SERVICES_ACCESS" | "PRIVATE_SERVICE_CONNECT";
  };
  expiresAt: string;
};

export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export function verifiedProviderAuditId(provider: string, value: unknown) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
  ) {
    throw new ProviderRequestError(
      provider,
      "Provider returned an invalid audit identifier",
      502,
    );
  }
  return value;
}

// A managed lease request must never wait indefinitely for a stale provider
// authority decision. Individual adapters keep their shorter per-request
// deadlines; this bound covers the complete pre-issuance authority sequence.
export const MANAGED_PROVIDER_AUTHORITY_TIMEOUT_MS = 45_000;

export async function issueAfterFreshProviderAuthority<TProof, TLease>(
  provider: string,
  revalidate: () => Promise<TProof>,
  issue: (proof: TProof) => Promise<TLease>,
): Promise<TLease> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new ProviderRequestError(
        provider,
        "Provider security validation timed out before database access was issued",
        504,
      ));
    }, MANAGED_PROVIDER_AUTHORITY_TIMEOUT_MS);
  });

  let proof: TProof;
  try {
    proof = await Promise.race([
      Promise.resolve().then(revalidate),
      timedOut,
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
  return issue(proof);
}
