// Owns Connection profile validation and save/test/delete lifecycle commands;
// editable draft mechanics stay in the profile state model.
import { useEffect, useRef, useState } from "react";

import type { DiagnosticItem } from "../../design-system/components/Diagnostics";
import type { FieldValidation } from "../../design-system/components/FormControls";
import type { PanelTab } from "../../design-system/components/PanelTabs";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { useToast } from "../../components/Toast";
import {
  deleteWorkspaceConnection,
  updateWorkspaceConnection,
} from "../workspaces/tauriAdapter";
import type { ConnectionTab } from "./connectionEditorModel";
import {
  connectionTestFailureRecovery,
  connectionTestFailureTarget,
  connectionTestFailureTitle,
} from "./connectionTestFailure";
import { formatConnectionUrl, parseConnectionUrl } from "./connectionUrl";
import {
  connectionDiagnosticBlocksTest,
  diagnoseConnection,
} from "./diagnostics";
import { connectionDiagnosticMessage } from "./connectionDiagnosticMessage";
import {
  connectionId,
  type ConnectionProfile,
  type ConnectionTestFailureCode,
} from "./domain";
import {
  CONNECTION_INPUT_MODE_PARAMETER,
} from "./options";
import { connectionVerificationRecorder } from "./connectionVerificationAnalytics";
import {
  deleteConnection,
  discoverConnectionProfileDatabases,
  testConnection,
  testConnectionProfile,
  upsertConnection,
} from "./tauriAdapter";
import type { BigQueryOnboardingController } from "./useBigQueryOnboardingController";
import type { ConnectionCatalogController } from "./useConnectionCatalogController";
import type { ConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import type { ConnectionProfileState } from "./useConnectionProfileState";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";

export function useConnectionProfileController({
  connections,
  onDeletedConnection,
  onSaved,
  onCancel,
  profileState,
  catalog,
  dialogs,
  bigQuery,
}: {
  connections: ConnectionProfile[];
  onDeletedConnection: (id: string) => Promise<void>;
  onSaved: (
    profile: ConnectionProfile,
    closeEditor: boolean,
  ) => Promise<void>;
  onCancel: () => void;
  profileState: ConnectionProfileState;
  catalog: ConnectionCatalogController;
  dialogs: ConnectionEditorDialogs;
  bigQuery: BigQueryOnboardingController;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const catalogScope = useCatalogScope();
  const { form, identity, credentials, tabs: tabState, url, status } =
    profileState;
  const { isSharedTemplate, isMongo, isBigQuery } = form.flags;
  const [databaseDiscovery, setDatabaseDiscovery] = useState<{
    pending: boolean;
    databases: string[];
  }>({ pending: false, databases: [] });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const driverCatalog = catalog.model.driverCatalog;
  const managedConnection = useManagedConnectionRecovery(
    form.value,
    catalogScope,
  );
  const diagnosticProfile = isSharedTemplate
    ? { ...form.value, extraParams: {} }
    : form.value;
  const diagnostics = diagnoseConnection(
    diagnosticProfile,
    connections,
    driverCatalog.data ?? [],
    driverCatalog.isError,
    driverCatalog.isPending,
    form.portDraft,
  );
  const parsedConnectionUrl =
    !isSharedTemplate && url.mode === "urlOnly"
      ? parseConnectionUrl(url.draft)
      : null;
  const connectionUrlInvalid =
    !isSharedTemplate && url.mode === "urlOnly" && parsedConnectionUrl === null;
  const hasBlockingProblems =
    connectionUrlInvalid ||
    diagnostics.some((diagnostic) => diagnostic.tone === "danger");
  const hasTestBlockingProblems =
    connectionUrlInvalid || diagnostics.some(connectionDiagnosticBlocksTest);
  const problemItems: DiagnosticItem[] = diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    tone: diagnostic.tone,
    title: connectionDiagnosticMessage(t, diagnostic.code),
  }));
  if (connectionUrlInvalid) {
    problemItems.push({
      id: "connection-url-invalid",
      tone: "danger",
      title: t("connections.problemConnectionUrlInvalid"),
    });
  }
  if (status.messageIsError && status.message) {
    problemItems.push({
      id: "connection-runtime",
      tone: "danger",
      title: t("connections.problemRuntime"),
      description: status.message,
    });
  }
  if (status.testFailure) {
    problemItems.push({
      id: "connection-test-failure",
      tone: "danger",
      title: connectionTestFailureTitle(
        t,
        status.testFailure.code,
        form.value,
      ),
      description: connectionTestFailureRecovery(
        t,
        status.testFailure.code,
        form.value,
      ),
    });
  }
  const validation = {
    name: form.nameInteracted ? fieldValidation("connection-name") : undefined,
    driver: fieldValidation("connection-driver"),
    host: fieldValidation("connection-host"),
    port: fieldValidation("connection-port"),
    database: fieldValidation("connection-database"),
    bigQueryLocation: fieldValidation("connection-bigquery-location"),
    bigQueryMaximumBytesBilled: fieldValidation(
      "connection-bigquery-maximum-bytes-billed",
    ),
    timeZone: fieldValidation("connection-time-zone"),
    keepAlive: fieldValidation("connection-keep-alive"),
    autoDisconnect: fieldValidation("connection-auto-disconnect"),
    startupScript: fieldValidation("connection-startup-script"),
    sshAlias: fieldValidation("connection-ssh-alias"),
    connectionUrl: connectionUrlInvalid
      ? {
          tone: "danger",
          message: t("connections.problemConnectionUrlInvalid"),
        } satisfies FieldValidation
      : undefined,
  };
  const tabs: readonly PanelTab<ConnectionTab>[] = isSharedTemplate
    ? [{ id: "general", label: t("connections.general") }]
    : isBigQuery
      ? [{ id: "general", label: t("connections.general") }]
    : [
        { id: "general", label: t("connections.general") },
        { id: "options", label: t("connections.options") },
        { id: "sshSsl", label: t("connections.sshSsl") },
        {
          id: "schemas",
          label: t("connections.schemas"),
          disabled: isMongo,
        },
        { id: "advanced", label: t("connections.advanced") },
      ];

  function fieldValidation(fieldId: string): FieldValidation | undefined {
    const diagnostic = diagnostics.find(
      (candidate) => candidate.fieldId === fieldId,
    );
    return diagnostic
      ? {
          tone: diagnostic.tone,
          message: connectionDiagnosticMessage(t, diagnostic.code),
        }
      : undefined;
  }

  function openDiagnostic(diagnosticId: string) {
    if (diagnosticId === "connection-test-failure") {
      dialogs.problems.setOpen(false);
      if (status.testFailure) {
        const target = connectionTestFailureTarget(
          status.testFailure,
          form.value,
        );
        if (!target) return;
        tabState.setActive(target.tab);
        requestAnimationFrame(() => document.getElementById(target.fieldId)?.focus());
      }
      return;
    }
    if (diagnosticId === "connection-url-invalid") {
      dialogs.problems.setOpen(false);
      tabState.setActive("general");
      requestAnimationFrame(() =>
        document.getElementById("connection-url")?.focus(),
      );
      return;
    }
    const diagnostic = diagnostics.find(
      (candidate) => candidate.id === diagnosticId,
    );
    if (!diagnostic) return;
    dialogs.problems.setOpen(false);
    tabState.setActive(diagnostic.tab);
    if (diagnostic.fieldId) {
      const fieldId = diagnostic.fieldId;
      requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
    }
  }

  async function save(closeEditor: boolean) {
    if (hasBlockingProblems) {
      dialogs.problems.setOpen(true);
      return;
    }
    status.setBusy(true);
    status.setRunning(closeEditor ? "save" : "apply");
    status.setMessage(null);
    status.setTestFailure(null);
    try {
      const saved = isSharedTemplate
        ? await updateWorkspaceConnection({
            ...form.value,
            readonlyDefault: true,
            allowWrites: false,
          })
        : await upsertConnection(
            form.value,
            credentials.password || undefined,
          );
      form.setValue(saved);
      if (url.mode === "urlOnly") {
        url.setDraft(formatConnectionUrl(saved));
      }
      await bigQuery.finalizeSavedProfile(saved);
      identity.setIsNew(false);
      identity.setPersisted(true);
      credentials.setPassword("");
      await onSaved(saved, closeEditor);
      toast(t("connections.connectionSaved"));
      status.setMessage(t("connections.saved"));
      status.setMessageIsError(false);
    } catch (error) {
      status.setMessage(errMessage(error));
      status.setMessageIsError(true);
    } finally {
      status.setBusy(false);
      status.setRunning(null);
    }
  }

  function bindWorkspaceConnection(bound: ConnectionProfile) {
    form.setValue(bound);
    void onSaved(bound, false).catch((error) => {
      status.setMessage(errMessage(error));
      status.setMessageIsError(true);
    });
  }

  function duplicateCurrentConnection() {
    if (identity.isNew || form.value.workspaceAccess !== "local") return;
    form.setValue((current) => {
      const extraParams = { ...current.extraParams };
      delete extraParams[CONNECTION_INPUT_MODE_PARAMETER];
      return {
        ...current,
        id: connectionId(crypto.randomUUID()),
        name: t("connections.copyName", {
          name: current.name || t("app.unnamed"),
        }),
        extraParams,
        secretRef: null,
        workspaceAccess: "local",
        credentialMode: "local",
        providerTarget: null,
      };
    });
    identity.setIsNew(true);
    identity.setPersisted(false);
    credentials.setPassword("");
    url.setMode("default");
    url.setDraft("");
    tabState.setActive("general");
    status.setMessage(null);
    status.setMessageIsError(false);
    toast(t("connections.connectionDuplicated"));
  }

  async function removeCurrentConnection() {
    if (
      identity.isNew ||
      (isSharedTemplate && form.value.workspaceAccess !== "manage")
    ) {
      return;
    }
    status.setBusy(true);
    status.setMessage(null);
    try {
      if (isSharedTemplate) {
        await deleteWorkspaceConnection(form.value.id);
      } else {
        await deleteConnection(form.value.id);
      }
      toast(t("connections.connectionDeleted"));
      await onDeletedConnection(form.value.id);
      onCancel();
    } catch (error) {
      status.setMessage(errMessage(error));
      status.setMessageIsError(true);
      status.setBusy(false);
    }
  }

  async function cancelEditor() {
    if (status.busy) return;
    status.setBusy(true);
    status.setMessage(null);
    try {
      await bigQuery.discardUnpersistedAuth();
      status.setBusy(false);
      onCancel();
    } catch (error) {
      status.setMessage(errMessage(error));
      status.setMessageIsError(true);
      status.setBusy(false);
    }
  }

  async function test() {
    if (hasTestBlockingProblems) {
      dialogs.problems.setOpen(true);
      return;
    }
    const recordVerification = connectionVerificationRecorder(catalogScope, form.value);
    status.setBusy(true);
    status.setRunning("test");
    status.setMessage(null);
    status.setTestFailure(null);
    dialogs.problems.setOpen(false);
    try {
      const receipt = isSharedTemplate
        ? await testConnection(form.value.id)
        : await testConnectionProfile(
          form.value,
          credentials.password || undefined,
        );
      if (!mounted.current) return;
      if (!receipt.ok) {
        status.setTestFailure(receipt.failure);
        status.setMessageIsError(true);
        dialogs.problems.setOpen(true);
        recordVerification("failed");
        return;
      }
      status.setMessage(`✓ ${t("connections.connectionOk")}`);
      status.setMessageIsError(false);
      recordVerification("success");
    } catch {
      if (!mounted.current) return;
      status.setTestFailure({
        code: "unknown",
        field: null,
        detail: t("connections.testFailure.transportDetail"),
      });
      status.setMessageIsError(true);
      dialogs.problems.setOpen(true);
      recordVerification("failed");
    } finally {
      if (mounted.current) {
        status.setBusy(false);
        status.setRunning(null);
      }
    }
  }

  async function discoverDatabases() {
    if (!form.flags.canDiscoverDatabases || databaseDiscovery.pending) return;
    setDatabaseDiscovery((current) => ({
      pending: true,
      databases: current.databases,
    }));
    try {
      const discovered = await discoverConnectionProfileDatabases(
        form.value,
        credentials.password || undefined,
      );
      setDatabaseDiscovery({
        pending: false,
        databases: discovered.map((database) => database.name),
      });
    } catch {
      setDatabaseDiscovery({ pending: false, databases: [] });
    }
  }

  return {
    view: {
      form: form.value,
      set: form.set,
      port: {
        draft: form.portDraft,
        setDraft: form.setPortDraft,
      },
      flags: form.flags,
      identity: {
        isNew: identity.isNew,
        persisted: identity.persisted,
      },
      credentials,
      tabs: {
        items: tabs,
        active: tabState.active,
        setActive: tabState.setActive,
      },
      url: {
        mode: url.mode,
        draft: url.draft,
        selectMode: url.selectMode,
        edit: url.edit,
        normalize: url.normalize,
        importFromClipboard: url.importFromClipboard,
      },
      options: {
        advancedParameters: form.advancedParameters,
        addAdvancedParameter: form.addAdvancedParameter,
        removeAdvancedParameter: form.removeAdvancedParameter,
        updateAdvancedParameter: form.updateAdvancedParameter,
        setExtraParameter: form.setExtraParameter,
        setMongoTls: form.setMongoTls,
        setSrv: form.setSrv,
        toggleTimedConnectionOption: form.toggleTimedConnectionOption,
        setTimedConnectionOptionValue: form.setTimedConnectionOptionValue,
        pickDatabaseFile: form.pickDatabaseFile,
        pickExtraParameterFile: form.pickExtraParameterFile,
      },
      databaseDiscovery: {
        ...databaseDiscovery,
        discover: discoverDatabases,
      },
      bigQuery,
      validation,
      revealNameValidation: form.revealNameValidation,
    },
    problems: {
      items: problemItems,
      hasBlocking: hasBlockingProblems,
      hasTestBlocking: hasTestBlockingProblems,
      openDiagnostic,
    },
    commands: {
      busy: status.busy,
      running: status.running,
      message: status.message,
      messageIsError: status.messageIsError,
      testFailure: status.testFailure,
      testFailureTitle: (code: ConnectionTestFailureCode) =>
        connectionTestFailureTitle(t, code, form.value),
      testFailureRecovery: (code: ConnectionTestFailureCode) =>
        connectionTestFailureRecovery(t, code, form.value),
      managedConnection,
      save,
      test,
      duplicate: duplicateCurrentConnection,
      remove: removeCurrentConnection,
      cancel: cancelEditor,
      bindWorkspaceConnection,
    },
  };
}
