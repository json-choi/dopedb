// Read-only Neon policy inspection and approval-gated, idempotent hardening.
// Browser callers receive codes and redacted descriptions; SQL and credentials
// remain inside this server-only module.
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

import {
  issueNeonLease,
  NeonLeaseCleanupRequiredError,
  neonRoleForLease,
  openNeonBootstrapTarget,
  revokeNeonLease,
  validateNeonResource,
} from "./neon";
import {
  NEON_ROLE_CONNECTION_LIMIT,
  neonDatabaseName,
  neonPolicyRoleIdentity,
  neonSchemaName,
  type NeonCredential,
  type NeonResource,
} from "./neon-core";
import { ProviderRequestError } from "./provider-types";

const POLICY_VERSION = 1 as const;

class NeonSmokeCleanupRequiredError extends Error {
  constructor(
    readonly role: string | null,
    readonly objectName: string | null = null,
  ) {
    super("Neon smoke resource cleanup failed");
  }
}

export class NeonBootstrapRepairRequiredError extends ProviderRequestError {
  constructor(
    readonly repairCode: string,
    readonly providerAuditId: string,
    readonly temporaryRole: string | null,
    readonly temporaryObject: string | null,
  ) {
    super("neon", "Neon bootstrap needs manual repair", 503);
    this.name = "NeonBootstrapRepairRequiredError";
  }
}

export type NeonEnvironmentClassification = "development" | "production";

export type NeonBootstrapFinding = Readonly<{
  code: string;
  level: "blocker" | "change" | "verified";
  description: string;
  target: string;
  before: string;
  after: string;
  requiresApproval: "publicAcl" | null;
  rollbackAvailable: boolean;
}>;

export type NeonBootstrapReport = Readonly<{
  version: typeof POLICY_VERSION;
  status: "blocked" | "approvalRequired" | "readyToApply";
  planHash: string;
  providerAuditId: string;
  production: boolean;
  target: Readonly<{
    project: string;
    branch: string;
    databaseId: string;
    database: string;
    schemas: readonly string[];
  }>;
  findings: readonly NeonBootstrapFinding[];
  requiresPublicAclApproval: boolean;
  requiresProductionApproval: boolean;
  canRollback: boolean;
}>;

type BootstrapAction = {
  finding: NeonBootstrapFinding;
  apply: string[];
  rollback: string[];
};

type BootstrapInspection = {
  report: NeonBootstrapReport;
  readyHash: string;
  actions: BootstrapAction[];
  credential: NeonCredential;
  resource: NeonResource;
};

function identifier(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Invalid Neon bootstrap plan");
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function planHash(value: unknown) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function finding(input: Omit<NeonBootstrapFinding, "rollbackAvailable"> & {
  rollbackAvailable?: boolean;
}): NeonBootstrapFinding {
  return { ...input, rollbackAvailable: input.rollbackAvailable === true };
}

function blocker(
  code: string,
  description: string,
  target: string,
): NeonBootstrapFinding {
  return finding({
    code,
    level: "blocker",
    description,
    target,
    before: "검증 실패",
    after: "전용 개발 브랜치 또는 DBA 조치 필요",
    requiresApproval: null,
  });
}

function classification(
  providerValue: true | false | "unknown" | undefined,
  requested: NeonEnvironmentClassification | null,
) {
  if (providerValue === true) {
    if (requested === "development") {
      throw new ProviderRequestError(
        "neon",
        "A protected Neon branch cannot be classified as development",
        409,
      );
    }
    return true;
  }
  if (providerValue === false) return requested === "production";
  if (!requested) {
    throw new ProviderRequestError(
      "neon",
      "Classify this default or unclassified Neon branch before continuing",
      409,
    );
  }
  return requested === "production";
}

export async function inspectNeonBootstrap(input: {
  credential: NeonCredential;
  resource: NeonResource;
  environment: NeonEnvironmentClassification | null;
}): Promise<BootstrapInspection> {
  const target = await openNeonBootstrapTarget(input.credential, input.resource);
  const production = classification(target.branch.production, input.environment);
  const sql = target.sql;
  const actions: BootstrapAction[] = [];
  const findings: NeonBootstrapFinding[] = [];
  const addAction = (action: BootstrapAction) => {
    actions.push(action);
    findings.push(action.finding);
  };

  if (target.branch.ready !== true) {
    findings.push(blocker(
      "NEON_BRANCH_NOT_READY",
      "선택한 Neon 브랜치의 compute가 Ready 상태가 아닙니다.",
      `${target.resource.project} / ${target.resource.branch}`,
    ));
  }

  const identityRows = await sql.query(
    "SELECT current_user AS current_user, "
      + "pg_get_userbyid(d.datdba) = current_user AS owns_database, "
      + "r.rolcreaterole AS can_create_role "
      + "FROM pg_database d JOIN pg_roles r ON r.rolname = current_user "
      + "WHERE d.datname = current_database()",
  );
  const identity = identityRows[0];
  if (
    identityRows.length !== 1
    || identity?.current_user !== target.owner
    || identity?.owns_database !== true
  ) {
    findings.push(blocker(
      "NEON_DATABASE_OWNER_MISMATCH",
      "Neon owner session이 선택한 데이터베이스 소유자와 일치하지 않습니다.",
      target.resource.database,
    ));
  }
  if (identity?.can_create_role !== true) {
    findings.push(blocker(
      "NEON_ROLE_CREATE_UNAVAILABLE",
      "데이터베이스 소유자가 최소권한 lease role을 만들 수 없습니다.",
      target.resource.database,
    ));
  }

  const delegationRows = await sql.query(
    "SELECT has_database_privilege(current_database(), "
      + "'CONNECT WITH GRANT OPTION') AS grantable",
  );
  if (delegationRows[0]?.grantable !== true) {
    findings.push(blocker(
      "NEON_DATABASE_CONNECT_NOT_GRANTABLE",
      "데이터베이스 CONNECT 권한을 단기 role에 위임할 수 없습니다.",
      target.resource.database,
    ));
  }

  const allDatabaseRows = await sql.query(
    "SELECT d.datname AS database_name FROM pg_database d "
      + "WHERE d.datallowconn AND NOT d.datistemplate ORDER BY d.datname",
  );
  const allDatabases = allDatabaseRows
    .map((row) => row.database_name)
    .filter((value): value is string => typeof value === "string" && neonDatabaseName(value));
  if (allDatabases.length !== allDatabaseRows.length) {
    findings.push(blocker(
      "NEON_DATABASE_INVENTORY_INVALID",
      "데이터베이스 목록을 안전하게 고정하지 못했습니다.",
      target.resource.database,
    ));
  }

  const publicDatabaseRows = await sql.query(
    "SELECT acl.privilege_type AS privilege_type FROM pg_database d "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl "
      + "WHERE d.datname = current_database() AND acl.grantee = 0 "
      + "AND acl.privilege_type = ANY(ARRAY['CREATE', 'TEMPORARY']::text[]) "
      + "ORDER BY acl.privilege_type",
  );
  const publicDatabasePrivileges = publicDatabaseRows
    .map((row) => row.privilege_type)
    .filter((value): value is string => value === "CREATE" || value === "TEMPORARY");
  for (const privilege of publicDatabasePrivileges) {
    const database = identifier(target.resource.database);
    addAction({
      finding: finding({
        code: `NEON_REVOKE_PUBLIC_DATABASE_${privilege}`,
        level: "change",
        description: `PUBLIC의 데이터베이스 ${privilege} 권한을 회수합니다.`,
        target: target.resource.database,
        before: `PUBLIC ${privilege}`,
        after: `PUBLIC ${privilege} 없음`,
        requiresApproval: "publicAcl",
        rollbackAvailable: true,
      }),
      apply: [`REVOKE ${privilege} ON DATABASE ${database} FROM PUBLIC`],
      rollback: [`GRANT ${privilege} ON DATABASE ${database} TO PUBLIC`],
    });
  }

  const reachableDatabaseRows = await sql.query(
    "SELECT d.datname AS database_name, "
      + "has_database_privilege(d.oid, 'CONNECT WITH GRANT OPTION') AS grantable "
      + "FROM pg_database d "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl "
      + "WHERE d.datallowconn AND NOT d.datistemplate "
      + "AND d.datname <> current_database() AND acl.grantee = 0 "
      + "AND acl.privilege_type = 'CONNECT' ORDER BY d.datname",
  );
  for (const row of reachableDatabaseRows) {
    const name = row.database_name;
    if (typeof name !== "string" || !neonDatabaseName(name)) {
      findings.push(blocker(
        "NEON_OTHER_DATABASE_INVALID",
        "다른 데이터베이스의 공개 접근 대상을 안전하게 식별하지 못했습니다.",
        "같은 Neon 브랜치",
      ));
      continue;
    }
    if (row.grantable !== true) {
      findings.push(blocker(
        "NEON_OTHER_DATABASE_CONNECT_NOT_GRANTABLE",
        "다른 데이터베이스의 PUBLIC CONNECT를 현재 owner로 회수할 수 없습니다.",
        name,
      ));
      continue;
    }
    const database = identifier(name);
    addAction({
      finding: finding({
        code: "NEON_REVOKE_OTHER_DATABASE_PUBLIC_CONNECT",
        level: "change",
        description: "단기 role이 다른 데이터베이스로 이동하지 못하도록 PUBLIC CONNECT를 회수합니다.",
        target: name,
        before: "PUBLIC CONNECT",
        after: "PUBLIC CONNECT 없음",
        requiresApproval: "publicAcl",
        rollbackAvailable: true,
      }),
      apply: [`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`],
      rollback: [`GRANT CONNECT ON DATABASE ${database} TO PUBLIC`],
    });
  }

  const schemaRows = await sql.query(
    "SELECT n.nspname AS schema_name, "
      + "has_schema_privilege(n.oid, 'USAGE WITH GRANT OPTION') AS grantable, "
      + "has_schema_privilege(n.oid, 'CREATE') AS can_create_probe "
      + "FROM pg_namespace n WHERE n.nspname = ANY($1::text[]) ORDER BY n.nspname",
    [target.resource.schemas],
  );
  if (
    schemaRows.length !== target.resource.schemas.length
    || schemaRows.some((row) => row.grantable !== true || row.can_create_probe !== true)
  ) {
    findings.push(blocker(
      "NEON_SCHEMA_NOT_GRANTABLE",
      "허용 schema가 없거나 단기 role 위임·쓰기 probe 생성 경계를 만족하지 않습니다.",
      target.resource.schemas.join(", "),
    ));
  }

  const publicSchemaCreateRows = await sql.query(
    "SELECT n.nspname AS schema_name FROM pg_namespace n "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl "
      + "WHERE n.nspname = ANY($1::text[]) AND acl.grantee = 0 "
      + "AND acl.privilege_type = 'CREATE' ORDER BY n.nspname",
    [target.resource.schemas],
  );
  for (const row of publicSchemaCreateRows) {
    const name = row.schema_name;
    if (typeof name !== "string" || !neonSchemaName(name)) {
      findings.push(blocker(
        "NEON_SCHEMA_INVENTORY_INVALID",
        "공개 schema 권한 대상을 안전하게 식별하지 못했습니다.",
        target.resource.database,
      ));
      continue;
    }
    const schema = identifier(name);
    addAction({
      finding: finding({
        code: "NEON_REVOKE_PUBLIC_SCHEMA_CREATE",
        level: "change",
        description: "PUBLIC이 관리 schema에 객체를 만들지 못하도록 CREATE를 회수합니다.",
        target: name,
        before: "PUBLIC CREATE",
        after: "PUBLIC CREATE 없음",
        requiresApproval: "publicAcl",
        rollbackAvailable: true,
      }),
      apply: [`REVOKE CREATE ON SCHEMA ${schema} FROM PUBLIC`],
      rollback: [`GRANT CREATE ON SCHEMA ${schema} TO PUBLIC`],
    });
  }

  const marker = neonPolicyRoleIdentity(target.resource);
  const unsafeSchemaRows = await sql.query(
    "SELECT n.nspname AS schema_name FROM pg_namespace n "
      + "WHERE n.nspname = ANY($1::text[]) AND ("
      + "(n.nspowner <> current_user::regrole "
      + "AND NOT EXISTS (SELECT 1 FROM pg_roles policy_owner "
      + "WHERE policy_owner.rolname = $2 AND policy_owner.oid = n.nspowner) "
      + "AND NOT EXISTS ("
      + "SELECT 1 FROM pg_roles owner_role WHERE owner_role.oid = n.nspowner "
      + "AND owner_role.rolname = 'pg_database_owner')) OR EXISTS ("
      + "SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl "
      + "WHERE acl.privilege_type = 'CREATE' "
      + "AND acl.grantee <> 0 "
      + "AND acl.grantee <> current_user::regrole::oid "
      + "AND NOT EXISTS (SELECT 1 FROM pg_roles policy_owner "
      + "WHERE policy_owner.rolname = $2 AND policy_owner.oid = acl.grantee) "
      + "AND NOT EXISTS (SELECT 1 FROM pg_roles creator_role "
      + "WHERE creator_role.oid = acl.grantee "
      + "AND creator_role.rolname = 'pg_database_owner'))) LIMIT 1",
    [target.resource.schemas, marker.name],
  );
  const foreignObjectRows = await sql.query(
    "SELECT 1 AS unsafe FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
      + "WHERE n.nspname = ANY($1::text[]) "
      + "AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') "
      + "AND c.relowner <> current_user::regrole "
      + "AND NOT EXISTS (SELECT 1 FROM pg_roles policy_owner "
      + "WHERE policy_owner.rolname = $2 AND policy_owner.oid = c.relowner) LIMIT 1",
    [target.resource.schemas, marker.name],
  );
  if (unsafeSchemaRows.length > 0 || foreignObjectRows.length > 0) {
    findings.push(blocker(
      "NEON_SCHEMA_OWNERSHIP_UNSAFE",
      "관리 schema의 생성자 또는 객체 소유자가 단일 owner 경계 밖에 있습니다.",
      target.resource.schemas.join(", "),
    ));
  }

  const outsidePublicRows = await sql.query(
    "SELECT 1 AS unsafe FROM pg_namespace n "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl "
      + "WHERE lower(n.nspname) <> 'information_schema' AND lower(n.nspname) !~ '^pg_' "
      + "AND NOT (n.nspname = ANY($1::text[])) AND acl.grantee = 0 "
      + "AND acl.privilege_type = ANY(ARRAY['USAGE', 'CREATE']::text[]) LIMIT 1",
    [target.resource.schemas],
  );
  if (outsidePublicRows.length > 0) {
    findings.push(blocker(
      "NEON_OUTSIDE_SCHEMA_PUBLIC_ACCESS",
      "allowlist 밖 schema에 PUBLIC USAGE 또는 CREATE가 남아 있습니다.",
      "allowlist 밖 schema",
    ));
  }

  const unsafeObjectRows = await sql.query(
    "SELECT 1 AS unsafe FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, "
      + "acldefault(CASE WHEN c.relkind = 'S' THEN 's'::\"char\" ELSE 'r'::\"char\" END, c.relowner))) acl "
      + "WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f','S') "
      + "AND acl.grantee = 0 AND acl.privilege_type = ANY("
      + "ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::text[]) LIMIT 1",
    [target.resource.schemas],
  );
  if (unsafeObjectRows.length > 0) {
    findings.push(blocker(
      "NEON_PUBLIC_OBJECT_WRITE_ACCESS",
      "관리 schema의 객체에 PUBLIC 쓰기 권한이 있습니다.",
      target.resource.schemas.join(", "),
    ));
  }

  const ungrantableRows = await sql.query(
    "SELECT 1 AS unsafe FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
      + "WHERE n.nspname = ANY($1::text[]) AND ("
      + "(c.relkind IN ('r','p','v','m','f') "
      + "AND (NOT has_table_privilege(c.oid, 'SELECT WITH GRANT OPTION') "
      + "OR NOT has_table_privilege(c.oid, 'INSERT WITH GRANT OPTION') "
      + "OR NOT has_table_privilege(c.oid, 'UPDATE WITH GRANT OPTION') "
      + "OR NOT has_table_privilege(c.oid, 'DELETE WITH GRANT OPTION'))) OR "
      + "(c.relkind = 'S' AND (NOT has_sequence_privilege(c.oid, 'SELECT WITH GRANT OPTION') "
      + "OR NOT has_sequence_privilege(c.oid, 'USAGE WITH GRANT OPTION') "
      + "OR NOT has_sequence_privilege(c.oid, 'UPDATE WITH GRANT OPTION')))) LIMIT 1",
    [target.resource.schemas],
  );
  if (ungrantableRows.length > 0) {
    findings.push(blocker(
      "NEON_OBJECT_NOT_GRANTABLE",
      "현재 객체의 읽기·쓰기 권한을 최소권한 role에 위임할 수 없습니다.",
      target.resource.schemas.join(", "),
    ));
  }

  const securityDefinerRows = await sql.query(
    "SELECT 1 AS unsafe FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
      + "CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl "
      + "WHERE n.nspname = ANY($1::text[]) AND p.prosecdef "
      + "AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE' LIMIT 1",
    [target.resource.schemas],
  );
  if (securityDefinerRows.length > 0) {
    findings.push(blocker(
      "NEON_PUBLIC_SECURITY_DEFINER",
      "PUBLIC이 실행할 수 있는 SECURITY DEFINER 함수가 있습니다.",
      target.resource.schemas.join(", "),
    ));
  }

  const markerRows = await sql.query(
    "SELECT r.rolcanlogin AS can_login, r.rolsuper AS superuser, "
      + "r.rolinherit AS inherits, r.rolcreaterole AS create_role, "
      + "r.rolcreatedb AS create_database, "
      + "r.rolreplication AS replication, r.rolbypassrls AS bypass_rls, "
      + "shobj_description(r.oid, 'pg_authid') AS marker "
      + "FROM pg_roles r WHERE r.rolname = $1",
    [marker.name],
  );
  if (markerRows.length === 0) {
    addAction({
      finding: finding({
        code: "NEON_CREATE_OWNERSHIP_MARKER",
        level: "change",
        description: "DopeDB가 만든 정책 경계만 이후 복구 대상으로 식별하도록 NOLOGIN marker를 만듭니다.",
        target: marker.name,
        before: "marker 없음",
        after: "NOLOGIN 최소권한 marker",
        requiresApproval: null,
        rollbackAvailable: true,
      }),
      apply: [
        `CREATE ROLE ${marker.name} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        `COMMENT ON ROLE ${marker.name} IS '${marker.comment}'`,
      ],
      rollback: [`DROP ROLE ${marker.name}`],
    });
  } else {
    const row = markerRows[0];
    if (
      markerRows.length !== 1
      || row?.can_login !== false
      || row?.superuser !== false
      || row?.inherits !== true
      || row?.create_role !== false
      || row?.create_database !== false
      || row?.replication !== false
      || row?.bypass_rls !== false
      || row?.marker !== marker.comment
    ) {
      findings.push(blocker(
        "NEON_OWNERSHIP_MARKER_DRIFT",
        "기존 DopeDB marker가 예상 정책과 달라 자동으로 인수하지 않습니다.",
        marker.name,
      ));
    } else {
      const [version] = await sql.query(
        "SELECT current_setting('server_version_num')::integer AS version",
      );
      const membershipOptionsSupported = Number(version?.version) >= 160_000;
      const pre16MembershipRows = membershipOptionsSupported
        ? []
        : await sql.query(
          "SELECT count(*)::integer AS member_count FROM pg_auth_members membership "
            + "JOIN pg_roles granted ON granted.oid = membership.roleid "
            + "WHERE granted.rolname = $1",
          [marker.name],
        );
      const unexpectedMembers = membershipOptionsSupported
        ? await sql.query(
          "SELECT 1 AS unexpected FROM pg_auth_members membership "
            + "JOIN pg_roles granted ON granted.oid = membership.roleid "
            + "JOIN pg_roles member_role ON member_role.oid = membership.member "
            + "WHERE granted.rolname = $1 AND member_role.rolname <> current_user LIMIT 1",
          [marker.name],
        )
        : [];
      const ownerMembershipRows = membershipOptionsSupported
        ? await sql.query(
          "SELECT count(*)::integer AS grant_count, "
            + "COALESCE(bool_or(membership.admin_option), FALSE) AS admin_option, "
            + "COALESCE(bool_or(membership.inherit_option), FALSE) AS inherit_option, "
            + "COALESCE(bool_or(membership.set_option), FALSE) AS set_option "
            + "FROM pg_auth_members membership "
            + "JOIN pg_roles granted ON granted.oid = membership.roleid "
            + "JOIN pg_roles member_role ON member_role.oid = membership.member "
            + "WHERE granted.rolname = $1 AND member_role.rolname = current_user",
          [marker.name],
        )
        : [];
      const membership = ownerMembershipRows[0];
      const grantCount = Number(membership?.grant_count ?? 0);
      const inactive = membershipOptionsSupported
        ? grantCount === 0 && unexpectedMembers.length === 0
        : Number(pre16MembershipRows[0]?.member_count ?? 0) === 0;
      const active = membershipOptionsSupported
        && unexpectedMembers.length === 0
        && ownerMembershipRows.length === 1
        && grantCount >= 1
        && grantCount <= 2
        && membership?.admin_option === true
        && membership?.inherit_option === true
        && membership?.set_option === true;
      if (!inactive && !active) {
        findings.push(blocker(
          "NEON_OWNERSHIP_MARKER_MEMBERSHIP_DRIFT",
          "DopeDB 정책 owner의 구성원 경계가 예상 상태와 다릅니다.",
          marker.name,
        ));
      }
    }
  }

  const driftedLeaseRoleRows = await sql.query(
    "SELECT r.rolname AS role_name FROM pg_roles r "
      + "WHERE r.rolname ~ '^dopedb_[a-z0-9]{1,8}_[a-z0-9]{1,32}$' "
      + "AND r.rolname !~ '^dopedb_policy_[0-9a-f]{16}$' "
      + "AND r.rolname <> $1 AND (r.rolsuper OR NOT r.rolinherit "
      + "OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls "
      + "OR r.rolvaliduntil IS NULL OR r.rolconnlimit <> $2 "
      + "OR (NOT r.rolcanlogin AND r.rolvaliduntil > now()) "
      + "OR EXISTS (SELECT 1 FROM pg_auth_members membership "
      + "WHERE membership.member = r.oid) "
      + "OR EXISTS (SELECT 1 FROM pg_auth_members membership "
      + "WHERE membership.roleid = r.oid)) LIMIT 1",
    [marker.name, NEON_ROLE_CONNECTION_LIMIT],
  );
  if (driftedLeaseRoleRows.length > 0) {
    findings.push(blocker(
      "NEON_LEASE_ROLE_DRIFT",
      "기존 DopeDB 형식 role의 로그인·만료·권한 경계가 예상 정책과 다릅니다.",
      "기존 단기 role",
    ));
  }

  const activeLeaseRoleRows = await sql.query(
    "SELECT 1 AS active FROM pg_roles r "
      + "WHERE r.rolname ~ '^dopedb_[a-z0-9]{1,8}_[a-z0-9]{1,32}$' "
      + "AND r.rolname !~ '^dopedb_policy_[0-9a-f]{16}$' "
      + "AND r.rolcanlogin "
      + "AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil > now()) LIMIT 1",
  );
  if (activeLeaseRoleRows.length > 0) {
    findings.push(blocker(
      "NEON_ACTIVE_LEASE_ROLE_PRESENT",
      "활성 DopeDB 단기 role이 남아 있어 다른 branch의 자격증명인지 구분할 수 없습니다.",
      "기존 단기 role",
    ));
  }

  if (!findings.some((item) => item.level === "blocker")) {
    findings.push(finding({
      code: "NEON_READ_WRITE_SMOKE_PLANNED",
      level: "change",
      description: "단기 read/write role을 실제 연결해 허용·거부 경계를 검증합니다.",
      target: target.resource.schemas[0],
      before: "실행 전 검증 없음",
      after: "read 성공·write DML 성공·DDL/role 관리 거부·probe 제거",
      requiresApproval: null,
      rollbackAvailable: true,
    }));
  }

  if (!findings.some((item) => item.level === "blocker") && actions.length === 0) {
    findings.push(finding({
      code: "NEON_POLICY_ALREADY_READY",
      level: "verified",
      description: "현재 ACL과 ownership marker가 DopeDB 읽기 경계를 만족합니다.",
      target: target.resource.database,
      before: "정책 충족",
      after: "변경 없음",
      requiresApproval: null,
    }));
  }

  const hashBase = {
    version: POLICY_VERSION,
    providerAuditId: target.providerAuditId,
    project: target.resource.project,
    branch: target.resource.branch,
    databaseId: target.resource.databaseId,
    database: target.resource.database,
    schemas: [...target.resource.schemas].sort(),
    production,
    databases: [...allDatabases].sort(),
    marker: marker.name,
    managedAccess: ["read", "write"],
  };
  const hasBlocker = findings.some((item) => item.level === "blocker");
  const requiresPublicAclApproval = actions.some(
    (action) => action.finding.requiresApproval === "publicAcl",
  );
  const readyHash = planHash({ ...hashBase, state: "ready" });
  const hash = !hasBlocker && actions.length === 0
    ? readyHash
    : planHash({
        ...hashBase,
        state: "preflight",
        findings,
        actions,
      });
  return {
    report: {
      version: POLICY_VERSION,
      status: hasBlocker
        ? "blocked"
        : requiresPublicAclApproval
          ? "approvalRequired"
          : "readyToApply",
      planHash: hash,
      providerAuditId: target.providerAuditId,
      production,
      target: {
        project: target.resource.project,
        branch: target.resource.branch,
        databaseId: target.resource.databaseId,
        database: target.resource.database,
        schemas: [...target.resource.schemas],
      },
      findings,
      requiresPublicAclApproval,
      requiresProductionApproval: production,
      canRollback: findings
        .filter((item) => item.level === "change")
        .every((item) => item.rollbackAvailable),
    },
    readyHash,
    actions,
    credential: input.credential,
    resource: target.resource,
  };
}

async function smokeReadCredential(input: {
  credential: NeonCredential;
  resource: NeonResource;
  production: boolean;
}) {
  const role = neonRoleForLease("bootstrap", randomUUID());
  const lease = await issueNeonLease({
    credential: input.credential,
    resource: input.resource,
    accessMode: "read",
    production: input.production,
    role,
  });
  try {
    const url = new URL(`postgresql://${lease.host}`);
    url.username = lease.username;
    url.password = lease.password;
    url.pathname = `/${encodeURIComponent(lease.database)}`;
    url.searchParams.set("sslmode", "verify-full");
    const client = neon(url.toString(), {
      fetchOptions: { signal: AbortSignal.timeout(15_000) },
    });
    const positive = await client.query("SELECT 1 AS ok");
    if (positive.length !== 1 || Number(positive[0]?.ok) !== 1) {
      throw new Error("positive read smoke failed");
    }
    let writeDenied = false;
    try {
      await client.query("CREATE TEMP TABLE dopedb_bootstrap_write_probe(id integer)");
    } catch {
      writeDenied = true;
    }
    if (!writeDenied) throw new Error("negative write smoke failed");
  } finally {
    try {
      await revokeNeonLease(input.credential, input.resource, role);
    } catch {
      throw new NeonSmokeCleanupRequiredError(role);
    }
  }
}

async function smokeWriteCredential(input: {
  credential: NeonCredential;
  resource: NeonResource;
  production: boolean;
}) {
  const target = await openNeonBootstrapTarget(input.credential, input.resource);
  const schemaName = target.resource.schemas[0];
  if (!schemaName || !neonSchemaName(schemaName)) {
    throw new ProviderRequestError("neon", "Neon write smoke schema is invalid", 409);
  }
  const tableName = `dopedb_write_probe_${randomUUID().replaceAll("-", "")}`;
  const qualifiedTable = `${identifier(schemaName)}.${identifier(tableName)}`;
  const role = neonRoleForLease("bootstrap", randomUUID());
  let probeCreated = false;
  let leaseIssued = false;
  let failure: unknown = null;

  try {
    await target.sql.query(
      `CREATE TABLE ${qualifiedTable} (id integer PRIMARY KEY, value integer NOT NULL)`,
    );
    probeCreated = true;
    const lease = await issueNeonLease({
      credential: input.credential,
      resource: target.resource,
      accessMode: "write",
      production: input.production,
      role,
    });
    leaseIssued = true;
    const url = new URL(`postgresql://${lease.host}`);
    url.username = lease.username;
    url.password = lease.password;
    url.pathname = `/${encodeURIComponent(lease.database)}`;
    url.searchParams.set("sslmode", "verify-full");
    const client = neon(url.toString(), {
      fetchOptions: { signal: AbortSignal.timeout(15_000) },
    });
    const inserted = await client.query(
      `INSERT INTO ${qualifiedTable} (id, value) VALUES ($1, $2) RETURNING value`,
      [1, 1],
    );
    const updated = await client.query(
      `UPDATE ${qualifiedTable} SET value = $1 WHERE id = $2 RETURNING value`,
      [2, 1],
    );
    const deleted = await client.query(
      `DELETE FROM ${qualifiedTable} WHERE id = $1 RETURNING id`,
      [1],
    );
    if (
      inserted.length !== 1
      || Number(inserted[0]?.value) !== 1
      || updated.length !== 1
      || Number(updated[0]?.value) !== 2
      || deleted.length !== 1
      || Number(deleted[0]?.id) !== 1
    ) {
      throw new Error("positive write smoke failed");
    }

    let ddlDenied = false;
    try {
      await client.query(`ALTER TABLE ${qualifiedTable} ADD COLUMN forbidden integer`);
    } catch {
      ddlDenied = true;
    }
    if (!ddlDenied) throw new Error("negative DDL smoke failed");

    let roleManagementDenied = false;
    try {
      await client.query(`ALTER ROLE ${role} CREATEROLE`);
    } catch {
      roleManagementDenied = true;
    }
    if (!roleManagementDenied) {
      throw new Error("negative role management smoke failed");
    }
  } catch (error) {
    failure = error;
  }

  let roleCleanupFailed = false;
  let objectCleanupFailed = false;
  if (probeCreated) {
    if (leaseIssued || failure instanceof NeonLeaseCleanupRequiredError) {
      try {
        await revokeNeonLease(input.credential, target.resource, role);
      } catch {
        roleCleanupFailed = true;
      }
    }
    try {
      await target.sql.query(`DROP TABLE ${qualifiedTable}`);
    } catch {
      objectCleanupFailed = true;
    }
  }
  if (roleCleanupFailed || objectCleanupFailed) {
    throw new NeonSmokeCleanupRequiredError(
      roleCleanupFailed ? role : null,
      objectCleanupFailed ? `${schemaName}.${tableName}` : null,
    );
  }
  if (failure instanceof NeonLeaseCleanupRequiredError) {
    throw new Error("write lease issuance failed after cleanup");
  }
  if (failure) throw failure;
}

export async function applyNeonBootstrap(input: {
  credential: NeonCredential;
  resource: NeonResource;
  environment: NeonEnvironmentClassification | null;
  expectedPlanHash: string;
  expectedReadyHash: string;
  publicAclApproved: boolean;
  productionApproved: boolean;
}) {
  const inspection = await inspectNeonBootstrap(input);
  const approvedState = inspection.report.planHash === input.expectedPlanHash;
  const verifiedReplay = inspection.report.planHash === input.expectedReadyHash
    && inspection.report.status === "readyToApply"
    && inspection.actions.length === 0;
  if (!approvedState && !verifiedReplay) {
    throw new ProviderRequestError(
      "neon",
      "Neon bootstrap plan changed; review the new preflight",
      409,
    );
  }
  if (approvedState && inspection.report.status === "blocked") {
    throw new ProviderRequestError(
      "neon",
      "Neon bootstrap has unresolved blockers",
      409,
    );
  }
  if (
    approvedState
    && inspection.report.requiresPublicAclApproval
    && !input.publicAclApproved
  ) {
    throw new ProviderRequestError(
      "neon",
      "Approve the listed PUBLIC privilege changes before applying",
      409,
    );
  }
  if (inspection.report.production && !input.productionApproved) {
    throw new ProviderRequestError(
      "neon",
      "Production Neon bootstrap requires explicit administrator approval",
      409,
    );
  }

  const target = await openNeonBootstrapTarget(
    inspection.credential,
    inspection.resource,
  );
  if (
    target.branch.ready !== true
    || target.providerAuditId !== inspection.report.providerAuditId
    || classification(target.branch.production, input.environment)
      !== inspection.report.production
  ) {
    throw new ProviderRequestError(
      "neon",
      "Neon target changed after preflight; review the new plan",
      409,
    );
  }
  let changesApplied = false;
  if (approvedState && inspection.actions.length > 0) {
    await target.sql.transaction(
      inspection.actions.flatMap((action) => action.apply)
        .map((statement) => target.sql.query(statement)),
    );
    changesApplied = true;
  }
  try {
    await validateNeonResource(
      inspection.credential,
      inspection.resource,
      "write",
      inspection.report.production,
    );
    await smokeReadCredential({
      credential: inspection.credential,
      resource: inspection.resource,
      production: inspection.report.production,
    });
    await smokeWriteCredential({
      credential: inspection.credential,
      resource: inspection.resource,
      production: inspection.report.production,
    });
  } catch (error) {
    const roleCleanupRequired = (
      error instanceof NeonSmokeCleanupRequiredError && error.role !== null
    ) || error instanceof NeonLeaseCleanupRequiredError;
    const objectCleanupRequired = error instanceof NeonSmokeCleanupRequiredError
      && error.objectName !== null;
    const cleanupRequired = roleCleanupRequired || objectCleanupRequired;
    const temporaryRole = error instanceof NeonSmokeCleanupRequiredError
      ? error.role
      : error instanceof NeonLeaseCleanupRequiredError
        ? error.externalCredentialId
        : null;
    const temporaryObject = error instanceof NeonSmokeCleanupRequiredError
      ? error.objectName
      : null;
    let rolledBack = !changesApplied;
    if (changesApplied) {
      try {
        await target.sql.transaction(
          [...inspection.actions].reverse().flatMap((action) => action.rollback)
            .map((statement) => target.sql.query(statement)),
        );
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    if (cleanupRequired || !rolledBack) {
      let repairCode = "NEON_POLICY_ROLLBACK_REQUIRED";
      if (
        (cleanupRequired && !rolledBack)
        || (roleCleanupRequired && objectCleanupRequired)
      ) {
        repairCode = "NEON_BOOTSTRAP_MULTIPLE_REPAIRS_REQUIRED";
      } else if (roleCleanupRequired) {
        repairCode = "NEON_SMOKE_ROLE_CLEANUP_REQUIRED";
      } else if (objectCleanupRequired) {
        repairCode = "NEON_SMOKE_PROBE_CLEANUP_REQUIRED";
      }
      throw new NeonBootstrapRepairRequiredError(
        repairCode,
        inspection.report.providerAuditId,
        temporaryRole,
        temporaryObject,
      );
    }
    throw new ProviderRequestError(
      "neon",
      "Neon verification failed and approved changes were rolled back",
      409,
    );
  }
  return {
    report: inspection.report.planHash === input.expectedPlanHash
      ? inspection.report
      : { ...inspection.report, planHash: input.expectedPlanHash },
    resource: inspection.resource,
    providerAuditId: inspection.report.providerAuditId,
  };
}
