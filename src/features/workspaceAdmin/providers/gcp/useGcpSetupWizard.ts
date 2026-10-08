// Owns one Google Cloud SQL setup session: discovery reads keyed by the setup, the
// operator's target and approval choices, and the prepare → save command. A repair
// pins the existing connection's project and instance and may not change them.
// Success is only the saved integration, never the OAuth approval itself.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n, type I18nKey } from "../../../../lib/i18n";
import type { WorkspaceAdminScope } from "../../domain";
import { runWorkspaceAdmin, WorkspaceAdminRequestError } from "../../requests";
import { isGcpSetupExpired, providerErrorMessage } from "../accounts/providerErrors";
import {
  gcpActiveLeaseRetryMessage,
  parseGcpActiveLeaseConflict,
  type GcpEnvironmentClassification,
} from "../domain";
import {
  GcpBootstrapCancelled,
  GcpSetupExpired,
  prepareGcpSetupWithPropagationRetry,
} from "./gcpBootstrapTransport";
import {
  gcpApprovalsComplete,
  gcpEffectiveProduction,
  gcpPrepareOperation,
  parseGcpBootstrapTicket,
  parseSavedIntegrationId,
  permissionsFromConflict,
  type GcpRepairTarget,
  type GcpSetupSession,
} from "./gcpModel";
import { gcpInstancesQuery, gcpPermissionsQuery, gcpProjectsQuery } from "./queries";

export type GcpWizardPhase = "idle" | "configuring" | "propagating" | "saving";
export type GcpSetupSaved = { integrationId: string; repair: GcpRepairTarget | null };

export function useGcpSetupWizard({
  scope,
  session,
  repair,
  onSaved,
}: {
  scope: WorkspaceAdminScope;
  session: GcpSetupSession;
  repair: GcpRepairTarget | null;
  onSaved: (saved: GcpSetupSaved) => void;
}) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const [projectChoice, setProjectChoice] = useState("");
  const [instanceChoice, setInstanceChoice] = useState("");
  const [environment, setEnvironmentValue] = useState<GcpEnvironmentClassification>("");
  const [productionApproved, setProductionApproved] = useState(false);
  const [iamChangeApproved, setIamChangeApproved] = useState(false);
  const [iamRoleGrantApproved, setIamRoleGrantApproved] = useState(false);
  const [schemaDatabase, setSchemaDatabaseValue] = useState("");
  const [schemaOwner, setSchemaOwnerValue] = useState("");
  const [schemaApproved, setSchemaApproved] = useState(false);
  const [phase, setPhase] = useState<GcpWizardPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const attemptRef = useRef<AbortController | null>(null);

  useEffect(() => () => attemptRef.current?.abort(), []);

  const projectId = repair ? repair.resource.project : projectChoice;
  const instanceId = repair ? repair.resource.instance : instanceChoice;
  const projects = useQuery({ ...gcpProjectsQuery(scope, session.id), enabled: !expired });
  const project = projects.data?.projects.find((item) => item.id === projectId) ?? null;
  const instances = useQuery({
    ...gcpInstancesQuery(scope, session.id, projectId),
    enabled: !expired && project !== null,
  });
  const permissions = useQuery({
    ...gcpPermissionsQuery(scope, session.id, projectId),
    enabled: !expired && project !== null,
  });
  const instance = instances.data?.instances.find((item) => item.id === instanceId) ?? null;
  const repairTargetMissing = Boolean(repair && (
    (projects.data && !project) || (instances.data && !instance)
  ));
  const sessionExpired = expired
    || [projects.error, instances.error, permissions.error].some(isGcpSetupExpired);
  const busy = phase !== "idle";
  const approvalInput = {
    instance,
    environment,
    productionApproved,
    iamChangeApproved,
    iamRoleGrantApproved,
    schema: { database: schemaDatabase, owner: schemaOwner, approved: schemaApproved },
    permissions: permissions.data ?? null,
  };
  const approvalsComplete = !repairTargetMissing
    && !sessionExpired
    && gcpApprovalsComplete(approvalInput);

  function resetApprovals() {
    setEnvironmentValue("");
    setProductionApproved(false);
    setIamChangeApproved(false);
    setIamRoleGrantApproved(false);
    setSchemaDatabaseValue("");
    setSchemaOwnerValue("");
    setSchemaApproved(false);
    setError(null);
  }

  function selectProject(next: string) {
    if (repair || busy) return;
    setProjectChoice(next);
    setInstanceChoice("");
    resetApprovals();
  }

  function selectInstance(next: string) {
    if (repair || busy) return;
    setInstanceChoice(next);
    resetApprovals();
  }

  function setEnvironment(next: GcpEnvironmentClassification) {
    setEnvironmentValue(next);
    setProductionApproved(false);
  }

  function setSchemaDatabase(next: string) {
    setSchemaDatabaseValue(next);
    setSchemaApproved(false);
  }

  function setSchemaOwner(next: string) {
    setSchemaOwnerValue(next);
    setSchemaApproved(false);
  }

  function failureMessage(cause: unknown, fallback: I18nKey): string {
    const conflict = cause instanceof WorkspaceAdminRequestError
      ? parseGcpActiveLeaseConflict(cause.body)
      : null;
    if (conflict) {
      return gcpActiveLeaseRetryMessage(conflict, {
        wait: t("workspaceProviders.gcpActiveLeaseWait"),
        reconnect: t("workspaceProviders.gcpActiveLeaseReconnect"),
      }, lang);
    }
    return providerErrorMessage(cause, { lang, t }, fallback);
  }

  async function configure() {
    if (busy) return;
    const operation = repairTargetMissing || sessionExpired
      ? null
      : gcpPrepareOperation({
          ...approvalInput,
          workspaceId: scope.workspaceId,
          setupId: session.id,
          project,
          repairIntegrationId: repair?.integrationId ?? null,
        });
    if (!operation) {
      setError(t("workspaceProviders.gcpApprovalsRequired"));
      return;
    }
    const attempt = new AbortController();
    attemptRef.current = attempt;
    let stage: "prepare" | "save" = "prepare";
    setPhase("configuring");
    setError(null);
    try {
      const prepared = await prepareGcpSetupWithPropagationRetry({
        accountId: scope.accountId,
        operation,
        setupExpiresAt: projects.data?.expiresAt ?? session.expiresAt,
        signal: attempt.signal,
        onIamPending: () => setPhase("propagating"),
      });
      const bootstrapTicket = parseGcpBootstrapTicket(prepared);
      if (!bootstrapTicket) {
        setError(t("workspaceProviders.gcpBootstrapShapeError"));
        return;
      }
      stage = "save";
      setPhase("saving");
      const saved = await runWorkspaceAdmin(scope.accountId, {
        kind: "saveGcpIntegration",
        workspaceId: scope.workspaceId,
        setupId: session.id,
        bootstrapTicket,
        repairIntegrationId: repair?.integrationId ?? null,
      });
      if (attempt.signal.aborted) return;
      const integrationId = parseSavedIntegrationId(saved);
      if (!integrationId || (repair && integrationId !== repair.integrationId)) {
        setError(t("workspaceProviders.gcpSavedShapeError"));
        return;
      }
      onSaved({ integrationId, repair });
    } catch (cause) {
      if (cause instanceof GcpBootstrapCancelled || attempt.signal.aborted) return;
      if (cause instanceof GcpSetupExpired || isGcpSetupExpired(cause)) {
        setExpired(true);
        return;
      }
      if (stage === "prepare" && cause instanceof WorkspaceAdminRequestError) {
        const required = permissionsFromConflict(cause.body);
        if (required) {
          queryClient.setQueryData(
            gcpPermissionsQuery(scope, session.id, operation.projectId).queryKey,
            required,
          );
          setIamRoleGrantApproved(false);
        }
      }
      setError(failureMessage(
        cause,
        stage === "prepare"
          ? "workspaceProviders.gcpBootstrapFailed"
          : "workspaceProviders.gcpSaveFailed",
      ));
    } finally {
      if (attemptRef.current === attempt) {
        attemptRef.current = null;
        setPhase("idle");
      }
    }
  }

  return {
    session,
    repair,
    projects,
    instances,
    permissions,
    projectId,
    instanceId,
    project,
    instance,
    environment,
    productionApproved,
    iamChangeApproved,
    iamRoleGrantApproved,
    schemaDatabase,
    schemaOwner,
    schemaApproved,
    effectiveProduction: gcpEffectiveProduction(instance, environment),
    approvalsComplete,
    repairTargetMissing,
    sessionExpired,
    phase,
    busy,
    error,
    selectProject,
    selectInstance,
    setEnvironment,
    setProductionApproved,
    setIamChangeApproved,
    setIamRoleGrantApproved,
    setSchemaDatabase,
    setSchemaOwner,
    setSchemaApproved,
    configure: () => void configure(),
  };
}

export type GcpSetupWizardController = ReturnType<typeof useGcpSetupWizard>;
