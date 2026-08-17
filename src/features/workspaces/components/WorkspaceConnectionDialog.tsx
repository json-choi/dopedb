// Secure workspace connection flow: publishes only a redacted local template or
// binds a member-local credential to a synchronized template.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindWorkspaceConnectionCredentials,
  copyConnectionToWorkspace,
} from "../tauriAdapter";
import { invalidateWorkspaceContext } from "../cache";
import { workspaceAuthStateQuery, workspaceContextQuery } from "../queries";
import {
  buildWorkspaceChoiceGroups,
  canManageWorkspaceConnections,
  parseWorkspaceChoice,
} from "../choices";
import type { ConnectionProfile } from "../../connections/domain";
import { CONNECTION_SSH_ALIAS_PARAMETER } from "../../connections/options";
import { errDetails } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import {
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalSurface,
} from "../../../design-system/components/Modal";

export default function WorkspaceConnectionDialog({
  connection,
  mode,
  onBound,
  onClose,
  returnFocusRef,
}: {
  connection: ConnectionProfile;
  mode: "copy" | "credentials";
  onBound: (connection: ConnectionProfile) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const context = useQuery(workspaceContextQuery());
  const auth = useQuery(workspaceAuthStateQuery());
  const targetGroups = useMemo(
    () => buildWorkspaceChoiceGroups(
      auth.data,
      context.data?.workspaces ?? [],
      t("workspace.localOnly"),
    )
      .map((group) => ({
        ...group,
        choices: group.choices.filter((choice) =>
          choice.workspace.kind === "team"
          && canManageWorkspaceConnections(choice.role)
          && !(
            choice.workspace.id === context.data?.active.id
            && choice.accountUserId === auth.data?.user?.id
          ),
        ),
      }))
      .filter((group) => group.choices.length > 0),
    [auth.data, context.data, t],
  );
  const targets = targetGroups.flatMap((group) => group.choices);
  const [targetValue, setTargetValue] = useState("");
  const [username, setUsername] = useState(connection.username);
  const [password, setPassword] = useState("");
  const [sshAlias, setSshAlias] = useState(
    connection.extraParams[CONNECTION_SSH_ALIAS_PARAMETER] ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const selectedTargetValue = targetValue || targets[0]?.value || "";

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const returnFocus = returnFocusRef?.current ?? trigger;
    const focusTarget = initialFocusRef.current;
    if (focusTarget instanceof HTMLSelectElement && focusTarget.disabled) {
      cancelRef.current?.focus();
    } else {
      focusTarget?.focus();
    }
    return () => returnFocus?.focus?.();
  }, [returnFocusRef]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (mode === "copy") {
        const target = parseWorkspaceChoice(selectedTargetValue);
        if (!target?.accountUserId) throw new Error("A workspace account is required.");
        await copyConnectionToWorkspace(
          connection.id,
          target.workspaceId,
          target.accountUserId,
        );
        await invalidateWorkspaceContext(queryClient);
        toast(t("workspace.connectionCopied"));
      } else {
        const bound = await bindWorkspaceConnectionCredentials(
          connection.id,
          username,
          password,
          sshAlias,
        );
        onBound(bound);
        toast(t("workspace.credentialsBound"));
      }
      onClose();
    } catch (caught) {
      const details = errDetails(caught);
      const serviceUnavailable =
        details.kind === "network" && details.message.includes("404 Not Found");
      setError(
        serviceUnavailable
          ? t("workspace.connectionServiceUnavailable")
          : details.message,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (!pending) onClose();
      }}
    >
      <ModalSurface
        aria-labelledby="workspace-connection-title"
        aria-describedby="workspace-connection-description"
        aria-busy={pending}
        onEscape={pending ? undefined : onClose}
      >
        <form
          className="tw:flex tw:min-h-0 tw:flex-col tw:gap-3 tw:overflow-auto tw:p-4"
          onSubmit={submit}
        >
          <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
            <h2 id="workspace-connection-title">
              {mode === "copy"
                ? t("workspace.copyConnection", {
                    name: connection.name,
                  })
                : t("workspace.bindCredentials", {
                    name: connection.name,
                  })}
            </h2>
          </header>
          {mode === "copy" ? (
            <>
              <p
                id="workspace-connection-description"
                className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground tw:[overflow-wrap:anywhere]"
              >
                {t("workspace.copySecurityNote")}
              </p>
              <Field label={t("workspace.targetWorkspace")}>
                <SelectInput
                  ref={(node) => {
                    initialFocusRef.current = node;
                  }}
                  value={selectedTargetValue}
                  onChange={(event) =>
                    setTargetValue(event.target.value)
                  }
                  disabled={pending || targets.length === 0}
                >
                  {targetGroups.map((group) => (
                    <optgroup key={group.key} label={group.label}>
                      {group.choices.map((choice) => (
                        <option
                          value={choice.value}
                          key={choice.value}
                        >
                          {choice.workspace.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </SelectInput>
              </Field>
              {targets.length === 0 ? (
                <div
                  className="tw:text-ui tw:text-danger"
                  role="alert"
                >
                  {t("workspace.noManageableWorkspace")}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p
                id="workspace-connection-description"
                className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground tw:[overflow-wrap:anywhere]"
              >
                {t("workspace.credentialsSecurityNote")}
              </p>
              <Field label={t("workspace.username")}>
                <TextInput
                  ref={(node) => {
                    initialFocusRef.current = node;
                  }}
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  autoComplete="username"
                />
              </Field>
              <Field label={t("connections.password")}>
                <TextInput
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  autoComplete="current-password"
                  required
                />
              </Field>
              {connection.engine !== "sqlite" ? (
                <Field label={t("connections.sshHostAlias")}>
                  <TextInput
                    value={sshAlias}
                    onChange={(event) =>
                      setSshAlias(event.target.value)
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={255}
                    pattern="[A-Za-z0-9._][A-Za-z0-9._-]*"
                    placeholder={t(
                      "connections.sshHostAliasPlaceholder",
                    )}
                  />
                </Field>
              ) : null}
            </>
          )}
          {error ? (
            <div
              className="tw:border-l-2 tw:border-danger tw:bg-danger-muted tw:p-2 tw:text-ui tw:leading-body tw:text-danger tw:[overflow-wrap:anywhere]"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <footer className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[520px]:[&>button]:w-full">
            <Button
              ref={cancelRef}
              onClick={onClose}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending ||
                (mode === "copy" && !selectedTargetValue)
              }
            >
              {pending
                ? t("common.working")
                : mode === "copy"
                  ? t("workspace.copy")
                  : t("workspace.bind")}
            </Button>
          </footer>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
