// Controller of the inline add-database flow: step navigation, the import name and
// production approval, the one-use provider receipt and the idempotent import. It
// composes resource discovery and Neon preparation, owns the single in-flight
// mutation and the flow's error, and reports busy state to the hosting view.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../../../lib/i18n";
import { useEventCallback } from "../../../../lib/useEventCallback";
import type { WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { runWorkspaceAdmin } from "../../requests";
import {
  providerImportDisplayName,
  type Integration,
  type Provider,
} from "../domain";
import {
  importNameIssue,
  isFutureInstant,
  newIdempotencyKey,
  parseClaimReceipt,
  parseImportedConnection,
  type WizardError,
} from "./model";
import { PROVIDER_RESOURCES_AREA } from "./queries";
import {
  describeFailure,
  importFailure,
  isStaleSelection,
} from "./serverMessages";
import { useNeonBootstrap } from "./useNeonBootstrap";
import { useResourceDiscovery } from "./useResourceDiscovery";

export type WizardStep = 1 | 2 | 3;
export type WizardMutation = "claim" | "import" | "neonPreflight" | "neonApply";

export type ImportedDatabase = Readonly<{ id: string | null; name: string }>;

type ClaimedReceipt = Readonly<{
  integrationId: string;
  value: string;
  receipt: string;
  receiptExpiresAt: string;
}>;

type PendingImport = Readonly<{
  integrationId: string;
  receipt: string;
  name: string;
  productionApproved: boolean;
  idempotencyKey: string;
}>;

export function useManagedDatabaseImport({
  scope,
  providers,
  integrations,
  onImported,
  onAlreadyShared,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  providers: readonly Provider[];
  integrations: readonly Integration[];
  onImported: (database: ImportedDatabase) => void;
  /** The control plane reports the resource is already shared; the list is stale. */
  onAlreadyShared: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [productionApproved, setProductionApproved] = useState(false);
  const [claim, setClaim] = useState<ClaimedReceipt | null>(null);
  const [mutation, setMutation] = useState<WizardMutation | null>(null);
  const [error, setError] = useState<WizardError | null>(null);
  const inFlight = useRef(false);
  const pendingImport = useRef<PendingImport | null>(null);
  const discovery = useResourceDiscovery({ scope, providers, integrations, browsing: step >= 2 });

  async function run(kind: WizardMutation, task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setMutation(kind);
    setError(null);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setMutation(null);
    }
  }

  const neon = useNeonBootstrap({ scope, discovery, run, fail: setError });

  const reportBusy = useEventCallback(onBusyChange);
  useEffect(() => {
    reportBusy(mutation !== null);
  }, [mutation, reportBusy]);

  // Discovered lists carry short-lived proofs; never keep them past this flow.
  const { accountId, workspaceId } = scope;
  useEffect(() => () => {
    reportBusy(false);
    queryClient.removeQueries({
      queryKey: workspaceAdminQueryKey({ accountId, workspaceId }, PROVIDER_RESOURCES_AREA),
    });
  }, [accountId, queryClient, reportBusy, workspaceId]);

  const { provider, leaf, isNeon } = discovery;
  const isProduction = isNeon
    ? neon.report?.production === true || neon.environment === "production"
    : leaf?.production === true;
  const defaultName = provider && leaf ? providerImportDisplayName(provider.name, leaf.name) : "";
  const name = nameDraft ?? defaultName;
  const nameIssue = importNameIssue(name);
  const busy = mutation !== null;
  const canContinue = step === 1
    ? discovery.integrationReady && discovery.levels !== null
    : discovery.complete;
  const canCreate = step === 3
    && discovery.complete
    && nameIssue === null
    && (!isProduction || productionApproved)
    && (!isNeon || neon.verified);

  /** Anything derived from the previous target (receipt, plan, name) is dropped. */
  function resetDownstream() {
    setClaim(null);
    pendingImport.current = null;
    neon.reset();
    setNameDraft(null);
    setProductionApproved(false);
    setError(null);
  }

  function chooseIntegration(id: string) {
    if (busy) return;
    discovery.chooseIntegration(id);
    resetDownstream();
  }

  function chooseResource(index: number, value: string) {
    if (busy) return;
    discovery.choose(index, value);
    resetDownstream();
  }

  function next() {
    if (busy || !canContinue || step === 3) return;
    setError(null);
    setStep(step === 1 ? 2 : 3);
  }

  function back() {
    if (busy || step === 1) return;
    setError(null);
    setStep(step === 3 ? 2 : 1);
  }

  async function claimReceipt(integrationId: string): Promise<string | null> {
    const resource = await discovery.freshLeaf();
    if (!resource?.selectionProof) {
      setError({ message: t("workspaceProviderDatabases.selectionUnavailable"), reconnect: false });
      return null;
    }
    let body: unknown;
    try {
      body = await runWorkspaceAdmin(scope.accountId, {
        kind: "claimProviderResource",
        workspaceId: scope.workspaceId,
        integrationId,
        selectionProof: resource.selectionProof,
      });
    } catch (caught) {
      if (isStaleSelection(caught)) {
        discovery.reloadLeaf();
        setError({ message: t("workspaceProviderDatabases.selectionExpired"), reconnect: false });
      } else {
        setError(describeFailure(caught, i18n, "workspaceProviderDatabases.receiptError"));
      }
      return null;
    }
    const parsed = parseClaimReceipt(body);
    if (!parsed) {
      setError({ message: t("workspaceProviderDatabases.receiptShapeError"), reconnect: false });
      return null;
    }
    setClaim({ integrationId, value: resource.value, ...parsed });
    return parsed.receipt;
  }

  function create() {
    if (!canCreate || !discovery.integration || !leaf) return Promise.resolve();
    const integrationId = discovery.integration.id;
    const finalName = name.trim();
    return run("import", async () => {
      let receipt: string | null;
      if (isNeon) {
        if (!neon.verified) {
          neon.expire();
          setError({ message: t("workspaceProviderDatabases.neonVerificationExpired"), reconnect: false });
          return;
        }
        receipt = neon.bootstrap.receipt;
      } else {
        receipt = claim
          && claim.integrationId === integrationId
          && claim.value === leaf.value
          && isFutureInstant(claim.receiptExpiresAt)
          ? claim.receipt
          : null;
        if (!receipt) {
          setMutation("claim");
          receipt = await claimReceipt(integrationId);
          if (!receipt) return;
          setMutation("import");
        }
      }
      // A retry of the same receipt, name and approval keeps its idempotency key.
      let pending = pendingImport.current;
      if (
        !pending
        || pending.integrationId !== integrationId
        || pending.receipt !== receipt
        || pending.name !== finalName
        || pending.productionApproved !== isProduction
      ) {
        pending = {
          integrationId,
          receipt,
          name: finalName,
          productionApproved: isProduction,
          idempotencyKey: newIdempotencyKey(),
        };
        pendingImport.current = pending;
      }
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "importProviderResource",
          workspaceId: scope.workspaceId,
          integrationId: pending.integrationId,
          receipt: pending.receipt,
          idempotencyKey: pending.idempotencyKey,
          name: pending.name,
          productionApproved: pending.productionApproved,
        });
      } catch (caught) {
        const failure = importFailure(caught);
        if (failure) pendingImport.current = null;
        if (failure === "alreadyImported") {
          setError({ message: t("workspaceProviderDatabases.alreadyImported"), reconnect: false });
          onAlreadyShared();
        } else if (failure === "receiptRejected") {
          setClaim(null);
          if (isNeon) neon.expire();
          setError({
            message: t(isNeon
              ? "workspaceProviderDatabases.neonVerificationExpired"
              : "workspaceProviderDatabases.receiptRejected"),
            reconnect: false,
          });
        } else if (failure === "idempotencyConflict") {
          setError({ message: t("workspaceProviderDatabases.idempotencyConflict"), reconnect: false });
        } else {
          setError(describeFailure(caught, i18n, "workspaceProviderDatabases.importError"));
        }
        return;
      }
      pendingImport.current = null;
      const connection = parseImportedConnection(body);
      onImported({ id: connection?.id ?? null, name: connection?.name ?? finalName });
    });
  }

  return {
    step,
    discovery,
    neon,
    mutation,
    busy,
    error,
    name,
    nameIssue,
    isProduction,
    productionApproved,
    canContinue,
    canCreate,
    setName: setNameDraft,
    setProductionApproved,
    clearError: () => setError(null),
    chooseIntegration,
    chooseResource,
    next,
    back,
    create,
  };
}

export type ManagedDatabaseImport = ReturnType<typeof useManagedDatabaseImport>;
