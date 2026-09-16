// Presents the immutable external Agent start scope and reconfirmation action.
import { useState } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { githubSourceRevisionLabel } from "../knowledge/presentation";
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
        <h2>
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
      data-modal-initial-focus
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
        <div
          key={database.connectionId}
          className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2"
        >
          <Icon name="database" className="tw:text-muted-foreground" />
          <span className="tw:grid tw:min-w-0 tw:flex-1">
            <span className="tw:truncate tw:text-sm tw:font-medium">
              {database.databaseName}
            </span>
            <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
              {t("agent.externalDatabaseRevision", {
                engine: database.engine,
                revision: database.connectionRevision,
              })}
            </span>
          </span>
          <span className="tw:max-w-[40%] tw:shrink-0 tw:text-xs tw:text-muted-foreground">
            {database.connectionId === writeConnectionId
              ? t("agent.externalWriteTarget")
              : t("agent.acpReadOnlyContext")}
          </span>
        </div>
      ))}
      {sources.map((source) => (
        <div
          key={source.sourceId}
          className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2"
        >
          <Icon name="branch" className="tw:text-muted-foreground" />
          <span className="tw:grid tw:min-w-0 tw:flex-1">
            <span className="tw:truncate tw:text-sm tw:font-medium">
              {source.displayName}
            </span>
            <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
              {githubSourceRevisionLabel(source.repository, source.commitSha)}
            </span>
          </span>
        </div>
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
