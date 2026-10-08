// Workspace creation contract: the name rule the control plane and Rust both enforce,
// and a strict reader for the created workspace. Pure functions only.
import { workspaceId, type WorkspaceId } from "../../workspaces/domain";

export const WORKSPACE_NAME_MAX_LENGTH = 120;

// Rust rejects every Unicode control character (Cc), a superset of the server rule.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkspaceNameProblem = "empty" | "tooLong" | "control";

/** Trimmed, 1–120 UTF-16 code units, one line, no control characters. */
export function workspaceNameProblem(value: string): WorkspaceNameProblem | null {
  const name = value.trim();
  if (name.length === 0) return "empty";
  if (name.length > WORKSPACE_NAME_MAX_LENGTH) return "tooLong";
  if (CONTROL_CHARACTER.test(name)) return "control";
  return null;
}

export interface CreatedWorkspace {
  id: WorkspaceId;
  name: string;
}

/** `{ workspace: { id, name, ... } }` from a 201, or null when it cannot be trusted. */
export function parseCreatedWorkspace(value: unknown): CreatedWorkspace | null {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const workspace = body?.workspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return null;
  const { id, name } = workspace as Record<string, unknown>;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (typeof name !== "string" || name.length === 0 || name.length > 512) return null;
  return { id: workspaceId(id), name };
}
