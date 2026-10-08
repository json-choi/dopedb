// Settings → Workspace → Database access. A workspace admin picks one shared
// database they manage, reviews how members get credentials, the write ceiling and
// team read access, and sets each member's access level; offline edits that
// conflict with a database's current version are reviewed above the picker.
// Reads come from the area queries; every change runs through useAccessCommands,
// one command at a time. The selection is local view state only.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../design-system/components/Button";
import { Field, SelectInput } from "../../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { queryResultPhase } from "../../../lib/queryResultPhase";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import ConflictReview from "./ConflictReview";
import DatabaseAccess from "./DatabaseAccess";
import { manageableDatabases } from "./domain";
import { accessErrorMessage } from "./errors";
import { connectionConflictsQuery, sharedDatabasesQuery } from "./queries";
import { useAccessCommands } from "./useAccessCommands";

export default function ConnectionAccessPanel({ scope, onNavigate }: WorkspaceAdminPanelProps) {
  const { lang, t } = useI18n();
  const commands = useAccessCommands(scope);
  const databasesQuery = useQuery(sharedDatabasesQuery(scope));
  const conflictsQuery = useQuery(connectionConflictsQuery(scope));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const databases = databasesQuery.data;
  const manageable = useMemo(
    () => (databases ? manageableDatabases(databases) : []),
    [databases],
  );
  // A database that disappears (deleted, or no longer managed) falls back to the
  // first one still available instead of leaving a stale selection behind.
  const selected = manageable.find((database) => database.id === selectedId)
    ?? manageable[0]
    ?? null;
  const databasesPhase = queryResultPhase(databases, databasesQuery.error);
  const conflicts = conflictsQuery.data ?? [];
  const conflictNotice = commands.notice?.area === "conflict" ? commands.notice : null;
  const conflictStillListed = conflictNotice !== null
    && conflicts.some((conflict) => conflict.id === conflictNotice.conflictId);
  const locked = commands.busy !== null;

  const retryDatabases = (
    <Button
      size="compact"
      disabled={databasesQuery.isFetching}
      onClick={() => void databasesQuery.refetch()}
    >
      {t("workspaceAdmin.retry")}
    </Button>
  );

  return (
    <div className="tw:flex tw:w-full tw:min-w-0 tw:max-w-[880px] tw:flex-col tw:gap-5 tw:p-4 tw:@max-[700px]:p-0">
      <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
        {t("workspaceAccess.description")}
      </p>

      {conflictNotice && !conflictStillListed ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          <strong className="tw:font-semibold">{conflictNotice.connectionName}</strong>
          {" · "}
          {conflictNotice.message}
        </InlineNotice>
      ) : null}
      {conflictsQuery.error ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          role="status"
          action={
            <Button
              size="compact"
              disabled={conflictsQuery.isFetching}
              onClick={() => void conflictsQuery.refetch()}
            >
              {t("workspaceAdmin.retry")}
            </Button>
          }
        >
          {accessErrorMessage(conflictsQuery.error, { lang, t }, "workspaceAccess.conflictsLoadFailed")}
        </InlineNotice>
      ) : null}
      {conflicts.length > 0 ? (
        <ConflictReview
          conflicts={conflicts}
          busy={commands.busy}
          notice={conflictStillListed ? conflictNotice : null}
          onKeep={(conflict) => void commands.keepCurrent(conflict)}
          onApply={(conflict) => void commands.applyCandidate(conflict)}
        />
      ) : null}

      <section aria-label={t("workspaceAccess.databaseLabel")} className="tw:grid tw:min-w-0 tw:gap-2">
        {databasesPhase === "coldLoading" ? (
          <div className="tw:text-sm">
            <LoadingLabel>{t("workspaceAccess.loadingDatabases")}</LoadingLabel>
          </div>
        ) : null}
        {databasesPhase === "coldError" ? (
          <InlineNotice tone="danger" icon="alert" role="alert" action={retryDatabases}>
            {accessErrorMessage(databasesQuery.error, { lang, t }, "workspaceAccess.loadDatabasesFailed")}
          </InlineNotice>
        ) : null}
        {databasesPhase === "staleError" ? (
          <InlineNotice tone="warning" icon="alert" role="status" action={retryDatabases}>
            {t("workspaceAccess.refreshDatabasesFailed")}
          </InlineNotice>
        ) : null}
        {databases && databases.length === 0 ? (
          <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-3">
            <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t("workspaceAccess.noDatabases")}
            </p>
            <Button size="compact" onClick={() => onNavigate("workspace-providers")}>
              {t("workspaceAccess.openProviders")}
            </Button>
          </div>
        ) : null}
        {databases && databases.length > 0 && manageable.length === 0 ? (
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("workspaceAccess.noManagedDatabases")}
          </p>
        ) : null}
        {selected ? (
          <div className="tw:w-full tw:max-w-[420px]">
            <Field label={t("workspaceAccess.databaseLabel")}>
              <SelectInput
                value={selected.id}
                disabled={locked}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {manageable.map((database) => (
                  <option key={database.id} value={database.id}>
                    {database.name} · {database.engine}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}
      </section>

      {selected ? (
        <DatabaseAccess
          scope={scope}
          database={selected}
          commands={commands}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}
