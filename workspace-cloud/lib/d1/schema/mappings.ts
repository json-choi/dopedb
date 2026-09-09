import { sql } from "drizzle-orm";
import { sqliteTable, text, check, index, primaryKey } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization, member } from "./auth";
import { knowledgeProjectEnvironment } from "./projects";
import { knowledgeGraphRevision } from "./graphs";

export const knowledgeMappingProposal = sqliteTable(
  "knowledge_mapping_proposal",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectEnvironmentId: text("project_environment_id").notNull().references(
      () => knowledgeProjectEnvironment.id,
      { onDelete: "cascade" },
    ),
    graphRevisionId: text("graph_revision_id").notNull().references(
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
    proposedAt: utcDate("proposed_at").notNull().default(utcNow),
    decidedAt: utcDate("decided_at"),
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
      sql`${matches(sql`${table.schemaFingerprint}`, "^[0-9a-f]{64}$")}
        AND ${matches(sql`${table.fromNodeId}`, "^[0-9a-f]{64}$")}`,
    ),
    check(
      "knowledge_mapping_state",
      sql`${table.state} IN ('proposed', 'approved', 'rejected', 'stale')`,
    ),
    check(
      "knowledge_mapping_target_length",
      sql`length(${table.targetKind}) BETWEEN 1 AND 128
        AND length(${table.targetIdentity}) BETWEEN 1 AND 2048`,
    ),
  ],
);

// Analysis Articles share sanitized HTML, one exact query, immutable authority
// pins, run metadata, and receipts. Database traffic and result rows remain on
// Desktop. Public publications contain only an explicitly approved HTML snapshot.
