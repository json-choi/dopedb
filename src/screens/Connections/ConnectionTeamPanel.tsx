// Team-connection administration shown inside the editor of a connection the member
// manages: preserved offline edits that conflict with its current version (keep the
// current one or apply the preserved one), and the guarded deletion of a connection
// with per-member DopeDB accounts, which first revokes those accounts on the database.
// Reads and commands belong to the workspace-admin access hooks; this component only
// lays them out for the open connection.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { InlineNotice } from "../../design-system/components/Status";
import type { ConnectionProfile } from "../../features/connections/domain";
import AccessLoweringPrompt from "../../features/workspaceAdmin/accessLowering/AccessLoweringPrompt";
import ConflictReview from "../../features/workspaceAdmin/access/ConflictReview";
import { connectionConflictsQuery, sharedDatabasesQuery } from "../../features/workspaceAdmin/access/queries";
import { useAccessCommands } from "../../features/workspaceAdmin/access/useAccessCommands";
import { useAccessLowering } from "../../features/workspaceAdmin/accessLowering/useAccessLowering";
import { refreshDesktopConnections } from "../../features/workspaceAdmin/desktopConnections";
import type { WorkspaceAdminScope } from "../../features/workspaceAdmin/domain";
import { invalidateProviderReads } from "../../features/workspaceAdmin/providers/accounts/providerReads";
import {
  providerErrorMessage,
  removalFailure,
  type RemovalFailure,
} from "../../features/workspaceAdmin/providers/databases/serverMessages";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";

const REMOVAL_FAILURES: Record<RemovalFailure, I18nKey> = {
  conflictRecorded: "workspaceProviderDatabases.removeConflict",
  changed: "workspaceProviderDatabases.removeChanged",
  missing: "workspaceProviderDatabases.removeMissing",
  revocationPending: "workspaceProviderDatabases.removeRevocationPending",
  busy: "workspaceProviderDatabases.removeBusy",
};

export function ConnectionTeamPanel({
  scope,
  connection,
  onDeleted,
}: {
  scope: WorkspaceAdminScope;
  connection: ConnectionProfile;
  /** The connection no longer exists: the editor drops it and closes. */
  onDeleted: () => Promise<void>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const lowering = useAccessLowering(scope, () => void finishDeletion());
  const commands = useAccessCommands(scope, lowering);
  const conflictsQuery = useQuery(connectionConflictsQuery(scope));
  const databases = useQuery(sharedDatabasesQuery(scope));
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const direct = connection.credentialMode === "provisioned";
  const conflicts = (conflictsQuery.data ?? []).filter(
    (conflict) => conflict.connectionId === connection.id,
  );
  const conflictNotice = commands.notice?.area === "conflict" ? commands.notice : null;
  const conflictStillListed = conflictNotice !== null
    && conflicts.some((conflict) => conflict.id === conflictNotice.conflictId);

  async function finishDeletion() {
    toast(t("workspaceProviderDatabases.removed", { name: connection.name }));
    // Best effort and not part of the command: the deletion is committed, and the next
    // workspace refresh converges the Explorer if this pull cannot finish.
    await refreshDesktopConnections(queryClient, catalogScope.key, [connection.id])
      .catch(() => undefined);
    await onDeleted();
  }

  async function remove() {
    const revision = databases.data?.find((row) => row.id === connection.id)?.revision ?? 0;
    if (removing || revision < 1) return;
    setRemoving(true);
    setError(null);
    try {
      const outcome = await lowering.runDeletion(connection.id, {
        kind: "deleteSharedConnection",
        workspaceId: scope.workspaceId,
        connectionId: connection.id,
        expectedRevision: revision,
      });
      // Pending revocation: the prompt below explains it and the connection stays.
      if (outcome === "incomplete") return;
      await finishDeletion();
    } catch (caught) {
      const failure = removalFailure(caught);
      setError(
        failure
          ? t(REMOVAL_FAILURES[failure], { name: connection.name })
          : providerErrorMessage(caught, i18n, "workspaceProviderDatabases.removeError"),
      );
      if (failure) void invalidateProviderReads(queryClient, scope);
    } finally {
      setRemoving(false);
    }
  }

  if (conflicts.length === 0 && !direct && !lowering.incomplete && !conflictNotice) return null;

  return (
    <div className="tw:mx-auto tw:mb-4 tw:grid tw:w-full tw:max-w-[840px] tw:gap-4">
      {conflicts.length > 0 ? (
        <ConflictReview
          conflicts={conflicts}
          busy={commands.busy}
          notice={conflictStillListed ? conflictNotice : null}
          onKeep={(conflict) => void commands.keepCurrent(conflict)}
          onApply={(conflict) => void commands.applyCandidate(conflict)}
        />
      ) : null}
      {conflictNotice && !conflictStillListed ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {conflictNotice.message}
        </InlineNotice>
      ) : null}
      <AccessLoweringPrompt lowering={lowering} memberName={() => null} />
      {error ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {error}
        </InlineNotice>
      ) : null}
      {direct ? (
        <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-y tw:border-border-subtle tw:py-3">
          <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("connections.credentialMethod.directDeleteHint")}
          </p>
          <ConfirmButton
            size="compact"
            tone="danger"
            disabled={removing || databases.data === undefined || lowering.incomplete !== null}
            label={t(removing
              ? "workspaceProviderDatabases.removing"
              : "workspaceProviderDatabases.remove")}
            confirmLabel={t("workspaceProviderDatabases.removeConfirm", { name: connection.name })}
            onConfirm={() => void remove()}
          >
            {removing ? (
              <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" />
            ) : (
              <Icon name="trash" />
            )}
            {t("workspaceProviderDatabases.remove")}
          </ConfirmButton>
        </div>
      ) : null}
    </div>
  );
}
