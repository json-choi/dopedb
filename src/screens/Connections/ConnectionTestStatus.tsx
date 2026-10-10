// Presents the Connection editor's check command and its outcome: the failure
// notice above the tabs with its one recovery action, and the action bar with the
// Test/Stop command, why a check is unavailable, and persistent live regions that
// announce each result when it arrives.
import { Button } from "../../design-system/components/Button";
import { ModalDetailActionBar } from "../../design-system/components/Modal";
import { LoadingLabel } from "../../design-system/components/Status";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

type Commands = ConnectionEditorController["commands"];

export function ConnectionTestFailureNotice({
  commands,
}: {
  commands: Commands;
}) {
  const { t } = useI18n();
  const failure = commands.testFailure;
  if (!failure) return null;
  // A refusal carries its own guidance; repair and binding do not fix it.
  const action = failure.refusal === "sharedConnectionChanged"
    ? { label: t("schema.refreshWorkspace"), run: () => void commands.refreshWorkspace() }
    : failure.refusal === "workspaceSignInRequired"
      ? { label: t("workspace.login"), run: commands.signIn }
      : failure.refusal
        ? null
        : commands.managedConnection.canOpenSettings
          ? {
              label: t("connections.managedWorkspace.open"),
              run: () => commands.managedConnection.openSettings(),
            }
          : commands.failureOpensBinding
            ? { label: t("workspace.bindCredentialsShort"), run: commands.openFailureBinding }
            : null;

  return (
    <section
      className="tw:mx-auto tw:mb-4 tw:grid tw:w-full tw:max-w-[840px] tw:gap-1.5 tw:rounded-sm tw:border tw:border-danger/40 tw:bg-danger-muted tw:p-3"
      role="alert"
    >
      <strong className="tw:text-sm tw:font-semibold tw:text-danger">
        {commands.testFailureTitle(failure)}
      </strong>
      <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-foreground">
        {commands.testFailureRecovery(failure)}
      </p>
      {action ? (
        <div className="tw:mt-1">
          <Button
            size="compact"
            tone="primary"
            disabled={commands.busy}
            onClick={action.run}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function ConnectionTestActionBar({
  commands,
  activeDriver,
  problemsOpen,
}: {
  commands: Commands;
  activeDriver: ConnectionEditorController["catalog"]["drivers"]["active"];
  /** Problems replaces the failure notice, which otherwise announces a failure. */
  problemsOpen: boolean;
}) {
  const { t } = useI18n();
  const unavailable =
    commands.running !== "test" ? commands.testUnavailableReason : null;
  const errorMessage = commands.message && commands.messageIsError
    ? commands.message
    : null;
  // Shown once in Problems, so it is only announced here.
  const hiddenFailureAnnouncement =
    !errorMessage && problemsOpen && commands.testFailure
      ? commands.testFailureTitle(commands.testFailure)
      : null;

  return (
    <ModalDetailActionBar>
      <Button
        size="compact"
        variant="ghost"
        tone="primary"
        disabled={
          commands.running !== "test" &&
          (commands.busy || commands.testUnavailableReason !== null)
        }
        disabledBehavior="focusable"
        aria-describedby={unavailable ? "connection-test-unavailable" : undefined}
        onClick={() => void commands.test()}
      >
        {commands.running === "test"
          ? t("connections.testCancel")
          : t("connections.test")}
      </Button>
      {commands.running === "test" ? (
        <span className="tw:text-sm">
          <LoadingLabel>{t("connections.testing")}</LoadingLabel>
        </span>
      ) : null}
      {unavailable ? (
        <span
          id="connection-test-unavailable"
          className="tw:min-w-0 tw:text-sm tw:text-muted-foreground"
        >
          {unavailable === "sharedDraftUnsaved"
            ? t("connections.testUnavailableSharedDraft")
            : t("connections.testUnavailableManagedCooldown", {
                seconds: commands.managedRetrySeconds,
              })}
        </span>
      ) : null}
      {/* Both live regions stay mounted so a result is announced when it arrives.
          A check failure is shown and announced once: by its notice, or, while
          Problems replaces that notice, by the list and this alert's hidden text. */}
      <div className="tw:grid tw:min-w-0 tw:flex-1 tw:text-sm">
        <span
          role="status"
          className="tw:min-w-0 tw:[overflow-wrap:anywhere] tw:text-muted-foreground"
        >
          {commands.message && !commands.messageIsError
            ? commands.message
            : null}
        </span>
        <span
          role="alert"
          className="tw:min-w-0 tw:[overflow-wrap:anywhere] tw:text-danger"
        >
          {errorMessage}
          {hiddenFailureAnnouncement ? (
            <span className="tw:sr-only">{hiddenFailureAnnouncement}</span>
          ) : null}
        </span>
        {!commands.message && activeDriver ? (
          <span className="tw:min-w-0 tw:truncate tw:text-muted-foreground">
            {activeDriver.name} {activeDriver.version}
          </span>
        ) : null}
      </div>
    </ModalDetailActionBar>
  );
}
