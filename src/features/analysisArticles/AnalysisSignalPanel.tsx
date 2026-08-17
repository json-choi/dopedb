import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../design-system/components/Modal";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
  StatusDot,
  type StatusTone,
} from "../../design-system/components/Status";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type {
  AnalysisArticleRecord,
  AnalysisBlock,
  AnalysisCollaboratorDirectory,
  AnalysisSignal,
  AnalysisSignalCondition,
  AnalysisSignalCreate,
  AnalysisSignalDefinition,
} from "./domain";
import {
  createAnalysisSignal,
  deleteAnalysisSignal,
  listAnalysisCollaborators,
  listAnalysisNotifications,
  listAnalysisSignalReceipts,
  listAnalysisSignals,
  markAnalysisNotificationsRead,
  setAnalysisSignalEnabled,
  updateAnalysisSignal,
} from "./tauriAdapter";
import { analysisQueryKeys } from "./queryKeys";

type SignalDraft = AnalysisSignalCreate;
type ConditionKind = AnalysisSignalCondition["kind"];
type Translate = ReturnType<typeof useI18n>["t"];

function conditionLabel(kind: ConditionKind, t: Translate): string {
  if (kind === "threshold_above") return t("analysis.signalConditionAbove");
  if (kind === "threshold_below") return t("analysis.signalConditionBelow");
  if (kind === "absolute_change") return t("analysis.signalConditionAbsolute");
  if (kind === "percentage_change") return t("analysis.signalConditionPercentage");
  if (kind === "missing_data") return t("analysis.signalConditionMissing");
  return t("analysis.signalConditionFailure");
}

function signalStateLabel(state: AnalysisSignal["lastObservedState"], t: Translate) {
  if (state === "normal") return t("analysis.signalStateNormal");
  if (state === "firing") return t("analysis.signalStateFiring");
  if (state === "recovered") return t("analysis.signalStateRecovered");
  if (state === "no_data") return t("analysis.signalStateNoData");
  if (state === "error") return t("analysis.signalStateError");
  if (state === "stale") return t("analysis.signalStateStale");
  return t("analysis.signalStateUnknown");
}

function severityLabel(
  severity: AnalysisSignalDefinition["severity"],
  t: Translate,
) {
  if (severity === "critical") return t("analysis.signalSeverityCritical");
  if (severity === "warning") return t("analysis.signalSeverityWarning");
  return t("analysis.signalSeverityInfo");
}

function channelLabel(
  channel: AnalysisSignalDefinition["channels"][number],
  t: Translate,
) {
  if (channel === "desktop") return t("analysis.signalChannelDesktop");
  if (channel === "workspace_web") return t("analysis.signalChannelWorkspace");
  return t("analysis.signalChannelEmail");
}

function eligibleMetricBlocks(article: AnalysisArticleRecord) {
  return article.definition.blocks.filter((block) => {
    if (block.kind !== "metric" || !block.sourceNodeId) return false;
    const metricId = typeof block.config.metricId === "string" ? block.config.metricId : null;
    const metric = article.definition.metrics.find((candidate) => candidate.id === metricId);
    const node = [...article.definition.queries, ...article.definition.transforms]
      .find((candidate) => candidate.id === block.sourceNodeId);
    const column = metric && node
      ? node.columns.find((candidate) => candidate.name === metric.valueColumn) : null;
    return Boolean(
      metric
      && metric.sourceNodeId === block.sourceNodeId
      && column
      && ["number", "duration", "currency", "percent"].includes(column.type)
      && column.masking === "none"
      && ["public", "internal"].includes(column.sensitivity),
    );
  });
}

function defaultDefinition(memberId: string): AnalysisSignalDefinition {
  return {
    condition: { kind: "threshold_above", value: 0 },
    baselineWindowSeconds: null,
    minimumSampleCount: 1,
    cooldownSeconds: 3_600,
    rearmAfterNormalCount: 1,
    severity: "warning",
    recipientMemberIds: memberId ? [memberId] : [],
    channels: ["desktop", "workspace_web"],
    productionConfirmed: false,
  };
}

function newDraft(
  article: AnalysisArticleRecord,
  blocks: AnalysisBlock[],
  directory: AnalysisCollaboratorDirectory | undefined,
): SignalDraft {
  return {
    id: crypto.randomUUID(),
    articleRevision: article.liveRevision ?? article.revision,
    blockId: blocks[0]?.id ?? "",
    definition: defaultDefinition(directory?.currentMemberId ?? article.ownerMemberId),
    enabled: true,
  };
}

function conditionWithKind(kind: ConditionKind): AnalysisSignalCondition {
  if (kind === "percentage_change") return { kind, percentage: 10 };
  if (kind === "missing_data" || kind === "consecutive_failure") return { kind, count: 2 };
  return { kind, value: 0 };
}

function conditionAmount(condition: AnalysisSignalCondition): number {
  if ("value" in condition) return condition.value;
  if ("percentage" in condition) return condition.percentage;
  return condition.count;
}

function withConditionAmount(
  condition: AnalysisSignalCondition,
  amount: number,
): AnalysisSignalCondition {
  if ("value" in condition) return { ...condition, value: amount };
  if ("percentage" in condition) return { ...condition, percentage: amount };
  return { ...condition, count: Math.max(1, Math.trunc(amount)) };
}

function signalTone(state: string): StatusTone {
  if (state === "normal" || state === "recovered") return "success";
  if (state === "firing" || state === "error" || state === "stale") return "danger";
  if (state === "no_data") return "warning";
  return "neutral";
}

function canManage(directory: AnalysisCollaboratorDirectory | undefined) {
  return directory ? ["editor", "admin", "owner"].includes(directory.currentRole) : false;
}

export function AnalysisSignalPanel({
  article,
  scopeKey,
}: {
  article: AnalysisArticleRecord;
  scopeKey: string;
}) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const signalKey = analysisQueryKeys.signals(scopeKey, article.id);
  const signals = useQuery({
    queryKey: signalKey,
    queryFn: () => listAnalysisSignals(article.id),
    retry: false,
  });
  const collaborators = useQuery({
    queryKey: analysisQueryKeys.collaborators(scopeKey),
    queryFn: listAnalysisCollaborators,
    retry: false,
  });
  const notifications = useQuery({
    queryKey: analysisQueryKeys.notifications(scopeKey),
    queryFn: listAnalysisNotifications,
    retry: false,
  });
  const metricBlocks = useMemo(() => eligibleMetricBlocks(article), [article]);
  const [draft, setDraft] = useState<SignalDraft | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSignal = signals.data?.find((signal) => signal.id === selectedSignalId) ?? null;
  const receipts = useQuery({
    queryKey: analysisQueryKeys.signalReceipts(scopeKey, article.id, selectedSignalId),
    queryFn: () => listAnalysisSignalReceipts(article.id, selectedSignalId!),
    enabled: Boolean(selectedSignalId),
    retry: false,
  });

  useEffect(() => {
    if (selectedSignalId && signals.data?.some((signal) => signal.id === selectedSignalId)) return;
    setSelectedSignalId(signals.data?.[0]?.id ?? null);
  }, [selectedSignalId, signals.data]);

  const refresh = async (signalId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: signalKey }),
      queryClient.invalidateQueries({ queryKey: analysisQueryKeys.notifications(scopeKey) }),
      signalId
        ? queryClient.invalidateQueries({ queryKey: analysisQueryKeys.signalReceipts(scopeKey, article.id, signalId) })
        : Promise.resolve(),
    ]);
  };
  const save = useMutation({
    mutationFn: (value: SignalDraft) => editingRevision === null
      ? createAnalysisSignal(article.id, value)
      : updateAnalysisSignal(article.id, value.id, editingRevision, value),
    onSuccess: async (signal) => {
      setError(null);
      setDraft(null);
      setEditingRevision(null);
      setSelectedSignalId(signal.id);
      await refresh(signal.id);
    },
    onError: (cause) => setError(errMessage(cause)),
  });
  const toggle = useMutation({
    mutationFn: (signal: AnalysisSignal) => setAnalysisSignalEnabled(
      article.id,
      signal.id,
      signal.revision,
      !signal.enabled,
    ),
    onSuccess: async (signal) => {
      setError(null);
      await refresh(signal.id);
    },
    onError: (cause) => setError(errMessage(cause)),
  });
  const remove = useMutation({
    mutationFn: (signal: AnalysisSignal) => deleteAnalysisSignal(
      article.id,
      signal.id,
      signal.revision,
    ),
    onSuccess: async (_, signal) => {
      setError(null);
      setSelectedSignalId(null);
      await refresh(signal.id);
    },
    onError: (cause) => setError(errMessage(cause)),
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => markAnalysisNotificationsRead(ids),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: analysisQueryKeys.notifications(scopeKey) });
    },
    onError: (cause) => setError(errMessage(cause)),
  });

  const openNew = () => {
    setEditingRevision(null);
    setDraft(newDraft(article, metricBlocks, collaborators.data));
  };
  const openEdit = (signal: AnalysisSignal) => {
    setEditingRevision(signal.revision);
    setDraft({
      id: signal.id,
      articleRevision: article.liveRevision ?? article.revision,
      blockId: signal.blockId,
      definition: structuredClone(signal.definition),
      enabled: signal.enabled,
    });
  };
  const unread = (notifications.data ?? []).filter((notification) => notification.readAt === null);
  const manager = canManage(collaborators.data);

  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[1180px] tw:gap-5 tw:p-5 tw:@max-[760px]:p-3">
      {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
      {article.state !== "live" ? (
        <InlineNotice tone="warning" icon="alert">
          {t("analysis.signalLiveFirst")}
        </InlineNotice>
      ) : null}
      <section className="tw:grid tw:gap-3">
        <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
          <span className="tw:grid tw:gap-1">
            <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.signalTitle")}</h2>
            <span className="tw:text-xs tw:text-muted-foreground">{t("analysis.signalBody")}</span>
          </span>
          {manager ? (
            <Button
              size="compact"
              variant="primary"
              disabled={article.state !== "live" || metricBlocks.length === 0}
              onClick={openNew}
            >
              <Icon name="plus" /> {t("analysis.signalNew")}
            </Button>
          ) : null}
        </div>
        {metricBlocks.length === 0 ? (
          <InlineNotice tone="warning" icon="alert">
            {t("analysis.signalMetricRequired")}
          </InlineNotice>
        ) : null}
        {signals.isPending ? <LoadingLabel>{t("analysis.signalLoading")}</LoadingLabel> : signals.error ? (
          <InlineNotice tone="danger" icon="alert">{errMessage(signals.error)}</InlineNotice>
        ) : signals.data?.length ? (
          <div className="tw:grid tw:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] tw:gap-4 tw:@max-[820px]:grid-cols-1">
            <div className="tw:grid tw:content-start tw:gap-2">
              {signals.data.map((signal) => {
                const block = article.definition.blocks.find((candidate) => candidate.id === signal.blockId);
                return (
                  <button
                    type="button"
                    key={signal.id}
                    data-selected={selectedSignalId === signal.id}
                    className="tw:grid tw:w-full tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-start tw:gap-x-2 tw:gap-y-1 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3 tw:text-left tw:font-sans tw:text-foreground tw:data-[selected=true]:border-ring tw:data-[selected=true]:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                    onClick={() => setSelectedSignalId(signal.id)}
                  >
                    <StatusDot tone={signal.enabled ? signalTone(signal.lastObservedState) : "neutral"} />
                    <strong className="tw:min-w-0 tw:truncate tw:text-sm tw:font-medium">{block?.title || signal.blockId}</strong>
                    <StatusBadge density="compact" tone={signal.enabled ? signalTone(signal.lastObservedState) : "neutral"}>
                      {signal.enabled ? signalStateLabel(signal.lastObservedState, t) : t("analysis.signalDisabled")}
                    </StatusBadge>
                    <span className="tw:col-start-2 tw:text-xs tw:text-muted-foreground">{conditionLabel(signal.definition.condition.kind, t)} · {severityLabel(signal.definition.severity, t)}</span>
                    <span className="tw:col-start-2 tw:font-mono tw:text-2xs tw:text-muted-foreground">{t("analysis.signalRevision", { revision: signal.revision })}</span>
                  </button>
                );
              })}
            </div>
            {selectedSignal ? (
              <SignalDetail
                article={article}
                signal={selectedSignal}
                manager={manager}
                busy={toggle.isPending || remove.isPending}
                receipts={receipts.data ?? []}
                loadingReceipts={receipts.isPending}
                onEdit={() => openEdit(selectedSignal)}
                onToggle={() => toggle.mutate(selectedSignal)}
                onDelete={() => remove.mutate(selectedSignal)}
              />
            ) : null}
          </div>
        ) : (
          <div className="tw:rounded-md tw:border tw:border-dashed tw:border-border-subtle tw:p-5 tw:text-sm tw:text-muted-foreground">{t("analysis.signalEmpty")}</div>
        )}
      </section>

      <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <span className="tw:grid tw:gap-1">
            <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.signalInbox")}</h2>
            <span className="tw:text-xs tw:text-muted-foreground">{t("analysis.signalInboxBody")}</span>
          </span>
          {unread.length ? (
            <Button size="compact" disabled={markRead.isPending} onClick={() => markRead.mutate(unread.map((item) => item.id))}>
              {t("analysis.signalMarkRead")}
            </Button>
          ) : null}
        </div>
        {notifications.isPending ? <LoadingLabel>{t("analysis.signalNotificationLoading")}</LoadingLabel> : notifications.error ? (
          <InlineNotice tone="danger" icon="alert">{errMessage(notifications.error)}</InlineNotice>
        ) : notifications.data?.length ? (
          <div className="tw:grid tw:gap-2">
            {notifications.data.map((notification) => (
              <div key={notification.id} data-unread={notification.readAt === null} className="tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-start tw:gap-2 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3 tw:data-[unread=true]:border-warning/60">
                <StatusDot tone={signalTone(notification.state)} />
                <span className="tw:grid tw:min-w-0 tw:gap-0.5">
                  <strong className="tw:truncate tw:text-sm tw:font-medium">{notification.articleTitle} · {signalStateLabel(notification.state, t)}</strong>
                  <span className="tw:text-xs tw:text-muted-foreground">{notification.blockId} · {new Date(notification.evaluatedAt).toLocaleString(lang)}</span>
                </span>
                <StatusBadge density="compact" tone={notification.severity === "critical" ? "danger" : notification.severity === "warning" ? "warning" : "neutral"}>{severityLabel(notification.severity, t)}</StatusBadge>
              </div>
            ))}
          </div>
        ) : <span className="tw:text-sm tw:text-muted-foreground">{t("analysis.signalNotificationEmpty")}</span>}
      </section>

      {draft ? (
        <SignalEditor
          draft={draft}
          article={article}
          blocks={metricBlocks}
          directory={collaborators.data}
          saving={save.isPending}
          editing={editingRevision !== null}
          onChange={setDraft}
          onClose={() => {
            setDraft(null);
            setEditingRevision(null);
          }}
          onSave={() => save.mutate(draft)}
        />
      ) : null}
    </div>
  );
}

function SignalDetail({
  article,
  signal,
  manager,
  busy,
  receipts,
  loadingReceipts,
  onEdit,
  onToggle,
  onDelete,
}: {
  article: AnalysisArticleRecord;
  signal: AnalysisSignal;
  manager: boolean;
  busy: boolean;
  receipts: Awaited<ReturnType<typeof listAnalysisSignalReceipts>>;
  loadingReceipts: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { lang, t } = useI18n();
  const block = article.definition.blocks.find((candidate) => candidate.id === signal.blockId);
  return (
    <div className="tw:grid tw:content-start tw:gap-4 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-4">
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-2">
        <span className="tw:grid tw:min-w-0 tw:gap-1">
          <h3 className="tw:m-0 tw:truncate tw:text-sm tw:font-semibold">{block?.title || signal.blockId}</h3>
          <span className="tw:text-xs tw:text-muted-foreground">{conditionLabel(signal.definition.condition.kind, t)} {conditionAmount(signal.definition.condition).toLocaleString(lang)}</span>
        </span>
        {manager ? (
          <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-1">
            <Button size="xs" disabled={busy} onClick={onToggle}>{signal.enabled ? t("analysis.signalDisable") : t("analysis.signalEnable")}</Button>
            <Button size="xs" disabled={busy} onClick={onEdit}>{t("analysis.edit")}</Button>
            <ConfirmButton size="xs" variant="dangerGhost" disabled={busy} confirmLabel={t("analysis.signalDeleteConfirm")} onConfirm={onDelete}>{t("analysis.signalDelete")}</ConfirmButton>
          </span>
        ) : null}
      </div>
      <dl className="tw:grid tw:grid-cols-[150px_minmax(0,1fr)] tw:gap-x-3 tw:gap-y-2 tw:text-xs tw:@max-[520px]:grid-cols-1">
        <dt className="tw:text-muted-foreground">{t("analysis.signalLiveRevision")}</dt><dd className="tw:m-0 tw:font-mono">{signal.articleRevision}</dd>
        <dt className="tw:text-muted-foreground">{t("analysis.signalMinimumSample")}</dt><dd className="tw:m-0">{signal.definition.minimumSampleCount.toLocaleString(lang)}</dd>
        <dt className="tw:text-muted-foreground">{t("analysis.signalCooldown")}</dt><dd className="tw:m-0">{t("analysis.signalMinutes", { count: Math.round(signal.definition.cooldownSeconds / 60) })}</dd>
        <dt className="tw:text-muted-foreground">{t("analysis.signalRecipients")}</dt><dd className="tw:m-0">{signal.definition.recipientMemberIds.length}</dd>
        <dt className="tw:text-muted-foreground">{t("analysis.signalChannels")}</dt><dd className="tw:m-0">{signal.definition.channels.map((channel) => channelLabel(channel, t)).join(", ")}</dd>
        <dt className="tw:text-muted-foreground">{t("analysis.signalLastRun")}</dt><dd className="tw:m-0 tw:truncate tw:font-mono">{signal.lastEvaluatedRunId ?? t("analysis.never")}</dd>
      </dl>
      <section className="tw:grid tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
        <h4 className="tw:m-0 tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide tw:text-muted-foreground">{t("analysis.signalEvidence")}</h4>
        {loadingReceipts ? <LoadingLabel>{t("analysis.loadingEvidence")}</LoadingLabel> : receipts.length ? receipts.map((receipt) => (
          <details key={receipt.id} className="tw:rounded-sm tw:border tw:border-border-subtle tw:bg-background tw:p-2">
            <summary className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-xs">
              <StatusDot tone={signalTone(receipt.state)} />
              <strong className="tw:font-medium">{signalStateLabel(receipt.state, t)}</strong>
              <span className="tw:text-muted-foreground">{new Date(receipt.evaluatedAt).toLocaleString(lang)}</span>
              <span className="tw:ml-auto tw:font-mono tw:text-2xs">#{receipt.transitionSequence}</span>
            </summary>
            <dl className="tw:mt-2 tw:grid tw:grid-cols-[100px_minmax(0,1fr)] tw:gap-x-2 tw:gap-y-1 tw:text-2xs">
              <dt className="tw:text-muted-foreground">{t("analysis.signalRun")}</dt><dd className="tw:m-0 tw:truncate tw:font-mono">{receipt.runId}</dd>
              <dt className="tw:text-muted-foreground">{t("analysis.signalSchema")}</dt><dd className="tw:m-0 tw:truncate tw:font-mono">{receipt.schemaFingerprint}</dd>
              <dt className="tw:text-muted-foreground">{t("analysis.signalResultHash")}</dt><dd className="tw:m-0 tw:truncate tw:font-mono">{receipt.resultHash ?? receipt.errorKind ?? t("analysis.signalNoResultHash")}</dd>
            </dl>
          </details>
        )) : <span className="tw:text-xs tw:text-muted-foreground">{t("analysis.signalNoEvidence")}</span>}
      </section>
    </div>
  );
}

function SignalEditor({
  draft,
  article,
  blocks,
  directory,
  saving,
  editing,
  onChange,
  onClose,
  onSave,
}: {
  draft: SignalDraft;
  article: AnalysisArticleRecord;
  blocks: AnalysisBlock[];
  directory: AnalysisCollaboratorDirectory | undefined;
  saving: boolean;
  editing: boolean;
  onChange: (draft: SignalDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const patchDefinition = (patch: Partial<AnalysisSignalDefinition>) => onChange({
    ...draft,
    definition: { ...draft.definition, ...patch },
  });
  const kind = draft.definition.condition.kind;
  const changeCondition = (next: ConditionKind) => patchDefinition({
    condition: conditionWithKind(next),
    baselineWindowSeconds: next === "absolute_change" || next === "percentage_change"
      ? 86_400 : null,
  });
  const valid = Boolean(
    draft.blockId
    && draft.definition.recipientMemberIds.length
    && draft.definition.channels.length
    && draft.definition.productionConfirmed
    && Number.isFinite(conditionAmount(draft.definition.condition))
    && draft.definition.minimumSampleCount >= 0
    && draft.definition.rearmAfterNormalCount >= 1,
  );
  return (
    <ModalBackdrop onMouseDown={onClose}>
      <ModalSurface
        size="settings"
        aria-labelledby="analysis-signal-editor-title"
        onEscape={saving ? undefined : onClose}
      >
        <ModalTitleBar
          title={editing ? t("analysis.signalEditTitle") : t("analysis.signalNewTitle")}
          titleId="analysis-signal-editor-title"
          closeLabel={t("analysis.signalCloseEditor")}
          onClose={onClose}
        />
        <div className="scrollbar-sleek tw:grid tw:min-h-0 tw:gap-5 tw:overflow-auto tw:p-4">
          <span className="tw:text-xs tw:text-muted-foreground">{t("analysis.signalPinned", { title: article.definition.title, revision: article.liveRevision ?? article.revision })}</span>
          <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[620px]:grid-cols-1">
            <Field label={t("analysis.signalMetricBlock")}>
              <SelectInput value={draft.blockId} onChange={(event) => onChange({ ...draft, blockId: event.target.value })}>
                {blocks.map((block) => <option key={block.id} value={block.id}>{block.title || block.id}</option>)}
              </SelectInput>
            </Field>
            <Field label={t("analysis.signalCondition")}>
              <SelectInput value={kind} onChange={(event) => changeCondition(event.target.value as ConditionKind)}>
                {(["threshold_above", "threshold_below", "absolute_change", "percentage_change", "missing_data", "consecutive_failure"] as const).map((value) => <option key={value} value={value}>{conditionLabel(value, t)}</option>)}
              </SelectInput>
            </Field>
            <Field label={kind === "percentage_change" ? t("analysis.signalChangePercent") : kind === "missing_data" || kind === "consecutive_failure" ? t("analysis.signalConsecutiveRuns") : t("analysis.signalThreshold")}>
              <TextInput type="number" step={kind === "missing_data" || kind === "consecutive_failure" ? 1 : "any"} min={kind === "percentage_change" || kind === "missing_data" || kind === "consecutive_failure" ? 0 : undefined} value={conditionAmount(draft.definition.condition)} onChange={(event) => patchDefinition({ condition: withConditionAmount(draft.definition.condition, Number(event.target.value)) })} />
            </Field>
            {draft.definition.baselineWindowSeconds !== null ? (
              <Field label={t("analysis.signalBaselineHours")}>
                <TextInput type="number" min={1} max={8784} value={Math.round(draft.definition.baselineWindowSeconds / 3_600)} onChange={(event) => patchDefinition({ baselineWindowSeconds: Math.max(1, Number(event.target.value)) * 3_600 })} />
              </Field>
            ) : null}
            <Field label={t("analysis.signalMinimumSampleCount")}>
              <TextInput type="number" min={0} step={1} value={draft.definition.minimumSampleCount} onChange={(event) => patchDefinition({ minimumSampleCount: Math.max(0, Math.trunc(Number(event.target.value))) })} />
            </Field>
            <Field label={t("analysis.signalCooldownMinutes")}>
              <TextInput type="number" min={0} step={1} value={Math.round(draft.definition.cooldownSeconds / 60)} onChange={(event) => patchDefinition({ cooldownSeconds: Math.max(0, Math.trunc(Number(event.target.value))) * 60 })} />
            </Field>
            <Field label={t("analysis.signalRecoveryRuns")}>
              <TextInput type="number" min={1} max={1000} step={1} value={draft.definition.rearmAfterNormalCount} onChange={(event) => patchDefinition({ rearmAfterNormalCount: Math.max(1, Math.trunc(Number(event.target.value))) })} />
            </Field>
            <Field label={t("analysis.signalSeverity")}>
              <SelectInput value={draft.definition.severity} onChange={(event) => patchDefinition({ severity: event.target.value as AnalysisSignalDefinition["severity"] })}>
                <option value="info">{t("analysis.signalSeverityInfo")}</option>
                <option value="warning">{t("analysis.signalSeverityWarning")}</option>
                <option value="critical">{t("analysis.signalSeverityCritical")}</option>
              </SelectInput>
            </Field>
          </div>
          <fieldset className="tw:grid tw:gap-2 tw:rounded-md tw:border tw:border-border-subtle tw:p-3">
            <legend className="tw:px-1 tw:text-sm tw:font-semibold">{t("analysis.signalRecipients")}</legend>
            <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:@max-[520px]:grid-cols-1">
              {(directory?.members ?? []).map((member) => (
                <CheckboxField
                  key={member.id}
                  checked={draft.definition.recipientMemberIds.includes(member.id)}
                  label={<span>{member.name} <small className="tw:text-muted-foreground">{member.role}</small></span>}
                  onChange={(event) => patchDefinition({
                    recipientMemberIds: event.target.checked
                      ? [...draft.definition.recipientMemberIds, member.id]
                      : draft.definition.recipientMemberIds.filter((id) => id !== member.id),
                  })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="tw:grid tw:gap-2 tw:rounded-md tw:border tw:border-border-subtle tw:p-3">
            <legend className="tw:px-1 tw:text-sm tw:font-semibold">{t("analysis.signalDelivery")}</legend>
            <div className="tw:flex tw:flex-wrap tw:gap-4">
              {(["desktop", "workspace_web", "email"] as const).map((channel) => (
                <CheckboxField key={channel} checked={draft.definition.channels.includes(channel)} label={channelLabel(channel, t)} onChange={(event) => patchDefinition({ channels: event.target.checked ? [...draft.definition.channels, channel] : draft.definition.channels.filter((value) => value !== channel) })} />
              ))}
            </div>
          </fieldset>
          <InlineNotice tone="warning" icon="alert">
            {t("analysis.signalSafetyBody")}
          </InlineNotice>
          <CheckboxField checked={draft.definition.productionConfirmed} label={t("analysis.signalProductionConfirm")} onChange={(event) => patchDefinition({ productionConfirmed: event.target.checked })} />
        </div>
        <ModalFooter>
          <Button disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={saving || !valid} onClick={onSave}>{saving ? t("analysis.signalSaving") : editing ? t("analysis.signalSaveRevision") : t("analysis.signalCreate")}</Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
