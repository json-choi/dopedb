// Rows of the member directory. A member row edits the role or removes access, except
// for the owner and the acting administrator, whose rows are read-only as the server
// requires; an invitation row copies, re-creates or revokes its link. Rows only render
// the command state they are given and report intent through callbacks.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { SelectInput, TextInput } from "../../../design-system/components/FormControls";
import { SettingsRow } from "../../../design-system/components/SettingsList";
import { LoadingLabel, StatusBadge } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { AssignableWorkspaceRole } from "../domain";
import {
  ASSIGNABLE_ROLES,
  formatMemberDate,
  memberDisplayName,
  ROLE_LABEL_KEYS,
  ROLE_OPTION_KEYS,
  type PendingInvitation,
  type WorkspaceMember,
} from "./domain";
import type { LinkCopyState, MemberCommand } from "./useMemberCommands";

function RowFailure({ message }: { message: string }) {
  return (
    <p role="alert" className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger">
      {message}
    </p>
  );
}

export function MemberRow({
  member,
  self,
  workspaceName,
  busy,
  pending,
  failure,
  onChangeRole,
  onRemove,
}: {
  member: WorkspaceMember;
  /** The signed-in administrator's own membership, which the server keeps unchanged. */
  self: boolean;
  workspaceName: string;
  busy: boolean;
  /** The running command when it targets this member. */
  pending: MemberCommand | null;
  failure: string | null;
  onChangeRole: (role: AssignableWorkspaceRole) => void;
  onRemove: () => void;
}) {
  const { t, lang } = useI18n();
  const name = memberDisplayName(member);
  const profileName = member.name.trim();
  const editableRole = self || member.role === "owner" ? null : member.role;
  const shownRole = pending?.kind === "changeRole" ? pending.role : editableRole;
  return (
    <SettingsRow
      identity={
        <span className="tw:grid tw:min-w-0 tw:gap-0.5">
          <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
            <strong className="tw:min-w-0 tw:text-ui tw:[overflow-wrap:anywhere]">{name}</strong>
            {self ? (
              <StatusBadge density="compact">{t("workspaceMembers.you")}</StatusBadge>
            ) : null}
          </span>
          {profileName ? (
            <span className="tw:min-w-0 tw:text-xs tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
              {member.email}
            </span>
          ) : null}
        </span>
      }
      details={
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
          {editableRole && shownRole ? (
            <span className="tw:w-48 tw:max-w-full">
              <SelectInput
                density="compact"
                aria-label={t("workspaceMembers.roleFor", { member: name })}
                value={shownRole}
                // The targeted select stays focusable while its own command runs.
                disabled={busy && !pending}
                aria-disabled={pending ? true : undefined}
                onChange={(event) => onChangeRole(event.target.value as AssignableWorkspaceRole)}
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(ROLE_OPTION_KEYS[role])}
                  </option>
                ))}
              </SelectInput>
            </span>
          ) : (
            <span className="tw:text-ui tw:text-foreground">{t(ROLE_LABEL_KEYS[member.role])}</span>
          )}
          {pending ? (
            <LoadingLabel>
              {t(pending.kind === "remove" ? "workspaceMembers.removing" : "workspaceMembers.changingRole")}
            </LoadingLabel>
          ) : (
            <span className="tw:text-xs tw:text-muted-foreground">
              {t("workspaceMembers.joinedAt", { date: formatMemberDate(member.createdAt, lang) })}
            </span>
          )}
        </span>
      }
      actions={
        editableRole ? (
          <ConfirmButton
            iconOnly
            size="compact"
            variant="ghost"
            tone="danger"
            disabled={busy}
            label={t("workspaceMembers.removeMember", { member: name })}
            confirmLabel={t("workspaceMembers.removeConfirm", {
              member: profileName ? `${profileName} (${member.email})` : member.email,
              workspace: workspaceName,
            })}
            onConfirm={onRemove}
          >
            <Icon name="trash" />
          </ConfirmButton>
        ) : undefined
      }
    >
      {failure ? <RowFailure message={failure} /> : null}
    </SettingsRow>
  );
}

export function InvitationRow({
  invitation,
  expired,
  busy,
  pending,
  failure,
  copy,
  onCopy,
  onRecreate,
  onRevoke,
}: {
  invitation: PendingInvitation;
  /** Expired invitations stay listed as pending until they are revoked. */
  expired: boolean;
  busy: boolean;
  /** The running command when it targets this invitation. */
  pending: MemberCommand | null;
  failure: string | null;
  /** Copy feedback for this invitation's link only. */
  copy: LinkCopyState;
  onCopy: () => void;
  onRecreate: () => void;
  onRevoke: () => void;
}) {
  const { t, lang } = useI18n();
  const copied = copy?.status === "copied";
  const copyFailed = copy?.status === "failed";
  return (
    <SettingsRow
      identity={
        <strong className="tw:block tw:min-w-0 tw:text-ui tw:[overflow-wrap:anywhere]">
          {invitation.email}
        </strong>
      }
      details={
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
          {invitation.role ? (
            <span className="tw:text-ui tw:text-foreground">{t(ROLE_LABEL_KEYS[invitation.role])}</span>
          ) : null}
          {pending ? (
            <LoadingLabel>
              {t(pending.kind === "recreateInvitation" ? "workspaceMembers.recreating" : "workspaceMembers.revoking")}
            </LoadingLabel>
          ) : expired ? (
            <StatusBadge tone="warning">{t("workspaceMembers.expired")}</StatusBadge>
          ) : (
            <span className="tw:text-xs tw:text-muted-foreground">
              {t("workspaceMembers.expiresAt", { date: formatMemberDate(invitation.expiresAt, lang, true) })}
            </span>
          )}
        </span>
      }
      actions={
        <>
          {expired ? (
            <Button
              iconOnly
              size="compact"
              variant="ghost"
              disabled={busy}
              aria-label={t("workspaceMembers.recreateInvitation", { email: invitation.email })}
              onClick={onRecreate}
            >
              <Icon name="refresh" />
            </Button>
          ) : (
            <Button
              iconOnly
              size="compact"
              variant="ghost"
              tone={copied ? "success" : "neutral"}
              disabled={pending !== null}
              aria-label={
                copied
                  ? t("workspaceMembers.linkCopied")
                  : t("workspaceMembers.copyInvitationLink", { email: invitation.email })
              }
              onClick={onCopy}
            >
              <Icon name={copied ? "check" : "copy"} />
            </Button>
          )}
          <ConfirmButton
            iconOnly
            size="compact"
            variant="ghost"
            tone="danger"
            disabled={busy}
            label={t("workspaceMembers.revokeInvitation", { email: invitation.email })}
            confirmLabel={t("workspaceMembers.revokeConfirm", { email: invitation.email })}
            onConfirm={onRevoke}
          >
            <Icon name="trash" />
          </ConfirmButton>
        </>
      }
    >
      {failure || copyFailed ? (
        <span className="tw:grid tw:min-w-0 tw:gap-1.5">
          {failure ? <RowFailure message={failure} /> : null}
          {copyFailed ? (
            <>
              <RowFailure message={t("workspaceMembers.copyFailed")} />
              <TextInput
                density="compact"
                monospace
                readOnly
                value={invitation.inviteUrl}
                aria-label={t("workspaceMembers.inviteLink")}
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          ) : null}
        </span>
      ) : null}
    </SettingsRow>
  );
}
