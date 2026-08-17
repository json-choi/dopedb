import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { Field, TextInput } from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../design-system/components/Modal";
import { SegmentedControl } from "../../design-system/components/SegmentedControl";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
  type StatusTone,
} from "../../design-system/components/Status";
import { approveOperation } from "../operations/tauriAdapter";
import { useI18n, type I18nKey } from "../../lib/i18n";
import type {
  ProviderKind,
  ProviderProvisioningDriverStatus,
  ProviderProvisioningPlan,
  ProviderProvisioningTarget,
  ProvisioningAccessMode,
  ProvisioningAction,
  ProvisioningReadiness,
  ProvisioningState,
} from "./domain";
import {
  providerCredentialQueryKeys,
  providerProvisioningForConnectionQuery,
  providerProvisioningStatusesQuery,
} from "./queries";
import {
  cancelProviderProvisioning,
  discoverProviderProvisioningTargets,
  executeProviderProvisioning,
  getProviderProvisioningStatus,
  prepareProviderProvisioning,
  prepareProviderProvisioningDestroy,
  prepareProviderProvisioningRepair,
  reconcileProviderProvisioning,
} from "./tauriAdapter";

const actionKey: Record<ProvisioningAction, I18nKey> = {
  bindProviderRole: "managedAccess.action.bindProviderRole",
  configureDatabaseAuthentication: "managedAccess.action.configureDatabaseAuthentication",
  createDatabasePrincipal: "managedAccess.action.createDatabasePrincipal",
  createProviderIdentity: "managedAccess.action.createProviderIdentity",
  createReadRole: "managedAccess.action.createReadRole",
  createWriteRole: "managedAccess.action.createWriteRole",
  enableProviderService: "managedAccess.action.enableProviderService",
  grantExistingObjects: "managedAccess.action.grantExistingObjects",
  grantFutureObjects: "managedAccess.action.grantFutureObjects",
  reconcileDatabasePolicy: "managedAccess.action.reconcileDatabasePolicy",
  reconcileProviderPolicy: "managedAccess.action.reconcileProviderPolicy",
  removeOwnedDatabasePrincipal: "managedAccess.action.removeOwnedDatabasePrincipal",
  removeOwnedProviderIdentity: "managedAccess.action.removeOwnedProviderIdentity",
  revokeIssuedCredentials: "managedAccess.action.revokeIssuedCredentials",
  smokeTestReadCredential: "managedAccess.action.smokeTestReadCredential",
  smokeTestWriteCredential: "managedAccess.action.smokeTestWriteCredential",
  verifyDatabasePolicy: "managedAccess.action.verifyDatabasePolicy",
  verifyProviderTarget: "managedAccess.action.verifyProviderTarget",
};

const stateKey: Record<ProvisioningState, I18nKey> = {
  applying: "managedAccess.state.applying",
  destroying: "managedAccess.state.destroying",
  needsRepair: "managedAccess.state.needsRepair",
  needsSetup: "managedAccess.state.needsSetup",
  ready: "managedAccess.state.ready",
  readyToApply: "managedAccess.state.readyToApply",
  verifying: "managedAccess.state.verifying",
};

const readinessKey: Record<ProvisioningReadiness, I18nKey> = {
  loggedOut: "managedAccess.readiness.loggedOut",
  missing: "managedAccess.readiness.missing",
  outdated: "managedAccess.readiness.outdated",
  ready: "managedAccess.readiness.ready",
  wrongAccount: "managedAccess.readiness.wrongAccount",
};

function providerLabel(provider: ProviderKind) {
  if (provider === "gcpCloudSql") return "Google Cloud SQL";
  if (provider === "planetScale") return "PlanetScale";
  return "Neon";
}

function readinessTone(status: ProviderProvisioningDriverStatus): StatusTone {
  if (status.readiness === "ready") return "success";
  if (status.readiness === "wrongAccount") return "danger";
  return "warning";
}

function planTone(plan: ProviderProvisioningPlan): StatusTone {
  if (plan.state === "ready") return "success";
  if (plan.state === "needsRepair") return "danger";
  if (plan.state === "applying" || plan.state === "verifying" || plan.state === "destroying") {
    return "warning";
  }
  return "neutral";
}

export function ManagedAccessLauncher({
  connectionId,
  provider,
}: {
  connectionId: string;
  provider: ProviderKind;
}) {
  const { t } = useI18n();
  const statuses = useQuery(providerProvisioningStatusesQuery());
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const available = statuses.data?.some((status) => status.provider === provider) ?? false;

  if (!available) return null;
  return (
    <>
      <Button
        ref={triggerRef}
        onClick={() => setOpen(true)}
      >
        <Icon name="shield" />
        {t("managedAccess.launch")}
      </Button>
      {open ? (
        <ManagedAccessDialog
          connectionId={connectionId}
          initialProvider={provider}
          onClose={() => setOpen(false)}
          returnFocus={() => triggerRef.current?.focus()}
        />
      ) : null}
    </>
  );
}

export function ManagedAccessDialog({
  connectionId,
  initialProvider,
  onClose,
  returnFocus,
}: {
  connectionId: string;
  initialProvider?: ProviderKind;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const statuses = useQuery(providerProvisioningStatusesQuery());
  const existing = useQuery(providerProvisioningForConnectionQuery(connectionId));
  const [provider, setProvider] = useState<ProviderKind | null>(initialProvider ?? null);
  const [targets, setTargets] = useState<ProviderProvisioningTarget[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [access, setAccess] = useState<ProvisioningAccessMode>("read");
  const [plan, setPlan] = useState<ProviderProvisioningPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<
    | "discover"
    | "plan"
    | "approve"
    | "execute"
    | "cancel"
    | "destroy"
    | "repair"
    | "reconcile"
    | null
  >(null);
  const [failed, setFailed] = useState(false);

  const selectedStatus = useMemo(
    () => statuses.data?.find((status) => status.provider === provider) ?? null,
    [provider, statuses.data],
  );
  const selectedTarget = useMemo(
    () => targets?.find((target) => target.discoveryId === targetId) ?? null,
    [targetId, targets],
  );

  const close = () => {
    onClose();
    window.requestAnimationFrame(returnFocus);
  };

  useEffect(() => {
    if (!plan || plan.operationState !== "executing") return;
    const timer = window.setInterval(() => {
      void getProviderProvisioningStatus(plan.receiptId)
        .then(setPlan)
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [plan]);

  function selectProvider(next: ProviderKind) {
    setProvider(next);
    setTargets(null);
    setTargetId(null);
    setPlan(null);
    setConfirmation("");
    setFailed(false);
  }

  async function discover() {
    if (!provider || pending) return;
    setPending("discover");
    setFailed(false);
    try {
      const nextTargets = await discoverProviderProvisioningTargets(provider, connectionId);
      setTargets(nextTargets);
      setTargetId(nextTargets[0]?.discoveryId ?? null);
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function prepare() {
    if (!selectedTarget || pending) return;
    setPending("plan");
    setFailed(false);
    try {
      const nextPlan = await prepareProviderProvisioning(
        selectedTarget.discoveryId,
        connectionId,
        access,
      );
      setPlan(nextPlan);
      setConfirmation("");
      await queryClient.invalidateQueries({
        queryKey: providerCredentialQueryKeys.provisioning(connectionId),
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function runPlan() {
    if (!plan || pending) return;
    setFailed(false);
    let current = plan;
    try {
      if (current.operationState === "pending_approval") {
        setPending("approve");
        await approveOperation(
          current.operationId,
          current.payloadHash,
          current.confirmationPhrase ? confirmation : undefined,
        );
        current = await getProviderProvisioningStatus(current.receiptId);
        setPlan(current);
      }
      if (!current.canExecute) return;
      setPending("execute");
      current = await executeProviderProvisioning(current.receiptId);
      setPlan(current);
    } catch {
      const recovered = await getProviderProvisioningStatus(current.receiptId).catch(() => null);
      if (recovered) setPlan(recovered);
      if (recovered?.repairReason !== "userCancelled") setFailed(true);
    } finally {
      setPending(null);
      await queryClient.invalidateQueries({
        queryKey: providerCredentialQueryKeys.provisioning(connectionId),
      });
    }
  }

  async function cancel() {
    if (!plan?.canCancel || pending === "cancel") return;
    setPending("cancel");
    try {
      await cancelProviderProvisioning(plan.receiptId);
    } catch {
      setFailed(true);
    } finally {
      setPending((current) => current === "cancel" ? "execute" : current);
    }
  }

  async function prepareDestroy() {
    if (!plan?.canDestroy || pending) return;
    setPending("destroy");
    setFailed(false);
    try {
      setPlan(await prepareProviderProvisioningDestroy(plan.receiptId));
      setConfirmation("");
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function prepareRepair() {
    if (plan?.state !== "needsRepair" || pending) return;
    setPending("repair");
    setFailed(false);
    try {
      setPlan(await prepareProviderProvisioningRepair(plan.receiptId));
      setConfirmation("");
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function reconcile() {
    if (plan?.state !== "ready" || pending) return;
    setPending("reconcile");
    setFailed(false);
    try {
      setPlan(await reconcileProviderProvisioning(plan.receiptId));
      await queryClient.invalidateQueries({
        queryKey: providerCredentialQueryKeys.provisioning(connectionId),
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  const readinessMessage = selectedStatus
    ? selectedStatus.prerequisiteKind === "workspaceIntegration"
      ? t("managedAccess.integration.ready", {
          provider: providerLabel(selectedStatus.provider),
        })
      : selectedStatus.readiness === "ready"
        ? t("managedAccess.login.ready", {
            cli: selectedStatus.prerequisiteName,
            account: selectedStatus.activeIdentity ?? "—",
          })
        : t(`managedAccess.login.${selectedStatus.readiness}` as I18nKey, {
            cli: selectedStatus.prerequisiteName,
            version: selectedStatus.minimumVersion ?? "—",
          })
    : null;
  const confirmationReady = !plan?.confirmationPhrase
    || confirmation === plan.confirmationPhrase;

  return (
    <ModalBackdrop onMouseDown={pending === null ? close : undefined}>
      <ModalSurface
        size="wide"
        fill
        aria-labelledby="managed-access-title"
        aria-describedby="managed-access-description"
        aria-busy={pending !== null}
        onEscape={pending === null ? close : undefined}
      >
        <ModalTitleBar
          title={t("managedAccess.title")}
          titleId="managed-access-title"
          closeLabel={t("managedAccess.close")}
          onClose={close}
        />
        <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-[220px_minmax(0,1fr)] tw:@max-[700px]:grid-cols-1">
          <aside className="tw:min-h-0 tw:overflow-y-auto tw:border-r tw:border-border-subtle tw:bg-card tw:p-2 tw:@max-[700px]:max-h-44 tw:@max-[700px]:border-r-0 tw:@max-[700px]:border-b">
            <p className="tw:m-0 tw:px-2 tw:py-1 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-muted-foreground tw:uppercase">
              {t("managedAccess.provider")}
            </p>
            <div className="tw:grid tw:gap-0.5" role="listbox" aria-label={t("managedAccess.provider")}>
              {statuses.data?.map((status) => (
                <button
                  key={status.provider}
                  type="button"
                  role="option"
                  aria-selected={provider === status.provider}
                  data-selected={provider === status.provider || undefined}
                  className="tw:grid tw:min-w-0 tw:cursor-pointer tw:grid-cols-[20px_minmax(0,1fr)] tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:py-2 tw:text-left tw:text-ui tw:text-foreground tw:data-[selected]:bg-selection tw:data-[selected]:text-selection-foreground tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30"
                  onClick={() => selectProvider(status.provider)}
                >
                  <Icon name="key" />
                  <span className="tw:min-w-0 tw:truncate">{providerLabel(status.provider)}</span>
                </button>
              ))}
            </div>
            {existing.data?.some((entry) => entry.state !== "needsSetup") ? (
              <div className="tw:mt-3 tw:border-t tw:border-border-subtle tw:pt-2">
                <p className="tw:m-0 tw:px-2 tw:py-1 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-muted-foreground tw:uppercase">
                  {t("managedAccess.existing")}
                </p>
                {existing.data.filter((entry) => entry.state !== "needsSetup").map((entry) => (
                  <button
                    key={entry.receiptId}
                    type="button"
                    data-selected={plan?.receiptId === entry.receiptId || undefined}
                    className="tw:flex tw:w-full tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:py-2 tw:text-left tw:text-ui tw:data-[selected]:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30"
                    onClick={() => setPlan(entry)}
                  >
                    <span className="tw:min-w-0 tw:flex-1 tw:truncate">{entry.targetDisplayName}</span>
                    <StatusBadge tone={planTone(entry)} density="compact">
                      {t(stateKey[entry.state])}
                    </StatusBadge>
                  </button>
                ))}
              </div>
            ) : null}
          </aside>

          <main className="tw:min-h-0 tw:overflow-y-auto tw:bg-background">
            <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[760px] tw:gap-5 tw:p-5 tw:@max-[560px]:p-4">
              <div>
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("managedAccess.title")}</h2>
                <p id="managed-access-description" className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("managedAccess.description")}
                </p>
              </div>

              {failed || statuses.isError || existing.isError ? (
                <InlineNotice tone="danger" icon="info" role="alert">
                  {t("managedAccess.actionError")}
                </InlineNotice>
              ) : null}

              {!statuses.isLoading && statuses.data?.length === 0 ? (
                <p className="tw:m-0 tw:border-y tw:border-border-subtle tw:py-4 tw:text-sm tw:text-muted-foreground">
                  {t("managedAccess.noProviders")}
                </p>
              ) : null}

              {selectedStatus && !plan ? (
                <section className="tw:grid tw:gap-3" aria-labelledby="managed-access-login">
                  <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:pb-2">
                    <h3 id="managed-access-login" className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-sm tw:font-semibold">
                      {providerLabel(selectedStatus.provider)} · {selectedStatus.prerequisiteName}
                    </h3>
                    <StatusBadge tone={readinessTone(selectedStatus)}>
                      {t(readinessKey[selectedStatus.readiness])}
                    </StatusBadge>
                  </div>
                  <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">{readinessMessage}</p>
                  {selectedStatus.readiness !== "ready" ? (
                    <div>
                      <Button
                        size="compact"
                        onClick={() => void statuses.refetch()}
                        disabled={statuses.isFetching}
                      >
                        <Icon name="refresh" />
                        {t("managedAccess.refresh")}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selectedStatus?.readiness === "ready" && !plan ? (
                <section className="tw:grid tw:gap-3" aria-labelledby="managed-access-target">
                  <h3 id="managed-access-target" className="tw:m-0 tw:text-sm tw:font-semibold">
                    {t("managedAccess.target")}
                  </h3>
                  {targets === null ? (
                    <div>
                      <Button size="compact" onClick={() => void discover()} disabled={pending !== null}>
                        <Icon name="search" />
                        {pending === "discover" ? t("managedAccess.discovering") : t("managedAccess.discover")}
                      </Button>
                    </div>
                  ) : targets.length === 0 ? (
                    <p className="tw:m-0 tw:border-y tw:border-border-subtle tw:py-4 tw:text-sm tw:text-muted-foreground">
                      {t("managedAccess.emptyTargets")}
                    </p>
                  ) : (
                    <div className="tw:grid tw:gap-1" role="radiogroup" aria-label={t("managedAccess.target")}>
                      {targets.map((target) => (
                        <button
                          key={target.discoveryId}
                          type="button"
                          role="radio"
                          aria-checked={targetId === target.discoveryId}
                          data-selected={targetId === target.discoveryId || undefined}
                          className="tw:grid tw:min-w-0 tw:cursor-pointer tw:grid-cols-[20px_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:rounded-sm tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2 tw:text-left tw:data-[selected]:border-ring tw:data-[selected]:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30"
                          onClick={() => setTargetId(target.discoveryId)}
                        >
                          <Icon name="database" />
                          <span className="tw:grid tw:min-w-0 tw:gap-0.5">
                            <strong className="tw:truncate tw:text-sm">{target.displayName}</strong>
                            <span className="tw:truncate tw:text-xs tw:text-muted-foreground">{target.detail}</span>
                          </span>
                          {target.production ? <StatusBadge tone="warning">PROD</StatusBadge> : null}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedTarget ? (
                    <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
                      <span className="tw:text-sm tw:font-medium tw:text-muted-foreground">
                        {t("managedAccess.access")}
                      </span>
                      <SegmentedControl
                        value={access}
                        label={t("managedAccess.access")}
                        options={[
                          { value: "read", label: t("managedAccess.accessRead") },
                          { value: "write", label: t("managedAccess.accessWrite") },
                        ]}
                        onChange={setAccess}
                        disabled={pending !== null}
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {plan ? (
                <section className="tw:grid tw:gap-4" aria-labelledby="managed-access-plan">
                  <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:border-b tw:border-border-subtle tw:pb-3">
                    <Icon name="shield" className="tw:mt-0.5 tw:text-info" />
                    <div className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-0.5">
                      <h3 id="managed-access-plan" className="tw:m-0 tw:truncate tw:text-sm tw:font-semibold">
                        {plan.targetDisplayName}
                      </h3>
                      <span className="tw:truncate tw:text-xs tw:text-muted-foreground">{plan.targetDetail}</span>
                    </div>
                    <StatusBadge tone={planTone(plan)}>{t(stateKey[plan.state])}</StatusBadge>
                  </div>
                  {plan.production ? (
                    <InlineNotice tone="warning" icon="info" role="status">
                      {t("managedAccess.productionWarning")}
                    </InlineNotice>
                  ) : null}
                  <ol className="tw:m-0 tw:grid tw:list-decimal tw:gap-2 tw:pl-6 tw:text-sm">
                    {plan.actions.map((action, index) => (
                      <li key={`${action}-${index}`} className="tw:pl-1 tw:text-foreground">
                        {t(actionKey[action])}
                      </li>
                    ))}
                  </ol>
                  {plan.operationState === "executing" || pending === "execute" ? (
                    <div className="tw:grid tw:gap-2" aria-live="polite">
                      <LoadingLabel>
                        {t("managedAccess.progress", {
                          phase: t(stateKey[plan.state]),
                          completed: plan.completedSteps,
                          total: plan.totalSteps,
                        })}
                      </LoadingLabel>
                      <progress
                        className="tw:h-1.5 tw:w-full tw:accent-info"
                        value={plan.completedSteps}
                        max={Math.max(plan.totalSteps, 1)}
                      />
                    </div>
                  ) : null}
                  {plan.confirmationPhrase && plan.operationState === "pending_approval" ? (
                    <Field label={t("managedAccess.confirmation", { phrase: plan.confirmationPhrase })}>
                      <TextInput
                        density="compact"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.currentTarget.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={pending !== null}
                      />
                    </Field>
                  ) : null}
                  {plan.canDestroy ? (
                    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
                      {plan.state === "ready" ? (
                        <Button
                          size="compact"
                          onClick={() => void reconcile()}
                          disabled={pending !== null}
                        >
                          <Icon name="refresh" />
                          {t("managedAccess.verify")}
                        </Button>
                      ) : null}
                      {plan.state === "needsRepair" ? (
                        <Button
                          size="compact"
                          onClick={() => void prepareRepair()}
                          disabled={pending !== null}
                        >
                          <Icon name="refresh" />
                          {t("managedAccess.repair")}
                        </Button>
                      ) : null}
                      <Button
                        size="compact"
                        variant="dangerGhost"
                        onClick={() => void prepareDestroy()}
                        disabled={pending !== null}
                      >
                        <Icon name="trash" />
                        {t("managedAccess.remove")}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </main>
        </div>
        <ModalFooter>
          {plan && plan.state !== "ready" && plan.state !== "needsSetup" ? (
            <Button
              size="compact"
              onClick={() => {
                setPlan(null);
                setConfirmation("");
              }}
              disabled={pending !== null}
            >
              {t("managedAccess.back")}
            </Button>
          ) : null}
          {plan?.canCancel ? (
            <Button
              size="compact"
              variant="dangerGhost"
              onClick={() => void cancel()}
              disabled={pending === "cancel"}
            >
              <Icon name="stop" />
              {t("managedAccess.cancelOperation")}
            </Button>
          ) : null}
          <Button size="compact" onClick={close} disabled={pending === "approve" || pending === "plan"}>
            {t("managedAccess.close")}
          </Button>
          {!plan && selectedTarget ? (
            <Button
              size="compact"
              variant="primary"
              onClick={() => void prepare()}
              disabled={pending !== null}
            >
              {pending === "plan" ? t("managedAccess.preparing") : t("managedAccess.plan")}
            </Button>
          ) : plan && (plan.operationState === "pending_approval" || plan.canExecute) ? (
            <Button
              size="compact"
              variant="primary"
              onClick={() => void runPlan()}
              disabled={pending !== null || !confirmationReady}
            >
              <Icon name="play" />
              {plan.operationState === "pending_approval"
                ? t("managedAccess.approveApply")
                : t("managedAccess.apply")}
            </Button>
          ) : null}
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
