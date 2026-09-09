// Historical PostgreSQL migration/harness schema; the application uses D1.
import { check, index, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceControl } from "./namespace";
import { knowledgeProjectEnvironment } from "./projects";
import { knowledgeGraphRevision } from "./graphs";
import { organization, member } from "./auth";

export const knowledgeMappingProposal = workspaceControl.table(
  "knowledge_mapping_proposal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: uuid("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    graphRevisionId: uuid("graph_revision_id").notNull().references(
      () => knowledgeGraphRevision.id,
      { onDelete: "cascade" },
    ),
    schemaFingerprint: text("schema_fingerprint").notNull(),
    fromNodeId: text("from_node_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetIdentity: text("target_identity").notNull(),
    state: text("state").notNull().default("proposed"),
    proposedByMemberId: text("proposed_by_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    decidedByMemberId: text("decided_by_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_mapping_review_idx").on(
      table.organizationId,
      table.projectEnvironmentId,
      table.state,
      table.proposedAt,
    ),
    check(
      "knowledge_mapping_hashes",
      sql`${table.schemaFingerprint} ~ '^[0-9a-f]{64}$'
        AND ${table.fromNodeId} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "knowledge_mapping_state",
      sql`${table.state} IN ('proposed', 'approved', 'rejected', 'stale')`,
    ),
    check(
      "knowledge_mapping_target_length",
      sql`char_length(${table.targetKind}) BETWEEN 1 AND 128
        AND char_length(${table.targetIdentity}) BETWEEN 1 AND 2048`,
    ),
  ],
);

// Analysis Articles share sanitized HTML, one exact query, immutable authority
// pins, run metadata, and receipts. Database traffic and result rows remain on
// Desktop. Public publications contain only an explicitly approved HTML snapshot.
