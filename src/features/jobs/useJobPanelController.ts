// Owns the complete connection-scoped Job panel workflow: immutable plan draft,
// file capability, exact approval, durable lifecycle mutations, and query refresh.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { CatalogRelationV2 } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { jobsQuery, qk } from "../../lib/queries";
import { approveOperation } from "../operations/tauriAdapter";
import {
  jobConnectionId,
  jobRelationRef,
  type Job,
  type JobArtifactId,
  type JobDetail,
  type JobErrorPolicy,
  type JobFieldMapping,
  type JobFileCapability,
  type JobFormat,
  type JobId,
  type JobInputInspection,
  type JobKind,
  type JobSqlAudit,
} from "./domain";
import {
  DEFAULT_JOB_BATCH_SIZE,
  jobErrorKey,
  jobFileExtension,
  jobRelationLabel,
} from "./jobPanelPresentation";
import {
  cancelJob,
  createJob,
  getJob,
  inspectJobInput,
  pauseJob,
  pickJobInput,
  pickJobOutput,
  revealJobArtifact,
  startJob,
} from "./tauriAdapter";

export type JobApproval = {
  job: Job;
  payloadHash: string;
  confirmationPhrase: string | null;
  /** Statement counts of a SQL import, including schema changes (DDL). */
  sqlAudit: JobSqlAudit | null;
};

export function useJobPanelController({
  connectionId,
  relation,
}: {
  connectionId: string;
  relation: CatalogRelationV2;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const jobs = useQuery(jobsQuery(connectionId));
  const scopedConnectionId = jobConnectionId(connectionId);
  const [kind, setKind] = useState<JobKind>("export");
  const [format, setFormat] = useState<JobFormat>("csv");
  const [capability, setCapability] = useState<JobFileCapability | null>(null);
  const [inspection, setInspection] = useState<JobInputInspection | null>(null);
  const [customMapping, setCustomMapping] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [required, setRequired] = useState<Record<string, boolean>>({});
  const [errorPolicy, setErrorPolicy] = useState<JobErrorPolicy>("stop");
  const [maxErrors, setMaxErrors] = useState(1_000);
  const [nullValues, setNullValues] = useState(",NULL,null");
  const [batchSize, setBatchSize] = useState(DEFAULT_JOB_BATCH_SIZE);
  const [approval, setApproval] = useState<JobApproval | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState<JobId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetColumns = useMemo(
    () => new Set(relation.columns.map((column) => column.name)),
    [relation.columns],
  );

  function resetPlan(nextKind = kind, nextFormat = format) {
    setKind(nextKind);
    setFormat(nextFormat);
    setCapability(null);
    setInspection(null);
    setCustomMapping(false);
    setTargets({});
    setRequired({});
    setApproval(null);
    setError(null);
  }

  async function chooseFile() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "export") {
        const selected = await pickJobOutput(
          scopedConnectionId,
          `${relation.object.name}.${jobFileExtension(format)}`,
        );
        setCapability(selected);
        setInspection(null);
        return;
      }
      const selected = await pickJobInput(scopedConnectionId);
      setCapability(selected);
      if (!selected) {
        setInspection(null);
        return;
      }
      const nextInspection = await inspectJobInput(
        scopedConnectionId,
        selected.id,
        format,
      );
      setInspection(nextInspection);
      setTargets(Object.fromEntries(nextInspection.fields.map((field) => [
        field,
        targetColumns.has(field) ? field : "",
      ])));
    } catch (cause) {
      setCapability(null);
      setInspection(null);
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  function mappings(): JobFieldMapping[] {
    if (!customMapping || !inspection) return [];
    return inspection.fields.flatMap((source) => {
      const target = targets[source]?.trim();
      return target
        ? [{ source, target, required: required[source] ?? false }]
        : [];
    });
  }

  async function refreshJobs() {
    await queryClient.invalidateQueries({ queryKey: qk.jobs(connectionId) });
  }

  async function submit() {
    if (!capability) return;
    setBusy(true);
    setError(null);
    try {
      const plan = kind === "export"
        ? {
            kind: "export" as const,
            capabilityId: capability.id,
            relation: jobRelationRef(relation.object),
            consistency: "per_batch_current" as const,
            columns: [],
            fieldNames: [],
            batchSize,
          }
        : {
            kind: "import" as const,
            capabilityId: capability.id,
            targetRelation: format === "sql" || format === "sql_gzip"
              ? null
              : jobRelationRef(relation.object),
            mapping: mappings(),
            validation: {
              onError: errorPolicy,
              maxErrors,
              nullValues: nullValues.split(",").map((value) => value.trim()),
            },
            batchSize,
          };
      const proposed = await createJob({
        connectionId: scopedConnectionId,
        format,
        plan,
      });
      await refreshJobs();
      if (proposed.approvalRequired) {
        setApproval({
          job: proposed.job,
          payloadHash: proposed.payloadHash,
          confirmationPhrase: proposed.confirmationPhrase,
          sqlAudit: proposed.sqlAudit ?? null,
        });
        return;
      }
      await startJob(scopedConnectionId, proposed.job.id);
      setCapability(null);
      await refreshJobs();
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndStart() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      await approveOperation(
        approval.job.operationId,
        approval.payloadHash,
        approval.confirmationPhrase ?? undefined,
      );
      await startJob(scopedConnectionId, approval.job.id);
      setApproval(null);
      setCapability(null);
      setDetail(null);
      await refreshJobs();
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function cancelApproval() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      await cancelJob(scopedConnectionId, approval.job.id);
      setApproval(null);
      setDetail(null);
      await refreshJobs();
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function mutateJob(job: Job, action: "start" | "pause" | "cancel") {
    setBusyJobId(job.id);
    setError(null);
    try {
      if (action === "start") await startJob(scopedConnectionId, job.id);
      if (action === "pause") await pauseJob(scopedConnectionId, job.id);
      if (action === "cancel") await cancelJob(scopedConnectionId, job.id);
      await refreshJobs();
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusyJobId(null);
    }
  }

  async function openJob(job: Job) {
    setBusyJobId(job.id);
    setError(null);
    try {
      const next = await getJob(scopedConnectionId, job.id);
      setDetail(next);
      if (next.approvalRequired) {
        setApproval({
          job: next.job,
          payloadHash: next.payloadHash,
          confirmationPhrase: next.confirmationPhrase,
          sqlAudit: next.sqlAudit ?? null,
        });
      }
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    } finally {
      setBusyJobId(null);
    }
  }

  async function revealArtifact(artifactId: JobArtifactId) {
    try {
      await revealJobArtifact(scopedConnectionId, artifactId);
    } catch (cause) {
      setError(t(jobErrorKey(cause)));
    }
  }

  function setTarget(source: string, target: string) {
    setTargets((current) => ({ ...current, [source]: target }));
  }

  function setSourceRequired(source: string, isRequired: boolean) {
    setRequired((current) => ({ ...current, [source]: isRequired }));
  }

  const canSubmit = capability !== null
    && !busy
    && (kind === "export" || format === "sql" || format === "sql_gzip" || inspection !== null);

  return {
    model: {
      approval,
      batchSize,
      busy,
      busyJobId,
      canSubmit,
      capability,
      customMapping,
      detail,
      error,
      errorPolicy,
      format,
      inspection,
      jobs,
      kind,
      maxErrors,
      nullValues,
      relation,
      relationName: jobRelationLabel(relation.object),
      required,
      targets,
    },
    commands: {
      approveAndStart,
      cancelApproval,
      chooseFile,
      closeDetail: () => setDetail(null),
      mutateJob,
      openJob,
      refreshJobs,
      resetPlan,
      revealArtifact,
      setBatchSize: (value: number) => setBatchSize(Math.max(100, Math.min(10_000, value))),
      setCustomMapping,
      setErrorPolicy,
      setMaxErrors: (value: number) => setMaxErrors(Math.max(1, Math.min(1_000_000, value))),
      setNullValues,
      setSourceRequired,
      setTarget,
      submit,
    },
  };
}

export type JobPanelController = ReturnType<typeof useJobPanelController>;
