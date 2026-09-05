import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  knowledgeEnvironmentConnection,
  knowledgeGithubInstallation,
  knowledgeProjectEnvironment,
  knowledgeSource,
  organization,
  workspaceConnection,
} from "../schema";
import {
  authorizeWorkspace,
  authorizeWorkspaceConnection,
} from "../workspace-authorization";
import { githubSourceManifest, readGithubBlobs } from "./github-app";
import {
  isPersonalKnowledgeMetadata,
  personalKnowledgeOrganizationId,
} from "./personal-scope";
import {
  MAX_SOURCE_BROWSE_FILE_BYTES,
  MAX_SOURCE_BROWSE_MANIFEST_BYTES,
  sourceBrowseMatches,
  sourceBrowseText,
} from "./source-browser";

type ExactSourceInput = {
  workspaceId: string;
  sourceId: string;
  environmentId: string;
  environmentRevision: number;
  connectionId: string;
  connectionRevision: number;
  commitSha: string;
};

type SourceBrowseFailure = { ok: false; status: number; error: string };

async function exactSource(request: Request, input: ExactSourceInput) {
  const workspace = await authorizeWorkspace(
    request,
    input.workspaceId,
    "view",
  );
  if (!workspace.ok) return workspace;
  const [source] = await db.select({
    repository: knowledgeSource.repositoryFullName,
    refName: knowledgeSource.refName,
    commitSha: knowledgeSource.commitSha,
    installationId: knowledgeGithubInstallation.installationId,
    organizationMetadata: organization.metadata,
  }).from(knowledgeSource).innerJoin(
    organization,
    eq(organization.id, knowledgeSource.organizationId),
  ).innerJoin(
    knowledgeGithubInstallation,
    and(
      eq(knowledgeGithubInstallation.organizationId, knowledgeSource.organizationId),
      eq(knowledgeGithubInstallation.id, knowledgeSource.githubInstallationId),
      eq(knowledgeGithubInstallation.status, "active"),
    ),
  ).innerJoin(
    knowledgeProjectEnvironment,
    and(
      eq(knowledgeProjectEnvironment.organizationId, knowledgeSource.organizationId),
      eq(knowledgeProjectEnvironment.id, knowledgeSource.projectEnvironmentId),
      eq(knowledgeProjectEnvironment.revision, knowledgeSource.environmentRevision),
    ),
  ).where(and(
    eq(knowledgeSource.organizationId, input.workspaceId),
    eq(knowledgeSource.id, input.sourceId),
    eq(knowledgeSource.projectEnvironmentId, input.environmentId),
    eq(knowledgeSource.environmentRevision, input.environmentRevision),
    eq(knowledgeSource.commitSha, input.commitSha),
    eq(knowledgeSource.provider, "github"),
    isNull(knowledgeSource.revokedAt),
  )).limit(1);
  if (!source?.repository || !source.refName || !source.commitSha) {
    return {
      ok: false as const,
      status: 409,
      error: "The pinned GitHub source changed; start a new Agent session",
    };
  }

  const isPersonal = workspace.role === "owner"
    && input.workspaceId === personalKnowledgeOrganizationId(workspace.session.user.id)
    && isPersonalKnowledgeMetadata(source.organizationMetadata);
  if (!isPersonal) {
    const authorization = await authorizeWorkspaceConnection(
      request,
      input.workspaceId,
      input.connectionId,
      "use",
    );
    if (!authorization.ok) return authorization;
    const [binding] = await db.select({ id: knowledgeEnvironmentConnection.id }).from(
      knowledgeEnvironmentConnection,
    ).innerJoin(
      workspaceConnection,
      and(
        eq(workspaceConnection.organizationId, knowledgeEnvironmentConnection.organizationId),
        eq(workspaceConnection.id, knowledgeEnvironmentConnection.connectionId),
        eq(workspaceConnection.contentRevision, knowledgeEnvironmentConnection.connectionRevision),
        isNull(workspaceConnection.deletedAt),
        isNull(workspaceConnection.revocationPendingAt),
      ),
    ).where(and(
      eq(knowledgeEnvironmentConnection.organizationId, input.workspaceId),
      eq(knowledgeEnvironmentConnection.projectEnvironmentId, input.environmentId),
      eq(knowledgeEnvironmentConnection.environmentRevision, input.environmentRevision),
      eq(knowledgeEnvironmentConnection.connectionId, input.connectionId),
      eq(knowledgeEnvironmentConnection.connectionRevision, input.connectionRevision),
      isNull(knowledgeEnvironmentConnection.revokedAt),
    )).limit(1);
    if (!binding) {
      return {
        ok: false as const,
        status: 409,
        error: "The pinned environment connection changed; start a new Agent session",
      };
    }
  }
  return {
    ok: true as const,
    source: {
      installationId: source.installationId,
      repository: source.repository,
      refName: source.refName,
      commitSha: source.commitSha,
    },
  };
}

export async function searchPinnedGithubSource(
  request: Request,
  input: ExactSourceInput & { query: string; limit: number },
) {
  const authority = await exactSource(request, input);
  if (!authority.ok) return authority;
  try {
    const manifest = await githubSourceManifest(
      authority.source.installationId,
      authority.source.repository,
      authority.source.commitSha,
      { maxTotalBytes: MAX_SOURCE_BROWSE_MANIFEST_BYTES },
    );
    return {
      ok: true as const,
      value: {
        sourceId: input.sourceId,
        repository: authority.source.repository,
        refName: authority.source.refName,
        commitSha: authority.source.commitSha,
        fileCount: manifest.length,
        ...sourceBrowseMatches(manifest, input.query, input.limit),
      },
    };
  } catch {
    return {
      ok: false as const,
      status: 424,
      error: "GitHub source tree is temporarily unavailable",
    } satisfies SourceBrowseFailure;
  }
}

export async function readPinnedGithubSource(
  request: Request,
  input: ExactSourceInput & { path: string; lineStart: number; lineEnd: number },
) {
  const authority = await exactSource(request, input);
  if (!authority.ok) return authority;
  try {
    const manifest = await githubSourceManifest(
      authority.source.installationId,
      authority.source.repository,
      authority.source.commitSha,
      { maxTotalBytes: MAX_SOURCE_BROWSE_MANIFEST_BYTES },
    );
    const file = manifest.find((candidate) => candidate.path === input.path);
    if (!file) {
      return { ok: false as const, status: 404, error: "Source path is outside the pinned commit" };
    }
    if (file.bytes > MAX_SOURCE_BROWSE_FILE_BYTES) {
      return { ok: false as const, status: 413, error: "Source file exceeds the interactive browse limit" };
    }
    const [downloaded] = await readGithubBlobs(
      authority.source.installationId,
      authority.source.repository,
      [file],
    );
    if (!downloaded || downloaded.path !== file.path) {
      return { ok: false as const, status: 409, error: "GitHub source file changed" };
    }
    return {
      ok: true as const,
      value: {
        sourceId: input.sourceId,
        repository: authority.source.repository,
        commitSha: authority.source.commitSha,
        path: file.path,
        blobSha: file.blobSha,
        bytes: file.bytes,
        ...sourceBrowseText(downloaded.bytes, input.lineStart, input.lineEnd),
      },
    };
  } catch {
    return {
      ok: false as const,
      status: 424,
      error: "GitHub source file is temporarily unavailable",
    } satisfies SourceBrowseFailure;
  }
}
