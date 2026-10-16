// Members area contracts: strict parsing of the control-plane member directory, the
// invitation email rule mirrored from the server, the role choices an administrator may
// assign, and date display. Pure functions only; requests and refusal wording live in
// the commands controller.
import type { I18nKey, Lang } from "../../../lib/i18n";
import type { WorkspaceRole } from "../../workspaces/domain";
import type { AssignableWorkspaceRole } from "../domain";

export const ASSIGNABLE_ROLES: readonly AssignableWorkspaceRole[] = [
  "viewer",
  "analyst",
  "editor",
  "admin",
];
export const DEFAULT_INVITE_ROLE: AssignableWorkspaceRole = "analyst";

/** Read-only role names, shared with the rest of workspace administration. */
export const ROLE_LABEL_KEYS: Record<WorkspaceRole, I18nKey> = {
  viewer: "workspaceAdmin.roleViewer",
  analyst: "workspaceAdmin.roleAnalyst",
  editor: "workspaceAdmin.roleEditor",
  admin: "workspaceAdmin.roleAdmin",
  owner: "workspaceAdmin.roleOwner",
};

/** Role choices spell out that a viewer cannot run queries. */
export const ROLE_OPTION_KEYS: Record<AssignableWorkspaceRole, I18nKey> = {
  viewer: "workspaceMembers.roleViewerOption",
  analyst: "workspaceAdmin.roleAnalyst",
  editor: "workspaceAdmin.roleEditor",
  admin: "workspaceAdmin.roleAdmin",
};

export interface WorkspaceMember {
  /** Membership id; the identifier role changes and removals address. */
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: WorkspaceRole | null;
  expiresAt: string;
  createdAt: string;
  inviteUrl: string;
}

export interface MemberDirectory {
  members: WorkspaceMember[];
  invitations: PendingInvitation[];
}

/** The invitation an invite request returned: new, or a renewed pending one. */
export interface CreatedInvitation {
  id: string;
  role: WorkspaceRole | null;
  expiresAt: string;
  inviteUrl: string;
}

export class MemberDirectoryShapeError extends Error {
  constructor() {
    super("The workspace service returned an incompatible member directory.");
    this.name = "MemberDirectoryShapeError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same pattern and bound the control plane applies after trimming and lowercasing.
const INVITE_EMAIL = /^\S+@\S+\.\S+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const MAX_TEXT = 512;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function boundedText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= MAX_TEXT
    && (allowEmpty || value.trim().length > 0);
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function workspaceRole(value: unknown): WorkspaceRole | null {
  return value === "owner" || ASSIGNABLE_ROLES.includes(value as AssignableWorkspaceRole)
    ? value as WorkspaceRole
    : null;
}

/** Missing and null both mean "no role recorded"; any other value must be a known role. */
function optionalRole(value: unknown): WorkspaceRole | null | undefined {
  if (value === null || value === undefined) return null;
  return workspaceRole(value) ?? undefined;
}

function invitationUrl(value: unknown): string | null {
  if (!boundedText(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function parseMember(value: unknown): WorkspaceMember | null {
  const item = record(value);
  if (
    !item
    || !isUuid(item.id)
    || !boundedText(item.userId)
    || !boundedText(item.name, true)
    || !boundedText(item.email)
  ) {
    return null;
  }
  const role = workspaceRole(item.role);
  const createdAt = timestamp(item.createdAt);
  if (!role || !createdAt) return null;
  return { id: item.id, userId: item.userId, name: item.name, email: item.email, role, createdAt };
}

function parseInvitation(value: unknown): PendingInvitation | null {
  const item = record(value);
  if (!item || !isUuid(item.id) || !boundedText(item.email) || item.status !== "pending") {
    return null;
  }
  const role = optionalRole(item.role);
  const expiresAt = timestamp(item.expiresAt);
  const createdAt = timestamp(item.createdAt);
  const inviteUrl = invitationUrl(item.inviteUrl);
  if (role === undefined || !expiresAt || !createdAt || !inviteUrl) return null;
  return { id: item.id, email: item.email, role, expiresAt, createdAt, inviteUrl };
}

function parseAll<T>(values: unknown[], parse: (value: unknown) => T | null): T[] {
  const parsed: T[] = [];
  for (const value of values) {
    const item = parse(value);
    if (item === null) throw new MemberDirectoryShapeError();
    parsed.push(item);
  }
  return parsed;
}

/** Accepts only the directory of the requested workspace; any malformed row rejects it. */
export function parseMemberDirectory(value: unknown, workspaceId: string): MemberDirectory {
  const body = record(value);
  if (
    !body
    || typeof body.workspaceId !== "string"
    || body.workspaceId.toLowerCase() !== workspaceId.toLowerCase()
    || !Array.isArray(body.members)
    || !Array.isArray(body.invitations)
  ) {
    throw new MemberDirectoryShapeError();
  }
  return {
    members: parseAll(body.members, parseMember),
    invitations: parseAll(body.invitations, parseInvitation),
  };
}

/**
 * The server already created or renewed the invitation, so an unexpected body only
 * drops the follow-up details; the refreshed directory remains the source of truth.
 */
export function parseCreatedInvitation(value: unknown): CreatedInvitation | null {
  const invitation = record(record(value)?.invitation);
  if (!invitation || !isUuid(invitation.id)) return null;
  const role = optionalRole(invitation.role);
  const expiresAt = timestamp(invitation.expiresAt);
  const inviteUrl = invitationUrl(invitation.inviteUrl);
  if (role === undefined || !expiresAt || !inviteUrl) return null;
  return { id: invitation.id, role, expiresAt, inviteUrl };
}

/** Returns the address the server will store, or null when the server would refuse it. */
export function normalizeInviteEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && !CONTROL_CHARACTER.test(email) && INVITE_EMAIL.test(email)
    ? email
    : null;
}

/** The control plane keeps listing expired invitations as pending until they are revoked. */
export function invitationExpired(invitation: Pick<PendingInvitation, "expiresAt">, now: number) {
  return Date.parse(invitation.expiresAt) <= now;
}

/** An invitation is re-created with its recorded role when that role is assignable. */
export function reinviteRole(role: WorkspaceRole | null): AssignableWorkspaceRole {
  return role && role !== "owner" ? role : DEFAULT_INVITE_ROLE;
}

/** A member's visible name; accounts without a profile name fall back to the email. */
export function memberDisplayName(member: Pick<WorkspaceMember, "name" | "email">) {
  return member.name.trim() || member.email;
}

/** Join dates read as a day; invitation expiry also needs the time within its short window. */
export function formatMemberDate(value: string, lang: Lang, withTime = false) {
  return new Intl.DateTimeFormat(
    lang === "ko" ? "ko-KR" : "en-US",
    withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" },
  ).format(new Date(value));
}
