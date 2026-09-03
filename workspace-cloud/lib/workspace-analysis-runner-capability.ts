// Exact Desktop-runner possession proof for a user-triggered foreground run.
// The clear capability is returned only at registration and is never persisted.
import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const analysisRunnerCapabilityHeader = "x-dopedb-analysis-runner-capability";
export const analysisRunnerCapabilityVersionHeader =
  "x-dopedb-analysis-runner-capability-version";
export const analysisRunnerCapabilityVersion = 1 as const;

const RAW_CAPABILITY = /^[0-9a-f]{64}$/;
const HASH_DOMAIN = "dopedb:analysis-runner-capability:v1\0";

export function parseAnalysisRunnerCapability(request: Request) {
  const value = request.headers.get(analysisRunnerCapabilityHeader) ?? "";
  return RAW_CAPABILITY.test(value) ? value : null;
}

export function parseAnalysisRunnerCapabilityVersion(request: Request) {
  return request.headers.get(analysisRunnerCapabilityVersionHeader) === "1"
    ? analysisRunnerCapabilityVersion
    : null;
}

export function isAnalysisDesktopBearerRequest(request: Request) {
  return /^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? "");
}

export function issueAnalysisRunnerCapability() {
  return randomBytes(32).toString("hex");
}

export function hashAnalysisRunnerCapability(capability: string) {
  if (!RAW_CAPABILITY.test(capability)) {
    throw new Error("Invalid Analysis runner capability");
  }
  return createHash("sha256")
    .update(HASH_DOMAIN, "utf8")
    .update(Buffer.from(capability, "hex"))
    .digest("hex");
}
