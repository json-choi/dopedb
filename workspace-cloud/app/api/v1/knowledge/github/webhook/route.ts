import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyGithubWebhook } from "@/lib/knowledge/github-app";
import {
  reconcileGithubKnowledgeCommit,
  recordGithubKnowledgePush,
  recordGithubSourceRevisions,
} from "@/lib/knowledge/sync-queue";
import {
  knowledgeGithubInstallation,
  knowledgeSource,
} from "@/lib/schema";

const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
const MAX_CHANGED_FILES = 10_000;
const RAW_SOURCE_REVISION_BATCH = 10_000;

async function boundedBody(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
}

function safeDelivery(value: string | null) {
  return value && /^[A-Za-z0-9-]{1,128}$/.test(value) ? value : null;
}

function safePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4_096
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function changedFiles(payload: Record<string, unknown>) {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const paths = new Set<string>();
  for (const value of commits) {
    if (!value || typeof value !== "object") continue;
    const commit = value as Record<string, unknown>;
    for (const key of ["added", "modified", "removed"] as const) {
      const values = Array.isArray(commit[key]) ? commit[key] : [];
      for (const path of values) {
        if (safePath(path)) paths.add(path);
        if (paths.size > MAX_CHANGED_FILES) return [];
      }
    }
  }
  return [...paths].sort();
}

function positiveInteger(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return BigInt(value);
}

function repositories(value: unknown) {
  if (!Array.isArray(value) || value.length > 10_000) return [];
  const result: Array<{ id: string; fullName: string | null }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const repository = item as Record<string, unknown>;
    const id = positiveInteger(repository.id);
    const fullName = typeof repository.full_name === "string"
      && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)
      && repository.full_name.split("/").every((segment) => segment !== "." && segment !== "..")
      ? repository.full_name
      : null;
    if (id) result.push({ id: id.toString(), fullName });
  }
  return result;
}

async function requeueSources(
  sources: Array<{ organizationId: string; id: string; commitSha: string | null }>,
) {
  let queued = false;
  for (const source of sources) {
    if (!source.commitSha) continue;
    await reconcileGithubKnowledgeCommit({
      organizationId: source.organizationId,
      sourceId: source.id,
      observedCommitSha: source.commitSha,
    });
    queued = true;
  }
  return queued;
}

export async function POST(request: Request) {
  const rawBody = await boundedBody(request);
  if (!rawBody || !verifyGithubWebhook(
    rawBody,
    request.headers.get("x-hub-signature-256"),
  )) {
    return new Response(null, { status: 401 });
  }
  const deliveryId = safeDelivery(request.headers.get("x-github-delivery"));
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) return new Response(null, { status: 400 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const installationPayload = payload.installation;
  const installationId = installationPayload && typeof installationPayload === "object"
    ? positiveInteger((installationPayload as Record<string, unknown>).id)
    : null;
  if (!installationId) return new Response(null, { status: 202 });
  const installations = await db.select({
    id: knowledgeGithubInstallation.id,
    organizationId: knowledgeGithubInstallation.organizationId,
  }).from(knowledgeGithubInstallation).where(eq(
    knowledgeGithubInstallation.installationId,
    installationId,
  ));
  if (installations.length === 0) return new Response(null, { status: 202 });
  const graphBuildsEnabled = env.knowledgeGraphBuildsEnabled();
  const installationIds = installations.map((installation) => installation.id);

  if (event === "push") {
    const repositoryPayload = payload.repository;
    const repositoryId = repositoryPayload && typeof repositoryPayload === "object"
      ? positiveInteger((repositoryPayload as Record<string, unknown>).id)
      : null;
    const refName = typeof payload.ref === "string" ? payload.ref : null;
    const before = typeof payload.before === "string" && /^[0-9a-f]{40}$/.test(payload.before)
      ? payload.before
      : null;
    const deleted = payload.deleted === true;
    const after = !deleted
      && typeof payload.after === "string"
      && /^[0-9a-f]{40}$/.test(payload.after)
      && !/^0{40}$/.test(payload.after)
      ? payload.after
      : null;
    if (!repositoryId || !refName || !before) return new Response(null, { status: 202 });
    const files = changedFiles(payload);
    const shortRef = refName.replace(/^refs\/(?:heads|tags)\//, "");
    const sources = await db.select({
      id: knowledgeSource.id,
      organizationId: knowledgeSource.organizationId,
    }).from(knowledgeSource).where(and(
      inArray(knowledgeSource.githubInstallationId, installationIds),
      eq(knowledgeSource.repositoryId, repositoryId.toString()),
      or(
        eq(knowledgeSource.refName, refName),
        eq(knowledgeSource.refName, shortRef),
      ),
      isNull(knowledgeSource.revokedAt),
    ));
    if (graphBuildsEnabled) {
      for (const source of sources) {
        await recordGithubKnowledgePush({
          organizationId: source.organizationId,
          sourceId: source.id,
          deliveryId,
          beforeCommitSha: before,
          afterCommitSha: after,
          changedFiles: files,
        });
      }
    } else {
      for (let offset = 0; offset < sources.length; offset += RAW_SOURCE_REVISION_BATCH) {
        await recordGithubSourceRevisions(
          sources.slice(offset, offset + RAW_SOURCE_REVISION_BATCH).map((source) => ({
            organizationId: source.organizationId,
            sourceId: source.id,
            deliveryId,
            beforeCommitSha: before,
            afterCommitSha: after,
          })),
        );
      }
    }
  } else if (event === "installation") {
    const action = typeof payload.action === "string" ? payload.action : "";
    const status = action === "deleted"
      ? "revoked"
      : action === "suspend"
        ? "suspended"
        : action === "unsuspend" || action === "created" || action === "new_permissions_accepted"
          ? "active"
          : null;
    if (status) {
      await db.update(knowledgeGithubInstallation).set({
        status,
        updatedAt: new Date(),
      }).where(eq(knowledgeGithubInstallation.installationId, installationId));
      if (status !== "active") {
        await db.update(knowledgeSource).set({
          syncState: status === "revoked" ? "revoked" : "stale",
          lastFailureCode: status === "revoked"
            ? "github_installation_revoked"
            : "github_installation_suspended",
          revokedAt: status === "revoked" ? new Date() : null,
          updatedAt: new Date(),
        }).where(inArray(knowledgeSource.githubInstallationId, installationIds));
      } else {
        const sources = await db.update(knowledgeSource).set({
          syncState: graphBuildsEnabled ? "pending" : "ready",
          syncRevision: sql`${knowledgeSource.syncRevision} + 1`,
          lastFailureCode: null,
          revokedAt: null,
          updatedAt: new Date(),
        }).where(inArray(
          knowledgeSource.githubInstallationId,
          installationIds,
        )).returning({
          organizationId: knowledgeSource.organizationId,
          id: knowledgeSource.id,
          commitSha: knowledgeSource.commitSha,
        });
        if (graphBuildsEnabled) {
          await requeueSources(sources);
        }
      }
    }
  } else if (event === "installation_repositories") {
    const action = typeof payload.action === "string" ? payload.action : "";
    const changed = action === "removed"
      ? repositories(payload.repositories_removed)
      : action === "added"
        ? repositories(payload.repositories_added)
        : [];
    if (changed.length > 0) {
      const sources = await db.update(knowledgeSource).set({
        syncState: action === "removed"
          ? "stale"
          : graphBuildsEnabled ? "pending" : "ready",
        syncRevision: sql`${knowledgeSource.syncRevision} + 1`,
        lastFailureCode: action === "removed"
          ? "github_repository_access_removed"
          : null,
        updatedAt: new Date(),
      }).where(and(
        inArray(knowledgeSource.githubInstallationId, installationIds),
        inArray(knowledgeSource.repositoryId, changed.map((repository) => repository.id)),
      )).returning({
        organizationId: knowledgeSource.organizationId,
        id: knowledgeSource.id,
        commitSha: knowledgeSource.commitSha,
      });
      if (action === "added" && graphBuildsEnabled) {
        await requeueSources(sources);
      }
    }
  } else if (event === "repository") {
    const action = typeof payload.action === "string" ? payload.action : "";
    const [repository] = repositories(payload.repository ? [payload.repository] : []);
    if (repository) {
      const unavailable = action === "deleted" || action === "archived" || action === "transferred";
      const available = action === "renamed" || action === "unarchived";
      if (unavailable || available) {
        const sources = await db.update(knowledgeSource).set({
          ...(available && repository.fullName
            ? { repositoryFullName: repository.fullName }
            : {}),
          syncState: unavailable
            ? "stale"
            : graphBuildsEnabled ? "pending" : "ready",
          syncRevision: sql`${knowledgeSource.syncRevision} + 1`,
          lastFailureCode: unavailable ? "github_repository_unavailable" : null,
          updatedAt: new Date(),
        }).where(and(
          inArray(knowledgeSource.githubInstallationId, installationIds),
          eq(knowledgeSource.repositoryId, repository.id),
        )).returning({
          organizationId: knowledgeSource.organizationId,
          id: knowledgeSource.id,
          commitSha: knowledgeSource.commitSha,
        });
        if (available && graphBuildsEnabled) {
          await requeueSources(sources);
        }
      }
    }
  }
  return new Response(null, { status: 202 });
}
