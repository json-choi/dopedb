import type { AnalysisPublicSnapshot } from "../../../lib/workspace-analysis-publications";
import { AnalysisArticleBody } from "../../../../src/design-system/components/AnalysisArticleBody";

export function AnalysisArticleDocument({
  article,
  eyebrow = "Analysis Article",
  resultLabel = "Published HTML",
}: {
  article: AnalysisPublicSnapshot;
  eyebrow?: string;
  resultLabel?: string;
}) {
  return (
    <article
      className="tw:mx-auto tw:grid tw:w-full tw:max-w-[900px] tw:gap-8"
      data-analysis-publication-snapshot
    >
      <header className="tw:grid tw:gap-4 tw:border-b tw:border-border tw:pb-8">
        <span className="tw:font-mono tw:text-2xs tw:font-semibold tw:tracking-[0.09em] tw:text-primary tw:uppercase">
          {eyebrow}
        </span>
        <h1 className="tw:font-serif tw:text-[clamp(2.6rem,7vw,5.8rem)] tw:font-medium tw:leading-[0.94] tw:tracking-[-0.045em]">
          {article.title}
        </h1>
        <div className="tw:flex tw:flex-wrap tw:gap-2 tw:text-xs tw:text-muted-foreground">
          <span className="tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1">{resultLabel}</span>
          <time className="tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1" dateTime={article.publishedAt}>
            {new Date(article.publishedAt).toLocaleString()}
          </time>
        </div>
      </header>
      <AnalysisArticleBody html={article.html} />
    </article>
  );
}

export function PublicAnalysisArticle({ article }: { article: AnalysisPublicSnapshot }) {
  return <AnalysisArticleDocument article={article} />;
}
