import { sql } from "drizzle-orm";
import { sqliteTable, text, check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";
import { matches } from "./patterns";
import { organization } from "./auth";
import { knowledgeSource } from "./sources";

export const knowledgeSourceEvent = sqliteTable(
  "knowledge_source_event",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id, {
      onDelete: "cascade",
    }),
    deliveryId: text("delivery_id").notNull(),
    eventKind: text("event_kind").notNull(),
    beforeCommitSha: text("before_commit_sha"),
    afterCommitSha: text("after_commit_sha"),
    state: text("state").notNull().default("consumed"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    consumedAt: utcDate("consumed_at"),
  },
  (table) => [
    uniqueIndex("knowledge_source_event_delivery_idx").on(table.deliveryId, table.sourceId),
    index("knowledge_source_event_source_idx").on(
      table.organizationId,
      table.sourceId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceId],
      foreignColumns: [knowledgeSource.organizationId, knowledgeSource.id],
      name: "knowledge_source_event_org_source_fk",
    }).onDelete("cascade"),
    check(
      "knowledge_source_event_kind",
      sql`${table.eventKind} IN ('push', 'installation', 'repository')`,
    ),
    check(
      "knowledge_source_event_state",
      sql`${table.state} IN ('consumed', 'failed')`,
    ),
    check(
      "knowledge_source_event_commits",
      sql`(${table.beforeCommitSha} IS NULL OR ${matches(sql`${table.beforeCommitSha}`, "^[0-9a-f]{40}$")})
        AND (${table.afterCommitSha} IS NULL OR ${matches(sql`${table.afterCommitSha}`, "^[0-9a-f]{40}$")})`,
    ),
  ],
);
