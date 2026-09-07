// Editorial Article reading surface: document, derived outline and exact query tools.
// Commands and results remain owned by the existing Article controller.
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { AnalysisArticleBody } from "../../design-system/components/AnalysisArticleBody";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import type { AnalysisArticleRecord } from "./domain";
import { useArticleOutline } from "./useArticleOutline";

export function AnalysisArticleReader({ article, projectName, source, connectionName, runAction, children }: {
  article: AnalysisArticleRecord;
  projectName: string;
  source: string;
  connectionName: string;
  runAction: ReactNode;
  children: ReactNode;
}) {
  const { t, lang } = useI18n();
  const outline = useArticleOutline(article.definition.html);
  const outlineItems = outline.headings.map((heading, index) => (
    <button
      key={index}
      type="button"
      aria-current={outline.active === index ? "location" : undefined}
      data-nested={heading.nested || undefined}
      className="tw:w-full tw:cursor-pointer tw:border-0 tw:border-l tw:border-border-subtle tw:bg-transparent tw:px-4 tw:py-2.5 tw:text-left tw:font-sans tw:text-sm tw:leading-body tw:text-muted-foreground tw:data-[nested=true]:pl-7 tw:aria-[current=location]:border-foreground tw:aria-[current=location]:text-foreground tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
      onClick={() => outline.navigate(index)}
    >{heading.title}</button>
  ));
  const scrollToQuery = () => {
    const query = outline.scrollRef.current?.querySelector<HTMLElement>("[data-article-saved-query]");
    query?.focus({ preventScroll: true });
    query?.scrollIntoView({ block: "start" });
  };
  return (
    <div ref={outline.scrollRef} className="scrollbar-sleek tw:h-full tw:min-h-0 tw:overflow-y-auto tw:overscroll-contain tw:motion-safe:scroll-smooth">
      <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[1440px] tw:grid-cols-[minmax(0,1fr)_216px] tw:items-start tw:gap-y-8 tw:gap-x-[clamp(32px,6cqw,88px)] tw:px-[clamp(24px,4.5cqw,60px)] tw:pt-9 tw:pb-20 tw:@max-[920px]:grid-cols-1 tw:@max-[920px]:gap-y-8 tw:@max-[560px]:px-5 tw:@max-[560px]:pt-5">
          <header className="tw:col-start-1 tw:row-start-1 tw:grid tw:gap-5">
            <span className="tw:w-fit tw:rounded-full tw:bg-muted tw:px-2.5 tw:py-1 tw:text-xs tw:text-muted-foreground">{projectName}</span>
            <h1 className="tw:m-0 tw:max-w-[850px] tw:font-serif tw:text-[clamp(36px,4.7cqw,64px)] tw:leading-[1.08] tw:font-normal tw:tracking-[-0.035em] tw:text-balance tw:[overflow-wrap:anywhere]">{article.definition.title}</h1>
            {article.definition.query.title !== article.definition.title ? <p className="tw:m-0 tw:max-w-[680px] tw:text-[clamp(16px,1.6cqw,20px)] tw:leading-body tw:text-muted-foreground">{article.definition.query.title}</p> : null}
            <div className="tw:mt-1 tw:flex tw:items-center tw:gap-3">
              <span className="tw:grid tw:size-9 tw:shrink-0 tw:place-items-center tw:rounded-full tw:bg-muted tw:text-muted-foreground"><Icon name={article.definition.source === "human" ? "user" : "terminal"} /></span>
              <div className="tw:grid tw:gap-1">
                <span className="tw:text-sm tw:font-medium">{source}</span>
                <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
                  <time dateTime={article.updatedAt}>{t("analysis.updatedOn", { date: new Date(article.updatedAt).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }) })}</time>
                  <span aria-hidden="true">·</span><span>{t("analysis.revisionNumber", { revision: article.revision })}</span>
                </span>
              </div>
            </div>
          </header>
          <div className="tw:col-start-1 tw:row-start-2 tw:min-w-0 tw:@max-[920px]:row-start-3">
            <AnalysisArticleBody ref={outline.bodyRef} html={article.definition.html} />
            <div className="tw:mt-12 tw:grid tw:min-w-0 tw:gap-9">{children}</div>
          </div>
        <aside className="tw:sticky tw:top-8 tw:col-start-2 tw:row-start-1 tw:row-span-2 tw:grid tw:min-w-0 tw:gap-8 tw:@max-[920px]:static tw:@max-[920px]:col-start-1 tw:@max-[920px]:row-start-2 tw:@max-[920px]:row-span-1 tw:@max-[920px]:gap-5 tw:@max-[920px]:border-y tw:@max-[920px]:border-border-subtle tw:@max-[920px]:py-4">
          {outline.headings.length ? <>
            <nav aria-label={t("analysis.onThisPage")} className="tw:grid tw:gap-4 tw:@max-[920px]:hidden">
              <h2 className="tw:m-0 tw:text-2xs tw:font-medium tw:tracking-[0.08em] tw:text-muted-foreground tw:uppercase">{t("analysis.onThisPage")}</h2>
              <div className="scrollbar-sleek tw:grid tw:max-h-[42dvh] tw:overflow-auto">{outlineItems}</div>
            </nav>
            <details className="tw:hidden tw:@max-[920px]:block">
              <summary className="tw:cursor-pointer tw:text-sm tw:text-muted-foreground">{t("analysis.onThisPage")}</summary>
              <nav aria-label={t("analysis.onThisPage")} className="tw:mt-3 tw:grid">{outlineItems}</nav>
            </details>
          </> : null}
          <section className="tw:grid tw:gap-4 tw:border-t tw:border-border-subtle tw:pt-7 tw:@max-[920px]:border-0 tw:@max-[920px]:pt-0">
            <h2 className="tw:m-0 tw:text-2xs tw:font-medium tw:tracking-[0.08em] tw:text-muted-foreground tw:uppercase">{t("analysis.sourceDatabase")}</h2>
            <div className="tw:grid tw:gap-4 tw:text-sm tw:text-muted-foreground tw:@max-[920px]:flex tw:@max-[920px]:flex-wrap tw:@max-[920px]:items-center">
              <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2.5"><Icon name="database" className="tw:shrink-0" /><span className="tw:[overflow-wrap:anywhere]">{connectionName}</span></span>
              <span className="tw:flex tw:items-center tw:gap-2.5"><Icon name="lock" />{t("analysis.queryReadOnly")}</span>
              <Button variant="ghost" size="compact" onClick={scrollToQuery}><Icon name="file" />{t("analysis.savedQuery")}</Button>
              {runAction}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
