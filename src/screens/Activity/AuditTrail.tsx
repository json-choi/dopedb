// Security trail section of Activity: the hash-chain verdict with its exact scope,
// explicit re-verification, and bounded newest-first metadata pages. The verdict is
// recomputed only on open or request; exact bodies load for the selected record only.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import { Button } from "../../design-system/components/Button";
import { StatusBadge } from "../../design-system/components/Status";
import type { AuditCursor, AuditEntrySummary } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { auditEntryQuery, auditPageQuery, auditVerdictQuery } from "../../lib/queries";
import { fullTime, relTime } from "../../lib/relTime";
import {
  auditActionView,
  queryKindLabel,
  recordedIdentityLabel,
  sqlFirstLine,
} from "./activityLabels";

// The audit log is append-only, so a later verification can never cover fewer rows.
// This app-session high-water mark turns a shrinking chain into a visible failure.
const verifiedHighWater = new Map<string, number>();

function shortHash(hash: string | null) {
  if (!hash) return "∅";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function AuditRow({
  connectionId,
  entry,
  selected,
  tampered,
  onSelect,
  registerButton,
}: {
  connectionId: string;
  entry: AuditEntrySummary;
  selected: boolean;
  tampered: boolean;
  onSelect: () => void;
  registerButton: (button: HTMLButtonElement | null) => void;
}) {
  const { t, lang } = useI18n();
  const detail = useQuery(auditEntryQuery(connectionId, selected ? entry.id : null));
  const exact = detail.data;
  const action = auditActionView(t, entry.action);
  const detailId = `activity-audit-entry-${entry.id}`;

  return (
    <li
      data-tampered={tampered}
      className="tw:border-b tw:border-border-subtle tw:pb-2 tw:data-[tampered=true]:border-danger"
    >
      <Button
        ref={registerButton}
        presentation="listItem"
        variant="ghost"
        aria-expanded={selected}
        aria-controls={selected ? detailId : undefined}
        onClick={onSelect}
      >
        <Icon
          name={tampered ? "alert" : "chevronRight"}
          data-state={tampered ? "tampered" : selected ? "open" : "closed"}
          className="tw:data-[state=open]:rotate-90 tw:data-[state=tampered]:text-danger"
        />
        <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1 tw:py-1 tw:leading-ui">
          <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
            <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
            {entry.kind !== entry.action ? (
              <span className="badge kind">{queryKindLabel(t, entry.kind)}</span>
            ) : null}
            {tampered ? (
              <strong className="tw:text-danger">{t("activity.auditTampered")}</strong>
            ) : null}
          </span>
          <code className="tw:block tw:truncate tw:font-mono tw:text-sm">
            {sqlFirstLine(entry.sqlPreview, entry.sqlTruncated)}
          </code>
        </span>
        <time
          dateTime={entry.ts}
          title={fullTime(entry.ts, lang)}
          className="tw:shrink-0 tw:text-xs tw:font-normal tw:text-muted-foreground"
        >
          {relTime(entry.ts, lang)}
        </time>
      </Button>

      {selected ? (
        <div
          id={detailId}
          role="region"
          aria-label={action.label}
          className="tw:ml-7 tw:grid tw:min-w-0 tw:gap-2 tw:px-1 tw:pt-2"
        >
          {detail.isPending ? <Skeleton lines={3} /> : null}
          {detail.isError ? (
            <p role="alert" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-ui tw:text-danger">
              {t("activity.auditEntryLoadError")}
              <Button size="xs" onClick={() => void detail.refetch()}>{t("activity.retry")}</Button>
            </p>
          ) : null}
          {exact ? (
            <>
              {exact.approvedBy ? (
                <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
                  {t("activity.auditBy", { name: recordedIdentityLabel(t, exact.approvedBy) })}
                </p>
              ) : null}
              <code className="tw:block tw:max-h-48 tw:overflow-auto tw:rounded-sm tw:bg-muted tw:px-2 tw:py-1 tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:break-words">
                {exact.sql}
              </code>
              {exact.error ? (
                <div className="tw:grid tw:gap-1">
                  <span className="tw:text-xs tw:font-medium tw:text-danger">{t("activity.auditRecordedError")}</span>
                  <code className="tw:block tw:max-h-32 tw:overflow-auto tw:rounded-sm tw:bg-muted tw:px-2 tw:py-1 tw:font-mono tw:text-xs tw:whitespace-pre-wrap tw:break-words">
                    {exact.error}
                  </code>
                </div>
              ) : null}
              <p className="tw:m-0 tw:break-words tw:font-mono tw:text-xs tw:text-muted-foreground">
                <span title={exact.prevHash ?? ""}>
                  {t("activity.auditPrev", { hash: shortHash(exact.prevHash) })}
                </span>
                {" → "}
                <span title={exact.hash}>{t("activity.auditHash", { hash: shortHash(exact.hash) })}</span>
                {exact.affectedEstimate !== null ? (
                  <span>
                    {" · "}
                    {t("activity.auditRowsEstimate", { count: exact.affectedEstimate })}
                  </span>
                ) : null}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function AuditTrail({ connectionId }: { connectionId: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<(AuditCursor | null)[]>([null]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  const verdict = useQuery(auditVerdictQuery(connectionId));
  const cursor = cursors[cursors.length - 1] ?? null;
  const page = useQuery({
    ...auditPageQuery(connectionId, cursor, open),
    placeholderData: keepPreviousData,
  });
  const receipt = verdict.data ?? null;
  const entries = page.data?.items ?? [];
  const highWater = verifiedHighWater.get(connectionId) ?? 0;
  const shrunkBy = receipt && receipt.entryCount < highWater ? highWater - receipt.entryCount : 0;
  const broken = (receipt !== null && !receipt.ok) || shrunkBy > 0;
  const unavailable = verdict.isError && receipt === null;
  // A failed re-check must not leave the previous verdict looking current.
  const recheckFailed = verdict.isError && receipt !== null;
  const newSinceCheck = Boolean(
    receipt?.ok
      && open
      && cursor === null
      && page.data
      && !page.isPlaceholderData
      && (entries.length === 0 ? receipt.entryCount !== 0 : entries[0]?.hash !== receipt.tailHash),
  );

  useEffect(() => {
    if (receipt?.ok && receipt.entryCount > (verifiedHighWater.get(connectionId) ?? 0)) {
      verifiedHighWater.set(connectionId, receipt.entryCount);
    }
  }, [connectionId, receipt]);

  const pageItems = page.data?.items;
  useEffect(() => {
    if (!focusId || !pageItems) return;
    const button = rowButtons.current.get(focusId);
    if (!button) return;
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: "nearest" });
    setFocusId(null);
  }, [focusId, pageItems]);

  const anchored = receipt?.anchoredCount ?? 0;
  const [title, detail]: [string, string | null] = unavailable
    ? [t("activity.auditUnavailable"), t("activity.auditVerifyError")]
    : receipt === null
      ? [t("activity.auditVerifying"), null]
      : receipt.firstBadIndex !== null
        ? [
            t("activity.auditChainBrokenAt", {
              position: receipt.firstBadIndex + 1,
              count: receipt.entryCount,
            }),
            t("activity.auditBrokenDetail"),
          ]
        : receipt.anchorStatus === "shorter"
          ? [
              t("activity.auditShrunk", { count: anchored - receipt.entryCount }),
              t("activity.auditAnchorShorterDetail", { anchored }),
            ]
          : receipt.anchorStatus === "tailMismatch"
            ? [t("activity.auditTailReplaced"), t("activity.auditTailReplacedDetail")]
            : receipt.anchorStatus === "longer"
              ? [
                  t("activity.auditUnanchoredRows", { count: receipt.entryCount - anchored }),
                  t("activity.auditUnanchoredRowsDetail"),
                ]
              : receipt.anchorStatus === "missing"
                ? [t("activity.auditAnchorMissing"), t("activity.auditAnchorMissingDetail")]
                : shrunkBy > 0
                  ? [
                      t("activity.auditShrunk", { count: shrunkBy }),
                      t("activity.auditShrunkDetail", { before: highWater }),
                    ]
                  : !receipt.ok
                    ? [t("activity.auditChainBroken"), t("activity.auditBrokenDetail")]
                    : receipt.entryCount === 0
                      ? [t("activity.auditEmptyChain"), null]
                      : [t("activity.auditIntact", { count: receipt.entryCount }), null];
  const icon: IconName = broken || unavailable ? "alert" : receipt ? "shield" : "info";
  const checkedAt = receipt && verdict.dataUpdatedAt > 0
    ? relTime(verdict.dataUpdatedAt, lang)
    : null;

  const jumpToBroken = () => {
    if (!receipt?.firstBadId || receipt.firstBadRowId === null) return;
    setOpen(true);
    setCursors([null, { rowId: receipt.firstBadRowId + 1 }]);
    setSelectedId(receipt.firstBadId);
    setFocusId(receipt.firstBadId);
  };
  const changePage = (next: (AuditCursor | null)[]) => {
    setSelectedId(null);
    setCursors(next);
  };

  return (
    <section
      aria-labelledby="activity-audit-title"
      data-danger={broken || unavailable}
      className="tw:shrink-0 tw:border-b tw:border-border-subtle tw:bg-background tw:data-[danger=true]:border-danger tw:data-[danger=true]:bg-danger-muted"
    >
      <h2 id="activity-audit-title" className="tw:sr-only">{t("activity.auditTitle")}</h2>
      <div className="tw:grid tw:min-h-workbench-toolbar tw:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:px-3 tw:py-1.5 tw:max-[760px]:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)]">
        <Icon
          name={icon}
          data-danger={broken || unavailable}
          className="tw:text-primary tw:data-[danger=true]:text-danger"
        />
        <div className="tw:grid tw:min-w-0 tw:gap-0.5">
          <strong
            className="tw:text-sm tw:leading-ui tw:text-foreground"
            role={broken || unavailable ? "alert" : "status"}
            aria-live="polite"
          >
            {title}
          </strong>
          {detail ? (
            <span className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">{detail}</span>
          ) : null}
          {checkedAt ? (
            <span className="tw:text-xs tw:text-muted-foreground">
              {t("activity.auditCheckedAt", { time: checkedAt })}
              {newSinceCheck ? ` · ${t("activity.auditNewSinceCheck")}` : null}
              {recheckFailed ? (
                <span role="alert" className="tw:text-danger">{` · ${t("activity.auditRecheckFailed")}`}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[760px]:col-start-2 tw:max-[760px]:justify-start">
          {receipt && !receipt.ok && receipt.firstBadRowId !== null ? (
            <Button size="compact" onClick={jumpToBroken}>
              <Icon name="alert" />
              {t("activity.auditJumpToBroken")}
            </Button>
          ) : null}
          <Button
            size="compact"
            disabledBehavior="focusable"
            disabled={verdict.isFetching}
            aria-busy={verdict.isFetching}
            onClick={() => void verdict.refetch()}
          >
            <Icon
              name="refresh"
              data-loading={verdict.isFetching || undefined}
              className="tw:data-[loading=true]:animate-spin tw:motion-reduce:animate-none"
            />
            {verdict.isFetching ? t("activity.auditVerifyingShort") : t("activity.auditVerifyAgain")}
          </Button>
          <Button
            size="compact"
            aria-expanded={open}
            aria-controls="activity-audit-records"
            onClick={() => setOpen((current) => !current)}
          >
            {receipt
              ? t("activity.auditDetailsCount", { count: receipt.entryCount })
              : t("activity.auditDetails")}
            <Icon
              name="chevronRight"
              data-open={open}
              className="tw:transition-transform tw:data-[open=true]:rotate-90 tw:motion-reduce:transition-none"
            />
          </Button>
        </div>
      </div>

      {open ? (
        <div
          id="activity-audit-records"
          role="region"
          aria-labelledby="activity-audit-title"
          className="tw:grid tw:max-h-[min(52vh,520px)] tw:gap-3 tw:overflow-y-auto tw:border-t tw:border-border-subtle tw:bg-background tw:p-3"
        >
          <div className="tw:grid tw:min-w-0 tw:gap-1">
            <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
              {t("activity.auditRecordsDescription")}
            </p>
            <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
              {t("activity.auditScope")}
            </p>
          </div>
          {page.isError ? (
            <p role="alert" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-ui tw:text-danger">
              {t("activity.auditLoadError")}
              <Button size="xs" onClick={() => void page.refetch()}>{t("activity.retry")}</Button>
            </p>
          ) : null}
          {page.isPending ? <Skeleton lines={4} /> : null}
          {!page.isPending && !page.isError && entries.length === 0 ? (
            <p className="tw:m-0 tw:text-ui tw:leading-relaxed tw:text-muted-foreground">
              {t("activity.auditEmpty")}
            </p>
          ) : null}
          {entries.length > 0 ? (
            <ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-2 tw:p-0" aria-busy={page.isFetching}>
              {entries.map((entry) => (
                <AuditRow
                  key={entry.id}
                  connectionId={connectionId}
                  entry={entry}
                  selected={selectedId === entry.id}
                  tampered={receipt?.firstBadId === entry.id}
                  registerButton={(button) => {
                    if (button) rowButtons.current.set(entry.id, button);
                    else rowButtons.current.delete(entry.id);
                  }}
                  onSelect={() => setSelectedId((current) => current === entry.id ? null : entry.id)}
                />
              ))}
            </ul>
          ) : null}
          {cursors.length > 1 || page.data?.nextCursor ? (
            <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
              <Button
                size="compact"
                disabled={cursors.length <= 1 || page.isFetching}
                onClick={() => changePage(cursors.slice(0, -1))}
              >
                {t("common.prev")}
              </Button>
              <Button
                size="compact"
                disabled={!page.data?.nextCursor || page.isFetching}
                onClick={() => {
                  const next = page.data?.nextCursor;
                  if (next) changePage([...cursors, next]);
                }}
              >
                {t("common.next")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
