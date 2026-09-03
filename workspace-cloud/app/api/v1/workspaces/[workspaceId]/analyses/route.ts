// Workspace Analysis Article library. Definitions and exact authority pins are
// shared here; query result rows always remain on Desktop.
import { env } from "../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
  privateRevisionMutationJson,
} from "../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../lib/workspace-authorization";
import {
  commitAnalysisArticleCreate,
  type AnalysisArticleMutationAuthority,
} from "../../../../../../lib/workspace-analysis-article-store";
import { listAccessibleAnalysisArticles } from "../../../../../../lib/workspace-analysis-article-http";
import {
  parseSharedAnalysisArticleCreate,
  publicAnalysisArticle,
} from "../../../../../../lib/workspace-analysis-articles";
import { hasWorkspaceCapability } from "../../../../../../lib/workspace-permissions";
import { parseExpectedRevision } from "../../../../../../lib/workspace-versioning";

type RouteContext = { params: Promise<{ workspaceId: string }> };

function authority(authorization: {
  role: string;
  session: { session: { id: string }; user: { id: string } };
  membership: { id: string };
}): AnalysisArticleMutationAuthority {
  return {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
}
function uniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; cause?: { code?: unknown } };
  return row.code === "23505" || row.cause?.code === "23505";
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const environmentId = new URL(request.url).searchParams.get("environmentId");
  if (environmentId !== null && !isUuid(environmentId)) {
    return jsonError("Invalid Environment id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const articles = await listAccessibleAnalysisArticles({
    organizationId: workspaceId,
    memberId: authorization.membership.id,
    projectEnvironmentId: environmentId ?? undefined,
  });
  return privateJson({ workspaceId, articles });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  if (expectedRevision !== 0) return jsonError("New Analysis Articles require expected revision 0", 409);
  const body = await boundedJsonBody(request, 1024 * 1024);
  if (!body.ok) return jsonError("Invalid Analysis Article request", 400);
  let article;
  try {
    article = parseSharedAnalysisArticleCreate(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis Article", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!hasWorkspaceCapability(authorization.role, "write")) {
    return jsonError("Analysis Article creation requires workspace Editor access", 403);
  }
  try {
    const created = await commitAnalysisArticleCreate({
      organizationId: workspaceId,
      article,
      authority: authority(authorization),
    });
    if (!created) {
      return jsonError(
        "Analysis authority changed. Refresh the Project and connection grant.",
        409,
      );
    }
    return privateRevisionMutationJson(request, {
      article: publicAnalysisArticle({
        ...created,
        graphRevisionIds: article.graphRevisionIds,
        connections: article.connections,
      }),
    }, { status: 201 });
  } catch (error) {
    if (uniqueViolation(error)) return jsonError("Analysis Article already exists", 409);
    throw error;
  }
}
