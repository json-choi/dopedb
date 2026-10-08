// Creates a team workspace for the signed-in account, asks the account lifecycle to
// publish the new membership, then switches to it through the caller's workspace
// transition. Only the typed name lives here. A created workspace is never offered a
// second create: a failed switch is retried here or left for the workspace menu.
import { useState, type FormEvent } from "react";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import {
  Field,
  TextInput,
  type FieldValidation,
} from "../../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../../design-system/components/Modal";
import { InlineNotice, LoadingLabel } from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { AccountId, WorkspaceId } from "../../workspaces/domain";
import { requestWorkspaceMembershipRefresh } from "../../workspaces/membershipRefreshRequest";
import {
  runWorkspaceAdmin,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
} from "../requests";
import {
  parseCreatedWorkspace,
  workspaceNameProblem,
  type CreatedWorkspace,
} from "./domain";

const TITLE_ID = "create-workspace-title";
const DESCRIPTION_ID = "create-workspace-description";

// Identity-service refusal codes that have a workspace-specific explanation.
const REFUSAL_MESSAGES: Partial<Record<string, I18nKey>> = {
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS: "workspaceAccount.createLimitReached",
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: "workspaceAccount.createNotAllowed",
};

type CreateState =
  | { step: "editing"; error: string | null }
  | { step: "creating" }
  | { step: "switching"; workspace: CreatedWorkspace }
  | { step: "switchFailed"; workspace: CreatedWorkspace; detail: string }
  | { step: "unreadable" };

export default function CreateWorkspaceDialog({
  accountId,
  onSwitch,
  onClose,
}: {
  accountId: AccountId;
  /** The workspace menu's own authority transition for the new workspace. */
  onSwitch: (workspaceId: WorkspaceId) => Promise<void>;
  onClose: () => void;
}) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState("");
  const [state, setState] = useState<CreateState>({ step: "editing", error: null });
  const busy = state.step === "creating" || state.step === "switching";
  const created = state.step === "switching"
    || state.step === "switchFailed"
    || state.step === "unreadable";
  const problem = workspaceNameProblem(name);
  const validation: FieldValidation | undefined = created
    ? undefined
    : problem === "tooLong"
      ? { tone: "danger", message: t("workspaceAccount.nameTooLong") }
      : problem === "control"
        ? { tone: "danger", message: t("workspaceAccount.nameControl") }
        : undefined;

  function createError(error: unknown) {
    if (error instanceof WorkspaceAdminRequestError) {
      const refusal = error.code ? REFUSAL_MESSAGES[error.code] : undefined;
      if (refusal) return t(refusal);
      // Other coded refusals speak the identity service's vocabulary, not DopeDB's.
      if (error.code) return t("workspaceAccount.createFailed");
      if (error.status === 400 || error.status === 413) {
        return t("workspaceAccount.nameInvalid");
      }
    }
    return workspaceAdminErrorMessage(error, { lang, t }, "workspaceAccount.createFailed");
  }

  async function switchTo(workspace: CreatedWorkspace) {
    setState({ step: "switching", workspace });
    try {
      // Rust activates only a workspace it already lists, so the account lifecycle
      // publishes the new membership before the switch.
      await requestWorkspaceMembershipRefresh();
      await onSwitch(workspace.id);
    } catch (error) {
      setState({ step: "switchFailed", workspace, detail: errMessage(error) });
      return;
    }
    toast(t("workspaceAccount.workspaceCreated", { name: workspace.name }), "success");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.step === "switchFailed") {
      await switchTo(state.workspace);
      return;
    }
    if (state.step !== "editing" || problem !== null) return;
    setState({ step: "creating" });
    let body: unknown;
    try {
      body = await runWorkspaceAdmin(accountId, {
        kind: "createWorkspace",
        name: name.trim(),
      });
    } catch (error) {
      setState({ step: "editing", error: createError(error) });
      return;
    }
    const workspace = parseCreatedWorkspace(body);
    if (!workspace) {
      // The workspace exists but cannot be addressed; let the menu show it instead.
      setState({ step: "unreadable" });
      void requestWorkspaceMembershipRefresh().catch(() => undefined);
      return;
    }
    await switchTo(workspace);
  }

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <ModalSurface
        size="alert"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        aria-busy={busy}
        onRequestClose={onClose}
        dismissible={!busy}
      >
        <form
          className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col"
          onSubmit={(event) => void submit(event)}
        >
          <ModalHeader title={t("workspaceAdmin.newWorkspace")} titleId={TITLE_ID} />
          <div className="tw:grid tw:min-h-0 tw:min-w-0 tw:content-start tw:gap-4 tw:overflow-y-auto tw:p-5 tw:max-[640px]:p-4">
            <p
              id={DESCRIPTION_ID}
              className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground"
            >
              {t("workspaceAccount.createDescription")}
            </p>
            <Field label={t("workspaceAccount.nameLabel")} validation={validation}>
              {({ controlProps }) => (
                <TextInput
                  {...controlProps()}
                  data-modal-initial-focus
                  value={name}
                  readOnly={busy || created}
                  placeholder={t("workspaceAccount.namePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (state.step === "editing" && state.error) {
                      setState({ step: "editing", error: null });
                    }
                  }}
                />
              )}
            </Field>
            {state.step === "editing" && state.error ? (
              <InlineNotice tone="danger" icon="alert" role="alert">
                {state.error}
              </InlineNotice>
            ) : null}
            {state.step === "switching" ? (
              <LoadingLabel>
                {t("workspaceAccount.opening", { name: state.workspace.name })}
              </LoadingLabel>
            ) : null}
            {state.step === "switchFailed" ? (
              <InlineNotice tone="warning" icon="alert" role="alert">
                <span className="tw:grid tw:min-w-0 tw:gap-1">
                  <span>
                    {t("workspaceAccount.openCreatedFailed", { name: state.workspace.name })}
                  </span>
                  {state.detail ? (
                    <span className="tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
                      {state.detail}
                    </span>
                  ) : null}
                </span>
              </InlineNotice>
            ) : null}
            {state.step === "unreadable" ? (
              <InlineNotice tone="warning" icon="alert" role="alert">
                {t("workspaceAccount.createdUnreadable")}
              </InlineNotice>
            ) : null}
          </div>
          <ModalFooter>
            <Button disabled={busy} onClick={onClose}>
              {t(created ? "common.close" : "common.cancel")}
            </Button>
            {state.step === "unreadable" ? null : (
              <Button
                type="submit"
                variant="primary"
                disabled={busy || (!created && problem !== null)}
                disabledBehavior="focusable"
              >
                {busy
                  ? t("workspaceAccount.creating")
                  : state.step === "switchFailed"
                    ? t("workspaceAdmin.retry")
                    : t("workspaceAccount.create")}
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
