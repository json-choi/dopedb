import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { utcDate, utcNow, uuidDefault } from "./values";

export const user = sqliteTable("user", {
  id: text("id").default(uuidDefault).primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: utcDate("created_at").notNull().default(utcNow),
  updatedAt: utcDate("updated_at").notNull().default(utcNow),
});

export const organization = sqliteTable("organization", {
  id: text("id").default(uuidDefault).primaryKey().notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: utcDate("created_at").notNull().default(utcNow),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    expiresAt: utcDate("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: utcDate("access_token_expires_at"),
    refreshTokenExpiresAt: utcDate("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    uniqueIndex("account_issuer_subject_idx").on(table.issuer, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: utcDate("expires_at").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    updatedAt: utcDate("updated_at").notNull().default(utcNow),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const member = sqliteTable(
  "member",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    revocationPendingAt: utcDate("revocation_pending_at"),
    revocationClaimedAt: utcDate("revocation_claimed_at"),
    revocationClaimId: text("revocation_claim_id"),
    createdAt: utcDate("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("member_organization_user_idx").on(table.organizationId, table.userId),
    // Makes a connection grant's tenant/member composite foreign key enforceable.
    unique("member_organization_id_idx").on(table.organizationId, table.id),
    index("member_user_idx").on(table.userId),
    check(
      "member_revocation_claim_consistent",
      sql`(${table.revocationClaimedAt} IS NULL AND ${table.revocationClaimId} IS NULL)
        OR (${table.revocationClaimedAt} IS NOT NULL
          AND ${table.revocationClaimId} IS NOT NULL
          AND ${table.revocationPendingAt} IS NOT NULL)`,
    ),
  ],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: utcDate("expires_at").notNull(),
    createdAt: utcDate("created_at").notNull().default(utcNow),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organization_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const deviceCode = sqliteTable(
  "device_code",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    deviceCode: text("device_code").notNull().unique(),
    userCode: text("user_code").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: utcDate("expires_at").notNull(),
    status: text("status").notNull(),
    lastPolledAt: utcDate("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [index("device_code_user_idx").on(table.userId)],
);

export const rateLimit = sqliteTable(
  "rate_limit",
  {
    id: text("id").default(uuidDefault).primaryKey().notNull(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (table) => [index("rate_limit_last_request_idx").on(table.lastRequest)],
);

// Deletion receipts intentionally outlive the organization row. They contain no
// workspace name, member list, provider identity, or payload; only the opaque id,
// actor attribution, retention deadline, and terminal outcome remain after purge.

export const authSchema = { user, organization, session, account, verification, member, invitation, deviceCode, rateLimit };
