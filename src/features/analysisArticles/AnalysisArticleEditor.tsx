// Edits one Article draft and its exact saved-query definition before handing it to the caller.
// Save failures and revision conflicts stay inside this dialog; a conflict keeps the draft
// and re-bases it on the latest revision, and unsaved edits are never discarded silently.

import { useMemo, useState } from "react";

import { Button } from "../../design-system/components/Button";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  PropertyRow,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { EnvironmentConnection } from "../knowledge/domain";
import type { AnalysisFailure } from "./analysisFeedback";
import type {
  AnalysisArticleDocument,
  AnalysisQueryNode,
  SharedAnalysisArticleCreate,
} from "./domain";

type Draft = Readonly<{ title: string; html: string; sql: string; connectionId: string }>;

function draftOf(article: AnalysisArticleDocument): Draft {
  return {
    title: article.definition.title,
    html: article.definition.html,
    sql: article.definition.query.sql,
    connectionId: article.connectionId,
  };
}

// A person's save is attributed to the person even when the edited revision was
// Agent-authored; Desktop's save command enforces the same rule.
function simpleDefinition(
  title: string,
  html: string,
  query: AnalysisQueryNode,
): SharedAnalysisArticleCreate["definition"] {
  return {
    version: 3,
    source: "human",
    title,
    html,
    query,
  };
}

export function AnalysisArticleEditor({
  base,
  failure,
  conflict,
  notice,
  bindings,
  saving,
  reloading,
  onSave,
  onReloadLatest,
  onClose,
}: {
  /** The revision the draft applies to; a conflict replaces it with the latest one. */
  base: AnalysisArticleDocument;
  failure: AnalysisFailure | null;
  conflict: Readonly<{ latestUnavailable: boolean }> | null;
  /** Why the editor opened to fix the database pin; saving re-pins it. */
  notice: string | null;
  bindings: readonly EnvironmentConnection[];
  saving: boolean;
  reloading: boolean;
  onSave: (article: SharedAnalysisArticleCreate) => void;
  onReloadLatest: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [origin, setOrigin] = useState(() => draftOf(base));
  const [title, setTitle] = useState(origin.title);
  const [html, setHtml] = useState(origin.html);
  const [sql, setSql] = useState(origin.sql);
  const [connectionId, setConnectionId] = useState(origin.connectionId);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const usableBindings = useMemo(
    () => bindings.filter((binding) => (binding.remoteConnectionId ?? binding.connectionId) && !binding.stale),
    [bindings],
  );
  const dirty = title !== origin.title || html !== origin.html
    || sql !== origin.sql || connectionId !== origin.connectionId;

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  };
  const restartFromLatest = () => {
    const latest = draftOf(base);
    setOrigin(latest);
    setTitle(latest.title);
    setHtml(latest.html);
    setSql(latest.sql);
    setConnectionId(latest.connectionId);
    setError(null);
  };

  const submit = () => {
    const normalizedTitle = title.trim();
    const normalizedSql = sql.trim();
    const binding = usableBindings.find((candidate) => (candidate.remoteConnectionId ?? candidate.connectionId) === connectionId);
    if (!normalizedTitle) return setError(t("analysis.editorTitleRequired"));
    const authorityConnectionId = binding?.remoteConnectionId ?? binding?.connectionId;
    if (!binding || !authorityConnectionId) return setError(t("analysis.editorConnectionRequired"));
    if (!normalizedSql) return setError(t("analysis.editorQueryRequired"));
    const query: AnalysisQueryNode = {
      ...base.definition.query,
      sql: normalizedSql,
    };
    setError(null);
    onSave({
      id: base.id,
      projectEnvironmentId: base.projectEnvironmentId,
      environmentRevision: base.environmentRevision,
      connectionId: authorityConnectionId,
      connectionRevision: binding.connectionContentRevision,
      definition: simpleDefinition(normalizedTitle, html, query),
    });
  };

  return (
    <ModalBackdrop onMouseDown={requestClose}>
      <ModalSurface
        size="wide"
        aria-labelledby="analysis-editor-title"
        aria-busy={saving}
        onRequestClose={requestClose}
        dismissible={!saving}
      >
        <ModalHeader
          title={t("analysis.simpleEditorTitle")}
          titleId="analysis-editor-title"
        />
        <div className="scrollbar-sleek tw:grid tw:min-h-0 tw:flex-1 tw:gap-4 tw:overflow-auto tw:p-5">
          {notice ? <InlineNotice tone="warning" icon="info">{notice}</InlineNotice> : null}
          {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
          {failure ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {t("analysis.saveFailed", { reason: failure.message })}
            </InlineNotice>
          ) : null}
          {conflict ? (
            <InlineNotice
              tone="warning"
              icon="alert"
              role="alert"
              action={conflict.latestUnavailable ? (
                <Button size="xs" disabled={reloading} onClick={onReloadLatest}>
                  {reloading ? t("analysis.reloadingLatest") : t("analysis.reloadLatest")}
                </Button>
              ) : (
                <Button size="xs" disabled={saving} onClick={restartFromLatest}>
                  {t("analysis.restartFromLatest")}
                </Button>
              )}
            >
              {conflict.latestUnavailable
                ? t("analysis.conflictLatestUnavailable")
                : t("analysis.conflictKeptDraft", { revision: base.revision })}
            </InlineNotice>
          ) : null}
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("analysis.simpleEditorBody")}
          </p>
          <PropertyRow label={t("analysis.fieldTitle")} htmlFor="analysis-title">
            <TextInput
              id="analysis-title"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </PropertyRow>
          <PropertyRow label={t("analysis.fieldHtml")} htmlFor="analysis-html">
            <TextAreaInput
              id="analysis-html"
              value={html}
              rows={14}
              spellCheck={false}
              onChange={(event) => setHtml(event.target.value)}
            />
          </PropertyRow>
          <PropertyRow label={t("analysis.fieldDatabase")} htmlFor="analysis-database">
            <SelectInput
              id="analysis-database"
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
            >
              <option value="">{t("analysis.selectDatabase")}</option>
              {usableBindings.map((binding) => (
                <option key={binding.id} value={(binding.remoteConnectionId ?? binding.connectionId)!}>
                  {binding.alias || binding.connectionName}
                </option>
              ))}
            </SelectInput>
          </PropertyRow>
          <PropertyRow label={t("analysis.fieldSavedQuery")} htmlFor="analysis-sql">
            <TextAreaInput
              id="analysis-sql"
              value={sql}
              rows={10}
              spellCheck={false}
              onChange={(event) => setSql(event.target.value)}
            />
          </PropertyRow>
          <InlineNotice tone="warning" icon="info">
            {t("analysis.queryColumnsAgentNote")}
          </InlineNotice>
        </div>
        <ModalFooter>
          <Button disabled={saving} onClick={requestClose}>{t("analysis.cancel")}</Button>
          <Button
            variant="primary"
            disabledBehavior="focusable"
            disabled={saving || reloading || conflict?.latestUnavailable === true}
            aria-busy={saving}
            onClick={submit}
          >
            {saving
              ? t("analysis.saving")
              : conflict
                ? t("analysis.saveOnLatest")
                : t("analysis.save")}
          </Button>
        </ModalFooter>
        {confirmingDiscard ? (
          <ConfirmDialog
            title={t("analysis.discardTitle")}
            description={t("analysis.discardBody")}
            cancelLabel={t("analysis.keepEditing")}
            confirmLabel={t("analysis.discardChanges")}
            onCancel={() => setConfirmingDiscard(false)}
            onConfirm={onClose}
          />
        ) : null}
      </ModalSurface>
    </ModalBackdrop>
  );
}
