// Short-lived, single-use Desktop approval records; authorization codes are hashed.
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { session, user } from "./auth";
import { matches } from "./patterns";
import { utcDate, utcNow, uuidDefault } from "./values";

export const desktopAuthorizationCode = sqliteTable("desktop_authorization_code", {
  id: text("id").default(uuidDefault).primaryKey().notNull(),
  codeHash: text("code_hash").notNull().unique(),
  approvalHash: text("approval_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
  createdAt: utcDate("created_at").notNull().default(utcNow),
  expiresAt: utcDate("expires_at").notNull(),
  consumedAt: utcDate("consumed_at"),
}, (table) => [
  index("desktop_authorization_expiry_idx").on(table.expiresAt),
  check("desktop_authorization_code_hash", matches(table.codeHash, "^[0-9a-f]{64}$")),
  check("desktop_authorization_approval_hash", matches(table.approvalHash, "^[0-9a-f]{64}$")),
  check("desktop_authorization_client", sql`${table.clientId} = 'dopedb-desktop'`),
  check("desktop_authorization_challenge", sql`length(${table.codeChallenge}) = 43 AND ${table.codeChallenge} NOT GLOB '*[^A-Za-z0-9_-]*'`),
]);
