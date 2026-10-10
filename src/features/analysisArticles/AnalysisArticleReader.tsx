// Keeps the Article's findings first and review metadata collapsed by default.
// The controller owns query execution/results; opening review never starts a query.
// Shared HTML never navigates the app window: web links open externally only after
// native confirmation, other schemes are ignored, and in-page fragments stay inside.
import { memo, type MouseEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { AnalysisArticleBody } from "../../design-system/components/AnalysisArticleBody";
import { useI18n } from "../../lib/i18n";
import { openAgentExternalLink } from "../agents/tauriAdapter";
import type { AnalysisArticleDocument } from "./domain";
import { useArticleOutline } from "./useArticleOutline";

// Desktop retains the body DOM for outline focus; Workspace uses the same primitive.
const StableArticleBody = memo(AnalysisArticleBody);
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function followArticleLink(event: MouseEvent<HTMLDivElement>, lang: "en" | "ko") {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest("a[href]");
  if (!anchor || !event.currentTarget.contains(anchor)) return;
  event.preventDefault();
  if (event.type === "auxclick" && event.button !== 1) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    let fragment = href.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // A malformed escape is matched literally.
    }
    const target = fragment
      ? event.currentTarget.querySelector(`[id="${CSS.escape(fragment)}"], [name="${CSS.escape(fragment)}"]`)
      : null;
    target?.scrollIntoView({ block: "start" });
    return;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) {
    void openAgentExternalLink(url.href, lang, "analysisArticle").catch(() => undefined);
  }
}

export function AnalysisArticleReader({ article, projectName, source, connectionName, runAction, children }: {
  article: AnalysisArticleDocument;
  projectName: string;
  source: string;
  connectionName: string;
  runAction: ReactNode;
  children: ReactNode;
}) {
  const { t, lang } = useI18n();
  const outline = useArticleOutline(article.definition.html);
  return (
    <div ref={outline.scrollRef} className="scrollbar-sleek tw:h-full tw:min-h-0 tw:overflow-y-auto tw:overscroll-contain tw:motion-safe:scroll-smooth">
      <article className="tw:mx-auto tw:grid tw:w-full tw:max-w-[1000px] tw:min-w-0 tw:gap-8 tw:px-[clamp(20px,4.5cqw,56px)] tw:pt-5 tw:pb-14">
        <header className="tw:grid tw:min-w-0 tw:gap-4">
          <h1 className="tw:m-0 tw:font-sans tw:text-[clamp(26px,3.4cqw,36px)] tw:leading-tight tw:font-semibold tw:tracking-tight tw:text-balance tw:[overflow-wrap:anywhere]">{article.definition.title}</h1>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border-subtle tw:pb-5">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
              <span>{source}</span><span aria-hidden="true">·</span>
              <time dateTime={article.updatedAt}>{t("analysis.updatedOn", { date: new Date(article.updatedAt).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }) })}</time>
            </div>
            {runAction}
          </div>
        </header>
        {/* Click delegation over shared HTML; links keep native keyboard activation. */}
        <div
          className="tw:min-w-0"
          onClickCapture={(event) => followArticleLink(event, lang)}
          onAuxClickCapture={(event) => followArticleLink(event, lang)}
        >
          <StableArticleBody bodyRef={outline.bodyRef} html={article.definition.html} />
        </div>
        <details key={article.id} className="tw:group tw:min-w-0 tw:border-t tw:border-border-subtle">
          <summary className="tw:flex tw:cursor-pointer tw:list-none tw:items-center tw:gap-2 tw:py-4 tw:text-sm tw:font-medium tw:text-muted-foreground tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:[&::-webkit-details-marker]:hidden">
            <span className="tw:shrink-0 tw:group-open:rotate-90"><Icon name="chevronRight" /></span>
            {t("analysis.reviewDetails")}
          </summary>
          <div className="tw:grid tw:min-w-0 tw:gap-6 tw:pb-4">
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">{t("analysis.reviewHelp")}</p>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-2 tw:text-xs tw:text-muted-foreground">
              <span>{projectName}</span>
              <span>{t("analysis.revisionNumber", { revision: article.revision })}</span>
              <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2"><Icon name="database" /><span className="tw:[overflow-wrap:anywhere]">{connectionName}</span></span>
              <span className="tw:flex tw:items-center tw:gap-2"><Icon name="lock" />{t("analysis.queryReadOnly")}</span>
            </div>
            {outline.headings.length ? <nav aria-label={t("analysis.onThisPage")} className="tw:grid tw:gap-2">
              <h2 className="tw:m-0 tw:text-sm tw:font-medium">{t("analysis.onThisPage")}</h2>
              {outline.headings.map((heading, index) => <button
                key={index}
                type="button"
                aria-current={outline.active === index ? "location" : undefined}
                data-nested={heading.nested || undefined}
                className="tw:w-full tw:cursor-pointer tw:border-0 tw:border-l tw:border-border-subtle tw:bg-transparent tw:px-3 tw:py-1 tw:text-left tw:font-sans tw:text-sm tw:text-muted-foreground tw:data-[nested=true]:pl-6 tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() => outline.navigate(index)}
              >{heading.title}</button>)}
            </nav> : null}
            {children}
          </div>
        </details>
      </article>
    </div>
  );
}
