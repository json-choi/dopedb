// Administrator-device receipt for a claimed principal: compare-and-swap from the claimed
// state to ready / failed / dropped, binding the server fingerprint on first success.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { parseDirectReceiptRequest } from "@/lib/control-plane-contracts";
import { authorizeDirectAdmin, directRateLimited } from "@/lib/workspace-direct-access-http";
import { settleDirectReceipt } from "@/lib/workspace-direct-access-store";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const admin = await authorizeDirectAdmin(request, workspaceId, connectionId);
  if (!admin.ok) return admin.response;
  const limited = await directRateLimited(
    "direct-receipt", `${workspaceId}:${admin.authority.userId}:${connectionId}`, 240);
  if (limited) return limited;
  const body = await boundedJsonBody(request, 4 * 1_024);
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large" ? "Receipt is too large" : "Invalid receipt",
      body.reason === "too_large" ? 413 : 400,
    );
  }
  let receipt;
  try {
    receipt = parseDirectReceiptRequest(body.value);
  } catch {
    return jsonError("Invalid receipt", 400);
  }
  const settled = await settleDirectReceipt({
    organizationId: workspaceId, connectionId, actorUserId: admin.authority.userId, receipt,
  });
  if (!settled) {
    return jsonError("Receipt does not match the claimed principal", 409, "direct_receipt_rejected");
  }
  return privateJson({ principalId: receipt.principalId, state: receipt.to, appliedLevel: receipt.appliedLevel });
}
