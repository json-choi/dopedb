// Direct shared database contracts: the same strict goldens Rust decodes, the closed
// verifier formats, the effective-level matrix and the secretless public projection.
import { expect } from "vitest";
import {
  parseDirectProvisioningStatus,
  parseDirectReceiptRequest,
  parseDirectRevocationEntry,
  parseDirectVerifierRequest,
  parseDirectWorkList,
  parseWorkspaceMemberGrants,
} from "./control-plane-contracts";
import { parseDirectEndpoint, publicConnection } from "./workspace-connections";
import {
  directDesiredLevel,
  generatePrincipalMarker,
  generatePrincipalName,
  isDirectTransitionAllowed,
  isValidPrincipalMarker,
  isValidPrincipalName,
} from "./workspace-direct-access-core";
import type { WorkspaceRoleName } from "./workspace-permissions";

type Mutation = Readonly<{ path: readonly (string | number)[]; value: unknown }>;
type DirectRejection = Readonly<{ name: string; contract: string; mutations: readonly Mutation[] }>;
type DirectFixture = Readonly<{
  directAccess: Record<string, unknown>;
  directAccessRejections: readonly DirectRejection[];
}>;

const parsers: Record<string, [string, (value: unknown) => unknown]> = {
  directProvisioning: ["provisioning", parseDirectProvisioningStatus],
  directProvisioningFailed: ["provisioningFailed", parseDirectProvisioningStatus],
  directMemberGrants: ["memberGrants", parseWorkspaceMemberGrants],
  directVerifierRequestPostgres: ["verifierRequestPostgres", parseDirectVerifierRequest],
  directVerifierRequestMysql: ["verifierRequestMysql", parseDirectVerifierRequest],
  directWorkList: ["workList", parseDirectWorkList],
  directReceipt: ["receipt", parseDirectReceiptRequest],
};

export function assertDirectAccessContracts(
  fixture: DirectFixture,
  applyMutations: (base: unknown, rejection: { name: string; contract: never; mutations: readonly Mutation[] }) => unknown,
) {
  const direct = fixture.directAccess;
  // Goldens decode and re-serialize losslessly.
  for (const [key, parse] of [
    ["provisioning", parseDirectProvisioningStatus],
    ["provisioningNotRequested", parseDirectProvisioningStatus],
    ["provisioningFailed", parseDirectProvisioningStatus],
    ["memberGrants", parseWorkspaceMemberGrants],
    ["verifierRequestPostgres", parseDirectVerifierRequest],
    ["verifierRequestMysql", parseDirectVerifierRequest],
    ["workList", parseDirectWorkList],
    ["receipt", parseDirectReceiptRequest],
  ] as const) expect(parse(direct[key]), key).toEqual(direct[key]);
  const workList = direct.workList as { revocations: unknown[] };
  expect(parseDirectRevocationEntry(workList.revocations[0])).toEqual(workList.revocations[0]);

  for (const rejection of fixture.directAccessRejections) {
    const [key, parse] = rejection.contract === "directRevocation"
      ? ["", parseDirectRevocationEntry] as const
      : parsers[rejection.contract];
    const base = rejection.contract === "directRevocation" ? workList.revocations[0] : direct[key];
    const candidate = applyMutations(base, rejection as never);
    expect(() => parse(candidate), rejection.name).toThrow(/^Invalid direct (access contract|scope)$/u);
  }

  // Effective level: role x capability x write ceiling, reusing the grant projection.
  const levels = (role: WorkspaceRoleName, capability: string, writeCeiling: boolean) =>
    directDesiredLevel({ role, capability, writeCeiling });
  for (const role of ["viewer", "analyst", "editor", "admin", "owner"] as const) {
    expect(levels(role, "view", true), `${role} view`).toBe("none");
    expect(levels(role, "read", true), `${role} read`).toBe("read");
    for (const capability of ["use", "manage"]) {
      expect(levels(role, capability, false), `${role} ${capability} no ceiling`).toBe("read");
    }
  }
  expect(levels("viewer", "use", true)).toBe("read");
  expect(levels("analyst", "use", true)).toBe("read");
  expect(levels("editor", "use", true)).toBe("write");
  expect(levels("editor", "manage", true)).toBe("write");
  expect(levels("admin", "manage", true)).toBe("write");
  expect(levels("owner", "unknown", true)).toBe("none");
  expect(levels("unknown" as WorkspaceRoleName, "read", true)).toBe("none");
  for (const absent of [
    { memberPresent: false }, { revocationPending: true }, { connectionDeleted: true },
  ]) {
    expect(directDesiredLevel({ role: "owner", capability: "manage", writeCeiling: true, ...absent })).toBe("none");
  }

  // Server-generated identity and the closed state machine.
  expect(isValidPrincipalName(generatePrincipalName())).toBe(true);
  expect(isValidPrincipalMarker(generatePrincipalMarker())).toBe(true);
  expect(generatePrincipalName()).not.toBe(generatePrincipalName());
  for (const bad of ["dopedb_", "dopedb_0123456789ABCDEF0123", "x_0123456789abcdef0123", "dopedb_0123456789abcdef01234", "dopedb_0123456789abcdef012\""]) {
    expect(isValidPrincipalName(bad), bad).toBe(false);
  }
  expect(isDirectTransitionAllowed("requested", "applying")).toBe(true);
  expect(isDirectTransitionAllowed("dropped", "requested")).toBe(false);
  expect(isDirectTransitionAllowed("drop_pending", "ready")).toBe(false);

  // Registration input: secretless, engine-specific TLS modes, bounded scope.
  const endpoint = {
    name: "Orders", engine: "postgres", host: "db.example.test", port: 5432, database: "orders",
    scope: ["public"], writeCeiling: true,
  };
  const parsed = parseDirectEndpoint(endpoint);
  expect(parsed.connection).toMatchObject({
    provider: "generic", sslmode: "verify-full", readonlyDefault: true, allowWrites: false,
  });
  expect(parsed.writeCeiling).toBe(true);
  expect(parseDirectEndpoint({ ...endpoint, scope: ["x".repeat(63)] }).scope).toHaveLength(1);
  expect(() => parseDirectEndpoint({ ...endpoint, engine: "mysql", scope: ["sys"], sslmode: "REQUIRED" })).toThrow();
  expect(parseDirectEndpoint({ ...endpoint, engine: "mysql", scope: ["x".repeat(64)], sslmode: "REQUIRED" }).connection.sslmode).toBe("REQUIRED");
  expect(parseDirectEndpoint({ ...endpoint, engine: "mysql", scope: ["app"], sslmode: "VERIFY_IDENTITY" }).connection.sslmode)
    .toBe("VERIFY_IDENTITY");
  for (const bad of [
    { password: "x" }, { username: "x" }, { connectionString: "postgres://x" }, { verifier: "x" },
    { engine: "mongodb" }, { engine: "mysql", sslmode: "verify-full" }, { sslmode: "disable" },
    { host: "user@db.example.test" }, { host: "postgres://db" }, { port: 0 }, { port: 70000 },
    { scope: [] }, { scope: ["public", "public"] }, { scope: ["pg_catalog"] }, { scope: ["a\nb"] },
    { scope: Array.from({ length: 33 }, (_, i) => `s${i}`) }, { scope: ["x".repeat(64)] }, { scope: ["a\"b"] }, { scope: ["a`b"] }, { scope: ["a'b"] }, { scope: ["a\\b"] }, { scope: ["a%b"] }, { scope: ["information_schema"] },
    { writeCeiling: "yes" }, { database: "" },
  ]) expect(() => parseDirectEndpoint({ ...endpoint, ...bad }), JSON.stringify(bad)).toThrow();

  // Public projection: wire credential mode stays member_local; write needs the ceiling and a write grant.
  const row = {
    id: "c", name: "Orders", engine: "postgres", provider: "generic", driverId: null, host: "h", port: 5432,
    databaseName: "orders", sslmode: "verify-full", readonlyDefault: true, allowWrites: false,
    environment: null, schemaGroup: null, credentialMode: "member_local", contentRevision: 1,
    updatedAt: new Date("2026-10-20T00:00:00Z"),
  };
  const principal = {
    state: "ready" as const, appliedLevel: "write" as const, principalName: "dopedb_0123456789abcdef0123",
    lastSyncedAt: new Date("2026-10-20T01:00:00Z"), failureCode: null,
  };
  const withCeiling = publicConnection(row, "editor", "write", false, false, { writeCeiling: true, principal });
  expect(withCeiling).toMatchObject({
    credentialMode: "member_local", credentialsRequired: false, allowWrites: true,
    provisioning: { state: "ready", level: "write", principalName: principal.principalName, failureCode: null },
  });
  expect(publicConnection(row, "editor", "write", false, false, { writeCeiling: false, principal }).allowWrites).toBe(false);
  expect(publicConnection(row, "analyst", "read", false, false, { writeCeiling: true, principal }).allowWrites).toBe(false);
  expect(publicConnection(row, "editor", "write", false, false, { writeCeiling: true, principal: null }).provisioning)
    .toMatchObject({ state: "not_requested", level: "none", principalName: null });
  expect(publicConnection(row, "editor", "write").provisioning).toBeNull();
  expect(publicConnection(row, "editor", "write").credentialsRequired).toBe(true);
  expect(JSON.stringify(withCeiling)).not.toMatch(/verifier|marker|password|SCRAM/iu);
}
