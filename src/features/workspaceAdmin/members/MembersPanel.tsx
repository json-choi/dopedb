// Workspace management → Members for one team workspace. Composes the invite form, the
// member list and the pending invitations from a single directory read. Every write goes
// through the members command controller, one at a time; the control plane authorizes
// each command, so this panel only hides actions the server would always refuse.
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import { Button } from "../../../design-system/components/Button";
import {
  SettingsList,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import { invitationExpired, reinviteRole } from "./domain";
import InviteForm from "./InviteForm";
import { InvitationRow, MemberRow } from "./MemberDirectoryRows";
import { memberDirectoryQuery } from "./queries";
import {
  commandTarget,
  memberFailureMessage,
  useInvitationLinkCopy,
  useMemberCommands,
  type MemberCommand,
} from "./useMemberCommands";

const INVITATION_COMMANDS: ReadonlySet<MemberCommand["kind"]> = new Set([
  "revokeInvitation",
  "recreateInvitation",
]);

function Count({ value }: { value: number }) {
  return <span className="tw:text-ui tw:tabular-nums tw:text-muted-foreground">{value}</span>;
}

export default function MembersPanel({ scope }: WorkspaceAdminPanelProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const directory = useQuery(memberDirectoryQuery(scope));
  const commands = useMemberCommands(scope);
  const links = useInvitationLinkCopy();
  const data = directory.data;
  const now = Date.now();
  const pendingTarget = commands.pending ? commandTarget(commands.pending) : null;
  const failure = commands.failure;
  const failureTarget = failure ? commandTarget(failure.command) : null;
  // A refusal whose row left the refreshed directory stays visible above that list.
  const listedIds = new Set(
    [...(data?.members ?? []), ...(data?.invitations ?? [])].map((item) => item.id),
  );
  const orphaned = failure && failureTarget && data && !listedIds.has(failureTarget)
    ? failure
    : null;
  const invitationOrphan = orphaned && INVITATION_COMMANDS.has(orphaned.command.kind)
    ? orphaned.message
    : null;
  const memberOrphan = orphaned && !invitationOrphan ? orphaned.message : null;
  const retry = (
    <Button
      size="compact"
      disabled={directory.isFetching}
      disabledBehavior="focusable"
      onClick={() => void directory.refetch()}
    >
      {t("workspaceAdmin.retry")}
    </Button>
  );

  return (
    <div
      data-primary-flow
      className="tw:grid tw:w-full tw:max-w-[800px] tw:min-w-0 tw:content-start tw:gap-6 tw:p-4 tw:@max-[700px]:p-0"
    >
      <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
        {t("workspaceMembers.description")}
      </p>
      <InviteForm
        busy={commands.busy}
        inviting={commands.pending?.kind === "invite"}
        failure={failure?.command.kind === "invite" ? failure.message : null}
        outcome={commands.inviteOutcome}
        copy={links.state}
        onInvite={(email, role, onSuccess) =>
          commands.run({ kind: "invite", email, role }, onSuccess)}
        onCopy={(target, url) => void links.copyLink(target, url)}
      />

      <section className="tw:grid tw:min-w-0 tw:content-start tw:gap-2">
        <SettingsSectionHeader
          title={t("workspaceMembers.membersTitle")}
          info={data ? <Count value={data.members.length} /> : undefined}
          trailing={
            <Button
              iconOnly
              size="compact"
              variant="ghost"
              title={t("common.refresh")}
              disabled={directory.isFetching}
              disabledBehavior="focusable"
              onClick={() => void directory.refetch()}
            >
              <Icon
                name="refresh"
                data-spinning={directory.isFetching}
                className="tw:data-[spinning=true]:animate-spin tw:motion-reduce:animate-none"
              />
            </Button>
          }
        />
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceMembers.membersHint")}
        </p>
        {directory.isPending ? (
          <Skeleton lines={3} />
        ) : !data ? (
          <InlineNotice tone="danger" icon="alert" role="alert" action={retry}>
            {memberFailureMessage(directory.error, "load", i18n)}
          </InlineNotice>
        ) : (
          <>
            {directory.isError ? (
              <InlineNotice tone="danger" icon="alert" role="alert" action={retry}>
                {memberFailureMessage(directory.error, "refresh", i18n)}
              </InlineNotice>
            ) : null}
            {memberOrphan ? (
              <InlineNotice tone="danger" icon="alert" role="alert">
                {memberOrphan}
              </InlineNotice>
            ) : null}
            {data.members.length === 0 ? (
              <p className="tw:m-0 tw:py-3 tw:text-ui tw:text-muted-foreground">
                {t("workspaceMembers.empty")}
              </p>
            ) : (
              <SettingsList>
                {data.members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    self={member.userId === scope.accountId}
                    workspaceName={scope.workspaceName}
                    busy={commands.busy}
                    pending={pendingTarget === member.id ? commands.pending : null}
                    failure={failureTarget === member.id ? failure?.message ?? null : null}
                    onChangeRole={(role) =>
                      commands.run({ kind: "changeRole", memberId: member.id, role })}
                    onRemove={() => commands.run({ kind: "remove", memberId: member.id })}
                  />
                ))}
              </SettingsList>
            )}
          </>
        )}
      </section>

      {data && (data.invitations.length > 0 || invitationOrphan) ? (
        <section className="tw:grid tw:min-w-0 tw:content-start tw:gap-2">
          <SettingsSectionHeader
            title={t("workspaceMembers.invitationsTitle")}
            info={<Count value={data.invitations.length} />}
          />
          <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceMembers.invitationsHint")}
          </p>
          {invitationOrphan ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {invitationOrphan}
            </InlineNotice>
          ) : null}
          {data.invitations.length > 0 ? (
            <SettingsList>
              {data.invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  expired={invitationExpired(invitation, now)}
                  busy={commands.busy}
                  pending={pendingTarget === invitation.id ? commands.pending : null}
                  failure={failureTarget === invitation.id ? failure?.message ?? null : null}
                  copy={links.state?.target === invitation.id ? links.state : null}
                  onCopy={() => void links.copyLink(invitation.id, invitation.inviteUrl)}
                  onRecreate={() =>
                    commands.run({
                      kind: "recreateInvitation",
                      invitationId: invitation.id,
                      email: invitation.email,
                      role: reinviteRole(invitation.role),
                    })}
                  onRevoke={() =>
                    commands.run({ kind: "revokeInvitation", invitationId: invitation.id })}
                />
              ))}
            </SettingsList>
          ) : null}
        </section>
      ) : null}

      <p role="status" className="tw:sr-only">
        {links.state?.status === "copied" ? t("workspaceMembers.linkCopied") : ""}
      </p>
    </div>
  );
}
