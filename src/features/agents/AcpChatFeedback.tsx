// AI Chat feedback above the transcript: a dismissible notice, and the error
// whose action retries a failed session list or dismisses the message. A
// conversation whose pinned resources changed also offers a new one with the
// same resources. An unrecognized failure offers its raw detail for copying,
// never as the message itself. This presentation leaf owns no state, query, or
// transport.

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { AcpChatController } from "./useAcpChatController";

export default function AcpChatFeedback({
  feedback,
  session,
  commands,
}: Pick<AcpChatController, "feedback" | "session"> & {
  commands: Pick<AcpChatController["commands"], "feedback" | "session">;
}) {
  const { t } = useI18n();
  const errorDetail = feedback.error ? feedback.errorDetail : null;
  return (
    <>
      {feedback.notice ? (
        <InlineNotice
          tone="warning"
          icon="history"
          role="status"
          action={
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              onClick={commands.feedback.dismissNotice}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <Icon name="close" />
            </Button>
          }
        >
          {feedback.notice}
        </InlineNotice>
      ) : null}

      {feedback.error || session.loadError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <>
              {feedback.error && feedback.offerSameResources ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={commands.session.newWithSameResources}
                >
                  <Icon name="plus" />
                  {t("agent.acpNewSessionSameResources")}
                </Button>
              ) : null}
              {errorDetail ? (
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  onClick={() => void navigator.clipboard?.writeText(errorDetail)}
                  title={t("agent.acpCopyErrorDetail")}
                  aria-label={t("agent.acpCopyErrorDetail")}
                >
                  <Icon name="copy" />
                </Button>
              ) : null}
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                onClick={
                  session.loadError
                    ? commands.session.retryLoad
                    : commands.feedback.dismiss
                }
                title={t(session.loadError ? "common.refresh" : "common.close")}
                aria-label={t(session.loadError ? "common.refresh" : "common.close")}
              >
                <Icon name={session.loadError ? "refresh" : "close"} />
              </Button>
            </>
          }
        >
          {feedback.error ?? session.loadError}
        </InlineNotice>
      ) : null}
    </>
  );
}
