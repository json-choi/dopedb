// Owns the credential method choice of a new team connection in the connection editor:
// which methods this member and engine allow, the chosen one, and the end of the
// provider-managed and per-member-account flows (pull the new connection onto this
// device, then hand it to the editor's normal saved-connection path). Member accounts
// is the default and uses the editor's own form and save; the other two are the
// existing add flows, hosted by the editor instead of a separate management screen.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { refreshDesktopConnections } from "../workspaceAdmin/desktopConnections";
import type { WorkspaceAdminScope } from "../workspaceAdmin/domain";
import { useWorkspaceAdminScope } from "../workspaceAdmin/scope";
import { invalidateProviderReads } from "../workspaceAdmin/providers/accounts/providerReads";
import type { ConnectionProfile } from "./domain";
import { connectionsQuery } from "./queries";
import type { ConnectionEditorProps } from "./useConnectionEditorController";
import type { ConnectionProfileState } from "./useConnectionProfileState";

/** How members of a team workspace reach a new connection's database. */
export type CredentialMethod = "memberAccount" | "providerManaged" | "perMemberAccount";

export type CredentialMethodState = ReturnType<typeof useConnectionCredentialMethod>;

export function useConnectionCredentialMethod(
  profileState: ConnectionProfileState,
  editor: Pick<ConnectionEditorProps, "onSaved" | "onCancel">,
) {
  const isNew = profileState.identity.isNew;
  const engine = profileState.form.value.engine;
  // A flow that created the connection closes the editor like a normal save does.
  const onFinished = async (saved: ConnectionProfile | null) => {
    if (saved) await editor.onSaved(saved, true);
    else editor.onCancel();
  };
  const onBusyChange = profileState.status.setBusy;
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const scope: WorkspaceAdminScope | null = useWorkspaceAdminScope();
  const [chosen, setChosen] = useState<CredentialMethod>("memberAccount");

  // Provider import and direct registration are administrator-only on the server, and
  // exist for PostgreSQL and MySQL; every other engine uses the member's own account.
  const sqlEngine = engine === "postgres" || engine === "mysql";
  const adminMethods = isNew && scope !== null && scope.canManage && sqlEngine;
  const options: readonly CredentialMethod[] = [
    "memberAccount",
    ...(adminMethods ? (["providerManaged", "perMemberAccount"] as const) : []),
  ];
  const method = options.includes(chosen) ? chosen : "memberAccount";

  /** The flow created the connection: pull it onto this device and finish the editor. */
  async function finish(database: Readonly<{ id: string | null; name: string }>) {
    toast(t("connections.credentialMethod.added", { name: database.name }));
    if (scope) void invalidateProviderReads(queryClient, scope);
    let saved: ConnectionProfile | null = null;
    try {
      await refreshDesktopConnections(queryClient, catalogScope.key, []);
      const list = await queryClient.fetchQuery({
        ...connectionsQuery(catalogScope.key),
        staleTime: 0,
      });
      saved = list.find((connection) => connection.id === database.id) ?? null;
    } catch {
      // The connection already exists in the workspace; the next refresh lists it.
    }
    await onFinished(saved);
  }

  return {
    scope,
    /** Whether the member can pick a method at all. */
    selectable: options.length > 1,
    options,
    method,
    setMethod: setChosen,
    /** A flow, not the editor's own form, is what the person is filling in. */
    flowActive: method !== "memberAccount",
    finish,
    setBusy: onBusyChange,
  };
}
