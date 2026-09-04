import { describe, expect, it, vi } from "vitest";
import type { SafetySettings } from "../../ipc/types";
import {
  connectionId,
  type ConnectionProfile,
} from "../connections/domain";
import { persistConnectionSafety } from "../safetySettings/persistence";
import {
  canManageWorkspaceWritePolicy,
  effectiveSafetySettings,
  requestedSafetySettings,
  safetySchemaControlAvailable,
  safetyWriteControlAvailable,
  writeBlockRecoveryKind,
  writeBlockRecoveryOpensSafety,
} from "../safetySettings/policy";
import { approveManualOperationIfRequired } from "../queries/runPath";
import { analyzeRunSignal, localizeRunSignal } from "./runSignal";

const safety: SafetySettings = {
  allowWrites: false,
  allowSchemaChanges: false,
  wrapWritesInTx: true,
  explainPreview: true,
  autoRunReads: true,
  maxRows: 500,
  execPreviewRowLimit: 50,
};

const t = (key: string, vars?: Record<string, string | number>) =>
  `${key}${vars ? `:${JSON.stringify(vars)}` : ""}`;

const buildRunSignal = (
  sql: string,
  statements: string[],
  settings: SafetySettings,
  translate: typeof t,
) => localizeRunSignal(analyzeRunSignal(sql, statements, settings), translate);

describe("SQL run guidance", () => {
  it("warns before a write while one Safety control owns manual approval", async () => {
    const requestedWrites = { ...safety, allowWrites: true };
    expect(
      effectiveSafetySettings(
        {
          allowWrites: false,
          credentialMode: "local",
          workspaceAccess: "local",
        },
        requestedWrites,
      ).allowWrites,
    ).toBe(false);
    expect(
      effectiveSafetySettings(
        {
          allowWrites: true,
          credentialMode: "memberLocal",
          workspaceAccess: "write",
        },
        requestedWrites,
      ).allowWrites,
    ).toBe(false);
    expect(
      effectiveSafetySettings(
        {
          allowWrites: true,
          credentialMode: "managed",
          workspaceAccess: "write",
        },
        requestedWrites,
      ).allowWrites,
    ).toBe(true);
    const localConnection = {
      allowWrites: false,
      credentialMode: "local" as const,
      workspaceAccess: "local" as const,
    };
    expect(safetyWriteControlAvailable(localConnection)).toBe(true);
    expect(safetyWriteControlAvailable({
      ...localConnection,
      engine: "bigquery",
    })).toBe(false);
    expect(
      requestedSafetySettings(localConnection, {
        ...safety,
        allowWrites: true,
      }).allowWrites,
    ).toBe(true);
    expect(
      requestedSafetySettings(
        {
          allowWrites: true,
          credentialMode: "memberLocal",
          workspaceAccess: "write",
        },
        { ...safety, allowWrites: true },
      ).allowWrites,
    ).toBe(false);
    const managedConnection = {
      allowWrites: true,
      credentialMode: "managed" as const,
      workspaceAccess: "write" as const,
    };
    expect(safetyWriteControlAvailable(managedConnection)).toBe(true);
    expect(
      requestedSafetySettings(managedConnection, {
        ...safety,
        allowWrites: false,
      }).allowWrites,
    ).toBe(false);
    const managedWorkspaceManager = {
      allowWrites: false,
      credentialMode: "managed" as const,
      workspaceAccess: "manage" as const,
      provider: "neon" as const,
      engine: "postgres" as const,
    };
    expect(canManageWorkspaceWritePolicy(managedWorkspaceManager)).toBe(true);
    expect(safetyWriteControlAvailable(managedWorkspaceManager)).toBe(true);
    expect(safetySchemaControlAvailable(managedWorkspaceManager)).toBe(true);
    expect(
      requestedSafetySettings(managedWorkspaceManager, {
        ...safety,
        allowWrites: true,
      }).allowWrites,
    ).toBe(true);
    expect(
      requestedSafetySettings(managedWorkspaceManager, {
        ...safety,
        allowWrites: true,
        allowSchemaChanges: true,
      }),
    ).toMatchObject({ allowWrites: true, allowSchemaChanges: true });
    expect(safetySchemaControlAvailable({
      ...managedWorkspaceManager,
      provider: "gcpCloudSql",
    })).toBe(true);
    expect(
      requestedSafetySettings(
        { ...managedWorkspaceManager, provider: "gcpCloudSql" },
        { ...safety, allowWrites: true, allowSchemaChanges: true },
      ),
    ).toMatchObject({ allowWrites: true, allowSchemaChanges: true });
    expect(safetySchemaControlAvailable({
      ...managedWorkspaceManager,
      provider: "gcpCloudSql",
      engine: "mysql",
    })).toBe(false);
    expect(canManageWorkspaceWritePolicy({
      ...managedWorkspaceManager,
      workspaceAccess: "write",
    })).toBe(false);
    expect(safetyWriteControlAvailable({
      ...managedWorkspaceManager,
      workspaceAccess: "write",
    })).toBe(false);
    const blockedWrite = {
      kind: "blocked",
      message: "blocked: writes are disabled for this connection",
    };
    expect(
      writeBlockRecoveryKind(managedWorkspaceManager, blockedWrite),
    ).toBe("workspacePolicyAndDevice");
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          workspaceAccess: "write",
        },
        blockedWrite,
      ),
    ).toBe("workspacePolicy");
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
          workspaceAccess: "write",
        },
        blockedWrite,
      ),
    ).toBe("deviceSafety");
    expect(writeBlockRecoveryKind(localConnection, blockedWrite)).toBe(
      "localSafety",
    );
    expect(
      writeBlockRecoveryKind(
        {
          allowWrites: true,
          credentialMode: "memberLocal",
          workspaceAccess: "write",
        },
        blockedWrite,
      ),
    ).toBe("managedCredential");
    expect(
      writeBlockRecoveryKind(
        {
          allowWrites: true,
          credentialMode: "managed",
          workspaceAccess: "read",
        },
        blockedWrite,
      ),
    ).toBe("workspaceGrant");
    expect(
      writeBlockRecoveryKind(managedWorkspaceManager, {
        kind: "blocked",
        message: "blocked: multiple statements are not allowed",
      }),
    ).toBeNull();
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
        },
        {
          kind: "database",
          message: "permission denied for schema public",
          sql: 'CREATE TABLE "events" ("id" bigint)',
        },
      ),
    ).toBe("schemaSafety");
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
        },
        {
          kind: "database",
          message: "must be owner of schema public",
          sql: `${"/* reviewed */".repeat(2_000)}\n-- migration\nALTER TABLE events ADD COLUMN source text`,
        },
      ),
    ).toBe("schemaSafety");
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
        },
        {
          kind: "database",
          message: "must be owner of schema public",
          sql: "/* unterminated CREATE TABLE events (id bigint)",
        },
      ),
    ).toBeNull();
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
          provider: "gcpCloudSql",
        },
        {
          kind: "blocked",
          message: "schema changes are disabled for this connection",
        },
      ),
    ).toBe("schemaSafety");
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
          workspaceAccess: "write",
        },
        {
          kind: "blocked",
          message: "schema changes are disabled for this connection",
        },
      ),
    ).toBe("workspaceGrant");
    expect(writeBlockRecoveryOpensSafety("schemaSafety")).toBe(true);
    expect(writeBlockRecoveryOpensSafety("schemaUnavailable")).toBe(true);
    expect(writeBlockRecoveryOpensSafety("workspaceGrant")).toBe(false);
    expect(
      writeBlockRecoveryKind(
        {
          ...managedWorkspaceManager,
          allowWrites: true,
        },
        {
          kind: "blocked",
          message: "schema changes are disabled for this connection",
        },
      ),
    ).toBe("schemaSafety");

    const managedProfile: ConnectionProfile = {
      id: connectionId("00000000-0000-4000-8000-000000000010"),
      name: "managed",
      engine: "postgres",
      provider: "gcpCloudSql",
      driverId: null,
      host: "127.0.0.1",
      port: 5432,
      database: "app",
      username: "",
      sslmode: "require",
      extraParams: {},
      readonlyDefault: true,
      allowWrites: false,
      secretRef: null,
      env: "prod",
      schemaGroup: null,
      workspaceAccess: "manage",
      credentialMode: "managed",
      providerTarget: null,
    };
    const persistenceOrder: string[] = [];
    const setWorkspaceWritePolicy = vi.fn(async (
      _id: ConnectionProfile["id"],
      allowWrites: boolean,
    ) => {
      persistenceOrder.push(`workspace:${allowWrites}`);
      return { ...managedProfile, allowWrites };
    });
    await expect(persistConnectionSafety(
      managedProfile,
      { ...safety, allowWrites: true },
      {
        setDeviceSafety: async () => {
          persistenceOrder.push("device:true");
        },
        setWorkspaceWritePolicy,
      },
    )).resolves.toMatchObject({ allowWrites: true });
    expect(persistenceOrder).toEqual(["workspace:true", "device:true"]);

    persistenceOrder.length = 0;
    await expect(persistConnectionSafety(
      managedProfile,
      { ...safety, allowWrites: true },
      {
        setDeviceSafety: async () => {
          persistenceOrder.push("device:true");
          throw new Error("device write failed");
        },
        setWorkspaceWritePolicy,
      },
    )).rejects.toThrow("device write failed");
    expect(persistenceOrder).toEqual([
      "workspace:true",
      "device:true",
      "workspace:false",
    ]);

    persistenceOrder.length = 0;
    await expect(persistConnectionSafety(
      { ...managedProfile, allowWrites: true },
      safety,
      {
        setDeviceSafety: async () => {
          persistenceOrder.push("device:false");
        },
        setWorkspaceWritePolicy,
      },
    )).resolves.toMatchObject({ allowWrites: false });
    expect(persistenceOrder).toEqual(["device:false", "workspace:false"]);

    const approve = vi.fn().mockResolvedValue(undefined);
    await expect(
      approveManualOperationIfRequired(
        {
          operationId: "00000000-0000-4000-8000-000000000001",
          payloadHash: "a".repeat(64),
          approvalRequired: true,
          confirmationPhrase: "PROD",
        },
        approve,
      ),
    ).resolves.toBe(true);
    expect(approve).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "a".repeat(64),
      "PROD",
    );
    expect(buildRunSignal("UPDATE users SET active = 0", [], safety, t)).toEqual({
      tone: "warning",
      icon: "alert",
      text: "sql.signalNoWhere",
    });
    expect(
      buildRunSignal("UPDATE users SET active = 0 WHERE id = 1", [], safety, t),
    ).toEqual({
      tone: "danger",
      icon: "alert",
      text: "sql.signalWritesDisabled",
    });
    expect(
      buildRunSignal(
        "UPDATE users SET active = 0 WHERE id = 1",
        [],
        safety,
        t,
      ),
    ).toEqual({
      tone: "danger",
      icon: "alert",
      text: "sql.signalWritesDisabled",
    });
    expect(buildRunSignal(
      "UPDATE users SET active = 0 WHERE id = 1",
      [],
      { ...safety, allowWrites: true },
      t,
    )).toEqual({
      tone: "warning",
      icon: "alert",
      text: "sql.signalWriteStatement",
    });
    expect(buildRunSignal(
      "CREATE TABLE events (id bigint)",
      [],
      { ...safety, allowWrites: true },
      t,
    )).toEqual({
      tone: "danger",
      icon: "alert",
      text: "sql.signalSchemaDisabled",
    });
    expect(buildRunSignal(
      "SELECT * INTO archived_users FROM users",
      [],
      { ...safety, allowWrites: true },
      t,
    )).toEqual({
      tone: "danger",
      icon: "alert",
      text: "sql.signalSchemaDisabled",
    });
    expect(buildRunSignal(
      "CREATE TABLE events (id bigint)",
      [],
      { ...safety, allowWrites: true, allowSchemaChanges: true },
      t,
    )).toEqual({
      tone: "warning",
      icon: "alert",
      text: "sql.signalWriteStatement",
    });
  });

  it("describes a multi-statement read without granting execution", () => {
    expect(
      buildRunSignal(
        "SELECT 1; SELECT 2;",
        ["SELECT 1", "SELECT 2"],
        safety,
        t,
      ),
    ).toEqual({
      tone: "muted",
      icon: "info",
      text: 'sql.signalReadScript:{"count":2}',
    });
  });

  it("shows the enforced row cap for an unbounded read", () => {
    expect(buildRunSignal("SELECT * FROM users", [], safety, t)).toEqual({
      tone: "muted",
      icon: "info",
      text: 'sql.signalReadCap:{"count":500}',
    });
  });
});
