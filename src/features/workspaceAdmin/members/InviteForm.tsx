// Invite form of the members area. It owns only the draft address and role, checks the
// address with the server's own rule before sending, and shows the latest invite's
// refusal or outcome beside the form, including the copyable link that works even when
// the workspace service sends no email.
import { useId, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { Field, SelectInput, TextInput } from "../../../design-system/components/FormControls";
import { SettingsSectionHeader } from "../../../design-system/components/SettingsList";
import { InlineNotice, LoadingLabel } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { AssignableWorkspaceRole } from "../domain";
import {
  ASSIGNABLE_ROLES,
  DEFAULT_INVITE_ROLE,
  formatMemberDate,
  normalizeInviteEmail,
  ROLE_LABEL_KEYS,
  ROLE_OPTION_KEYS,
} from "./domain";
import type { InviteOutcome, LinkCopyState } from "./useMemberCommands";

export default function InviteForm({
  busy,
  inviting,
  failure,
  outcome,
  copy,
  onInvite,
  onCopy,
}: {
  /** Any members command is running; one command at a time. */
  busy: boolean;
  inviting: boolean;
  failure: string | null;
  outcome: InviteOutcome | null;
  copy: LinkCopyState;
  onInvite: (email: string, role: AssignableWorkspaceRole, onSuccess: () => void) => void;
  onCopy: (target: string, url: string) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableWorkspaceRole>(DEFAULT_INVITE_ROLE);
  const [invalid, setInvalid] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const validationId = `${baseId}-validation`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeInviteEmail(email);
    if (!normalized) {
      setInvalid(true);
      emailRef.current?.focus();
      return;
    }
    onInvite(normalized, role, () => setEmail(""));
  }

  return (
    <section className="tw:grid tw:min-w-0 tw:content-start tw:gap-2">
      <SettingsSectionHeader title={t("workspaceMembers.inviteTitle")} />
      <form noValidate className="tw:grid tw:min-w-0 tw:gap-2" onSubmit={submit}>
        <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_minmax(0,200px)_auto] tw:items-end tw:gap-2 tw:@max-[560px]:grid-cols-1">
          <Field label={t("workspaceMembers.emailLabel")}>
            <TextInput
              ref={emailRef}
              type="email"
              value={email}
              // Read-only rather than disabled, so Enter-to-submit keeps focus here.
              readOnly={inviting}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("workspaceMembers.emailPlaceholder")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? validationId : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                setInvalid(false);
              }}
            />
          </Field>
          <Field label={t("workspaceMembers.roleLabel")}>
            <SelectInput
              value={role}
              disabled={inviting}
              onChange={(event) => setRole(event.target.value as AssignableWorkspaceRole)}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {t(ROLE_OPTION_KEYS[option])}
                </option>
              ))}
            </SelectInput>
          </Field>
          <span className="tw:flex">
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              disabledBehavior="focusable"
            >
              {t("workspaceMembers.invite")}
            </Button>
          </span>
        </div>
        {invalid ? (
          <p id={validationId} role="alert" className="tw:m-0 tw:text-xs tw:text-danger">
            {t("workspaceMembers.emailInvalid")}
          </p>
        ) : null}
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceMembers.inviteHint")}
        </p>
      </form>
      {inviting ? <LoadingLabel>{t("workspaceMembers.inviting")}</LoadingLabel> : null}
      {failure ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {failure}
        </InlineNotice>
      ) : null}
      {outcome ? <InviteOutcomeNotice outcome={outcome} copy={copy} onCopy={onCopy} /> : null}
    </section>
  );
}

function InviteOutcomeNotice({
  outcome,
  copy,
  onCopy,
}: {
  outcome: InviteOutcome;
  copy: LinkCopyState;
  onCopy: (target: string, url: string) => void;
}) {
  const { t, lang } = useI18n();
  const invitation = outcome.invitation;
  if (!invitation) {
    return (
      <p role="status" className="tw:m-0 tw:text-ui tw:text-foreground tw:[overflow-wrap:anywhere]">
        {t("workspaceMembers.inviteCreated", { email: outcome.email })}
      </p>
    );
  }
  // Re-inviting a pending address renews that invitation with its original role.
  const keptRole = invitation.role !== null && invitation.role !== outcome.requestedRole
    ? invitation.role
    : null;
  const target = `outcome:${invitation.id}`;
  const copied = copy?.target === target && copy.status === "copied";
  const copyFailed = copy?.target === target && copy.status === "failed";
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-2">
      {keptRole ? (
        <InlineNotice tone="warning" icon="alert" role="status">
          {t("workspaceMembers.inviteKeptRole", {
            email: outcome.email,
            role: t(ROLE_LABEL_KEYS[keptRole]),
          })}
        </InlineNotice>
      ) : (
        <p role="status" className="tw:m-0 tw:flex tw:min-w-0 tw:items-start tw:gap-2 tw:text-ui tw:text-foreground">
          <Icon name="check" className="tw:mt-0.5 tw:shrink-0 tw:text-success" />
          <span className="tw:min-w-0 tw:[overflow-wrap:anywhere]">
            {t("workspaceMembers.inviteReady", {
              email: outcome.email,
              date: formatMemberDate(invitation.expiresAt, lang, true),
            })}
          </span>
        </p>
      )}
      <div className="ds-control-row tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:[--ds-row-control-size:var(--ds-control-md)]">
        <span className="tw:min-w-0 tw:flex-1">
          <TextInput
            density="compact"
            monospace
            readOnly
            value={invitation.inviteUrl}
            aria-label={t("workspaceMembers.inviteLink")}
            onFocus={(event) => event.currentTarget.select()}
          />
        </span>
        <Button
          size="compact"
          tone={copied ? "success" : "neutral"}
          onClick={() => onCopy(target, invitation.inviteUrl)}
        >
          <Icon name={copied ? "check" : "copy"} />
          {copied ? t("common.copied") : t("workspaceMembers.copyLink")}
        </Button>
      </div>
      {copyFailed ? (
        <p role="alert" className="tw:m-0 tw:text-xs tw:text-danger">
          {t("workspaceMembers.copyFailed")}
        </p>
      ) : null}
    </div>
  );
}
