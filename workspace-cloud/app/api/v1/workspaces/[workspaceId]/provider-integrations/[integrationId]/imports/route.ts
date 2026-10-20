// Receipt-only provider import. External provider identifiers are accepted only
// while discovering them; this endpoint consumes a session/member-bound opaque
// receipt through the one-statement import command.
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import { isEnvironmentKind } from "../../../../../../../../lib/knowledge/environment-kind";
import { importProviderReceipt } from "../../../../../../../../lib/provider-import-store";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { publicConnection } from "../../../../../../../../lib/workspace-connections";

type RouteContext = { params: Promise<{ workspaceId: string; integrationId: string }> };

function importName(value: unknown) {
  if (value === undefined) return "Managed database";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, integrationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(integrationId)) return jsonError("Invalid workspace or integration id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  const parsed = await boundedJsonBody(request, 2 * 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Provider import request is too large"
        : "Invalid provider import request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as {
    receipt?: unknown;
    idempotencyKey?: unknown;
    name?: unknown;
    environment?: unknown;
    productionApproved?: unknown;
  } | null;
  const name = importName(body?.name);
  // `environment` is the Project-environment kind the imported connection is labelled with;
  // Desktops that predate it omit the field and the connection stays unlabelled.
  const fields = ["receipt", "idempotencyKey", "name", "productionApproved"];
  const environment = body && Object.hasOwn(body, "environment") ? body.environment : null;
  if (
    !body
    || Object.keys(body).length !== fields.length + (Object.hasOwn(body, "environment") ? 1 : 0)
    || fields.some((field) => !Object.hasOwn(body, field))
    || (environment !== null && !isEnvironmentKind(environment))
    || typeof body.receipt !== "string" || !isUuid(body.receipt)
    || typeof body.idempotencyKey !== "string"
    || !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey)
    || typeof body.productionApproved !== "boolean"
    || !name
  ) {
    return jsonError("A discovery receipt, idempotency key, and valid name are required", 400);
  }
  const result = await importProviderReceipt({
    organizationId: workspaceId,
    integrationId,
    receiptId: body.receipt,
    idempotencyKey: body.idempotencyKey,
    name,
    environment,
    productionApproved: body.productionApproved,
    authority: {
      sessionId: authorization.session.session.id,
      userId: authorization.session.user.id,
      membershipId: authorization.membership.id,
      role: authorization.role,
    },
  });
  if (result.kind === "idempotency_conflict") {
    return jsonError("Import request conflicts with an existing idempotency key", 409);
  }
  if (result.kind === "resource_conflict") {
    return jsonError("Provider resource is already imported", 409);
  }
  if (result.kind !== "imported") {
    return jsonError("Discovery receipt is invalid, expired, or already used", 409);
  }
  return privateJson({
    connection: publicConnection(result.connection, authorization.role, authorization.accessMode),
  }, { status: 201 });
}
