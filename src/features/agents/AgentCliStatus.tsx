// Projects the local provider CLI query into one shared loading, failure,
// missing, authentication, and ready vocabulary across Agent setup surfaces.
import { Button } from "../../design-system/components/Button";
import {
  InlineNotice,
  StatusIndicator,
} from "../../design-system/components/Status";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { AgentCliInfo } from "./domain";

export function AgentCliStatusIndicators({
  cli,
  detecting,
  queryFailed,
  showDetected = false,
}: {
  cli: AgentCliInfo | undefined;
  detecting: boolean;
  queryFailed: boolean;
  showDetected?: boolean;
}) {
  const { t } = useI18n();
  if (detecting) {
    return (
      <StatusIndicator
        icon="refresh"
        label={t("agentTools.detecting")}
        spinning
      />
    );
  }
  if (queryFailed || !cli || Boolean(cli.detectionError)) {
    return (
      <StatusIndicator
        icon="alert"
        tone="danger"
        label={cli?.detectionError ?? t("agentTools.detectionFailed")}
      />
    );
  }
  if (!cli.installed) {
    return (
      <StatusIndicator
        icon="terminal"
        tone="warning"
        label={t("agentTools.cliMissing")}
      />
    );
  }
  return (
    <>
      {showDetected ? (
        <StatusIndicator
          icon="terminal"
          tone="success"
          label={t("agentTools.detected")}
        />
      ) : null}
      <StatusIndicator
        icon={cli.authenticated ? "check" : "user"}
        tone={cli.authenticated ? "success" : "warning"}
        label={t(
          cli.authenticated
            ? "agentTools.authenticated"
            : "agentTools.notAuthenticated",
        )}
      />
    </>
  );
}

export function AgentCliDetectionNotice({
  clis,
  queryError,
  onRetry,
  retrying,
}: {
  clis: ReadonlyArray<AgentCliInfo> | undefined;
  queryError: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useI18n();
  const failures =
    clis?.filter(
      (cli): cli is AgentCliInfo & { detectionError: string } =>
        Boolean(cli.detectionError),
    ) ?? [];
  if (!queryError && failures.length === 0) return null;
  return (
    <div className="tw:mt-3">
      <InlineNotice
        tone="danger"
        icon="alert"
        role="alert"
        action={
          <Button size="xs" variant="ghost" disabled={retrying} onClick={onRetry}>
            {t("agentTools.checkAgain")}
          </Button>
        }
      >
        <span className="tw:grid tw:gap-1">
          {queryError ? (
            <span>
              {t("agentTools.detectError", { error: errMessage(queryError) })}
            </span>
          ) : null}
          {failures.map((cli) => (
            <span key={cli.id}>
              {t("agentTools.detectProviderError", {
                provider: cli.name,
                error: cli.detectionError,
              })}
            </span>
          ))}
        </span>
      </InlineNotice>
    </div>
  );
}
