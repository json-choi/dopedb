// Device-local provider binding wizard. The reducer owns the ephemeral secret and
// one-use receipt; query caches receive summaries only.
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type RefObject,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import { Button } from "../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import {
  StatusBadge,
  type StatusTone,
} from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import {
  providerCredentialBindingsQuery,
  providerCredentialQueryKeys,
  providerIntegrationsQuery,
} from "./queries";
import {
  initialProviderCredentialDialogState,
  providerCredentialDialogReducer,
} from "./state";
import {
  beginProviderCredentialBinding,
  revokeProviderCredentialBinding,
  verifyProviderCredentialBinding,
} from "./tauriAdapter";
import type {
  ProviderCredentialDialogStatus,
  ProviderIntegrationSummary,
  ProviderKind,
} from "./domain";

const statusKey: Record<ProviderCredentialDialogStatus, "providerCredentials.accessDenied" | "providerCredentials.credentialsRequired" | "providerCredentials.deletionPending" | "providerCredentials.ready" | "providerCredentials.revoked" | "providerCredentials.scopeInsufficient" | "providerCredentials.unavailable" | "providerCredentials.unsupported"> = {
  accessDenied: "providerCredentials.accessDenied",
  credentialsRequired: "providerCredentials.credentialsRequired",
  deletionPending: "providerCredentials.deletionPending",
  ready: "providerCredentials.ready",
  revoked: "providerCredentials.revoked",
  scopeInsufficient: "providerCredentials.scopeInsufficient",
  unavailable: "providerCredentials.unavailable",
  unsupported: "providerCredentials.unsupported",
};

function statusTone(status: ProviderCredentialDialogStatus): StatusTone {
  if (status === "ready") return "success";
  if (
    status === "scopeInsufficient" ||
    status === "unavailable" ||
    status === "deletionPending"
  ) {
    return "warning";
  }
  if (status === "credentialsRequired") return "neutral";
  return "danger";
}

function ProviderStatusBadge({
  status,
  children,
}: {
  status: ProviderCredentialDialogStatus;
  children: string;
}) {
  return (
    <StatusBadge tone={statusTone(status)}>
      {children}
    </StatusBadge>
  );
}

function supportsMemberLocal(integration: ProviderIntegrationSummary) {
  return integration.provider === "gcpCloudSql" && integration.credentialMethod === "adcWif";
}

export function ProviderCredentialDialog({
  initialProvider,
  onClose,
  returnFocusRef,
}: {
  initialProvider?: ProviderKind;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const integrations = useQuery(providerIntegrationsQuery());
  const bindings = useQuery(providerCredentialBindingsQuery());
  const [state, dispatch] = useReducer(
    providerCredentialDialogReducer,
    initialProviderCredentialDialogState,
  );
  const [pending, setPending] = useState<"begin" | "verify" | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const memberLocalIntegrations = useMemo(
    () => integrations.data?.filter(supportsMemberLocal) ?? [],
    [integrations.data],
  );
  const memberLocalBindings = useMemo(
    () => bindings.data?.filter((binding) => binding.provider === "gcpCloudSql") ?? [],
    [bindings.data],
  );

  const selectedIntegration = useMemo(
    () => memberLocalIntegrations.find((item) => item.id === state.selectedIntegrationId) ?? null,
    [memberLocalIntegrations, state.selectedIntegrationId],
  );

  useEffect(() => {
    if (!initialProvider || state.selectedIntegrationId) return;
    const matchingIntegration = memberLocalIntegrations.find(
      (integration) => integration.provider === initialProvider,
    );
    if (matchingIntegration) {
      dispatch({
        type: "select",
        integrationId: matchingIntegration.id,
      });
    }
  }, [initialProvider, memberLocalIntegrations, state.selectedIntegrationId]);

  const close = useCallback(() => {
    if (pending !== null || revoking !== null) return;
    dispatch({ type: "discard" });
    onClose();
  }, [onClose, pending, revoking]);

  useEffect(() => {
    return () => dispatch({ type: "discard" });
  }, []);

  async function verify(receipt: NonNullable<typeof state.receipt>) {
    setPending("verify");
    setActionFailed(false);
    try {
      const verified = await verifyProviderCredentialBinding({
        receiptId: receipt.receiptId,
      });
      dispatch({ type: "verified", status: verified.state });
      await queryClient.invalidateQueries({
        queryKey: providerCredentialQueryKeys.bindings(),
      });
      await queryClient.invalidateQueries({
        queryKey: providerCredentialQueryKeys.integrations(),
      });
    } catch {
      // Provider errors are deliberately not displayed: upstream descriptions can
      // include a credential, endpoint, or private provider resource name.
      dispatch({ type: "status", status: "unavailable" });
      setActionFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function begin() {
    if (!selectedIntegration || pending) return;
    setActionFailed(false);
    if (!supportsMemberLocal(selectedIntegration)) {
      dispatch({ type: "status", status: "unsupported" });
      return;
    }
    const credential = { type: "gcpAdc" as const };
    dispatch({ type: "submit" });
    setPending("begin");
    try {
      const receipt = await beginProviderCredentialBinding({
        integrationId: selectedIntegration.id,
        credential,
      });
      dispatch({ type: "receipt", receipt });
      await verify(receipt);
    } catch {
      dispatch({ type: "status", status: "unavailable" });
      setActionFailed(true);
      setPending(null);
    }
  }

  async function revoke(id: NonNullable<typeof bindings.data>[number]["id"]) {
    if (revoking) return;
    setRevoking(id);
    setActionFailed(false);
    try {
      await revokeProviderCredentialBinding(id);
      await queryClient.invalidateQueries({ queryKey: providerCredentialQueryKeys.bindings() });
    } catch {
      // Provider details can contain credential or resource identifiers, so this
      // local recovery state intentionally remains generic.
      setActionFailed(true);
    } finally {
      setRevoking(null);
    }
  }

  const loadFailed = integrations.isError || bindings.isError;
  // Only an empty first read gets a skeleton. Refetches retain their prior rows so
  // action controls never jump while the member-local inventory revalidates.
  const loading = !loadFailed && (integrations.data === undefined || bindings.data === undefined);
  const visibleStatus = state.status ?? selectedIntegration?.state ?? null;

  return (
    <ModalBackdrop
      onMouseDown={
        pending === null && revoking === null ? close : undefined
      }
    >
      <ModalSurface
        aria-labelledby="provider-credential-title"
        aria-describedby="provider-credential-boundary"
        aria-busy={loading || pending !== null || revoking !== null}
        onRequestClose={close}
        dismissible={pending === null && revoking === null}
        returnFocusRef={returnFocusRef}
      >
        <ModalHeader
          title={t("providerCredentials.title")}
          titleId="provider-credential-title"
        />
        <div className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-auto tw:bg-background tw:p-4">
          <div className="tw:border-b tw:border-border-subtle tw:pb-3">
            <strong className="tw:text-sm">
              {t("providerCredentials.memberLocal")}
            </strong>
            <p
              id="provider-credential-boundary"
              className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground"
            >
              {t("providerCredentials.localBoundary")}
            </p>
          </div>

          {loading ? (
            <div className="tw:mt-4" aria-label={t("common.loading")}>
              <Skeleton lines={3} />
            </div>
          ) : null}
          {loadFailed ? (
            <div className="tw:mt-4 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border-l-2 tw:border-danger tw:bg-danger-muted tw:p-2">
              <p
                className="tw:m-0 tw:text-sm tw:text-danger"
                role="alert"
              >
                {t("providerCredentials.error")}
              </p>
              <Button
                size="compact"
                onClick={() =>
                  void Promise.all([
                    integrations.refetch(),
                    bindings.refetch(),
                  ])
                }
              >
                {t("app.retry")}
              </Button>
            </div>
          ) : null}
          {actionFailed ? (
            <p
              className="tw:mt-4 tw:mb-0 tw:border-l-2 tw:border-danger tw:bg-danger-muted tw:p-2 tw:text-sm tw:text-danger"
              role="alert"
            >
              {t("providerCredentials.actionError")}
            </p>
          ) : null}
          {!loading && !loadFailed && memberLocalIntegrations.length === 0 ? (
            <p className="tw:mt-4 tw:mb-0 tw:text-sm tw:text-muted-foreground">
              {t("providerCredentials.empty")}
            </p>
          ) : null}
          {!loading && !loadFailed && memberLocalIntegrations.length > 0 ? (
            <>
              <div
                className="tw:mt-4 tw:border-t tw:border-border-subtle"
                aria-label={t("providerCredentials.select")}
              >
                <p className="tw:m-0 tw:px-0 tw:py-2 tw:text-2xs tw:font-bold tw:tracking-[0.05em] tw:text-muted-foreground tw:uppercase">
                  {t("providerCredentials.select")}
                </p>
                {memberLocalIntegrations.map((integration) => {
                  const selected = integration.id === state.selectedIntegrationId;
                  return (
                    <button
                      type="button"
                      key={integration.id}
                      className="tw:flex tw:min-h-control-xl tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-3 tw:border-0 tw:border-t tw:border-border-subtle tw:bg-transparent tw:p-2 tw:font-sans tw:text-left tw:text-foreground tw:aria-pressed:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                      onClick={() => {
                        setActionFailed(false);
                        dispatch({ type: "select", integrationId: integration.id });
                      }}
                      aria-pressed={selected}
                    >
                      <span className="tw:grid tw:min-w-0 tw:gap-[var(--ds-segment-gap)]">
                        <strong className="tw:text-sm">
                          {integration.displayName}
                        </strong>
                        <small className="tw:text-2xs tw:text-muted-foreground">
                          {integration.provider}
                        </small>
                      </span>
                      <ProviderStatusBadge status={integration.state}>
                        {t(statusKey[integration.state])}
                      </ProviderStatusBadge>
                    </button>
                  );
                })}
              </div>

              {selectedIntegration ? (
                <div className="tw:mt-4 tw:grid tw:gap-3">
                  <div className="tw:flex tw:items-center tw:gap-2 tw:border-l-2 tw:border-border-strong tw:px-2 tw:py-1">
                    <Icon name="info" className="tw:text-muted-foreground" />
                    <span className="tw:grid tw:min-w-0 tw:gap-[var(--ds-segment-gap)]">
                      <strong className="tw:text-sm">
                        {t("providerCredentials.memberLocal")}
                      </strong>
                      <small className="tw:text-2xs tw:text-muted-foreground">
                        {t("providerCredentials.managed")}
                      </small>
                    </span>
                  </div>
                  {selectedIntegration.provider === "gcpCloudSql" ? (
                    <p className="tw:m-0 tw:border-l-2 tw:border-border-strong tw:px-2 tw:py-1 tw:text-sm tw:text-muted-foreground">
                      {t("providerCredentials.gcpHint")}
                    </p>
                  ) : null}
                  {visibleStatus ? (
                    <p
                      data-tone={statusTone(visibleStatus)}
                      className="tw:m-0 tw:border-l-2 tw:border-border-strong tw:px-2 tw:py-1 tw:text-sm tw:data-[tone=danger]:border-danger tw:data-[tone=danger]:text-danger tw:data-[tone=success]:border-success tw:data-[tone=success]:text-success tw:data-[tone=warning]:border-warning tw:data-[tone=warning]:text-warning"
                      role={visibleStatus === "ready" ? "status" : "alert"}
                    >
                      {t("providerCredentials.status", { status: t(statusKey[visibleStatus]) })}
                    </p>
                  ) : null}
                  {state.phase === "complete" && state.status === "ready" ? (
                    <p className="tw:m-0 tw:border-l-2 tw:border-success tw:px-2 tw:py-1 tw:text-sm tw:text-success">
                      {t("providerCredentials.success")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="tw:mt-4 tw:border-t tw:border-border-subtle">
                <p className="tw:m-0 tw:px-0 tw:py-2 tw:text-2xs tw:font-bold tw:tracking-[0.05em] tw:text-muted-foreground tw:uppercase">
                  {t("providerCredentials.memberLocal")}
                </p>
                {memberLocalBindings.length ? memberLocalBindings.map((binding) => (
                  <div
                    className="tw:flex tw:min-h-control-xl tw:w-full tw:items-center tw:justify-between tw:gap-3 tw:border-t tw:border-border-subtle tw:bg-transparent tw:p-2"
                    key={binding.id}
                  >
                    <span className="tw:grid tw:min-w-0 tw:gap-[var(--ds-segment-gap)]">
                      <strong className="tw:text-sm">{binding.provider}</strong>
                      <small className="tw:text-2xs tw:text-muted-foreground">
                        {t(statusKey[binding.state])}
                      </small>
                    </span>
                    <Button
                      size="compact"
                      variant="ghost"
                      disabled={revoking !== null}
                      onClick={() => void revoke(binding.id)}
                    >
                      {revoking === binding.id ? t("providerCredentials.revokePending") : t("providerCredentials.revoke")}
                    </Button>
                  </div>
                )) : (
                  <p className="tw:m-0 tw:py-2 tw:text-sm tw:text-muted-foreground">
                    {t("providerCredentials.noBindings")}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
        <ModalFooter>
          <Button
            size="compact"
            disabled={pending !== null || revoking !== null}
            onClick={close}
          >
            {t("common.close")}
          </Button>
          {selectedIntegration ? (
            <Button
              size="compact"
              variant="primary"
              disabled={!supportsMemberLocal(selectedIntegration) || pending !== null}
              onClick={() => void begin()}
            >
              {pending === "verify"
                ? t("providerCredentials.verifying")
                : t("providerCredentials.verify")}
            </Button>
          ) : null}
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
