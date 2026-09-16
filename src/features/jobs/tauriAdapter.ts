// Owns native Job file-capability, planning, lifecycle, and artifact commands.

import { invoke } from "../../ipc/core";

import type {
  ConnectionId,
  CreateJobRequest,
  Job,
  JobArtifactId,
  JobDetail,
  JobFileCapability,
  JobFileCapabilityId,
  JobFormat,
  JobId,
  JobInputInspection,
  JobProposal,
} from "./domain";

export function pickJobInput(
  connectionId: ConnectionId,
): Promise<JobFileCapability | null> {
  return invoke("pick_job_input", { connectionId });
}

export function pickJobOutput(
  connectionId: ConnectionId,
  suggestedName: string,
): Promise<JobFileCapability | null> {
  return invoke("pick_job_output", { connectionId, suggestedName });
}

export function inspectJobInput(
  connectionId: ConnectionId,
  capabilityId: JobFileCapabilityId,
  format: JobFormat,
): Promise<JobInputInspection> {
  return invoke("inspect_job_input", { connectionId, capabilityId, format });
}

export function createJob(request: CreateJobRequest): Promise<JobProposal> {
  return invoke("create_job", { request });
}

export function listJobs(connectionId: ConnectionId): Promise<Job[]> {
  return invoke("list_jobs", { connectionId });
}

export function getJob(
  connectionId: ConnectionId,
  jobId: JobId,
): Promise<JobDetail> {
  return invoke("get_job", { connectionId, jobId });
}

export function startJob(
  connectionId: ConnectionId,
  jobId: JobId,
): Promise<Job> {
  return invoke("start_job", { connectionId, jobId });
}

export function pauseJob(
  connectionId: ConnectionId,
  jobId: JobId,
): Promise<Job> {
  return invoke("pause_job", { connectionId, jobId });
}

export function cancelJob(
  connectionId: ConnectionId,
  jobId: JobId,
): Promise<Job> {
  return invoke("cancel_job", { connectionId, jobId });
}

export function revealJobArtifact(
  connectionId: ConnectionId,
  artifactId: JobArtifactId,
): Promise<void> {
  return invoke("reveal_job_artifact", { connectionId, artifactId });
}
