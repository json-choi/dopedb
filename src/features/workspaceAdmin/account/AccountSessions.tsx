// Signed-in sessions of the active account: which web browsers and DopeDB Desktop
// apps hold a session, with an explicit end action for every session except the one
// this app uses. The control plane owns the list; session tokens never reach the UI.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon, type IconName } from "../../../components/Icon";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
} from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { AccountId } from "../../workspaces/domain";
import {
  runWorkspaceAdmin,
  workspaceAdminErrorMessage,
  WorkspaceAdminRequestError,
} from "../requests";
import type { AccountSession, AccountSessionClient } from "./domain";
import { formatDay, relativeAge } from "./format";
import { accountSessionsQuery, accountSessionsQueryKey } from "./queries";

const CLIENT_LABEL: Record<AccountSessionClient, I18nKey> = {
  browser: "workspaceAccount.clientBrowser",
  desktop: "workspaceAccount.clientDesktop",
};

const CLIENT_ICON: Record<AccountSessionClient, IconName> = {
  browser: "link",
  desktop: "sidebar",
};

const END_CONFIRMATION: Record<AccountSessionClient, I18nKey> = {
  browser: "workspaceAccount.endBrowserSessionConfirm",
  desktop: "workspaceAccount.endDesktopSessionConfirm",
};

function SessionRow({
  session,
  busy,
  failure,
  onEnd,
}: {
  session: AccountSession;
  busy: boolean;
  failure: string | null;
  onEnd: () => void;
}) {
  const { lang, t } = useI18n();
  const age = relativeAge(session.updatedAt, lang);
  return (
    <SettingsRow
      identity={
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <Icon
            name={CLIENT_ICON[session.client]}
            className="tw:shrink-0 tw:text-muted-foreground"
          />
          <span className="tw:grid tw:min-w-0">
            <span className="tw:truncate tw:text-ui tw:font-medium tw:text-foreground">
              {t(CLIENT_LABEL[session.client])}
            </span>
            {session.ipAddress ? (
              <span className="tw:truncate tw:font-mono tw:text-2xs tw:text-muted-foreground">
                {session.ipAddress}
              </span>
            ) : null}
          </span>
        </span>
      }
      details={
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-sm tw:text-muted-foreground">
          {session.current ? (
            <StatusBadge tone="success">{t("workspaceAccount.currentSession")}</StatusBadge>
          ) : null}
          <time dateTime={session.updatedAt}>
            {age === null
              ? t("workspaceAccount.activeNow")
              : t("workspaceAccount.lastActive", { time: age })}
          </time>
          <span className="ds-meta-dot tw:shrink-0" aria-hidden="true" />
          <time dateTime={session.createdAt}>
            {t("workspaceAccount.signedIn", { date: formatDay(session.createdAt, lang) })}
          </time>
        </span>
      }
      actions={
        session.current ? undefined : (
          <ConfirmButton
            iconOnly
            label={t("workspaceAccount.endSession")}
            size="compact"
            variant="ghost"
            tone="danger"
            disabled={busy}
            confirmLabel={t(END_CONFIRMATION[session.client])}
            onConfirm={onEnd}
          >
            <Icon name="logOut" />
          </ConfirmButton>
        )
      }
    >
      {failure ? (
        <p role="alert" className="tw:m-0 tw:text-sm tw:leading-body tw:text-danger">
          {failure}
        </p>
      ) : null}
    </SettingsRow>
  );
}

export default function AccountSessions({ accountId }: { accountId: AccountId }) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery(accountSessionsQuery(accountId));
  const [ending, setEnding] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ sessionId: string; message: string } | null>(
    null,
  );

  function endSessionError(error: unknown) {
    if (
      error instanceof WorkspaceAdminRequestError
      && error.status === 409
      && error.code === "current_session"
    ) {
      return t("workspaceAccount.currentSessionCannotEnd");
    }
    return workspaceAdminErrorMessage(error, { lang, t }, "workspaceAccount.endSessionFailed");
  }

  async function endSession(session: AccountSession) {
    if (ending !== null) return;
    setEnding(session.id);
    setFailure(null);
    try {
      await runWorkspaceAdmin(accountId, {
        kind: "revokeAccountSession",
        sessionId: session.id,
      });
      toast(t("workspaceAccount.sessionEnded"), "success");
    } catch (error) {
      // A session that is already gone needs no message; the refresh drops its row.
      if (!(error instanceof WorkspaceAdminRequestError && error.status === 404)) {
        setFailure({ sessionId: session.id, message: endSessionError(error) });
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: accountSessionsQueryKey(accountId) });
      setEnding(null);
    }
  }

  const rows = sessions.data ?? [];
  const otherSessions = rows.filter((session) => !session.current).length;

  return (
    <section className="tw:grid tw:min-w-0" aria-busy={sessions.isFetching}>
      <SettingsSectionHeader
        title={t("workspaceAccount.sessionsTitle")}
        trailing={
          <Button
            iconOnly
            size="compact"
            variant="ghost"
            title={t("workspaceAccount.refreshSessions")}
            disabled={sessions.isFetching || ending !== null}
            onClick={() => void sessions.refetch()}
          >
            <Icon name="refresh" />
          </Button>
        }
      />
      <p className="tw:mt-0 tw:mb-3 tw:text-ui tw:leading-body tw:text-muted-foreground">
        {t("workspaceAccount.sessionsDescription")}
      </p>
      {sessions.isError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <Button
              size="compact"
              disabled={sessions.isFetching}
              onClick={() => void sessions.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          }
        >
          {workspaceAdminErrorMessage(
            sessions.error,
            { lang, t },
            "workspaceAccount.sessionsLoadFailed",
          )}
        </InlineNotice>
      ) : null}
      {sessions.isPending ? (
        <LoadingLabel>{t("workspaceAdmin.loading")}</LoadingLabel>
      ) : null}
      {rows.length > 0 ? (
        <SettingsList>
          {rows.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              busy={ending !== null}
              failure={failure?.sessionId === session.id ? failure.message : null}
              onEnd={() => void endSession(session)}
            />
          ))}
        </SettingsList>
      ) : null}
      {sessions.data && otherSessions === 0 ? (
        <p className="tw:mt-2 tw:mb-0 tw:text-ui tw:text-muted-foreground">
          {t("workspaceAccount.noOtherSessions")}
        </p>
      ) : null}
    </section>
  );
}
