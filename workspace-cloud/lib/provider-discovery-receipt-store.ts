import "server-only";

import { sql } from "drizzle-orm";
import { queryD1 } from "./d1/database";
import { utcNow } from "./d1/schema/values";
import { workspaceProviderDiscoveryReceipt } from "./d1/schema";

const DISCOVERY_RECEIPT_CLEANUP_LIMIT = 50;
const CONSUMED_RECEIPT_REPLAY_GRACE_MINUTES = 10;

/**
 * Scheduled bounded reclamation. Recently consumed rows are retained for a
 * short retry window so a lost import response can still replay by the exact
 * idempotency key; expired and older consumed receipts are safe to remove.
 */
export async function cleanupProviderDiscoveryReceipts(
  organizationId?: string,
): Promise<number> {
  const rows = await queryD1<{ id: string }>(sql`
    DELETE FROM ${workspaceProviderDiscoveryReceipt} WHERE id IN (
      SELECT receipt.id FROM ${workspaceProviderDiscoveryReceipt} receipt
      WHERE ((receipt.consumed_at IS NULL AND receipt.expires_at <= ${utcNow})
        OR receipt.consumed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now',
          '-' || ${CONSUMED_RECEIPT_REPLAY_GRACE_MINUTES} || ' minutes'))
        ${organizationId ? sql`AND receipt.organization_id = ${organizationId}` : sql``}
      ORDER BY COALESCE(receipt.consumed_at, receipt.expires_at), receipt.id
      LIMIT ${DISCOVERY_RECEIPT_CLEANUP_LIMIT}
    ) RETURNING id
  `);
  return rows.length;
}
