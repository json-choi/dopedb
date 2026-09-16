import type { AnalysisPublicSnapshot } from "../../../lib/workspace-analysis-publications";
import type { WorkspaceLocale } from "../../../lib/workspace-locale";
import { AnalysisArticleBody } from "../../../../src/design-system/components/AnalysisArticleBody";
import { articleSharingCopy } from "../../../features/articleSharing/copy";

export function formatPublicationInstant(value: string | Date, locale: WorkspaceLocale) {
  return `${new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

export function AnalysisArticleDocument({
  article,
  locale,
  eyebrow,
  resultLabel,
}: {
  article: AnalysisPublicSnapshot;
  locale: WorkspaceLocale;
  eyebrow?: string;
  resultLabel?: string;
}) {
  const copy = articleSharingCopy[locale];
  return (
    <article
      className="tw:mx-auto tw:grid tw:w-full tw:max-w-[900px] tw:gap-8"
      data-analysis-publication-snapshot
    >
      <header className="tw:grid tw:gap-4 tw:border-b tw:border-border tw:pb-8">
        <span className="tw:font-mono tw:text-2xs tw:font-semibold tw:tracking-[0.09em] tw:text-primary tw:uppercase">
          {eyebrow ?? copy.publicationEyebrow}
        </span>
        <h1 className="tw:font-serif tw:text-[clamp(2.6rem,7vw,5.8rem)] tw:font-medium tw:leading-[0.94] tw:tracking-[-0.045em]">
          {article.title}
        </h1>
        <div className="tw:flex tw:flex-wrap tw:gap-2 tw:text-xs tw:text-muted-foreground">
          <span className="tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1">
            {resultLabel ?? copy.publicationResult}
          </span>
          <time className="tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1" dateTime={article.publishedAt}>
            {formatPublicationInstant(article.publishedAt, locale)}
          </time>
        </div>
      </header>
      <AnalysisArticleBody html={article.html} />
    </article>
  );
}

export function PublicAnalysisArticle({
  article,
  locale,
}: {
  article: AnalysisPublicSnapshot;
  locale: WorkspaceLocale;
}) {
  return <AnalysisArticleDocument article={article} locale={locale} />;
}
