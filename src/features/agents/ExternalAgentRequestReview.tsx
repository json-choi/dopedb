// Presents the immutable external Agent start scope and reconfirmation action.
import { useState } from "react";

import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { databaseEngineLabel, type ConnectionId } from "../connections/domain";
import { githubSourceRevisionLabel } from "../knowledge/presentation";
import { AgentResourceChoiceRow } from "./AgentResourceChoice";
import type { ExternalAgentRequestSummary } from "./externalAgentDomain";
import {
  externalAgentResourceBoundaries,
  requestedExternalAgentResources,
} from "./externalAgentRequestModel";
import type {
  AgentDatabaseResourceChoice,
  AgentProjectResourceChoice,
  AgentSourceResourceChoice,
} from "./useAgentEnvironmentInventory";

export function ExternalAgentStartReview({
  request,
  projects,
}: {
  request: ExternalAgentRequestSummary;
  projects: AgentProjectResourceChoice[];
}) {
  const { t } = useI18n();
  const review = requestedExternalAgentResources(request.config, projects);
  if (!request.config || !review.complete) {
    return (
      <InlineNotice tone="danger" icon="alert" role="alert">
        {t("agent.externalConfiguredResourcesMissing")}
      </InlineNotice>
    );
  }
  return (
    <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)] tw:gap-4 tw:[overflow-wrap:anywhere]">
      <div>
        <h2 className="tw:m-0 tw:text-title tw:font-semibold">
          {review.project?.name ?? request.config.projectId}
        </h2>
        <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {t("agent.externalReviewExactScope")}
        </p>
      </div>
      <ResourceReviewList
        databases={review.databases}
        sources={review.sources}
        writeConnectionId={request.config.writeConnectionId ?? null}
      />
      {review.needsRefresh ? (
        <InlineNotice tone="warning" icon="alert" role="status">
          {t("agent.externalResourcesChanged")}
        </InlineNotice>
      ) : null}
    </div>
  );
}

export function StartApprovalButton({
  request,
  projects,
  disabled,
  ensureAvailable,
  onApprove,
}: {
  request: ExternalAgentRequestSummary;
  projects: AgentProjectResourceChoice[];
  disabled: boolean;
  ensureAvailable: (
    environmentId: string,
    authorityConnectionId: ConnectionId,
    connectionIds: readonly ConnectionId[],
  ) => Promise<boolean>;
  onApprove: () => void;
}) {
  const { t } = useI18n();
  const [preparing, setPreparing] = useState(false);
  const review = requestedExternalAgentResources(request.config, projects);

  async function approve() {
    if (!review.complete || disabled || preparing) return;
    setPreparing(true);
    try {
      const boundaries = externalAgentResourceBoundaries(
        review.databases,
        review.sources,
      );
      for (const boundary of boundaries) {
        if (
          boundary.stale
          && !(await ensureAvailable(
            boundary.environmentId,
            boundary.authorityConnectionId,
            boundary.connectionIds,
          ))
        ) {
          return;
        }
      }
      // Reconfirmation can advance a connection revision. Make the user review
      // the newly loaded exact resources before granting a process capability.
      if (boundaries.some((boundary) => boundary.stale)) return;
      onApprove();
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Button
      variant="primary"
      disabled={disabled || preparing || !review.complete}
      onClick={() => void approve()}
    >
      {review.needsRefresh
        ? t("agent.externalRefreshResources")
        : t("agent.externalApproveStart")}
    </Button>
  );
}

function ResourceReviewList({
  databases,
  sources,
  writeConnectionId,
}: {
  databases: AgentDatabaseResourceChoice[];
  sources: AgentSourceResourceChoice[];
  writeConnectionId: ConnectionId | null;
}) {
  const { t } = useI18n();
  return (
    <div className="tw:grid tw:gap-2">
      {databases.map((database) => (
        <AgentResourceChoiceRow
          key={database.connectionId}
          layout="card"
          icon="database"
          label={database.databaseName}
          detail={t("agent.externalDatabaseRevision", {
            engine: databaseEngineLabel(database.engine),
            revision: database.connectionRevision,
          })}
          suffix={
            <span className="tw:text-muted-foreground">
              {database.connectionId === writeConnectionId
                ? t("agent.externalWriteTarget")
                : t("agent.acpReadOnlyContext")}
            </span>
          }
        />
      ))}
      {sources.map((source) => (
        <AgentResourceChoiceRow
          key={source.sourceId}
          layout="card"
          icon="branch"
          label={source.displayName}
          detail={githubSourceRevisionLabel(source.repository, source.commitSha)}
        />
      ))}
    </div>
  );
}

export function ExternalAgentRequestIdentity({
  request,
}: {
  request: ExternalAgentRequestSummary;
}) {
  const { t } = useI18n();
  return (
    <dl className="tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:gap-x-3 tw:gap-y-2 tw:text-sm">
      <dt className="tw:text-muted-foreground">{t("agent.externalProvider")}</dt>
      <dd className="tw:m-0 tw:font-medium">
        {request.provider === "codex" ? "Codex" : "Claude Code"}
      </dd>
      <dt className="tw:text-muted-foreground">{t("agent.externalDirectory")}</dt>
      <dd className="tw:m-0 tw:min-w-0 tw:break-all tw:font-mono tw:text-xs">
        {request.workingDirectory}
      </dd>
    </dl>
  );
}
