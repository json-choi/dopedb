// Review list for preserved offline edits that conflict with a shared database's
// current version. Each item shows only the fields that differ and offers the two
// audited decisions; applying a deletion asks for confirmation first. Decisions
// are handed to the panel's access commands.
import ConfirmButton from "../../../components/ConfirmButton";
import { Button } from "../../../design-system/components/Button";
import {
  SettingsList,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { StatusBadge } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import {
  absoluteTimeLabel,
  changedConflictFields,
  relativeTimeLabel,
  type ConflictField,
  type ConflictPayload,
  type ConnectionConflict,
} from "./domain";
import type { AccessBusy } from "./useAccessCommands";

const EMPTY_VALUE = "—";

const FIELD_LABELS: Record<ConflictField, I18nKey> = {
  name: "workspaceAccess.fieldName",
  engine: "workspaceAccess.fieldEngine",
  provider: "workspaceAccess.fieldProvider",
  driverId: "workspaceAccess.fieldDriver",
  host: "workspaceAccess.fieldHost",
  port: "workspaceAccess.fieldPort",
  database: "workspaceAccess.fieldDatabase",
  sslmode: "workspaceAccess.fieldSsl",
  env: "workspaceAccess.fieldEnvironment",
  schemaGroup: "workspaceAccess.fieldSchemaGroup",
  allowWrites: "workspaceAccess.fieldWrites",
  deleted: "workspaceAccess.fieldState",
};

type Translate = ReturnType<typeof useI18n>["t"];

function fieldValue(payload: ConflictPayload, field: ConflictField, t: Translate): string {
  switch (field) {
    case "allowWrites":
      return t(payload.allowWrites ? "workspaceAccess.valueAllowed" : "workspaceAccess.readOnly");
    case "deleted":
      return t(payload.deleted ? "workspaceAccess.valueDeleted" : "workspaceAccess.valueActive");
    case "port":
      return String(payload.port);
    case "driverId":
    case "env":
    case "schemaGroup":
      return payload[field] ?? EMPTY_VALUE;
    case "database":
      return payload.database || EMPTY_VALUE;
    default:
      return payload[field];
  }
}

function ConflictDiff({
  conflict,
  fields,
}: {
  conflict: ConnectionConflict;
  fields: readonly ConflictField[];
}) {
  const { t } = useI18n();
  return (
    <table className="tw:w-full tw:table-fixed tw:border-collapse tw:text-xs">
      <thead>
        <tr className="tw:border-b tw:border-border-subtle">
          <th scope="col" className="tw:w-[30%] tw:py-1 tw:pr-2 tw:text-left tw:font-medium tw:text-muted-foreground">
            {t("workspaceAccess.conflictField")}
          </th>
          <th scope="col" className="tw:py-1 tw:pr-2 tw:text-left tw:font-medium tw:text-muted-foreground">
            {t("workspaceAccess.conflictCurrent", { revision: conflict.current.revision })}
          </th>
          <th scope="col" className="tw:py-1 tw:text-left tw:font-medium tw:text-muted-foreground">
            {t("workspaceAccess.conflictCandidate")}
          </th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field} className="tw:border-b tw:border-border-subtle tw:last:border-b-0">
            <th scope="row" className="tw:py-1.5 tw:pr-2 tw:text-left tw:align-top tw:font-normal tw:text-muted-foreground">
              {t(FIELD_LABELS[field])}
            </th>
            <td className="tw:py-1.5 tw:pr-2 tw:align-top tw:font-mono tw:text-foreground tw:[overflow-wrap:anywhere]">
              {fieldValue(conflict.current.payload, field, t)}
            </td>
            <td className="tw:py-1.5 tw:align-top tw:font-mono tw:font-semibold tw:text-foreground tw:[overflow-wrap:anywhere]">
              {fieldValue(conflict.candidate.payload, field, t)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConflictItem({
  conflict,
  busy,
  notice,
  onKeep,
  onApply,
}: {
  conflict: ConnectionConflict;
  busy: AccessBusy | null;
  notice: string | null;
  onKeep: (conflict: ConnectionConflict) => void;
  onApply: (conflict: ConnectionConflict) => void;
}) {
  const { lang, t } = useI18n();
  const fields = changedConflictFields(conflict.current.payload, conflict.candidate.payload);
  const working = busy?.kind === "conflict" && busy.conflictId === conflict.id ? busy.action : null;
  const locked = busy !== null;
  const deletion = conflict.candidate.payload.deleted;
  const applyLabel = working === "apply"
    ? t("workspaceAccess.resolving")
    : deletion
      ? t("workspaceAccess.applyDeletion")
      : t("workspaceAccess.applyCandidate");

  return (
    <article aria-label={conflict.connectionName} className="tw:grid tw:min-w-0 tw:gap-2 tw:px-3 tw:py-3">
      <header className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-start tw:justify-between tw:gap-2">
        <span className="tw:grid tw:min-w-0 tw:gap-0.5">
          <strong className="tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">
            {conflict.connectionName}
          </strong>
          <span className="tw:text-xs tw:text-muted-foreground">
            <span className="tw:font-mono">
              {t("workspaceAccess.conflictMeta", {
                expected: conflict.expectedRevision,
                server: conflict.server.revision,
              })}
            </span>
            {" · "}
            <time dateTime={conflict.createdAt} title={absoluteTimeLabel(conflict.createdAt, lang)}>
              {relativeTimeLabel(conflict.createdAt, lang)}
            </time>
          </span>
        </span>
        {conflict.currentMatchesServer ? null : (
          <StatusBadge tone="warning" title={t("workspaceAccess.conflictChangedAgainHint")}>
            {t("workspaceAccess.conflictChangedAgain")}
          </StatusBadge>
        )}
      </header>
      {fields.length > 0 ? (
        <ConflictDiff conflict={conflict} fields={fields} />
      ) : (
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{t("workspaceAccess.conflictSame")}</p>
      )}
      {notice ? (
        <p role="alert" className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger">
          {notice}
        </p>
      ) : null}
      <div className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-[var(--ds-control-gap)] tw:[--ds-row-control-size:var(--ds-control-md)]">
        <Button size="compact" disabled={locked} onClick={() => onKeep(conflict)}>
          {working === "keep" ? t("workspaceAccess.resolving") : t("workspaceAccess.keepCurrent")}
        </Button>
        {deletion && !conflict.currentMatchesCandidate ? (
          <ConfirmButton
            size="compact"
            tone="danger"
            label={t("workspaceAccess.applyDeletionTitle")}
            confirmLabel={t("workspaceAccess.applyDeletionConfirm", { name: conflict.connectionName })}
            disabled={locked}
            onConfirm={() => onApply(conflict)}
          >
            {applyLabel}
          </ConfirmButton>
        ) : (
          <Button size="compact" disabled={locked} onClick={() => onApply(conflict)}>
            {applyLabel}
          </Button>
        )}
      </div>
    </article>
  );
}

export default function ConflictReview({
  conflicts,
  busy,
  notice,
  onKeep,
  onApply,
}: {
  conflicts: readonly ConnectionConflict[];
  busy: AccessBusy | null;
  notice: { conflictId: string; message: string } | null;
  onKeep: (conflict: ConnectionConflict) => void;
  onApply: (conflict: ConnectionConflict) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("workspaceAccess.conflictsTitle")} className="tw:grid tw:min-w-0">
      <SettingsSectionHeader
        title={t("workspaceAccess.conflictsTitle")}
        info={
          <StatusBadge tone="warning">
            {t("workspaceAccess.conflictsCount", { count: conflicts.length })}
          </StatusBadge>
        }
      />
      <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
        {t("workspaceAccess.conflictsDescription")}
      </p>
      <SettingsList>
        {conflicts.map((conflict) => (
          <ConflictItem
            key={conflict.id}
            conflict={conflict}
            busy={busy}
            notice={notice?.conflictId === conflict.id ? notice.message : null}
            onKeep={onKeep}
            onApply={onApply}
          />
        ))}
      </SettingsList>
    </section>
  );
}
