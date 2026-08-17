import { useMemo, useState } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  CheckboxField,
  PropertyRow,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../design-system/components/Modal";
import { PanelTabs } from "../../design-system/components/PanelTabs";
import { InlineNotice, StatusBadge, StatusDot } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { EnvironmentConnection, KnowledgeEnvironment } from "../knowledge/domain";
import type { AnalysisArticleRecord, SharedAnalysisArticleCreate } from "./domain";
import {
  AnalysisDataContractEditor,
  AnalysisLayoutEditor,
  AnalysisTransformEditor,
} from "./AnalysisDefinitionBuilder";

type EditorTab = "overview" | "data" | "transforms" | "layout" | "refresh" | "authority";

function existingInput(article: AnalysisArticleRecord): SharedAnalysisArticleCreate {
  return {
    id: article.id,
    projectEnvironmentId: article.projectEnvironmentId,
    environmentRevision: article.environmentRevision,
    sourceKnowledgeGrantId: article.sourceKnowledgeGrantId,
    graphRevisionIds: [...article.graphRevisionIds],
    connections: article.connections.map((connection) => ({ ...connection })),
    definition: structuredClone(article.definition),
  };
}

export function AnalysisArticleEditor({
  article,
  environment,
  bindings,
  runners,
  saving,
  onSave,
  onClose,
}: {
  article: AnalysisArticleRecord;
  environment: KnowledgeEnvironment;
  bindings: readonly EnvironmentConnection[];
  runners: ReadonlyArray<{
    id: string;
    displayName: string;
    online: boolean;
    backgroundAllowed: boolean;
  }>;
  saving: boolean;
  onSave: (article: SharedAnalysisArticleCreate) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const editorTabs = useMemo(() => [
    { id: "overview", label: t("analysis.editorTabOverview") },
    { id: "data", label: t("analysis.editorTabData") },
    { id: "transforms", label: t("analysis.editorTabTransforms") },
    { id: "layout", label: t("analysis.editorTabLayout") },
    { id: "refresh", label: t("analysis.editorTabRefresh") },
    { id: "authority", label: t("analysis.editorTabAuthority") },
  ] as const, [t]);
  const initial = useMemo(
    () => existingInput(article),
    [article],
  );
  const [tab, setTab] = useState<EditorTab>("overview");
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const selectedConnectionIds = new Set(draft.connections.map((connection) => connection.connectionId));

  const patchDefinition = (patch: Partial<SharedAnalysisArticleCreate["definition"]>) => {
    setDraft((current) => ({
      ...current,
      definition: { ...current.definition, ...patch },
    }));
  };

  const toggleBinding = (binding: EnvironmentConnection) => {
    if (!binding.remoteConnectionId) return;
    setDraft((current) => {
      const exists = current.connections.some(
        (connection) => connection.connectionId === binding.remoteConnectionId,
      );
      return {
        ...current,
        connections: exists
          ? current.connections.filter(
              (connection) => connection.connectionId !== binding.remoteConnectionId,
            )
          : [...current.connections, {
              connectionId: binding.remoteConnectionId!,
              connectionRevision: binding.connectionRevision,
              role: binding.role,
              alias: binding.alias,
            }],
      };
    });
  };

  const submit = () => {
    try {
      const next: SharedAnalysisArticleCreate = draft;
      if (!next.definition.title.trim()) throw new Error(t("analysis.editorTitleRequired"));
      if (next.connections.length === 0) throw new Error(t("analysis.editorConnectionRequired"));
      setError(null);
      onSave(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <ModalBackdrop onMouseDown={onClose}>
      <ModalSurface
        size="wide"
        fill
        aria-labelledby="analysis-editor-title"
        onEscape={saving ? undefined : onClose}
      >
        <ModalTitleBar
          title={t("analysis.editorTitle", { title: article.definition.title })}
          titleId="analysis-editor-title"
          closeLabel={t("analysis.editorClose")}
          onClose={onClose}
        />
        <PanelTabs tabs={editorTabs} active={tab} onChange={setTab} label={t("analysis.editorLabel")} />
        <div className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:p-5">
          {error ? (
            <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice>
          ) : null}

          {tab === "overview" ? (
            <div className="tw:grid tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorOverviewTitle")}</h2>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("analysis.editorOverviewBody")}
                </p>
              </div>
              <PropertyRow label={t("analysis.fieldTitle")} htmlFor="analysis-title">
                <TextInput
                  id="analysis-title"
                  value={draft.definition.title}
                  maxLength={160}
                  onChange={(event) => patchDefinition({ title: event.target.value })}
                />
              </PropertyRow>
              <PropertyRow label={t("analysis.fieldQuestion")} htmlFor="analysis-question">
                <TextAreaInput
                  id="analysis-question"
                  value={draft.definition.question}
                  onChange={(event) => patchDefinition({ question: event.target.value })}
                />
              </PropertyRow>
              <PropertyRow label={t("analysis.fieldSummary")} htmlFor="analysis-summary">
                <TextAreaInput
                  id="analysis-summary"
                  value={draft.definition.summary}
                  onChange={(event) => patchDefinition({ summary: event.target.value })}
                />
              </PropertyRow>
              <PropertyRow label={t("analysis.fieldTimezone")} htmlFor="analysis-timezone">
                <TextInput
                  id="analysis-timezone"
                  value={draft.definition.timezone}
                  onChange={(event) => patchDefinition({ title: draft.definition.title, timezone: event.target.value })}
                />
              </PropertyRow>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="tw:grid tw:gap-5">
              <section className="tw:grid tw:gap-3">
                <div className="tw:grid tw:gap-1">
                  <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorDatabasesTitle")}</h2>
                  <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                    {t("analysis.editorDatabasesBody")}
                  </p>
                </div>
                {bindings.length === 0 ? (
                  <InlineNotice tone="warning" icon="alert">{t("analysis.editorConnectFirst")}</InlineNotice>
                ) : (
                  <div className="tw:grid tw:gap-1 tw:rounded-md tw:border tw:border-border-subtle tw:p-2">
                    {bindings.map((binding) => {
                      const available = Boolean(binding.remoteConnectionId) && !binding.stale;
                      return (
                        <div key={binding.id} className="tw:flex tw:min-h-control-lg tw:items-center tw:rounded-sm tw:px-2 tw:hover:bg-muted tw:[&>label]:flex-1">
                          <CheckboxField
                            checked={Boolean(binding.remoteConnectionId && selectedConnectionIds.has(binding.remoteConnectionId))}
                            disabled={!available}
                            onChange={() => toggleBinding(binding)}
                            label={(
                              <>
                                <StatusDot tone={binding.stale ? "warning" : available ? "success" : "danger"} />
                                <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">{binding.alias || binding.connectionName}</span>
                                <code className="tw:text-xs tw:text-muted-foreground">{binding.role} · r{binding.connectionRevision}</code>
                              </>
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              <AnalysisDataContractEditor
                definition={draft.definition}
                connections={draft.connections}
                onChange={(definition) => setDraft((current) => ({ ...current, definition }))}
              />
            </div>
          ) : null}

          {tab === "transforms" ? (
            <div className="tw:grid tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorTransformsTitle")}</h2>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("analysis.editorTransformsBody")}
                </p>
              </div>
              <AnalysisTransformEditor
                definition={draft.definition}
                onChange={(definition) => setDraft((current) => ({ ...current, definition }))}
              />
            </div>
          ) : null}

          {tab === "layout" ? (
            <div className="tw:grid tw:gap-5">
              <div className="tw:grid tw:gap-1">
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorLayoutTitle")}</h2>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("analysis.editorLayoutBody")}
                </p>
              </div>
              <AnalysisLayoutEditor
                definition={draft.definition}
                onChange={(definition) => setDraft((current) => ({ ...current, definition }))}
              />
            </div>
          ) : null}

          {tab === "refresh" ? (
            <div className="tw:grid tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorRefreshTitle")}</h2>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("analysis.editorRefreshBody")}
                </p>
              </div>
              <PropertyRow label={t("analysis.fieldMode")} htmlFor="analysis-refresh-mode">
                <SelectInput
                  id="analysis-refresh-mode"
                  value={draft.definition.refresh.mode}
                  onChange={(event) => {
                    const mode = event.target.value === "scheduled" ? "scheduled" : "manual";
                    patchDefinition({
                      refresh: {
                        ...draft.definition.refresh,
                        mode,
                        cron: mode === "scheduled" ? draft.definition.refresh.cron ?? "0 9 * * *" : null,
                        runnerId: mode === "scheduled" ? draft.definition.refresh.runnerId ?? runners[0]?.id ?? null : null,
                      },
                    });
                  }}
                >
                  <option value="manual">{t("analysis.modeManual")}</option>
                  <option value="scheduled">{t("analysis.modeScheduled")}</option>
                </SelectInput>
              </PropertyRow>
              {draft.definition.refresh.mode === "scheduled" ? (
                <>
                  <PropertyRow label={t("analysis.fieldRunner")} htmlFor="analysis-runner">
                    <SelectInput
                      id="analysis-runner"
                      value={draft.definition.refresh.runnerId ?? ""}
                      onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, runnerId: event.target.value || null } })}
                    >
                      <option value="">{t("analysis.selectRunner")}</option>
                      {runners.map((runner) => (
                        <option key={runner.id} value={runner.id} disabled={!runner.online || !runner.backgroundAllowed}>
                          {runner.displayName}{runner.online ? ` · ${t("analysis.online")}` : ` · ${t("analysis.offline")}`}{runner.backgroundAllowed ? "" : ` · ${t("analysis.backgroundDisabled")}`}
                        </option>
                      ))}
                    </SelectInput>
                  </PropertyRow>
                  <PropertyRow label={t("analysis.fieldCron")} htmlFor="analysis-cron">
                    <TextInput
                      id="analysis-cron"
                      value={draft.definition.refresh.cron ?? ""}
                      placeholder="0 9 * * *"
                      onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, cron: event.target.value } })}
                    />
                  </PropertyRow>
                </>
              ) : null}
              <PropertyRow label={t("analysis.fieldTimezone")} htmlFor="analysis-refresh-timezone">
                <TextInput
                  id="analysis-refresh-timezone"
                  value={draft.definition.refresh.timezone}
                  onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, timezone: event.target.value } })}
                />
              </PropertyRow>
              <PropertyRow label={t("analysis.fieldStaleAfter")} htmlFor="analysis-staleness">
                <TextInput
                  id="analysis-staleness"
                  type="number"
                  min={60}
                  value={draft.definition.refresh.maxStalenessSeconds}
                  onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, maxStalenessSeconds: event.target.valueAsNumber } })}
                />
              </PropertyRow>
              <PropertyRow label={t("analysis.fieldRetention")} htmlFor="analysis-retention">
                <TextInput
                  id="analysis-retention"
                  type="number"
                  min={1}
                  max={365}
                  value={draft.definition.refresh.resultRetentionDays}
                  onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, resultRetentionDays: event.target.valueAsNumber } })}
                />
              </PropertyRow>
              <CheckboxField
                label={t("analysis.shareReviewedResults")}
                checked={draft.definition.refresh.shareReviewedResults}
                onChange={(event) => patchDefinition({ refresh: { ...draft.definition.refresh, shareReviewedResults: event.target.checked } })}
              />
            </div>
          ) : null}

          {tab === "authority" ? (
            <div className="tw:grid tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.editorAuthorityTitle")}</h2>
                <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
                  {t("analysis.editorAuthorityBody")}
                </p>
              </div>
              <dl className="tw:grid tw:grid-cols-[minmax(130px,auto)_minmax(0,1fr)] tw:gap-x-4 tw:gap-y-3 tw:text-sm tw:@max-[560px]:grid-cols-1 tw:@max-[560px]:gap-y-1">
                <dt className="tw:text-muted-foreground">{t("analysis.articleId")}</dt>
                <dd className="tw:m-0 tw:truncate tw:font-mono">{draft.id}</dd>
                <dt className="tw:text-muted-foreground">{t("analysis.environment")}</dt>
                <dd className="tw:m-0 tw:font-mono">{environment.name} · r{draft.environmentRevision}</dd>
                <dt className="tw:text-muted-foreground">{t("analysis.knowledgeGrant")}</dt>
                <dd className="tw:m-0 tw:truncate tw:font-mono">{draft.sourceKnowledgeGrantId ?? t("analysis.none")}</dd>
                <dt className="tw:text-muted-foreground">{t("analysis.graphRevisions")}</dt>
                <dd className="tw:m-0 tw:grid tw:gap-1 tw:font-mono">
                  {draft.graphRevisionIds.length ? draft.graphRevisionIds.map((id) => <span className="tw:truncate" key={id}>{id}</span>) : t("analysis.none")}
                </dd>
                <dt className="tw:text-muted-foreground">{t("analysis.connectionRevisions")}</dt>
                <dd className="tw:m-0 tw:grid tw:gap-1">
                  {draft.connections.map((connection) => (
                    <span key={connection.connectionId} className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      <code className="tw:min-w-0 tw:flex-1 tw:truncate">{connection.alias}</code>
                      <StatusBadge density="compact">{connection.role} · r{connection.connectionRevision}</StatusBadge>
                    </span>
                  ))}
                </dd>
              </dl>
              {draft.environmentRevision !== environment.revision ? (
                <InlineNotice tone="warning" icon="alert">
                  {t("analysis.environmentRevisionChanged", {
                    pinned: draft.environmentRevision,
                    current: environment.revision,
                  })}
                </InlineNotice>
              ) : null}
            </div>
          ) : null}
        </div>
        <ModalFooter>
          <Button onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" /> : null}
            {t("analysis.saveRevision")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
