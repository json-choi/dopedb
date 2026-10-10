// One Agent tool call in the transcript: a compact activity line, or the full
// card with raw input/output when debug details are on. Both forms keep the
// call's Analysis Article link and its SQL proposal approval card; this leaf
// owns no query, transport, or session state.

import { Icon } from "../../components/Icon";
import {
  AgentActivityLine,
  AgentToolCallCard,
} from "../../design-system/components/Agent";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import AcpSqlApproval from "./AcpSqlApproval";
import AcpStructuredResult from "./AcpStructuredResult";
import { toolActivityLabel } from "./acpActivityLabels";
import {
  findAnalysisArticle,
  recordString,
  safeJson,
  toolContentText,
  toolStatusLabel,
  toolStatusTone,
} from "./acpTranscriptPresentation";
import { findAgentSqlProposal, isSqlProposalTool } from "./sqlProposal";

export default function AcpToolCallCard({
  data,
  debugDetails,
  onOpenKnowledgeAnalysis,
  onOpenActivity,
  expectedConnectionId,
  expectedProposerSessionId,
  sessionEnded,
}: {
  data: Record<string, unknown>;
  debugDetails: boolean;
  onOpenKnowledgeAnalysis: (environmentId: string, articleId?: string) => void;
  onOpenActivity: () => void;
  expectedConnectionId: string | null;
  /** The conversation's live Broker session, or `null` when it is not live. */
  expectedProposerSessionId: string | null;
  sessionEnded: boolean;
}) {
  const { t } = useI18n();
  const status = recordString(data, "status") ?? "pending";
  const title =
    recordString(data, "title") ??
    recordString(data, "kind") ??
    t("agent.acpToolRequest");
  const content = toolContentText(data.content);
  const rawOutput = data.rawOutput;
  const rawInput = data.rawInput;
  const article = findAnalysisArticle(rawOutput ?? data.content);
  const sqlProposal = isSqlProposalTool(data)
    ? findAgentSqlProposal(rawOutput ?? data.content)
    : null;
  const actions = (
    <>
      {article ? (
        <Button
          size="xs"
          variant="primary"
          onClick={() =>
            onOpenKnowledgeAnalysis(article.projectEnvironmentId, article.id)
          }
        >
          <Icon name="chart" />
          {t("agent.acpOpenAnalysisArticle")}
        </Button>
      ) : null}
      {sqlProposal ? (
        <AcpSqlApproval
          proposal={sqlProposal}
          expectedConnectionId={expectedConnectionId}
          expectedProposerSessionId={expectedProposerSessionId}
          sessionEnded={sessionEnded}
          announceWhenPending
          returnFocusToComposer
          onOpenActivity={onOpenActivity}
        />
      ) : null}
    </>
  );
  if (!debugDetails) {
    return (
      <div className="tw:grid tw:gap-2">
        <AgentActivityLine
          label={toolActivityLabel(data, t)}
          status={toolStatusLabel(status, t)}
          tone={toolStatusTone(status)}
        />
        {actions}
      </div>
    );
  }
  return (
    <AgentToolCallCard
      title={title}
      status={toolStatusLabel(status, t)}
      tone={toolStatusTone(status)}
      details={
        rawInput !== undefined || rawOutput !== undefined ? (
          <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
            <summary className="tw:cursor-pointer tw:text-muted-foreground">
              {t("agent.acpToolDetails")}
            </summary>
            <pre className="tw:mt-2 tw:mb-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-all tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-2xs tw:leading-body tw:whitespace-pre-wrap">
              {safeJson({ input: rawInput, output: rawOutput })}
            </pre>
          </details>
        ) : null
      }
    >
      <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden">
        {content ? (
          <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
            <summary className="tw:cursor-pointer tw:text-muted-foreground">
              {t("agent.acpToolOutput")}
            </summary>
            <pre className="tw:mt-2 tw:mb-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-all tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-2xs tw:leading-body tw:whitespace-pre-wrap">
              {content}
            </pre>
          </details>
        ) : null}
        <AcpStructuredResult value={rawOutput ?? data.content} />
        {actions}
      </div>
    </AgentToolCallCard>
  );
}
