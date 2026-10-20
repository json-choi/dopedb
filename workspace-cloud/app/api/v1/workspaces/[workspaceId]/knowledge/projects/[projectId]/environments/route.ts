import { env } from "@/lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "@/lib/http";
import { parseEnvironmentKind } from "@/lib/knowledge/environment-kind";
import { appendKnowledgeEnvironment } from "@/lib/knowledge/project-store";
import { knowledgeMutationAuthority } from "@/lib/knowledge/mutation-authority";
import { authorizeWorkspace } from "@/lib/workspace-authorization";
import {
  databaseErrorCode,
  logKnowledgeMutationFailure,
} from "@/lib/workspace-server-log";

type RouteContext = {
  params: Promise<{ workspaceId: string; projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) {
    return jsonError("Invalid request origin", 403);
  }
  const { workspaceId, projectId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(projectId)) {
    return jsonError("Invalid Project scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) {
    return jsonError(authorization.error, authorization.status);
  }
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 8 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  // `{kind}` is the shape; pre-kind Desktops send `{name, riskClass}`, read as the kind.
  const kind = body ? parseEnvironmentKind(body, ["expectedProjectRevision"]) : null;
  if (
    !body
    || !kind
    || typeof body.expectedProjectRevision !== "number"
    || !Number.isSafeInteger(body.expectedProjectRevision)
    || body.expectedProjectRevision < 1
  ) {
    return jsonError("Invalid Environment", 400);
  }

  const expectedProjectRevision = body.expectedProjectRevision;
  try {
    const project = await appendKnowledgeEnvironment({
      organizationId: workspaceId,
      projectId,
      expectedProjectRevision,
      kind,
      authority,
    });
    if (!project) {
      return jsonError(
        "Project revision changed or the Project already has an Environment of that kind",
        409,
      );
    }
    return privateJson({ project }, { status: 201 });
  } catch (error) {
    logKnowledgeMutationFailure({
      operation: "environment_create",
      databaseCode: databaseErrorCode(error),
    });
    return jsonError("Environment could not be created", 500);
  }
}
