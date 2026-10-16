// Neon least-privilege preparation for the chosen database: environment
// classification, the no-change preflight, explicit approvals and the idempotent
// apply that yields the one-use import receipt. The sealed plan and receipt live
// only in this component state and are dropped whenever the selection changes.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin } from "../../requests";
import {
  emptyNeonBootstrap,
  parseNeonBootstrapApply,
  parseNeonBootstrapPreflight,
  type NeonBootstrapState,
  type NeonEnvironmentClassification,
} from "../domain";
import {
  isFutureInstant,
  neonEnvironment,
  newIdempotencyKey,
  type WizardError,
} from "./model";
import {
  describeFailure,
  isNeonSelectionChanged,
  neonApplyFailure,
} from "./serverMessages";
import { invalidateNeonBranchQueries } from "../neonBranches/queries";
import type { ResourceDiscovery } from "./useResourceDiscovery";

type PendingApply = Readonly<{
  integrationId: string;
  planHash: string;
  publicAclApproved: boolean;
  productionApproved: boolean;
  idempotencyKey: string;
}>;

export function useNeonBootstrap({
  scope,
  discovery,
  run,
  fail,
}: {
  scope: WorkspaceAdminScope;
  discovery: ResourceDiscovery;
  /** Runs one exclusive flow mutation; nothing else may start while it is in flight. */
  run: (kind: "neonPreflight" | "neonApply", task: () => Promise<void>) => Promise<void>;
  fail: (error: WizardError | null) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const [classification, setClassification] = useState<NeonEnvironmentClassification>("");
  const [bootstrap, setBootstrap] = useState<NeonBootstrapState>(emptyNeonBootstrap);
  const [publicAclApproved, setPublicAclApproved] = useState(false);
  const [productionApproved, setProductionApproved] = useState(false);
  const pendingApply = useRef<PendingApply | null>(null);

  const environment = neonEnvironment(discovery.branch, classification);
  const report = bootstrap.report;
  const verified = Boolean(
    report && bootstrap.receipt && isFutureInstant(bootstrap.receiptExpiresAt),
  );
  const canApply = Boolean(
    report
    && report.status !== "blocked"
    && (!report.requiresPublicAclApproval || publicAclApproved)
    && (!report.requiresProductionApproval || productionApproved),
  );

  function clearPlan() {
    pendingApply.current = null;
    setBootstrap(emptyNeonBootstrap);
    setPublicAclApproved(false);
    setProductionApproved(false);
  }

  function reset() {
    clearPlan();
    setClassification("");
  }

  function classify(value: NeonEnvironmentClassification) {
    setClassification(value);
    clearPlan();
    fail(null);
  }

  function preflight() {
    return run("neonPreflight", async () => {
      if (!environment) {
        fail({ message: t("workspaceProviderDatabases.neonClassify"), reconnect: false });
        return;
      }
      const database = await discovery.freshLeaf();
      if (!database?.selectionProof || database.ready !== true) {
        fail({ message: t("workspaceProviderDatabases.neonReselect"), reconnect: false });
        return;
      }
      clearPlan();
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "preflightNeonBootstrap",
          workspaceId: scope.workspaceId,
          integrationId: discovery.integrationId,
          selectionProof: database.selectionProof,
          environment,
        });
      } catch (error) {
        if (isNeonSelectionChanged(error)) {
          discovery.reloadLeaf();
          fail({ message: t("workspaceProviderDatabases.neonSelectionChanged"), reconnect: false });
          return;
        }
        fail(describeFailure(error, i18n, "workspaceProviderDatabases.neonPreflightError"));
        return;
      }
      const parsed = parseNeonBootstrapPreflight(body);
      if (
        !parsed
        || parsed.report.target.project !== discovery.valueOf("projects")
        || parsed.report.target.branch !== discovery.valueOf("branches")
        || parsed.report.target.databaseId !== database.id
      ) {
        fail({ message: t("workspaceProviderDatabases.neonPreflightShapeError"), reconnect: false });
        return;
      }
      setBootstrap({ ...parsed, receipt: "", receiptExpiresAt: "" });
    });
  }

  function apply() {
    return run("neonApply", async () => {
      if (!report || !bootstrap.plan) return;
      if (!isFutureInstant(bootstrap.planExpiresAt)) {
        clearPlan();
        fail({ message: t("workspaceProviderDatabases.neonPreflightExpired"), reconnect: false });
        return;
      }
      if (report.status === "blocked") {
        fail({ message: t("workspaceProviderDatabases.neonBlocked"), reconnect: false });
        return;
      }
      if (report.requiresPublicAclApproval && !publicAclApproved) {
        fail({ message: t("workspaceProviderDatabases.neonPublicApprovalRequired"), reconnect: false });
        return;
      }
      if (report.requiresProductionApproval && !productionApproved) {
        fail({
          message: t("workspaceProviderDatabases.neonProductionApprovalRequired"),
          reconnect: false,
        });
        return;
      }
      // A retry of the exact same plan and approvals reuses its key; anything else is new.
      let pending = pendingApply.current;
      if (
        !pending
        || pending.integrationId !== discovery.integrationId
        || pending.planHash !== report.planHash
        || pending.publicAclApproved !== publicAclApproved
        || pending.productionApproved !== productionApproved
      ) {
        pending = {
          integrationId: discovery.integrationId,
          planHash: report.planHash,
          publicAclApproved,
          productionApproved,
          idempotencyKey: newIdempotencyKey(),
        };
        pendingApply.current = pending;
      }
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "applyNeonBootstrap",
          workspaceId: scope.workspaceId,
          integrationId: pending.integrationId,
          plan: bootstrap.plan,
          idempotencyKey: pending.idempotencyKey,
          publicAclApproved: pending.publicAclApproved,
          productionApproved: pending.productionApproved,
        });
      } catch (error) {
        const failure = neonApplyFailure(error);
        if (failure === "planChanged") {
          clearPlan();
          fail({ message: t("workspaceProviderDatabases.neonPlanChanged"), reconnect: false });
        } else if (failure === "manualRepair") {
          fail({ message: t("workspaceProviderDatabases.neonManualRepair"), reconnect: false });
        } else {
          fail(describeFailure(error, i18n, "workspaceProviderDatabases.neonApplyError"));
        }
        return;
      }
      const parsed = parseNeonBootstrapApply(body);
      if (
        !parsed
        || parsed.report.planHash !== report.planHash
        || parsed.report.target.project !== report.target.project
        || parsed.report.target.branch !== report.target.branch
        || parsed.report.target.databaseId !== report.target.databaseId
      ) {
        fail({ message: t("workspaceProviderDatabases.neonApplyShapeError"), reconnect: false });
        return;
      }
      pendingApply.current = null;
      setBootstrap((current) => ({
        ...current,
        report: parsed.report,
        receipt: parsed.receipt,
        receiptExpiresAt: parsed.receiptExpiresAt,
      }));
      // Bootstrap marks the branch ready without touching managed connections, so
      // the branch history would otherwise stay stale until the next import.
      void invalidateNeonBranchQueries(queryClient, scope, pending.integrationId);
    });
  }

  /** Drops an expired or consumed receipt so the next attempt starts from the preflight. */
  function expire() {
    clearPlan();
  }

  return {
    classification,
    environment,
    bootstrap,
    report,
    verified,
    canApply,
    publicAclApproved,
    productionApproved,
    setPublicAclApproved,
    setProductionApproved,
    classify,
    preflight,
    apply,
    expire,
    reset,
  };
}

export type NeonBootstrapController = ReturnType<typeof useNeonBootstrap>;
