import { expect, vi } from "vitest";

import type { ProviderImportPostgresHarness } from "./fixture";

export function expectRfc3339Timestamp(value: unknown) {
  if (typeof value !== "string") {
    throw new Error(`expected an RFC3339 timestamp string, received ${typeof value}`);
  }
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

export async function runProviderImportSupportAssertions() {
  const serverLog = await import("../workspace-server-log");
  const { boundedJsonBody, privateJsonStream } = await import("../http");
  const streamedFixture = {
    nested: [{ value: "한글🙂".repeat(20_000), omitted: undefined }, Number.NaN],
    date: new Date("2026-08-14T00:00:00.000Z"),
  };
  const streamedResponse = privateJsonStream(streamedFixture);
  expect(await streamedResponse.text()).toBe(JSON.stringify(streamedFixture));
  expect(streamedResponse.headers.get("cache-control")).toBe("private, no-store");
  const boundedFixture = JSON.stringify({ label: "한글🙂" });
  const boundedBytes = new TextEncoder().encode(boundedFixture).byteLength;
  await expect(boundedJsonBody(new Request("https://dopedb.invalid", {
    method: "POST",
    body: boundedFixture,
  }), boundedBytes)).resolves.toEqual({
    ok: true,
    value: { label: "한글🙂" },
  });
  await expect(boundedJsonBody(new Request("https://dopedb.invalid", {
    method: "POST",
    body: boundedFixture,
  }), boundedBytes - 1)).resolves.toEqual({
    ok: false,
    reason: "too_large",
  });
  await expect(boundedJsonBody(new Request("https://dopedb.invalid", {
    method: "POST",
    body: new Uint8Array([0xff]),
  }), 1)).resolves.toEqual({
    ok: false,
    reason: "invalid",
  });
  const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    serverLog.logProviderConnectionFailure({
      provider: "secret-provider-token",
      stage: "password-stage",
      postgresCode: "credential-value",
      providerStatus: 999,
    });
    serverLog.logGcpManagedAccessUpstreamRejection({
      stage: "authorization-token",
      upstreamStatus: 999,
      googleStatus: "SECRET_TOKEN_VALUE",
      googleReason: "PASSWORD_VALUE",
    });
    serverLog.logGcpCloudSetupCallbackFailure({
      stage: "credential-value",
      providerRequest: true,
      status: 999,
    });
    serverLog.logManagedDatabaseAccessFailure({
      provider: "secret-provider-token",
      providerRequest: false,
      status: 999,
      databaseCode: "42703",
    });
    serverLog.logManagedDatabaseAccessFailure({
      provider: "gcpCloudSql",
      providerRequest: false,
      status: 999,
      databaseCode: "password-value",
    });
    serverLog.logWorkspaceKmsFailure({
      operation: "credential-value",
      kind: "secret-value",
      status: 999,
    });
    serverLog.logKnowledgeMutationFailure({ operation: "credential-value", databaseCode: "password-value" });
    serverLog.logGithubKnowledgeSetupFailure({
      stage: "credential-value", kind: "secret-value", status: 999, databaseCode: "password-value",
    });
    expect(serverLog.databaseErrorCode({ cause: { code: "23505" } })).toBe("23505");
    expect(serverLog.databaseErrorCode({ cause: { code: "password-value" } })).toBeNull();
    expect(logSpy.mock.calls).toEqual([
      ["provider_connection_failed", {
        provider: "other",
        stage: "other",
        databaseKind: null,
        providerStatus: 0,
      }],
      ["gcp_managed_access_upstream_rejection", {
        stage: "other",
        upstreamStatus: 0,
        googleStatus: null,
        googleReason: null,
      }],
      ["gcp_cloud_setup_callback_failed", {
        stage: "other",
        kind: "provider_request",
        status: 0,
      }],
      ["managed_database_access_failed", {
        provider: "other",
        kind: "database_schema",
        status: 0,
      }],
      ["managed_database_access_failed", {
        provider: "gcpCloudSql",
        kind: "unexpected",
        status: 0,
      }],
      ["workspace_kms_failed", {
        operation: "other",
        kind: "other",
        status: 0,
      }],
      ["knowledge_mutation_failed", { operation: "other", databaseKind: null }],
      ["github_knowledge_setup_failed", {
        stage: "other", kind: "other", status: 0, databaseKind: null,
      }],
    ]);
  } finally {
    logSpy.mockRestore();
  }
  const kmsCore = await import("../workspace-kms-core");
  expect(kmsCore.crc32c(Buffer.from("123456789", "utf8"))).toBe(0xe3069283);
  const kmsKeyName = "projects/dopedb-harness/locations/global/keyRings/workspace/cryptoKeys/backup";
  expect(kmsCore.parseWorkspaceKmsConfiguration({
    keyName: kmsKeyName,
    workloadIdentityAudience: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/dopedb-workspace/providers/dopedb-workspace",
    serviceAccountEmail: "workspace-kms@dopedb-harness.iam.gserviceaccount.com",
  })).toMatchObject({ keyName: kmsKeyName });
  expect(() => kmsCore.parseWorkspaceKmsConfiguration({
    keyName: "credential-value",
    workloadIdentityAudience: "secret-value",
    serviceAccountEmail: "password-value",
  })).toThrow("Workspace KMS configuration failed");
  const syntheticWrapped = Buffer.from("synthetic wrapped data key", "utf8");
  const parsedWrapped = kmsCore.parseKmsEncryptResponse({
    name: `${kmsKeyName}/cryptoKeyVersions/7`,
    ciphertext: syntheticWrapped.toString("base64"),
    ciphertextCrc32c: String(kmsCore.crc32c(syntheticWrapped)),
    verifiedPlaintextCrc32c: true,
    verifiedAdditionalAuthenticatedDataCrc32c: true,
  }, kmsKeyName);
  expect(parsedWrapped.kmsKeyVersion).toBe(`${kmsKeyName}/cryptoKeyVersions/7`);
  const syntheticPlaintext = Buffer.alloc(32, 23);
  const parsedPlaintext = kmsCore.parseKmsDecryptResponse({
    plaintext: syntheticPlaintext.toString("base64"),
    plaintextCrc32c: String(kmsCore.crc32c(syntheticPlaintext)),
  });
  expect(parsedPlaintext).toEqual(syntheticPlaintext);
  parsedPlaintext.fill(0);
  syntheticPlaintext.fill(0);
  syntheticWrapped.fill(0);

  return { kmsKeyName };
}

export type ProviderImportSupportAssertions =
  Awaited<ReturnType<typeof runProviderImportSupportAssertions>>;

export async function assertProviderSecretIsNotDurable(
  fixture: ProviderImportPostgresHarness,
) {
  const { organizationId, providerSecret, sql } = fixture;
  const leaked = await sql<{ leaked: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT to_jsonb(connection)::text AS value
        FROM "workspace_control"."workspace_connection" connection
        WHERE connection."organization_id" = ${organizationId}
        UNION ALL
        SELECT to_jsonb(request)::text
        FROM "workspace_control"."workspace_provider_import_request" request
        WHERE request."organization_id" = ${organizationId}
        UNION ALL
        SELECT to_jsonb(event)::text
        FROM "workspace_control"."workspace_audit_event" event
        WHERE event."organization_id" = ${organizationId}
        UNION ALL
        SELECT to_jsonb(version)::text
        FROM "workspace_control"."workspace_resource_version" version
        WHERE version."organization_id" = ${organizationId}
      ) durable_record
      WHERE durable_record.value LIKE ${`%${providerSecret}%`}
    ) AS "leaked"
  `;
  expect(leaked[0]?.leaked).toBe(false);
}
