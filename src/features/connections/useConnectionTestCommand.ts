// Owns the Connection editor's cancellable check: the request identity that keeps
// a stopped or superseded probe from landing, and the outcome. A pass marks the
// draft verified; a typed failure opens Problems while the action bar's persistent
// alert announces its title. A refusal made before any server was contacted is not
// a verification outcome: a moved endpoint focuses the password field, and a
// runtime cooldown (`retryLater`) counts down the wait the runtime reported.
import { useEffect, useRef } from "react";

import { useI18n } from "../../lib/i18n";
import type { useCatalogScope } from "../../lib/queries";
import { connectionTestResultIsCurrent } from "./connectionEditorInteraction";
import { connectionTestIssue } from "./connectionTestFailure";
import { connectionVerificationRecorder } from "./connectionVerificationAnalytics";
import { testConnection, testConnectionProfile } from "./tauriAdapter";
import type { ConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import type { ConnectionProfileState } from "./useConnectionProfileState";

export type ConnectionTestUnavailableReason =
  | "sharedDraftUnsaved"
  | "managedCooldown";

export function useConnectionTestCommand({
  profileState,
  dialogs,
  catalogScope,
  hasTestBlockingProblems,
}: {
  profileState: ConnectionProfileState;
  dialogs: ConnectionEditorDialogs;
  catalogScope: ReturnType<typeof useCatalogScope>;
  hasTestBlockingProblems: boolean;
}) {
  const { t } = useI18n();
  const { form, credentials, changes, reveal, tabs, status, verification } =
    profileState;
  const { isSharedTemplate } = form.flags;
  const mounted = useRef(true);
  const testRequestId = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const unavailableReason: ConnectionTestUnavailableReason | null =
    isSharedTemplate && changes.dirty
      ? "sharedDraftUnsaved"
      : status.retrySeconds > 0
        ? "managedCooldown"
        : null;

  /**
   * A running check never holds the editor: stopping it discards the late
   * receipt through the request identity, and the native probe closes itself.
   */
  function cancel() {
    if (status.running !== "test") return;
    testRequestId.current += 1;
    status.setRunning(null);
  }

  async function test() {
    if (status.running === "test") {
      cancel();
      return;
    }
    if (unavailableReason !== null || status.busy) return;
    if (hasTestBlockingProblems) {
      reveal.revealAll();
      dialogs.problems.setOpen(true);
      return;
    }
    const startedRevision = verification.currentRevision();
    const requestId = ++testRequestId.current;
    const isCurrent = () =>
      connectionTestResultIsCurrent(
        startedRevision,
        verification.currentRevision(),
        requestId,
        testRequestId.current,
      );
    const recordVerification = connectionVerificationRecorder(
      catalogScope,
      form.value,
    );
    status.setRunning("test");
    status.setMessage(null);
    status.setTestFailure(null);
    status.setTestUsedSavedCredential(
      !isSharedTemplate && credentials.usesSavedPassword,
    );
    dialogs.problems.setOpen(false);
    try {
      const receipt = isSharedTemplate
        ? await testConnection(form.value.id)
        : await testConnectionProfile(
            credentials.probeProfile(),
            credentials.password || undefined,
          );
      if (!mounted.current) return;
      if (!isCurrent()) return;
      if (!receipt.ok) {
        const issue = connectionTestIssue(receipt.failure);
        status.setTestFailure(issue);
        status.setMessageIsError(true);
        if (issue.refusal) {
          // Nothing reached a server, so this is not a verification outcome.
          if (issue.refusal === "savedCredentialEndpointChanged") {
            tabs.focusField("general", "connection-password");
          }
          // Only the runtime knows a cooldown; the editor counts down its wait.
          const retryAfterSeconds = receipt.failure.retryAfterSeconds;
          if (issue.refusal === "retryLater" && retryAfterSeconds) {
            status.startRetryCooldown(Date.now() + retryAfterSeconds * 1_000);
          }
          return;
        }
        dialogs.problems.setOpen(true);
        recordVerification("failed");
        return;
      }
      status.setMessage(t("connections.connectionOk"));
      status.setMessageIsError(false);
      status.setVerified(true);
      recordVerification("success");
    } catch {
      if (!mounted.current) return;
      if (!isCurrent()) return;
      status.setTestFailure({
        code: "unknown",
        field: null,
      });
      status.setMessageIsError(true);
      dialogs.problems.setOpen(true);
      recordVerification("failed");
    } finally {
      if (mounted.current && requestId === testRequestId.current) {
        status.setRunning(null);
      }
    }
  }

  return {
    test,
    cancel,
    unavailableReason,
    managedRetrySeconds: status.retrySeconds,
  };
}
