// Composes external Agent request modals from inventory, review, and response boundaries.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import { InlineNotice, LoadingLabel } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { ConnectionProfile } from "../connections/domain";
import AcpSqlApproval from "./AcpSqlApproval";
import type { ExternalAgentConfig, ExternalAgentRequestSummary } from "./externalAgentDomain";
import { ExternalAgentConfigurationPicker } from "./ExternalAgentConfigurationPicker";
import {
  ExternalAgentRequestIdentity,
  ExternalAgentStartReview,
  StartApprovalButton,
} from "./ExternalAgentRequestReview";
import { agentSqlProposalReviewQuery } from "./queryOptions";
import {
  isFinalOperationState,
  type AgentSqlProposalReference,
} from "./sqlProposal";
import { useAgentEnvironmentInventory } from "./useAgentEnvironmentInventory";

/**
 * An approved external Agent process has no Desktop transcript, so its SQL
 * proposal is decided here with the same one-click approval card. Closing the
 * entry is possible only once the operation can no longer change.
 */
export function ExternalAgentProposalDialog({
  request,
  proposal,
  error,
  submitting,
  onClose,
}: {
  request: ExternalAgentRequestSummary;
  proposal: AgentSqlProposalReference;
  error: string | null;
  submitting: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const review = useQuery(agentSqlProposalReviewQuery(proposal));
  const closable =
    review.isError || (review.data ? isFinalOperationState(review.data.state) : false);
  return (
    <ModalBackdrop>
      <ModalSurface
        aria-labelledby="external-agent-proposal-title"
        dismissible={closable && !submitting}
        onRequestClose={onClose}
      >
        <ModalHeader
          title={t("agent.externalProposalTitle")}
          titleId="external-agent-proposal-title"
        />
        <div className="tw:grid tw:gap-4 tw:p-5">
          <AcpSqlApproval
            proposal={proposal}
            expectedConnectionId={proposal.connectionId}
          />
          <ExternalAgentRequestIdentity request={request} />
          {error ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {error}
            </InlineNotice>
          ) : null}
        </div>
        <ModalFooter>
          {/* Initial focus stays on this neutral action: keystrokes typed in the
              requesting terminal must never land on an approval control. */}
          <Button
            disabled={!closable || submitting}
            disabledBehavior="focusable"
            data-modal-initial-focus
            title={closable ? undefined : t("agent.externalProposalDecideFirst")}
            onClick={onClose}
          >
            {t("common.close")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}

export function ExternalAgentUnavailableDialog({
  request,
  error,
  submitting,
  onReject,
}: {
  request: ExternalAgentRequestSummary;
  error: string | null;
  submitting: boolean;
  onReject: () => void;
}) {
  const { t } = useI18n();
  return (
    <ModalBackdrop>
      <ModalSurface
        aria-labelledby="external-agent-unavailable-title"
        dismissible={!submitting}
        onRequestClose={onReject}
      >
        <ModalHeader
          title={t("agent.externalRequestTitle")}
          titleId="external-agent-unavailable-title"
        />
        <div className="tw:grid tw:gap-3 tw:p-5">
          <InlineNotice tone="danger" icon="alert" role="alert">
            {error ?? t("agent.externalNoConnection")}
          </InlineNotice>
          <ExternalAgentRequestIdentity request={request} />
        </div>
        <ModalFooter>
          <Button disabled={submitting} onClick={onReject}>
            {t("agent.externalReject")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}

export function ExternalAgentRequestDialog({
  request,
  anchor,
  connections,
  catalogScopeKey,
  error,
  submitting,
  onApprove,
  onReject,
}: {
  request: ExternalAgentRequestSummary;
  anchor: ConnectionProfile;
  connections: ConnectionProfile[];
  catalogScopeKey: string;
  error: string | null;
  submitting: boolean;
  onApprove: (config: ExternalAgentConfig | null) => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const inventory = useAgentEnvironmentInventory({
    catalogScopeKey,
    connection: anchor,
    connections,
    // The configuration picker shows the sentence only; it has no copy action.
    onError: (error) =>
      setInventoryError(error === null || typeof error === "string" ? error : error.message),
  });

  return (
    <ModalBackdrop>
      <ModalSurface
        size="wide"
        fill
        aria-labelledby="external-agent-request-title"
        dismissible={!submitting}
        onRequestClose={onReject}
      >
        <ModalHeader
          title={
            request.kind === "configure"
              ? t("agent.externalConfigureTitle")
              : t("agent.externalStartTitle")
          }
          titleId="external-agent-request-title"
        />
        <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)] tw:overflow-hidden tw:max-[760px]:grid-cols-1">
          <div className="tw:min-h-0 tw:overflow-auto tw:p-5">
            {inventory.pending ? (
              <LoadingLabel>{t("agent.externalLoadingResources")}</LoadingLabel>
            ) : request.kind === "configure" ? (
              <ExternalAgentConfigurationPicker
                request={request}
                projects={inventory.projects}
                disabled={submitting || inventory.updatingEnvironmentId !== null}
                ensureAvailable={inventory.ensureAvailable}
                onApprove={onApprove}
              />
            ) : (
              <ExternalAgentStartReview
                request={request}
                projects={inventory.projects}
              />
            )}
          </div>
          <aside className="tw:grid tw:content-start tw:gap-4 tw:border-l tw:border-border-subtle tw:bg-muted tw:p-5 tw:max-[760px]:border-t tw:max-[760px]:border-l-0">
            <ExternalAgentRequestIdentity request={request} />
            <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t("agent.externalSecurityBody")}
            </p>
          </aside>
        </div>
        {error || inventoryError || inventory.loadError ? (
          <div className="tw:px-5 tw:pb-3">
            <InlineNotice tone="danger" icon="alert" role="alert">
              {error ?? inventoryError ?? inventory.loadError}
            </InlineNotice>
          </div>
        ) : null}
        <ModalFooter>
          {/* Initial focus stays on Reject, never on an approval control. */}
          <Button disabled={submitting} data-modal-initial-focus onClick={onReject}>
            {t("agent.externalReject")}
          </Button>
          {request.kind === "start" ? (
            <StartApprovalButton
              request={request}
              projects={inventory.projects}
              disabled={submitting || inventory.pending || Boolean(inventory.loadError)}
              ensureAvailable={inventory.ensureAvailable}
              onApprove={() => onApprove(null)}
            />
          ) : null}
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
