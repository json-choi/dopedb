import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { utcNow, uuidDefault } from "./d1/schema/values";
import { providerMutationAuthoritySql, type ProviderMutationAuthority } from "./provider-integrations/authority";

export async function finalizeProviderIntegrationDisconnect(input: {
  authority: ProviderMutationAuthority; integrationId: string; provider: string; generation: bigint;
  claimId: string; scrubbedCredential: string; revokedLeases: number;
}) {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_provider_integration integration
      WHERE integration.id = ${input.integrationId} AND integration.organization_id = ${input.authority.organizationId}
        AND integration.provider = ${input.provider} AND integration.status IN ('active', 'reconnect_required') AND integration.revoked_at IS NULL
        AND integration.revocation_claim_id = ${input.claimId} AND integration.generation = ${input.generation}
        AND integration.disconnect_generation = ${input.generation} AND integration.disconnect_phase = 'provider_revoked'
        AND ${providerMutationAuthoritySql({ ...input.authority, requireManager: true,
          integration: { id: input.integrationId, provider: input.provider, generation: input.generation, claimId: input.claimId } })}
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.authority.organizationId}
          AND integration_id = ${input.integrationId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`UPDATE workspace_provider_integration SET status = 'revoked', encrypted_credential = ${input.scrubbedCredential},
          credential_expires_at = NULL, granted_scope = NULL, revoked_at = ${utcNow}, generation = generation + 1,
          updated_at = ${utcNow}, revocation_pending_at = NULL, revocation_claimed_at = NULL, revocation_claim_id = NULL,
          disconnect_phase = 'finalized' WHERE id = ${input.integrationId} AND EXISTS (${scope}) RETURNING id`,
      sql`UPDATE workspace_connection SET credential_mode = 'member_local', provider_integration_id = NULL,
          provider_resource = NULL, provider_resource_id = NULL, revision = revision + 1, updated_at = ${utcNow}
        WHERE organization_id = ${input.authority.organizationId} AND provider_integration_id = ${input.integrationId}
          AND deleted_at IS NULL AND EXISTS (${scope})`,
      sql`DELETE FROM workspace_provider_principal_claim WHERE organization_id = ${input.authority.organizationId}
        AND integration_id = ${input.integrationId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.authority.organizationId}, ${input.authority.userId}, 'provider.disconnect', 'provider_integration', ${input.integrationId},
          json_object('provider', ${input.provider}, 'revokedLeases', ${input.revokedLeases}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.matched;
}
