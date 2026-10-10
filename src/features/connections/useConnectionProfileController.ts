// Owns the Connection profile's save/delete/duplicate/cancel lifecycle and the
// grouped editor projection. It composes the draft's problems and the cancellable
// check; editable draft mechanics and unsaved-change state stay in the profile
// state, and a local save that would move the saved password to another endpoint
// returns the person to the password field.
import { useQueryClient } from "@tanstack/react-query";

import type { PanelTab } from "../../design-system/components/PanelTabs";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { useToast } from "../../components/Toast";
import { refreshDesktopConnections } from "../workspaceAdmin/desktopConnections";
import { requestWorkspaceAdmin } from "../workspaceAdmin/navigationRequest";
import {
  deleteWorkspaceConnection,
  updateWorkspaceConnection,
} from "../workspaces/tauriAdapter";
import { markConnectionEditorReturn } from "./connectionEditorShellBridge";
import type { ConnectionTab } from "./connectionEditorModel";
import {
  connectionDeleteFailureMessage,
  connectionSaveFailureMessage,
  connectionSaveNeedsPassword,
} from "./connectionTestFailure";
import { formatConnectionUrl } from "./connectionUrl";
import { connectionId, type ConnectionProfile } from "./domain";
import {
  CONNECTION_INPUT_MODE_PARAMETER,
} from "./options";
import { deleteConnection, upsertConnection } from "./tauriAdapter";
import type { BigQueryOnboardingController } from "./useBigQueryOnboardingController";
import type { CloudflareD1OnboardingController } from "./useCloudflareD1OnboardingController";
import type { ConnectionCatalogController } from "./useConnectionCatalogController";
import type { ConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import { useConnectionProblems } from "./useConnectionProblems";
import type { ConnectionProfileState } from "./useConnectionProfileState";
import { useConnectionTestCommand } from "./useConnectionTestCommand";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";
import { useConnectionDatabaseDiscovery } from "./useConnectionDatabaseDiscovery";

export function useConnectionProfileController({
  connections,
  onDeletedConnection,
  onSaved,
  projectEnvironmentId,
  onCancel,
  profileState,
  catalog,
  dialogs,
  bigQuery,
  cloudflareD1,
}: {
  connections: ConnectionProfile[];
  onDeletedConnection: (id: string) => Promise<void>;
  onSaved: (profile: ConnectionProfile, closeEditor: boolean) => Promise<void>;
  projectEnvironmentId?: string;
  onCancel: () => void;
  profileState: ConnectionProfileState;
  catalog: ConnectionCatalogController;
  dialogs: ConnectionEditorDialogs;
  bigQuery: BigQueryOnboardingController;
  cloudflareD1: CloudflareD1OnboardingController;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const catalogScope = useCatalogScope();
  const queryClient = useQueryClient();
  const {
    form,
    identity,
    credentials,
    changes,
    reveal,
    tabs: tabState,
    url,
    status,
  } = profileState;
  const { isSharedTemplate, isMongo, isBigQuery } = form.flags;
  const databaseDiscovery = useConnectionDatabaseDiscovery(profileState);
  const managedConnection = useManagedConnectionRecovery(form.value, catalogScope);
  const problems = useConnectionProblems({
    profileState,
    connections,
    driverCatalog: catalog.model.driverCatalog,
    dialogs,
  });
  const check = useConnectionTestCommand({
    profileState,
    dialogs,
    catalogScope,
    hasTestBlockingProblems: problems.hasTestBlocking,
  });

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

  async function save(closeEditor: boolean) {
    if (problems.hasBlocking) {
      reveal.revealAll();
      dialogs.problems.setOpen(true);
      return;
    }
    check.cancel();
    status.setBusy(true);
    status.setRunning(closeEditor ? "save" : "apply");
    status.setMessage(null);
    status.setTestFailure(null);
    let saved: ConnectionProfile;
    try {
      saved = isSharedTemplate
        ? await updateWorkspaceConnection({
            ...form.value,
            readonlyDefault: true,
            allowWrites: false,
          })
        : await upsertConnection(
            form.value,
            credentials.password || undefined,
            credentials.clearStoredPassword && !credentials.password,
          );
    } catch (error) {
      status.showError("save", connectionSaveFailureMessage(t, error, "profile"));
      status.setBusy(false);
      status.setRunning(null);
      // The saved password stays bound to its endpoint; a moved local profile
      // needs the password for the new endpoint before it can be saved.
      if (!isSharedTemplate && connectionSaveNeedsPassword(error)) {
        dialogs.problems.setOpen(false);
        tabState.focusField("general", "connection-password");
      }
      return;
    }
    form.setValue(saved);
    const savedUrlDraft = url.mode === "urlOnly"
      ? formatConnectionUrl(saved)
      : null;
    if (savedUrlDraft !== null) url.setDraft(savedUrlDraft);
    identity.setIsNew(false);
    identity.setPersisted(true);
    identity.markPersisted(saved, savedUrlDraft);
    credentials.setPassword("");
    try {
      // Removing a CLI sign-in the saved profile no longer uses is cleanup; the
      // profile itself is already saved, so a failure here is only reported.
      await bigQuery.finalizeSavedProfile(saved);
      await cloudflareD1.finalizeSavedProfile(saved);
    } catch {
      toast(t("connections.authCleanupDeferred"), "error");
    }
    try {
      await onSaved(saved, closeEditor);
    } catch (error) {
      // The profile is saved; only the exact Project binding failed and can be
      // retried by saving again from this editor.
      status.showError(
        "save",
        connectionSaveFailureMessage(t, error, "projectBinding"),
      );
      status.setBusy(false);
      status.setRunning(null);
      return;
    }
    const savedMessage = projectEnvironmentId
      ? t("connections.connectionSavedToProject")
      : t("connections.connectionSaved");
    toast(savedMessage);
    status.setMessage(savedMessage);
    status.setMessageIsError(false);
    status.setBusy(false);
    status.setRunning(null);
  }

  function bindWorkspaceConnection(bound: ConnectionProfile) {
    // The binding owns only this member's username, parameters, and credential
    // reference; unsaved template edits in this editor stay unsaved and visible.
    form.setValue((current) => ({
      ...current,
      username: bound.username,
      extraParams: bound.extraParams,
      secretRef: bound.secretRef,
    }));
    identity.markPersisted(bound, null);
    void onSaved(bound, false).catch((error) => {
      status.showError(
        "save",
        connectionSaveFailureMessage(t, error, "projectBinding"),
      );
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
    credentials.setClearStoredPassword(false);
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
    check.cancel();
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
      status.showError("delete", connectionDeleteFailureMessage(t, error));
      status.setBusy(false);
    }
  }

  /**
   * A shared connection that changed in the workspace is checked again only after
   * this device pulls its current revision; the stale one is never opened.
   */
  async function refreshWorkspace() {
    if (status.busy) return;
    status.setBusy(true);
    status.setTestFailure(null);
    status.setMessage(null);
    try {
      await refreshDesktopConnections(queryClient, catalogScope.key, [form.value.id]);
      status.setMessage(t("connections.workspaceRefreshed"));
      status.setMessageIsError(false);
    } catch {
      status.showError("refresh", t("connections.workspaceRefreshFailed"));
    } finally {
      status.setBusy(false);
    }
  }

  async function cancelEditor() {
    if (status.busy) return;
    check.cancel();
    status.setBusy(true);
    status.setMessage(null);
    let cleanupFailed = false;
    try {
      await bigQuery.discardUnpersistedAuth();
      await cloudflareD1.discardUnpersistedAuth();
    } catch {
      // Leaving must not depend on removing a temporary CLI sign-in.
      cleanupFailed = true;
    }
    status.setBusy(false);
    if (cleanupFailed) toast(t("connections.authCleanupDeferred"), "error");
    onCancel();
  }

  /** Esc, Cancel, and leaving for another draft confirm before losing edits. */
  function requestCancel() {
    if (status.busy) return;
    changes.guardDiscard(() => void cancelEditor());
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
      touch: reveal.touch,
      verified: status.verified,
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
        advancedRows: form.advanced.rows,
        advancedParameterIssue: form.advanced.issue,
        addAdvancedParameter: form.advanced.add,
        removeAdvancedParameter: form.advanced.remove,
        updateAdvancedParameter: form.advanced.update,
        setExtraParameter: form.setExtraParameter,
        setMongoTls: form.setMongoTls,
        setSrv: form.setSrv,
        toggleTimedConnectionOption: form.toggleTimedConnectionOption,
        setTimedConnectionOptionValue: form.setTimedConnectionOptionValue,
        pickDatabaseFile: form.pickDatabaseFile,
        pickExtraParameterFile: form.pickExtraParameterFile,
      },
      databaseDiscovery,
      bigQuery,
      cloudflareD1,
      validation: problems.validation,
    },
    problems: {
      items: problems.items,
      hasBlocking: problems.hasBlocking,
      hasTestBlocking: problems.hasTestBlocking,
      openDiagnostic: problems.openDiagnostic,
    },
    commands: {
      busy: status.busy,
      running: status.running,
      message: status.message,
      messageIsError: status.messageIsError,
      testFailure: status.testFailure,
      testFailureTitle: problems.failure.title,
      testFailureRecovery: problems.failure.recovery,
      testUnavailableReason: check.unavailableReason,
      managedRetrySeconds: check.managedRetrySeconds,
      failureOpensBinding: problems.failure.opensBinding,
      openFailureBinding: problems.failure.openBinding,
      managedConnection: {
        ...managedConnection,
        // Workspace management opens over this editor and returns to it, so the
        // draft, including any unsaved edit, survives the repair round trip.
        openSettings: () => {
          markConnectionEditorReturn();
          managedConnection.openSettings();
        },
      },
      save,
      test: check.test,
      duplicate: duplicateCurrentConnection,
      remove: removeCurrentConnection,
      refreshWorkspace,
      /** Settings → Account opens over this editor and returns to it after sign-in. */
      signIn: () => {
        markConnectionEditorReturn();
        requestWorkspaceAdmin("account");
      },
      cancel: requestCancel,
      bindWorkspaceConnection,
      /** Leave this draft for another one only after confirming unsaved edits. */
      leave: changes.guardDiscard,
      discard: {
        pending: changes.pendingDiscard,
        confirm: changes.confirmDiscard,
        keepEditing: changes.keepEditing,
      },
      dirty: changes.dirty,
    },
  };
}
