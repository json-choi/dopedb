// Provisions the signed-in account's private GitHub Knowledge authority while
// accepting only bounded Project/Environment identity metadata from Desktop.
import { authoritativeSession } from "@/lib/authoritative-session";
import { env } from "@/lib/env";
import {
  boundedJsonBody,
  isSafeDisplayText,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "@/lib/http";
import {
  ensurePersonalKnowledgeScope,
  type PersonalKnowledgeProject,
} from "@/lib/knowledge/personal-scope";
import { parseEnvironmentKind } from "@/lib/knowledge/environment-kind";
import {
  databaseErrorCode,
  logKnowledgeMutationFailure,
} from "@/lib/workspace-server-log";

function positiveRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function parseProjects(value: unknown): PersonalKnowledgeProject[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const projects: PersonalKnowledgeProject[] = [];
  const projectIds = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const project = candidate as Record<string, unknown>;
    if (
      Object.keys(project).sort().join(",") !== "environments,id,name,revision"
      || typeof project.id !== "string"
      || !isUuid(project.id)
      || projectIds.has(project.id)
      || typeof project.name !== "string"
      || !isSafeDisplayText(project.name.trim(), 512)
      || !positiveRevision(project.revision)
      || !Array.isArray(project.environments)
      || project.environments.length < 1
      || project.environments.length > 4
    ) return null;
    const environmentIds = new Set<string>();
    const environmentKinds = new Set<string>();
    const environments: PersonalKnowledgeProject["environments"] = [];
    for (const candidateEnvironment of project.environments) {
      if (
        !candidateEnvironment
        || typeof candidateEnvironment !== "object"
        || Array.isArray(candidateEnvironment)
      ) return null;
      const environment = candidateEnvironment as Record<string, unknown>;
      // `{id, kind, revision}`, or the pre-kind `{id, name, riskClass, revision}` read as the kind.
      const kind = parseEnvironmentKind(environment, ["id", "revision"]);
      if (
        !kind
        || typeof environment.id !== "string"
        || !isUuid(environment.id)
        || environmentIds.has(environment.id)
        || environmentKinds.has(kind)
        || !positiveRevision(environment.revision)
      ) return null;
      environmentIds.add(environment.id);
      environmentKinds.add(kind);
      environments.push({ id: environment.id, kind, revision: environment.revision });
    }
    projectIds.add(project.id);
    projects.push({
      id: project.id,
      name: project.name.trim(),
      revision: project.revision,
      environments,
    });
  }
  return projects;
}

export async function POST(request: Request) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const session = await authoritativeSession(request);
  if (!session) return jsonError("Unauthorized", 401);
  const parsed = await boundedJsonBody(request, 256 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  const projects = body
    && Object.keys(body).join(",") === "projects"
    ? parseProjects(body.projects)
    : null;
  if (!projects) return jsonError("Invalid Personal Knowledge scope", 400);
  try {
    const scope = await ensurePersonalKnowledgeScope({
      userId: session.user.id,
      sessionId: session.session.id,
      projects,
    });
    return privateJson(scope);
  } catch (error) {
    logKnowledgeMutationFailure({
      operation: "personal_scope_sync",
      databaseCode: databaseErrorCode(error),
    });
    return jsonError("Personal Knowledge scope could not be prepared", 500);
  }
}
