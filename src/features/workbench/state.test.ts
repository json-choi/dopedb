import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  connectionId,
  retrySqlDocumentConflict,
  sqlDocumentConflict,
  sqlDocumentId,
  type SqlDocument,
} from "../sqlDocuments/domain";
import {
  findSqlParameters,
  materializeSqlParameters,
} from "../query/sqlParameters";
import { resolveSqlNamespaceAtCaret } from "../queries/resolveMode";
import {
  sqlExecutionMarkerPosition,
  sqlRunSourceFromSelection,
} from "../queries/editorStatus";
import {
  canFallbackFromCombinedRead,
  initialSqlRunPath,
} from "../queries/runPath";
import { queryDocument, stableDocument } from "./domain";
import {
  publishWorkbenchDraft,
  readWorkbenchDraft,
  seedWorkbenchDraft,
} from "./draftStore";
import { emptyWorkbenchState, workbenchReducer } from "./state";
import {
  appShellNavigationReducer,
  initialAppShellMode,
} from "../appShell/navigationState";
import {
  AppUpdaterController,
  type AppUpdateResource,
  type AppUpdaterDownloadEvent,
} from "../updater/controller";
import {
  connectionDiagnosticBlocksTest,
  diagnoseConnection,
} from "../connections/diagnostics";
import {
  connectionUrlNeedsDatabaseSelection,
  parseConnectionUrl,
} from "../connections/connectionUrl";
import {
  canRecoverBigQueryAuthentication,
  connectionId as connectionProfileId,
  type DriverDescriptor,
} from "../connections/domain";
import {
  connectionTestFailureRecovery,
  connectionTestFailureTarget,
  connectionTestFailureTitle,
} from "../connections/connectionTestFailure";
import { switchConnectionSource } from "../connections/connectionEditorModel";
import {
  BIGQUERY_AUTH_MODE_PARAMETER,
  bigQueryAuthMode,
  bigQueryResourceInputMode,
  isValidBigQueryDatasetId,
  isValidBigQueryProjectId,
} from "../connections/bigQueryOnboardingModel";
import { connectionQueryKeys } from "../connections/queries";
import {
  CONNECTION_SSH_ALIAS_PARAMETER,
  isConnectionOptionSupported,
} from "../connections/options";
import {
  blankConnection,
  demoSqliteConnection,
  findDemoSqliteConnection,
} from "../connections/presets";
import {
  ensureGuidedDemoEnvironment,
  GUIDED_DEMO_ENVIRONMENT_NAME,
  GUIDED_DEMO_PROJECT_NAME,
  selectGuidedDemoEnvironment,
} from "../onboarding/demoSetup";
import { findAgentSqlProposal, isSqlProposalTool } from "../agents/sqlProposal";
import { actionSearchShortcutTargetIsEditable } from "../actionSearch/useActionSearchDialog";
import { tabFocusTargetIndex } from "../../design-system/tabKeyboard";
import {
  treeKeyboardMoveTarget,
  virtualTreeFocusIndex,
} from "../../design-system/treeKeyboard";
import {
  catalogLoadIssue,
  distinctCatalogDetailIssue,
  filterLoadedCatalogObjects,
  isAuthenticationRequired,
  isManagedConnectionRecoveryRequired,
  supportedObjectKinds,
} from "../catalogExplorer/catalogDomain";
import {
  flattenProjectEnvironmentResources,
  moveProjectDatabaseResource,
  orderProjectDatabaseResources,
  preferredProjectEnvironment,
  preferredProjectDatabaseDropTarget,
  projectConnectionAssignment,
  projectDatabasesDropTargets,
  projectResourceKey,
  promotedProjectConnectionSourceId,
} from "../catalogExplorer/projectResources";
import { knowledgeEnvironmentBadge } from "../knowledge/presentation";
import type { Catalog, CatalogObject, CatalogTable } from "../../ipc/types";
import {
  modalMouseDownShouldReachNativeDragRegion,
  ModalTitleBar,
} from "../../design-system/components/Modal";
import { queryResultPhase } from "../../lib/queryResultPhase";
import { compareCatalogs, diffCounts } from "../../lib/schemaDiff";
import { tableRef } from "../../lib/tableRef";
import type { I18nKey } from "../../lib/i18n";
import { workspaceManagedConnectionSettingsUrl } from "../workspaces/navigation";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function storedDocument(id = "doc-1"): SqlDocument {
  return {
    id: sqlDocumentId(id),
    connectionId: connectionId("db-1"),
    title: "Saved query",
    dialect: "postgresql",
    selectedDatabase: "app",
    selectedSchema: "billing",
    resolveMode: "script",
    content: "SELECT 1;",
    localRevision: 2,
    remoteId: null,
    remoteRevision: null,
    dirty: true,
    syncStatus: "local",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("workbench state ownership", () => {
  it("restores persisted SQL without removing the connection welcome document", () => {
    const key = (value: I18nKey) => value;
    const managedManager = {
      credentialMode: "managed" as const,
      workspaceAccess: "manage" as const,
    };
    const managedMember = {
      credentialMode: "managed" as const,
      workspaceAccess: "read" as const,
    };
    expect(
      connectionTestFailureTitle(key, "timeoutNetwork", managedManager),
    ).toBe("connections.testFailure.managedTitle");
    expect(
      connectionTestFailureRecovery(key, "authentication", managedManager),
    ).toBe("connections.testFailure.managedManagerRecovery");
    expect(
      connectionTestFailureRecovery(key, "tls", managedMember),
    ).toBe("connections.testFailure.managedMemberRecovery");
    expect(connectionTestFailureTarget({
      code: "authentication",
      field: "credentials",
      detail: "redacted",
    }, managedManager)).toBeNull();

    const managedConnectionId = connectionProfileId(
      "55555555-5555-4555-8555-555555555555",
    );
    const recoveryUrl = new URL(workspaceManagedConnectionSettingsUrl(
      "https://workspace.example.test/settings?workspace=11111111-1111-4111-8111-111111111111#workspace-11111111-1111-4111-8111-111111111111",
      managedConnectionId,
    ));
    expect(recoveryUrl.searchParams.get("workspace")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(recoveryUrl.searchParams.get("section")).toBe("databases");
    expect(recoveryUrl.searchParams.get("connection")).toBe(managedConnectionId);
    expect(recoveryUrl.hash).toBe(`#database-${managedConnectionId}`);

    const selectedDraft = "SELECT 1;\n  SELECT 2;  \nSELECT 3;";
    const selectedStart = selectedDraft.indexOf("  SELECT 2;");
    const selectedEnd = selectedDraft.indexOf("\nSELECT 3;");
    expect(
      sqlRunSourceFromSelection(selectedDraft, selectedStart, selectedEnd),
    ).toEqual({
      sql: "SELECT 2;",
      from: selectedStart + 2,
      to: selectedEnd - 2,
    });
    expect(sqlRunSourceFromSelection(selectedDraft, 0, 0)).toBeUndefined();

    expect(queryResultPhase(undefined, new Error("offline"))).toBe("coldError");
    expect(queryResultPhase(undefined, null)).toBe("coldLoading");
    expect(queryResultPhase([], new Error("offline"))).toBe("staleError");
    expect(queryResultPhase([], null)).toBe("loaded");

    const welcome = stableDocument("db-1", "welcome");
    const initialized = workbenchReducer(emptyWorkbenchState, {
      type: "initialize",
      document: welcome,
    });
    const restored = workbenchReducer(initialized, {
      type: "restoreSql",
      connectionId: "db-1",
      documents: [storedDocument()],
      activateFirst: true,
    });

    expect(restored.documents.map((document) => document.kind)).toEqual([
      "welcome",
      "sql",
    ]);
    expect(restored.activeDocumentId).toContain(":sql:doc-1");
  });

  it("keeps one document instance and moves only the active pointer", async () => {
    const query = queryDocument("db-1", "sql");
    const first = workbenchReducer(emptyWorkbenchState, {
      type: "activate",
      document: query,
    });
    const second = workbenchReducer(first, {
      type: "activate",
      document: query,
    });

    expect(second.documents).toHaveLength(1);
    expect(second.activeDocumentId).toBe(query.id);

    seedWorkbenchDraft(query.id, query.draft ?? "");
    publishWorkbenchDraft(query.id, "SELECT 42;");
    expect(readWorkbenchDraft(query.id, "SELECT 0;")).toBe("SELECT 42;");
    seedWorkbenchDraft(query.id, "SELECT 84;");
    expect(readWorkbenchDraft(query.id, "SELECT 0;")).toBe("SELECT 84;");
    expect(second.documents[0]).toBe(query);

    const editing = appShellNavigationReducer(initialAppShellMode, {
      type: "openConnectionEditor",
      target: { kind: "existing", connectionId: "db-1" },
    });
    const settings = appShellNavigationReducer(editing, {
      type: "openSettings",
      section: "safety",
    });
    expect(settings).toEqual({
      kind: "settings",
      route: { kind: "workbench" },
      section: "safety",
    });
    expect(
      appShellNavigationReducer(settings, { type: "closeSettings" }),
    ).toEqual({ kind: "content", route: { kind: "workbench" } });

    const knowledge = appShellNavigationReducer(initialAppShellMode, {
      type: "openKnowledge",
      focus: {
        environmentId: "environment-1",
        view: "sources",
        resourceId: null,
        requestId: 1,
      },
    });
    expect(
      appShellNavigationReducer(knowledge, {
        type: "openSchemaDiff",
        groupKey: "schema-group",
      }),
    ).toEqual({
      kind: "content",
      route: { kind: "schemaDiff", groupKey: "schema-group" },
    });

    const firstDownload = deferred<void>();
    const retryDownload = deferred<void>();
    const relaunch = deferred<void>();
    const downloadCallbacks: Array<
      ((event: AppUpdaterDownloadEvent) => void) | undefined
    > = [];
    let checkCalls = 0;
    let downloadCalls = 0;
    let closeCalls = 0;
    let relaunchCalls = 0;
    const update: AppUpdateResource = {
      version: "0.3.55",
      body: "Release notes",
      downloadAndInstall(callback) {
        downloadCallbacks.push(callback);
        const operation = downloadCalls === 0 ? firstDownload : retryDownload;
        downloadCalls += 1;
        return operation.promise;
      },
      async close() {
        closeCalls += 1;
      },
    };
    const updater = new AppUpdaterController({
      async currentVersion() {
        return "0.3.54";
      },
      async check() {
        checkCalls += 1;
        return update;
      },
      async relaunch() {
        relaunchCalls += 1;
        return relaunch.promise;
      },
      errorMessage: (error) => String(error),
    });

    const firstCheck = updater.refresh();
    expect(updater.refresh()).toBe(firstCheck);
    await firstCheck;
    expect(checkCalls).toBe(1);
    expect(updater.getSnapshot()).toMatchObject({
      phase: "available",
      currentVersion: "0.3.54",
      availableVersion: "0.3.55",
    });

    const stopObserving = updater.subscribe(() => undefined);
    const failedInstall = updater.install();
    expect(updater.install()).toBe(failedInstall);
    downloadCallbacks[0]?.({
      event: "Started",
      data: { contentLength: 1_000 },
    });
    downloadCallbacks[0]?.({
      event: "Progress",
      data: { chunkLength: 400 },
    });
    expect(updater.getSnapshot()).toMatchObject({
      phase: "downloading",
      downloadedBytes: 400,
      totalBytes: 1_000,
    });
    stopObserving();
    expect(updater.getSnapshot().downloadedBytes).toBe(400);
    firstDownload.reject(new Error("network"));
    await failedInstall;
    expect(updater.getSnapshot().phase).toBe("error");
    expect(closeCalls).toBe(0);

    const retriedInstall = updater.install();
    expect(updater.install()).toBe(retriedInstall);
    retryDownload.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(updater.getSnapshot().phase).toBe("ready");
    expect(relaunchCalls).toBe(1);
    expect(closeCalls).toBe(0);
    relaunch.resolve();
    await retriedInstall;
    expect(downloadCalls).toBe(2);
    expect(closeCalls).toBe(1);
    updater.dispose();
  });

  it("keeps an engine-specific query surface when the last tab closes", () => {
    const query = queryDocument("db-1", "sql");
    const state = workbenchReducer(emptyWorkbenchState, {
      type: "activate",
      document: query,
    });
    const closed = workbenchReducer(state, {
      type: "close",
      id: query.id,
      connectionId: "db-1",
      fallbackKind: "welcome",
    });

    expect(closed.documents).toEqual([stableDocument("db-1", "welcome")]);
    expect(closed.activeDocumentId).toBe("db-1:welcome");

    const mongoQuery = queryDocument("mongo-1", "documents");
    const mongoState = workbenchReducer(emptyWorkbenchState, {
      type: "activate",
      document: mongoQuery,
    });
    const mongoClosed = workbenchReducer(mongoState, {
      type: "close",
      id: mongoQuery.id,
      connectionId: "mongo-1",
      fallbackKind: "documents",
    });

    expect(mongoClosed.documents).toHaveLength(1);
    expect(mongoClosed.documents[0]?.kind).toBe("documents");
    expect(mongoClosed.activeDocumentId).toBe(mongoClosed.documents[0]?.id);
  });

  it("applies a successful save through the one state reducer", async () => {
    const query = queryDocument("db-1", "sql", "SELECT 0;");
    const state = workbenchReducer(emptyWorkbenchState, {
      type: "activate",
      document: query,
    });
    const databaseSelected = workbenchReducer(state, {
      type: "updateSelectedDatabase",
      id: query.id,
      selectedDatabase: "analytics",
    });
    const databaseDocument = databaseSelected.documents[0];
    expect(databaseDocument?.kind === "sql" && databaseDocument.selectedSchema).toBeNull();
    const selected = workbenchReducer(databaseSelected, {
      type: "updateSelectedSchema",
      id: query.id,
      selectedSchema: "public",
    });
    const resolved = workbenchReducer(selected, {
      type: "updateResolveMode",
      id: query.id,
      resolveMode: "playground",
    });
    const persisted = workbenchReducer(resolved, {
      type: "persist",
      id: query.id,
      document: storedDocument(),
    });
    const current = persisted.documents[0];

    expect(current?.kind).toBe("sql");
    if (current?.kind !== "sql") throw new Error("expected SQL document");
    expect(current.draft).toBe("SELECT 1;");
    expect(current.revision).toBe(2);
    expect(current.selectedDatabase).toBe("app");
    expect(current.selectedSchema).toBe("billing");
    expect(current.resolveMode).toBe("script");
    expect(
      resolveSqlNamespaceAtCaret({
        sqlBeforeCaret:
          "SELECT * FROM users;\nSET search_path TO billing;\nSELECT * FROM invoices",
        engine: "postgres",
        mode: current.resolveMode,
        selectedNamespace: "public",
        namespaceOptions: ["billing", "public"],
      }),
    ).toBe("billing");
    expect(
      resolveSqlNamespaceAtCaret({
        sqlBeforeCaret:
          "-- SET search_path TO billing;\nSELECT 'USE billing' AS note",
        engine: "postgres",
        mode: "script",
        selectedNamespace: "public",
        namespaceOptions: ["billing", "public"],
      }),
    ).toBe("public");

    expect(initialSqlRunPath(true, "SELECT * FROM invoices")).toBe(
      "combinedReadStream",
    );
    expect(
      initialSqlRunPath(true, "-- invoice list\nSELECT * FROM invoices"),
    ).toBe("combinedReadStream");
    expect(
      initialSqlRunPath(
        true,
        "UPDATE invoices SET state = state WHERE 1 = 0",
      ),
    ).toBe("plannedReadStream");
    expect(
      initialSqlRunPath(
        true,
        "WITH changed AS (DELETE FROM invoices RETURNING id) SELECT * FROM changed",
      ),
    ).toBe("plannedReadStream");
    expect(
      initialSqlRunPath(true, "SELECT * FROM invoices FOR UPDATE"),
    ).toBe("plannedReadStream");
    expect(initialSqlRunPath(false, "SELECT * FROM invoices")).toBe(
      "plannedReadStream",
    );
    expect(canFallbackFromCombinedRead("proposalRequired")).toBe(true);
    expect(canFallbackFromCombinedRead("network")).toBe(false);

    const parameterSql =
      "SELECT * FROM invoices WHERE account_id = :account AND created_at >= ${since}";
    const parameters = findSqlParameters(parameterSql, "postgres");
    expect(materializeSqlParameters(parameterSql, parameters, {
      "named:account": "42",
      "named:since": "DATE '2026-01-01'",
    })).toBe(
      "SELECT * FROM invoices WHERE account_id = 42 AND created_at >= DATE '2026-01-01'",
    );

    const executedSql = "SELECT 1;\nSELECT 2;";
    const executionStatus = {
      source: { sql: "SELECT 2;", from: 10, to: 19 },
      state: "completed" as const,
      label: "Completed",
    };
    expect(sqlExecutionMarkerPosition(executedSql, executionStatus)).toBe(19);
    expect(
      sqlExecutionMarkerPosition("SELECT 1;\nSELECT 3;", executionStatus),
    ).toBeNull();

    const conflict = sqlDocumentConflict(storedDocument(), {
      title: "Local query",
      selectedDatabase: "analytics",
      selectedSchema: "public",
      resolveMode: "playground",
      content: "SELECT * FROM events;",
    });
    expect(retrySqlDocumentConflict(conflict)).toEqual({
      expectedRevision: 2,
      title: "Local query",
      selectedDatabase: "analytics",
      selectedSchema: "public",
      resolveMode: "playground",
      content: "SELECT * FROM events;",
    });

    const postgresDriver: DriverDescriptor = {
      id: "sqlx-postgres",
      name: "PostgreSQL",
      engine: "postgres",
      version: "1",
      installMode: "bundled",
      installState: "installed",
      supportedProviders: ["auto", "generic"],
      capabilities: ["sql"],
      recommended: true,
    };
    const nameless = { ...blankConnection(), database: "app" };
    const namelessDiagnostics = diagnoseConnection(
      nameless,
      [],
      [postgresDriver],
      false,
      false,
    );
    expect(namelessDiagnostics.map(({ code }) => code)).toEqual([
      "nameRequired",
    ]);
    expect(namelessDiagnostics.some(connectionDiagnosticBlocksTest)).toBe(
      false,
    );
    expect(
      namelessDiagnostics.some(({ tone }) => tone === "danger"),
    ).toBe(true);

    const mongo = switchConnectionSource(
      {
        ...nameless,
        driverId: postgresDriver.id,
        extraParams: {
          "dopedb.timeZone": "UTC",
          "dopedb.keepAliveSeconds": "30",
          "dopedb.startupScript": "SET application_name = 'dopedb'",
          sslrootcert: "/tmp/ca.pem",
        },
        schemaGroup: "public",
      },
      "mongodb",
      "generic",
    );
    expect(mongo).toMatchObject({
      engine: "mongodb",
      provider: "generic",
      driverId: null,
      port: 27017,
      sslmode: "prefer",
      schemaGroup: null,
      username: "",
      extraParams: {},
    });
    const mongoDiagnostics = diagnoseConnection(
      { ...mongo, database: "app" },
      [],
      [
        {
          ...postgresDriver,
          id: "mongodb",
          name: "MongoDB",
          engine: "mongodb",
          supportedProviders: ["generic"],
        },
      ],
      false,
      false,
    );
    expect(
      mongoDiagnostics.some(
        ({ fieldId }) => fieldId === "connection-username",
      ),
    ).toBe(false);
    const importedMongo = parseConnectionUrl(
      'MONGODB_URI="mongodb+srv://reader:secret@cluster.example.net/?retryWrites=true&w=majority"',
    );
    expect(importedMongo).not.toBeNull();
    expect(importedMongo?.update).toMatchObject({
      engine: "mongodb",
      host: "cluster.example.net",
      database: "",
      username: "reader",
      extraParams: {
        retryWrites: "true",
        w: "majority",
        srv: "true",
      },
    });
    expect(importedMongo?.password).toBe("secret");
    expect(
      connectionUrlNeedsDatabaseSelection(importedMongo!),
    ).toBe(true);
    expect(
      connectionUrlNeedsDatabaseSelection(
        parseConnectionUrl(
          "mongodb+srv://reader@cluster.example.net/app",
        )!,
      ),
    ).toBe(false);

    const bigQueryDriver: DriverDescriptor = {
      ...postgresDriver,
      id: "google-bq-cli",
      name: "Google BigQuery CLI",
      engine: "bigquery",
      version: ">=2.0.29",
      installMode: "managed",
      supportedProviders: ["generic"],
      capabilities: ["sql", "introspection"],
    };
    const bigQuery = switchConnectionSource(
      {
        ...nameless,
        name: "Warehouse",
        port: 9_999,
        schemaGroup: "analytics",
        extraParams: { "dopedb.sshAlias": "warehouse" },
      },
      "bigquery",
      "generic",
    );
    expect(bigQuery).toMatchObject({
      engine: "bigquery",
      provider: "generic",
      host: "",
      port: 443,
      database: "",
      username: "",
      sslmode: "require",
      readonlyDefault: true,
      allowWrites: false,
      schemaGroup: null,
      extraParams: { maximumBytesBilled: "1073741824" },
    });
    expect(bigQueryAuthMode(bigQuery)).toBe("googleAccount");
    expect(connectionQueryKeys.bigQueryAuth(bigQuery, "scope-a")).not.toEqual(
      connectionQueryKeys.bigQueryAuth(bigQuery, "scope-b"),
    );
    expect(canRecoverBigQueryAuthentication(bigQuery)).toBe(true);
    expect(
      canRecoverBigQueryAuthentication({
        ...bigQuery,
        workspaceAccess: "read",
        credentialMode: "memberLocal",
      }),
    ).toBe(true);
    expect(
      canRecoverBigQueryAuthentication({
        ...bigQuery,
        workspaceAccess: "view",
        credentialMode: "memberLocal",
      }),
    ).toBe(false);
    expect(
      canRecoverBigQueryAuthentication({
        ...bigQuery,
        workspaceAccess: "manage",
        credentialMode: "managed",
      }),
    ).toBe(false);
    expect(isValidBigQueryProjectId("sample-analytics-2026")).toBe(true);
    expect(isValidBigQueryProjectId("Sample-analytics-2026")).toBe(false);
    expect(isValidBigQueryDatasetId("analytics_2026")).toBe(true);
    expect(isValidBigQueryDatasetId("analytics-2026")).toBe(false);
    expect(bigQueryResourceInputMode(true, 2)).toBe("select");
    expect(bigQueryResourceInputMode(true, 0)).toBe("manual");
    expect(bigQueryResourceInputMode(false, 2)).toBe("manual");
    const expiredAuthentication = catalogLoadIssue({
      kind: "authenticationRequired",
      message: "Google Cloud authentication is required",
    });
    expect(isAuthenticationRequired(expiredAuthentication)).toBe(true);
    expect(
      distinctCatalogDetailIssue(expiredAuthentication, {
        ...expiredAuthentication,
      }),
    ).toBeUndefined();
    expect(
      distinctCatalogDetailIssue(expiredAuthentication, {
        kind: "network",
        message: "another failure",
      }),
    ).toEqual({ kind: "network", message: "another failure" });
    expect(expiredAuthentication.message).not.toContain("config error:");
    expect(
      isAuthenticationRequired(catalogLoadIssue(new Error("network"))),
    ).toBe(false);
    const managedConnectionRecovery = catalogLoadIssue({
      kind: "managedConnectionRecoveryRequired",
      message: "managed workspace connection repair is required",
    });
    expect(
      isManagedConnectionRecoveryRequired(managedConnectionRecovery),
    ).toBe(true);
    expect(
      isManagedConnectionRecoveryRequired(expiredAuthentication),
    ).toBe(false);
    const serviceAccountBigQuery = {
      ...bigQuery,
      extraParams: {
        ...bigQuery.extraParams,
        [BIGQUERY_AUTH_MODE_PARAMETER]: "serviceAccount",
        location: "US",
      },
    };
    expect(bigQueryAuthMode(serviceAccountBigQuery)).toBe("serviceAccount");
    expect(
      switchConnectionSource(
        serviceAccountBigQuery,
        "bigquery",
        "generic",
      ).extraParams,
    ).toEqual({
      authMode: "serviceAccount",
      location: "US",
      maximumBytesBilled: "1073741824",
    });
    expect(
      switchConnectionSource(
        serviceAccountBigQuery,
        "postgres",
        "auto",
      ).extraParams,
    ).not.toHaveProperty(BIGQUERY_AUTH_MODE_PARAMETER);
    expect(
      diagnoseConnection(
        {
          ...bigQuery,
          host: "sample-analytics-2026",
          database: "analytics_2026",
        },
        [],
        [bigQueryDriver],
        false,
        false,
      ),
    ).toEqual([]);
    expect(
      diagnoseConnection(
        {
          ...bigQuery,
          host: "UPPERCASE",
          database: "invalid-dataset",
          extraParams: { maximumBytesBilled: "0" },
        },
        [],
        [bigQueryDriver],
        false,
        false,
      ).map(({ code }) => code),
    ).toEqual([
      "bigQueryProjectInvalid",
      "bigQueryDatasetInvalid",
      "bigQueryMaximumBytesBilledInvalid",
    ]);
    expect(
      tableRef("bigquery", {
        schema: "analytics_2026",
        name: "orders",
      } as CatalogTable),
    ).toBe("`analytics_2026.orders`");
    expect(supportedObjectKinds("bigquery")).toEqual(
      new Set(["materialized_view"]),
    );
    const importedBigQuery = parseConnectionUrl(
      "bigquery://reader:secret@sample-analytics-2026:9999/analytics_2026?location=US&maximumBytesBilled=42&foo=discarded&schemaGroup=discarded&allowWrites=true",
    );
    expect(importedBigQuery).not.toBeNull();
    expect(importedBigQuery?.update).toMatchObject({
      engine: "bigquery",
      provider: "generic",
      host: "sample-analytics-2026",
      port: 443,
      database: "analytics_2026",
      username: "",
      sslmode: "require",
      readonlyDefault: true,
      allowWrites: false,
      extraParams: { location: "US", maximumBytesBilled: "42" },
    });
    expect(importedBigQuery?.update.schemaGroup).toBeUndefined();
    expect(importedBigQuery?.password).toBeNull();
    expect(
      isConnectionOptionSupported(
        CONNECTION_SSH_ALIAS_PARAMETER,
        "bigquery",
      ),
    ).toBe(false);

    const demo = demoSqliteConnection("/tmp/demos/dopedb-demo-v1.sqlite");
    expect(findDemoSqliteConnection([demo], demo.database)).toBe(demo);

    let createdProjects = 0;
    let boundConnections = 0;
    let agentEnvironments: Array<{
      id: string;
      projectName: string;
      name: string;
      riskClass: "development";
      graphRevisionCount: number;
    }> = [];
    const guidedDemoGateway = {
      listAgentEnvironments: async () => agentEnvironments,
      listProjects: async () => [],
      createProject: async () => {
        createdProjects += 1;
        return {
          id: "project-demo",
          name: GUIDED_DEMO_PROJECT_NAME,
          revision: 1,
          environments: [
            {
              id: "environment-demo",
              name: GUIDED_DEMO_ENVIRONMENT_NAME,
              riskClass: "development" as const,
              revision: 1,
            },
          ],
        };
      },
      createEnvironment: async () => {
        throw new Error("the default Environment should already exist");
      },
      bindConnection: async (input: {
        projectEnvironmentId: string;
        connectionId: string;
        role: string;
        alias: string;
      }) => {
        boundConnections += 1;
        agentEnvironments = [
          {
            id: input.projectEnvironmentId,
            projectName: GUIDED_DEMO_PROJECT_NAME,
            name: GUIDED_DEMO_ENVIRONMENT_NAME,
            riskClass: "development",
            graphRevisionCount: 0,
          },
        ];
        return {
          id: "binding-demo",
          projectEnvironmentId: input.projectEnvironmentId,
          environmentRevision: 1,
          connectionId: input.connectionId,
          remoteConnectionId: null,
          connectionRevision: 1,
          connectionContentRevision: 1,
          currentConnectionRevision: 1,
          connectionName: demo.name,
          role: input.role,
          alias: input.alias,
          stale: false,
        };
      },
    };
    const firstDemoSetup = await ensureGuidedDemoEnvironment(
      demo,
      guidedDemoGateway,
    );
    const repeatedDemoSetup = await ensureGuidedDemoEnvironment(
      demo,
      guidedDemoGateway,
    );
    expect(firstDemoSetup).toMatchObject({
      environmentId: "environment-demo",
      createdEnvironmentId: "environment-demo",
      binding: { id: "binding-demo", alias: "commerce", role: "primary" },
    });
    expect(repeatedDemoSetup).toEqual({
      environmentId: "environment-demo",
      createdEnvironmentId: null,
      binding: null,
    });
    expect(createdProjects).toBe(1);
    expect(boundConnections).toBe(1);
    const explorerProject = {
      id: "project-commerce",
      name: "Commerce",
      revision: 2,
      environments: [
        {
          id: "environment-development",
          name: "Development",
          riskClass: "development" as const,
          revision: 3,
        },
        {
          id: "environment-production",
          name: "Production",
          riskClass: "production" as const,
          revision: 4,
        },
      ],
    };
    const projectDatabaseRows = flattenProjectEnvironmentResources(
      explorerProject,
      (environmentId) =>
        environmentId === "environment-development"
          ? [{ id: "database-development" }]
          : [{ id: "database-production" }],
    );
    expect(projectResourceKey(explorerProject.id, "databases")).toBe(
      "project-commerce:databases",
    );
    expect(
      projectDatabaseRows.map(({ environment, resource }) => ({
        environmentId: environment.id,
        databaseId: resource.id,
        badge: knowledgeEnvironmentBadge(environment.riskClass),
      })),
    ).toEqual([
      {
        environmentId: "environment-development",
        databaseId: "database-development",
        badge: "dev",
      },
      {
        environmentId: "environment-production",
        databaseId: "database-production",
        badge: "prod",
      },
    ]);
    const groupedConnections = [
      {
        ...blankConnection(),
        id: connectionProfileId("connection-prod-mirai"),
        name: "Prod-mirai",
        env: "prod",
        schemaGroup: "mirai",
      },
      {
        ...blankConnection(),
        id: connectionProfileId("connection-mirai-log"),
        name: "Mirai-log",
        env: "prod",
      },
      {
        ...blankConnection(),
        id: connectionProfileId("connection-dev-mirai"),
        name: "Dev-mirai",
        env: "dev",
        schemaGroup: "mirai",
      },
    ];
    const groupedProjectDatabaseRows = [
      {
        environment: explorerProject.environments[1]!,
        resource: {
          id: "binding-prod-mirai",
          connectionId: groupedConnections[0]!.id,
        },
      },
      {
        environment: explorerProject.environments[1]!,
        resource: {
          id: "binding-mirai-log",
          connectionId: groupedConnections[1]!.id,
        },
      },
      {
        environment: explorerProject.environments[0]!,
        resource: {
          id: "binding-dev-mirai",
          connectionId: groupedConnections[2]!.id,
        },
      },
    ];
    const contiguousProjectDatabaseRows = orderProjectDatabaseResources(
      groupedProjectDatabaseRows,
      groupedConnections,
      ["binding-prod-mirai", "binding-mirai-log", "binding-dev-mirai"],
    );
    expect(
      contiguousProjectDatabaseRows.map(({ resource }) => resource.id),
    ).toEqual([
      "binding-prod-mirai",
      "binding-dev-mirai",
      "binding-mirai-log",
    ]);
    const movedProjectDatabaseOrder = moveProjectDatabaseResource(
      contiguousProjectDatabaseRows,
      groupedConnections,
      "binding-dev-mirai",
      "binding-mirai-log",
      "after",
    );
    expect(movedProjectDatabaseOrder).toEqual([
      "binding-mirai-log",
      "binding-prod-mirai",
      "binding-dev-mirai",
    ]);
    expect(
      moveProjectDatabaseResource(
        contiguousProjectDatabaseRows,
        groupedConnections,
        "binding-mirai-log",
        "binding-prod-mirai",
        "after",
      ),
    ).toEqual([
      "binding-prod-mirai",
      "binding-dev-mirai",
      "binding-mirai-log",
    ]);
    expect(
      moveProjectDatabaseResource(
        contiguousProjectDatabaseRows,
        groupedConnections,
        "binding-mirai-log",
        "binding-dev-mirai",
        "before",
      ),
    ).toEqual([
      "binding-mirai-log",
      "binding-prod-mirai",
      "binding-dev-mirai",
    ]);
    expect(
      orderProjectDatabaseResources(
        groupedProjectDatabaseRows,
        groupedConnections,
        movedProjectDatabaseOrder,
      ).map(({ resource }) => resource.id),
    ).toEqual(movedProjectDatabaseOrder);
    expect(
      preferredProjectEnvironment(
        explorerProject,
        "environment-production",
      )?.id,
    ).toBe("environment-production");
    expect(
      preferredProjectDatabaseDropTarget(
        explorerProject,
        "environment-production",
      ),
    ).toEqual({
      projectId: "project-commerce",
      environmentId: "environment-production",
    });
    expect(
      preferredProjectDatabaseDropTarget(explorerProject, "environment-other"),
    ).toEqual({
      projectId: "project-commerce",
      environmentId: "environment-development",
    });
    expect(
      projectDatabasesDropTargets(
        [explorerProject],
        "environment-production",
        true,
        new Map([
          [
            "environment-production",
            [{ connectionId: "database-production" }],
          ],
        ]),
      ),
    ).toMatchObject([
      {
        id: "project-commerce",
        environmentId: "environment-production",
        accepting: true,
        connectionIds: new Set(["database-production"]),
      },
    ]);
    const explorerAssignment = projectConnectionAssignment(
      [demo, bigQuery],
      true,
      new Map([
        ["environment-development", [{ connectionId: demo.id }]],
      ]),
    );
    expect(explorerAssignment.unassignedConnections).toEqual([bigQuery]);
    expect(explorerAssignment.unassignedConnectionIds).toEqual(
      new Set([bigQuery.id]),
    );
    expect(
      promotedProjectConnectionSourceId(bigQuery, {
        connectionId: "shared-bigquery",
      }),
    ).toBe(bigQuery.id);
    expect(
      promotedProjectConnectionSourceId(bigQuery, {
        connectionId: bigQuery.id,
      }),
    ).toBeNull();
    expect(
      promotedProjectConnectionSourceId(
        { ...bigQuery, workspaceAccess: "read" },
        { connectionId: "shared-bigquery" },
      ),
    ).toBeNull();
    expect(
      selectGuidedDemoEnvironment([
        {
          id: "environment-other",
          projectName: "Other",
          name: "Production",
          riskClass: "production",
          graphRevisionCount: 2,
        },
        ...agentEnvironments,
      ])?.id,
    ).toBe("environment-demo");
    const sqlProposalTool = {
      title: "mcp__dopedb-desktop-session__sql_propose",
      rawOutput: JSON.stringify({
        operationId: "e4ec6fa8-edf8-4c66-a8cc-da3bfbeb58a2",
        connectionId: "eeeda2b1-47d9-404e-a143-3dd3b2f96d65",
        state: "pending_approval",
        payloadHash: "9a78926da9bc47dc62ba35d6fb0f375012e225c2e28b6a755f158e0765ad6c18",
      }),
    };
    expect(isSqlProposalTool(sqlProposalTool)).toBe(true);
    expect(findAgentSqlProposal(sqlProposalTool.rawOutput)).toMatchObject({
      operationId: "e4ec6fa8-edf8-4c66-a8cc-da3bfbeb58a2",
      connectionId: "eeeda2b1-47d9-404e-a143-3dd3b2f96d65",
      state: "pending_approval",
    });
    expect(findAgentSqlProposal("not JSON")).toBeNull();

    const relation = (
      database: string,
      columns: CatalogTable["columns"],
      indexes: CatalogTable["indexes"] = [],
    ) => ({
      database,
      schema: "public",
      name: "orders",
      kind: "table",
      nativeId: null,
      comment: null,
      partitionParent: null,
      partitionChildren: [],
      columns,
      foreignKeys: [],
      constraints: [],
      indexes,
      rowEstimate: null,
    }) satisfies CatalogTable;
    const baseColumns: CatalogTable["columns"] = [
      {
        name: "id",
        dataType: "bigint",
        nullable: false,
        pk: true,
        ordinal: 1,
        length: null,
        precision: null,
        scale: null,
        defaultExpression: null,
        generatedExpression: null,
        identity: false,
        autoIncrement: false,
        collation: null,
        comment: null,
      },
    ];
    const environmentDiff = compareCatalogs(
      {
        tables: [
          relation("commerce_dev", [
            ...baseColumns,
            {
              ...baseColumns[0],
              name: "fulfillment_channel",
              dataType: "text",
              nullable: true,
              pk: false,
              ordinal: 2,
            },
          ], [
            {
              name: "orders_status_idx",
              columns: ["status"],
              unique: false,
              method: "btree",
              keys: [],
              includedColumns: [],
              predicate: null,
              valid: true,
            },
          ]),
        ],
        objects: [],
      },
      {
        tables: [relation("commerce_prod", baseColumns)],
        objects: [],
      },
    );
    expect(diffCounts(environmentDiff)).toEqual({
      added: 2,
      missing: 0,
      changed: 0,
    });
    expect(environmentDiff.addedTables).toHaveLength(0);
    expect(environmentDiff.changedTables).toHaveLength(1);
    expect(environmentDiff.objects.map(({ path }) => path)).toEqual([
      "commerce_dev.public.orders.fulfillment_channel",
      "commerce_dev.public.orders.orders_status_idx",
    ]);

    expect(
      actionSearchShortcutTargetIsEditable({
        closest: (selector: string) => selector.includes(".cm-content"),
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      actionSearchShortcutTargetIsEditable({
        closest: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
    expect(tabFocusTargetIndex(0, 3, "previous")).toBe(2);
    expect(tabFocusTargetIndex(2, 3, "next")).toBe(0);
    expect(tabFocusTargetIndex(1, 3, "start")).toBe(0);
    expect(tabFocusTargetIndex(1, 3, "end")).toBe(2);
    expect(tabFocusTargetIndex(-1, 3, "next")).toBeNull();

    const virtualTreeItems = [
      { key: "connection", parentKey: null },
      ...Array.from({ length: 5_000 }, (_, index) => ({
        key: `table:${index}`,
        parentKey: "connection",
      })),
    ];
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "connection", "ArrowRight"),
    ).toBe("table:0");
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "table:2499", "ArrowDown"),
    ).toBe("table:2500");
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "table:2500", "ArrowUp"),
    ).toBe("table:2499");
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "table:2500", "ArrowLeft"),
    ).toBe("connection");
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "table:0", "End"),
    ).toBe("table:4999");
    expect(
      treeKeyboardMoveTarget(virtualTreeItems, "table:4999", "Home"),
    ).toBe("connection");
    expect(
      virtualTreeFocusIndex(
        virtualTreeItems.map((treeItem) => ({ treeItem })),
        "table:4999",
      ),
    ).toBe(5_000);

    const loadedCatalog: Catalog = {
      tables: Array.from({ length: 5_000 }, (_, index) => ({
        schema: "public",
        name: `table_${index}`,
      }) as CatalogTable),
      objects: [{
        schema: "audit",
        name: "recent_orders",
        kind: "materialized_view",
        parent: "orders",
      } as CatalogObject],
    };
    const loadedRelationMatches = filterLoadedCatalogObjects(
      loadedCatalog,
      "TABLE_4999",
    );
    expect(loadedRelationMatches.tables.map((table) => table.name)).toEqual([
      "table_4999",
    ]);
    expect(loadedRelationMatches.objects).toEqual([]);
    const loadedObjectMatches = filterLoadedCatalogObjects(
      loadedCatalog,
      "orders",
    );
    expect(loadedObjectMatches.tables).toEqual([]);
    expect(loadedObjectMatches.objects.map((object) => object.name)).toEqual([
      "recent_orders",
    ]);

    const modalTitleBar = renderToStaticMarkup(
      createElement(ModalTitleBar, {
        title: "Data Sources",
        titleId: "data-sources-title",
        closeLabel: "Close",
        onClose: () => undefined,
      }),
    );
    expect(modalTitleBar).toContain('data-tauri-drag-region="deep"');
    expect(modalTitleBar).toContain('data-tauri-drag-region="false"');
    expect(modalTitleBar).not.toContain('role="presentation"');
    const dragTarget = (value: string | null) => ({
      getAttribute: (name: string) =>
        name === "data-tauri-drag-region" ? value : null,
    }) as unknown as EventTarget;
    expect(
      modalMouseDownShouldReachNativeDragRegion([
        dragTarget(null),
        dragTarget("deep"),
      ]),
    ).toBe(true);
    expect(
      modalMouseDownShouldReachNativeDragRegion([
        dragTarget("false"),
        dragTarget("deep"),
      ]),
    ).toBe(false);
    expect(
      modalMouseDownShouldReachNativeDragRegion([dragTarget(null)]),
    ).toBe(false);
  });
});
