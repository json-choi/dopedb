// Knowledge writes revalidate their route authority in the same D1 batch that changes durable state. This closes the interval between an
// HTTP authorization check and a later write after provider or GitHub I/O.
import "server-only";

import { sql } from "drizzle-orm";

import { member, session, workspaceProfile } from "../d1/schema";
import { utcNow } from "../d1/schema/values";
import type {
  WorkspaceCapability,
  WorkspaceRoleName,
} from "../workspace-permissions";

export type KnowledgeMutationAuthority = {
  organizationId: string;
  membershipId: string;
  userId: string;
  sessionId: string;
  role: WorkspaceRoleName;
  capability: WorkspaceCapability;
  subject?: { membershipId: string; userId: string };
};

type RouteAuthorization = {
  session: {
    session: { id: string };
    user: { id: string };
  };
  membership: { id: string };
  role: WorkspaceRoleName;
};

export function knowledgeMutationAuthority(
  authorization: RouteAuthorization,
  organizationId: string,
  capability: WorkspaceCapability,
): KnowledgeMutationAuthority {
  return {
    organizationId,
    membershipId: authorization.membership.id,
    userId: authorization.session.user.id,
    sessionId: authorization.session.session.id,
    role: authorization.role,
    capability,
  };
}

function permittedRoles(capability: WorkspaceCapability) {
  switch (capability) {
    case "view":
      return sql`'viewer', 'analyst', 'editor', 'admin', 'owner'`;
    case "read":
      return sql`'analyst', 'editor', 'admin', 'owner'`;
    case "write":
      return sql`'editor', 'admin', 'owner'`;
    case "manage":
      return sql`'admin', 'owner'`;
    case "delete":
      return sql`'owner'`;
  }
}

// Use only inside the conditional mutation or atomic D1 batch that consumes
// this authority. A preceding HTTP check alone cannot authorize a later write.
export function knowledgeMutationAuthoritySql(
  input: KnowledgeMutationAuthority,
  organizationId: string,
) {
  const subjectGuard = input.subject ? sql`AND EXISTS (
    SELECT 1 FROM ${member} AS guarded_member
    WHERE guarded_member.id = ${input.subject.membershipId}
      AND guarded_member.organization_id = ${input.organizationId}
      AND guarded_member.user_id = ${input.subject.userId}
      AND guarded_member.revocation_pending_at IS NULL AND guarded_member.revocation_claim_id IS NULL
  )` : sql``;
  return sql`EXISTS (
    SELECT 1 FROM ${session} live_session
    JOIN ${member} live_member ON live_member.id = ${input.membershipId}
      AND live_member.organization_id = ${input.organizationId} AND live_member.user_id = ${input.userId}
    JOIN ${workspaceProfile} live_workspace ON live_workspace.organization_id = live_member.organization_id
    WHERE live_session.id = ${input.sessionId} AND live_session.user_id = ${input.userId}
      AND ${input.organizationId} = ${organizationId} AND live_session.expires_at > ${utcNow}
      AND live_member.role = ${input.role} AND live_member.role IN (${permittedRoles(input.capability)})
      AND live_member.revocation_pending_at IS NULL AND live_member.revocation_claim_id IS NULL
      AND live_workspace.lifecycle_state = 'active' ${subjectGuard}
  )`;
}
