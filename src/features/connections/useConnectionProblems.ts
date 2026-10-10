// Owns what is wrong with the Connection editor draft and how to reach the fix:
// diagnostics revealed only after a touch or an attempt, inline field validation,
// the Problems list including the last check outcome, and navigation from a
// problem to the tab, field, or member binding that resolves it.
import type { DiagnosticItem } from "../../design-system/components/Diagnostics";
import type { FieldValidation } from "../../design-system/components/FormControls";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { connectionDiagnosticMessage } from "./connectionDiagnosticMessage";
import {
  connectionTestFailureOpensBinding,
  connectionTestFailureTarget,
  connectionTestIssueRecovery,
  connectionTestIssueTitle,
} from "./connectionTestFailure";
import { parseConnectionUrl } from "./connectionUrl";
import {
  connectionDiagnosticBlocksTest,
  diagnoseConnection,
  type ConnectionDiagnostic,
  type ConnectionDiagnosticCode,
} from "./diagnostics";
import type { ConnectionProfile, ConnectionTestIssue } from "./domain";
import type { ConnectionCatalogController } from "./useConnectionCatalogController";
import type { ConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import type {
  ConnectionCommandStage,
  ConnectionProfileState,
} from "./useConnectionProfileState";

/** Empty-value diagnostics that wait until their field is touched or a command runs. */
const REQUIRED_VALUE_CODES = new Set<ConnectionDiagnosticCode>([
  "nameRequired",
  "hostRequired",
  "sqliteFileRequired",
  "cloudflareAccountRequired",
  "cloudflareD1DatabaseRequired",
  "mongoDatabaseRequired",
  "targetDatabaseRequired",
  "bigQueryProjectRequired",
  "bigQueryDatasetRequired",
]);

/** A failed command is titled by its stage; a save or install is never a check. */
const COMMAND_FAILURE_TITLES = {
  save: "connections.problemSaveFailed",
  delete: "connections.problemDeleteFailed",
  driver: "connections.problemDriverFailed",
  refresh: "connections.problemRefreshFailed",
} as const satisfies Record<ConnectionCommandStage, I18nKey>;

export function useConnectionProblems({
  profileState,
  connections,
  driverCatalog,
  dialogs,
}: {
  profileState: ConnectionProfileState;
  connections: ConnectionProfile[];
  driverCatalog: ConnectionCatalogController["model"]["driverCatalog"];
  dialogs: ConnectionEditorDialogs;
}) {
  const { t } = useI18n();
  const { form, reveal, tabs, url, status } = profileState;
  const { isSharedTemplate } = form.flags;
  const diagnosticProfile = isSharedTemplate
    ? { ...form.value, extraParams: {} } : form.value;
  const diagnostics = diagnoseConnection(
    diagnosticProfile,
    connections,
    driverCatalog.data ?? [],
    driverCatalog.isError,
    driverCatalog.isPending,
    form.portDraft,
  );
  // An empty required field is a prompt, not an error, until the person has
  // touched it or tried to save or check the draft.
  const diagnosticRevealed = (diagnostic: ConnectionDiagnostic) =>
    !REQUIRED_VALUE_CODES.has(diagnostic.code) ||
    reveal.all ||
    (diagnostic.fieldId !== null && reveal.isFieldTouched(diagnostic.fieldId));
  const failureOpensBinding = status.testFailure !== null &&
    connectionTestFailureOpensBinding(status.testFailure, form.value);
  const connectionUrlInvalid =
    !isSharedTemplate && url.mode === "urlOnly" &&
    parseConnectionUrl(url.draft) === null;
  const hasBlocking =
    connectionUrlInvalid ||
    diagnostics.some((diagnostic) => diagnostic.tone === "danger");
  const hasTestBlocking =
    connectionUrlInvalid || diagnostics.some(connectionDiagnosticBlocksTest);
  const items: DiagnosticItem[] = diagnostics
    .filter(diagnosticRevealed)
    .map((diagnostic) => ({
      id: diagnostic.id,
      tone: diagnostic.tone,
      title: connectionDiagnosticMessage(t, diagnostic.code),
    }));
  if (connectionUrlInvalid) {
    items.push({
      id: "connection-url-invalid",
      tone: "danger",
      title: t("connections.problemConnectionUrlInvalid"),
    });
  }
  if (status.messageIsError && status.message) {
    items.push({
      id: "connection-runtime",
      tone: "danger",
      title: status.messageStage
        ? t(COMMAND_FAILURE_TITLES[status.messageStage])
        : t("connections.problemRuntime"),
      description: status.message,
    });
  }
  if (status.testFailure) {
    items.push({
      id: "connection-test-failure",
      tone: "danger",
      title: failureTitle(status.testFailure),
      description: failureRecovery(status.testFailure),
    });
  }
  const validation = {
    name: fieldValidation("connection-name"),
    driver: fieldValidation("connection-driver"),
    host: fieldValidation("connection-host"),
    username: fieldValidation("connection-username"),
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

  function fieldValidation(fieldId: string): FieldValidation | undefined {
    const diagnostic = diagnostics.find(
      (candidate) =>
        candidate.fieldId === fieldId && diagnosticRevealed(candidate),
    );
    return diagnostic
      ? {
          tone: diagnostic.tone,
          message: connectionDiagnosticMessage(t, diagnostic.code),
        }
      : undefined;
  }

  function failureTitle(issue: ConnectionTestIssue): string {
    return connectionTestIssueTitle(t, issue, form.value);
  }

  function failureRecovery(issue: ConnectionTestIssue): string {
    return connectionTestIssueRecovery(t, issue, form.value, {
      usedSavedCredential: status.testUsedSavedCredential,
      retrySeconds: status.retrySeconds,
    });
  }

  /** Shared member-local failures are fixed in the member's own binding. */
  function openFailureBinding() {
    dialogs.problems.setOpen(false);
    dialogs.workspace.buttonRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    dialogs.workspace.setMode("credentials");
  }

  function openDiagnostic(diagnosticId: string) {
    if (diagnosticId === "connection-test-failure") {
      dialogs.problems.setOpen(false);
      if (status.testFailure && failureOpensBinding) {
        openFailureBinding();
        return;
      }
      const target = status.testFailure
        ? connectionTestFailureTarget(status.testFailure, form.value)
        : null;
      if (target) tabs.focusField(target.tab, target.fieldId);
      return;
    }
    if (diagnosticId === "connection-url-invalid") {
      dialogs.problems.setOpen(false);
      tabs.focusField("general", "connection-url");
      return;
    }
    const diagnostic = diagnostics.find(
      (candidate) => candidate.id === diagnosticId,
    );
    if (!diagnostic) return;
    dialogs.problems.setOpen(false);
    if (diagnostic.fieldId) tabs.focusField(diagnostic.tab, diagnostic.fieldId);
    else tabs.setActive(diagnostic.tab);
  }

  return {
    items,
    hasBlocking,
    hasTestBlocking,
    validation,
    openDiagnostic,
    failure: {
      title: failureTitle,
      recovery: failureRecovery,
      opensBinding: failureOpensBinding,
      openBinding: openFailureBinding,
    },
  };
}
