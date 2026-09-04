import { useMemo, useState } from "react";

import { Button } from "../../design-system/components/Button";
import {
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
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { EnvironmentConnection } from "../knowledge/domain";
import type {
  AnalysisArticleRecord,
  AnalysisQueryNode,
  SharedAnalysisArticleCreate,
} from "./domain";

function simpleDefinition(
  article: AnalysisArticleRecord,
  title: string,
  html: string,
  query: AnalysisQueryNode,
): SharedAnalysisArticleCreate["definition"] {
  return {
    version: 3,
    source: article.definition.source,
    title,
    html,
    query,
  };
}

export function AnalysisArticleEditor({
  article,
  bindings,
  saving,
  onSave,
  onClose,
}: {
  article: AnalysisArticleRecord;
  bindings: readonly EnvironmentConnection[];
  saving: boolean;
  onSave: (article: SharedAnalysisArticleCreate) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const initialQuery = article.definition.query;
  const [title, setTitle] = useState(article.definition.title);
  const [html, setHtml] = useState(article.definition.html);
  const [sql, setSql] = useState(initialQuery.sql);
  const [connectionId, setConnectionId] = useState(article.connectionId);
  const [error, setError] = useState<string | null>(null);
  const usableBindings = useMemo(
    () => bindings.filter((binding) => binding.remoteConnectionId && !binding.stale),
    [bindings],
  );

  const submit = () => {
    const normalizedTitle = title.trim();
    const normalizedSql = sql.trim();
    const binding = usableBindings.find((candidate) => candidate.remoteConnectionId === connectionId);
    if (!normalizedTitle) return setError(t("analysis.editorTitleRequired"));
    if (!binding?.remoteConnectionId) return setError(t("analysis.editorConnectionRequired"));
    if (!normalizedSql) return setError(t("analysis.editorQueryRequired"));
    const query: AnalysisQueryNode = {
      ...initialQuery,
      sql: normalizedSql,
    };
    setError(null);
    onSave({
      id: article.id,
      projectEnvironmentId: article.projectEnvironmentId,
      environmentRevision: article.environmentRevision,
      connectionId: binding.remoteConnectionId,
      connectionRevision: binding.connectionContentRevision,
      definition: simpleDefinition(article, normalizedTitle, html, query),
    });
  };

  return (
    <ModalBackdrop onMouseDown={onClose}>
      <ModalSurface size="wide" aria-labelledby="analysis-editor-title" onRequestClose={onClose}>
        <ModalTitleBar
          title={t("analysis.simpleEditorTitle")}
          titleId="analysis-editor-title"
          closeLabel={t("analysis.editorClose")}
          onClose={onClose}
        />
        <div className="scrollbar-sleek tw:grid tw:min-h-0 tw:flex-1 tw:gap-4 tw:overflow-auto tw:p-5">
          {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
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
                <option key={binding.id} value={binding.remoteConnectionId!}>
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
          <Button onClick={onClose}>{t("analysis.cancel")}</Button>
          <Button variant="primary" disabled={saving} onClick={submit}>
            {saving ? t("analysis.saving") : t("analysis.save")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
