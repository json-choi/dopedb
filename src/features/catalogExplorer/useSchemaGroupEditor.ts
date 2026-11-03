// Owns explicit schema-group membership changes for Database Explorer: the drag
// confirmation, the connection "schema comparison group" dialog, and the group rename
// and ungroup commands all persist through `saveSchemaGroup`, which applies the change
// optimistically and restores the previous profiles if the store refuses it.
import { useState } from "react";

import { useToast } from "../../components/Toast";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { schemaComparableEngine, type SchemaConnectionGroup } from "../../lib/schemaDiff";
import type { ConnectionId, ConnectionProfile } from "../connections/domain";
import { setConnectionsSchemaGroup } from "../connections/tauriAdapter";

/**
 * Explorer group commands write only this device's local profiles. A team connection's
 * group is shared metadata its managers change in the connection editor, and team
 * databases are compared through their Project environments instead.
 */
export function schemaGroupEditable(connection: ConnectionProfile): boolean {
  return connection.workspaceAccess === "local" && schemaComparableEngine(connection.engine);
}

export type SchemaGroupEditTarget =
  | { kind: "connection"; connection: ConnectionProfile }
  | { kind: "group"; group: SchemaConnectionGroup };

export async function saveSchemaGroup(
  connections: readonly ConnectionProfile[],
  ids: readonly ConnectionId[],
  schemaGroup: string | null,
  onConnectionUpdated: (connection: ConnectionProfile) => void,
) {
  const originals = ids.flatMap((id) => {
    const connection = connections.find((candidate) => candidate.id === id);
    return connection ? [connection] : [];
  });
  originals.forEach((original) => onConnectionUpdated({ ...original, schemaGroup }));
  try {
    const saved = await setConnectionsSchemaGroup([...ids], schemaGroup);
    saved.forEach(onConnectionUpdated);
  } catch (error) {
    originals.forEach(onConnectionUpdated);
    throw error;
  }
}

export function useSchemaGroupEditor(
  connections: readonly ConnectionProfile[],
  onConnectionUpdated: (connection: ConnectionProfile) => void,
) {
  const { t } = useI18n();
  const toast = useToast();
  const [target, setTarget] = useState<SchemaGroupEditTarget | null>(null);
  const [saving, setSaving] = useState(false);

  async function apply(ids: readonly ConnectionId[], schemaGroup: string | null) {
    setSaving(true);
    try {
      await saveSchemaGroup(connections, ids, schemaGroup, onConnectionUpdated);
      toast(t("connections.schemaGroupUpdated"));
      setTarget(null);
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  function memberIds(current: SchemaGroupEditTarget): ConnectionId[] {
    return current.kind === "connection"
      ? [current.connection.id]
      : current.group.connections.map((connection) => connection.id);
  }

  return {
    target,
    saving,
    open: setTarget,
    close: () => {
      if (!saving) setTarget(null);
    },
    /** Joins, creates, or renames; leaving or dissolving goes through `remove`. */
    save: (name: string) => {
      if (target) void apply(memberIds(target), name.trim() || null);
    },
    remove: () => {
      if (target) void apply(memberIds(target), null);
    },
  };
}
