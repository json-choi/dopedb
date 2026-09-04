import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { CheckboxField, Field, SelectInput, TextInput } from "../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../design-system/components/Status";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { AnalysisArticleRecord, AnalysisPublicationRequest } from "./domain";
import { analysisQueryKeys } from "./queryKeys";
import {
  analysisPublicationUrl,
  listAnalysisPublications,
  publishAnalysisSnapshot,
  revokeAnalysisPublication,
} from "./tauriAdapter";

function slugify(title: string): string {
  const stem = title
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "analysis";
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

function requestFor(article: AnalysisArticleRecord): AnalysisPublicationRequest {
  return {
    id: crypto.randomUUID(),
    runId: article.latestSuccessfulRunId ?? "",
    slug: slugify(article.definition.title),
    replacePublicationId: null,
    visibility: "unlisted",
    searchIndexable: false,
  };
}

export function AnalysisPublicationPanel({
  article,
  scopeKey,
}: {
  article: AnalysisArticleRecord;
  scopeKey: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const publicationKey = analysisQueryKeys.publication(scopeKey, article.id);
  const publications = useQuery({
    queryKey: publicationKey,
    queryFn: () => listAnalysisPublications(article.id),
    retry: false,
  });
  const [request, setRequest] = useState(() => requestFor(article));
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => publishAnalysisSnapshot(article.id, request),
    onSuccess: async () => {
      setError(null);
      setRequest(requestFor(article));
      await queryClient.invalidateQueries({ queryKey: publicationKey });
    },
    onError: (nextError) => setError(errMessage(nextError)),
  });
  const revoke = useMutation({
    mutationFn: (publicationId: string) => revokeAnalysisPublication(article.id, publicationId),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: publicationKey });
    },
    onError: (nextError) => setError(errMessage(nextError)),
  });

  const preparePublication = (publication: NonNullable<typeof publications.data>[number]) => {
    setRequest({
      ...requestFor(article),
      slug: publication.slug,
      replacePublicationId: publication.id,
      visibility: publication.visibility,
      searchIndexable: publication.visibility === "public",
    });
  };

  const openPublication = async (slug: string) => {
    setError(null);
    try {
      await openUrl(await analysisPublicationUrl(slug));
    } catch (reason) {
      setError(t("analysis.openPublicationFailed", { error: errMessage(reason) }));
    }
  };

  if (!article.latestSuccessfulRunId) {
    return <InlineNotice tone="warning" icon="alert">{t("analysis.publishRunFirst")}</InlineNotice>;
  }

  return (
    <div className="tw:grid tw:gap-5">
      {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
      <div className="tw:grid tw:gap-1">
        <h2 className="tw:m-0 tw:text-base tw:font-semibold">{t("analysis.publishHtmlTitle")}</h2>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("analysis.publishHtmlBody")}
        </p>
      </div>
      <Field label={t("analysis.publicationSlug")}>
        <TextInput
          id="analysis-publication-slug"
          value={request.slug}
          maxLength={128}
          onChange={(event) => setRequest((current) => ({
            ...current,
            slug: event.target.value.toLocaleLowerCase().replace(/[^a-z0-9-]/g, ""),
          }))}
        />
      </Field>
      <Field label={t("analysis.publicationVisibility")}>
        <SelectInput
          id="analysis-publication-visibility"
          value={request.visibility}
          onChange={(event) => {
            const visibility = event.target.value === "public" ? "public" : "unlisted";
            setRequest((current) => ({ ...current, visibility, searchIndexable: false }));
          }}
        >
          <option value="unlisted">{t("analysis.visibilityUnlisted")}</option>
          <option value="public">{t("analysis.visibilityPublic")}</option>
        </SelectInput>
      </Field>
      {request.visibility === "public" ? (
        <CheckboxField
          checked={request.searchIndexable}
          onChange={(event) => setRequest((current) => ({ ...current, searchIndexable: event.target.checked }))}
          label={t("analysis.publicationSearchIndex")}
        />
      ) : null}
      <div className="tw:flex tw:justify-end">
        <Button variant="primary" disabled={publish.isPending || request.slug.length < 8} onClick={() => publish.mutate()}>
          <Icon name="upload" />
          {publish.isPending ? t("analysis.publishing") : request.replacePublicationId ? t("analysis.publishNewVersion") : t("analysis.publishHtml")}
        </Button>
      </div>

      <section className="tw:grid tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-4">
        <h3 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.publicationsTitle")}</h3>
        {publications.isPending ? <LoadingLabel>{t("analysis.loading")}</LoadingLabel> : null}
        {publications.data?.length ? (
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
            {publications.data.map((publication) => (
              <li className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border-subtle tw:p-3" key={publication.id}>
                <code className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs">/{publication.slug}</code>
                <StatusBadge density="compact">v{publication.version}</StatusBadge>
                {publication.revokedAt ? <StatusBadge density="compact" tone="danger">{t("analysis.revoked")}</StatusBadge> : null}
                {!publication.revokedAt ? (
                  <>
                    <Button size="xs" onClick={() => void openPublication(publication.slug)}>
                      {t("analysis.openPublication")}
                    </Button>
                    <Button size="xs" onClick={() => preparePublication(publication)}>{t("analysis.prepareNewVersion")}</Button>
                    <ConfirmButton
                      size="xs"
                      variant="danger"
                      confirmLabel={t("analysis.revokeConfirm")}
                      onConfirm={() => revoke.mutate(publication.id)}
                    >
                      {t("analysis.revoke")}
                    </ConfirmButton>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : publications.isPending ? null : (
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">{t("analysis.noPublications")}</p>
        )}
      </section>
    </div>
  );
}
