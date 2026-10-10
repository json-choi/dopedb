// Secure workspace connection flow: publishes only a redacted local template or
// binds a member-local credential to a synchronized template, then checks the
// new binding once so the member sees whether it works.
import {
  useMemo,
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
import {
  connectionTestIssue,
  connectionTestIssueRecovery,
  connectionTestIssueTitle,
} from "../../connections/connectionTestFailure";
import type {
  ConnectionProfile,
  ConnectionTestIssue,
} from "../../connections/domain";
import { CONNECTION_SSH_ALIAS_PARAMETER } from "../../connections/options";
import {
  pickConnectionFile,
  testConnection,
} from "../../connections/tauriAdapter";
import { errDetails } from "../../../ipc/types";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../../design-system/components/Modal";
import { LoadingLabel } from "../../../design-system/components/Status";

type DialogMode = "copy" | "credentials";

/**
 * TLS files a member keeps in their own binding. The shared template owns the
 * TLS mode; certificate and key paths name files on this device, so they stay
 * in the local binding and never reach the workspace.
 */
const SQL_TLS_FILES = [
  { key: "sslrootcert", label: "connections.caCertificate" },
  { key: "sslcert", label: "connections.clientCertificate" },
  { key: "sslkey", label: "connections.clientKey" },
] as const satisfies readonly { key: string; label: I18nKey }[];

const MONGO_TLS_FILES = [
  { key: "tlsCAFile", label: "connections.caCertificate" },
  { key: "tlsCertificateKeyFile", label: "connections.clientCertificateKey" },
] as const satisfies readonly { key: string; label: I18nKey }[];

/** Which member-local TLS settings apply; SQL files only when the template uses TLS. */
function memberTlsFiles(connection: ConnectionProfile) {
  if (connection.engine === "mongodb") return MONGO_TLS_FILES;
  if (
    (connection.engine === "postgres" || connection.engine === "mysql") &&
    !["disable", "disabled"].includes(connection.sslmode)
  ) {
    return SQL_TLS_FILES;
  }
  return [];
}

/** Stable copy for a failed copy or binding; backend text never reaches the UI. */
function workspaceConnectionErrorKey(
  error: unknown,
  mode: DialogMode,
): I18nKey {
  switch (errDetails(error).kind) {
    case "network":
    case "timeout":
      return "workspace.connectionServiceUnavailable";
    case "credentialBindingRequired":
      return mode === "copy"
        ? "workspace.copyCredentialMissing"
        : "workspace.bindPasswordRequired";
    case "keychain":
      return "workspace.bindCredentialStoreFailed";
    case "config":
      return mode === "copy"
        ? "workspace.copyRejected"
        : "workspace.bindValuesRejected";
    case "blocked":
    case "safety":
      return "workspace.connectionActionBlocked";
    case "notFound":
      return mode === "copy"
        ? "workspace.copyTargetUnavailable"
        : "workspace.bindConnectionUnavailable";
    default:
      return "workspace.connectionActionFailed";
  }
}

export default function WorkspaceConnectionDialog({
  connection,
  mode,
  onBound,
  onClose,
  returnFocusRef,
}: {
  connection: ConnectionProfile;
  mode: DialogMode;
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
  const tlsFileFields = memberTlsFiles(connection);
  const [tlsFiles, setTlsFiles] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...SQL_TLS_FILES, ...MONGO_TLS_FILES].map(({ key }) => [
        key,
        connection.extraParams[key] ?? "",
      ]),
    ),
  );
  const [mongoTls, setMongoTls] = useState(
    connection.extraParams.tls?.toLowerCase() === "true",
  );
  const tlsFilesDisabled =
    connection.engine === "mongodb" && !mongoTls;
  const [pending, setPending] = useState<"saving" | "checking" | null>(null);
  const [error, setError] = useState<I18nKey | null>(null);
  const [checkFailure, setCheckFailure] = useState<{
    issue: ConnectionTestIssue;
    /** Whole seconds a `retryLater` refusal asked to wait. */
    retryAfterSeconds?: number;
  } | null>(null);
  // An existing binding keeps its saved password when the field stays empty.
  const keepsSavedPassword = connection.secretRef !== null;
  const selectedTargetValue = targetValue || targets[0]?.value || "";

  async function copy() {
    const target = parseWorkspaceChoice(selectedTargetValue);
    if (!target?.accountUserId) {
      setError("workspace.copyTargetRequired");
      return;
    }
    await copyConnectionToWorkspace(
      connection.id,
      target.workspaceId,
      target.accountUserId,
    );
    await invalidateWorkspaceContext(queryClient);
    toast(t("workspace.connectionCopied"));
    onClose();
  }

  /** Every applicable setting is sent, so clearing a path removes it from the binding. */
  function tlsFilesRequest(): Record<string, string> | undefined {
    if (tlsFileFields.length === 0) return undefined;
    const request: Record<string, string> = Object.fromEntries(
      tlsFileFields.map(({ key }) => [
        key,
        tlsFilesDisabled ? "" : (tlsFiles[key] ?? ""),
      ]),
    );
    if (connection.engine === "mongodb") request.tls = mongoTls ? "true" : "";
    return request;
  }

  async function browse(key: string) {
    const file = await pickConnectionFile();
    if (file) setTlsFiles((current) => ({ ...current, [key]: file }));
  }

  /** Save the binding, then check it once so a wrong value is fixed right here. */
  async function bind() {
    const bound = await bindWorkspaceConnectionCredentials(
      connection.id,
      username,
      password,
      sshAlias,
      tlsFilesRequest(),
    );
    onBound(bound);
    setPassword("");
    setPending("checking");
    let receipt;
    try {
      receipt = await testConnection(bound.id);
    } catch {
      setCheckFailure({ issue: { code: "unknown", field: null } });
      return;
    }
    if (!receipt.ok) {
      // A refusal made before connecting keeps its own guidance and wait.
      setCheckFailure({
        issue: connectionTestIssue(receipt.failure),
        retryAfterSeconds: receipt.failure.retryAfterSeconds,
      });
      return;
    }
    toast(t("workspace.credentialsVerified"));
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending("saving");
    setError(null);
    setCheckFailure(null);
    try {
      if (mode === "copy") await copy();
      else await bind();
    } catch (caught) {
      setError(workspaceConnectionErrorKey(caught, mode));
    } finally {
      setPending(null);
    }
  }

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (pending === null) onClose();
      }}
    >
      <ModalSurface
        aria-labelledby="workspace-connection-title"
        aria-describedby="workspace-connection-description"
        aria-busy={pending !== null}
        onRequestClose={onClose}
        dismissible={pending === null}
        returnFocusRef={returnFocusRef}
      >
        <form
          className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col"
          onSubmit={submit}
        >
          <ModalHeader
            titleId="workspace-connection-title"
            title={mode === "copy"
                ? t("workspace.copyConnection", {
                    name: connection.name,
                  })
                : t("workspace.bindCredentials", {
                    name: connection.name,
                  })}
          />
          <div className="tw:grid tw:min-h-0 tw:min-w-0 tw:gap-3 tw:overflow-y-auto tw:p-4">
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
                  data-modal-initial-focus
                  value={selectedTargetValue}
                  onChange={(event) =>
                    setTargetValue(event.target.value)
                  }
                  disabled={pending !== null || targets.length === 0}
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
                  data-modal-initial-focus
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
                  required={!keepsSavedPassword}
                  placeholder={
                    keepsSavedPassword
                      ? t("workspace.bindKeepsSavedPassword")
                      : undefined
                  }
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
              {tlsFileFields.length > 0 ? (
                <section
                  className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
                  aria-labelledby="workspace-connection-tls"
                >
                  <h2
                    id="workspace-connection-tls"
                    className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground"
                  >
                    {t("workspace.bindTlsFiles")}
                  </h2>
                  {connection.engine === "mongodb" ? (
                    <CheckboxField
                      label={t("connections.enableTls")}
                      checked={mongoTls}
                      disabled={pending !== null}
                      onChange={(event) => setMongoTls(event.target.checked)}
                    />
                  ) : null}
                  {tlsFileFields.map(({ key, label }) => (
                    <Field key={key} label={t(label)}>
                      {({ controlProps }) => (
                        <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2">
                          <TextInput
                            {...controlProps()}
                            value={tlsFiles[key] ?? ""}
                            disabled={pending !== null || tlsFilesDisabled}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            onChange={(event) => {
                              const value = event.target.value;
                              setTlsFiles((current) => ({ ...current, [key]: value }));
                            }}
                          />
                          <Button
                            aria-label={`${t("connections.browse")}: ${t(label)}`}
                            disabled={pending !== null || tlsFilesDisabled}
                            onClick={() => void browse(key)}
                          >
                            {t("connections.browse")}
                          </Button>
                        </div>
                      )}
                    </Field>
                  ))}
                </section>
              ) : null}
            </>
          )}
          {pending === "checking" ? (
            <span className="tw:text-ui">
              <LoadingLabel>{t("workspace.bindChecking")}</LoadingLabel>
            </span>
          ) : null}
          {error ? (
            <div
              className="tw:border-l-2 tw:border-danger tw:bg-danger-muted tw:p-2 tw:text-ui tw:leading-body tw:text-danger tw:[overflow-wrap:anywhere]"
              role="alert"
            >
              {t(error)}
            </div>
          ) : checkFailure ? (
            <div
              className="tw:grid tw:gap-1 tw:border-l-2 tw:border-danger tw:bg-danger-muted tw:p-2 tw:text-ui tw:leading-body tw:[overflow-wrap:anywhere]"
              role="alert"
            >
              <strong className="tw:font-semibold tw:text-danger">
                {connectionTestIssueTitle(t, checkFailure.issue, connection)}
              </strong>
              <span className="tw:text-foreground">
                {checkFailure.issue.refusal
                  ? connectionTestIssueRecovery(t, checkFailure.issue, connection, {
                      retrySeconds: checkFailure.retryAfterSeconds,
                    })
                  : t("workspace.bindCheckFailed")}
              </span>
            </div>
          ) : null}
          </div>
          <ModalFooter>
            <Button
              onClick={onClose}
              disabled={pending !== null}
            >
              {checkFailure ? t("common.close") : t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending !== null ||
                (mode === "copy" && !selectedTargetValue)
              }
              disabledBehavior="focusable"
            >
              {pending
                ? t("common.working")
                : mode === "copy"
                  ? t("workspace.copy")
                  : t("workspace.bind")}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
