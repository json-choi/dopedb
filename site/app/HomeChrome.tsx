// Navigation and legal links stay ordinary, server-rendered anchors.
import { DopeDBMark } from "./DopeDBMark";
import { Arrow } from "./MarketingButton";
import { RecommendedHeaderDownload } from "./PlatformDownloads";
import { TrackedLink } from "./TrackedLink";
import { repoUrl, workspaceUrls, type HomeCopy, type Lang } from "./homeContent";

export function HomeHeader({ c: existing, lang }: { c: HomeCopy; lang: Lang }) {
  const c = existing.landing;
  const otherLang = lang === "ko" ? "en" : "ko";
  return <header className="tw:fixed tw:inset-x-0 tw:top-0 tw:z-40 tw:border-b tw:border-hairline/65 tw:bg-night/85 tw:backdrop-blur-xl">
    <div className="tw:mx-auto tw:flex tw:h-20 tw:max-w-[1440px] tw:items-center tw:justify-between tw:gap-5 tw:px-6 tw:md:px-12">
      <a href="#top" aria-label={lang === "ko" ? "DopeDB 홈" : "DopeDB home"} className="tw:flex tw:shrink-0 tw:items-center tw:gap-2.5">
        <span className="tw:text-signal"><DopeDBMark className="tw:size-10" /></span><span className="tw:text-[22px] tw:font-semibold tw:tracking-[-0.055em]">DopeDB</span><span className="tw:ml-2 tw:hidden tw:font-mono tw:text-[8px] tw:tracking-widest tw:text-cream-muted tw:sm:block">ALPHA</span>
      </a>
      <nav aria-label={lang === "ko" ? "주요 메뉴" : "Main navigation"} className="tw:hidden tw:items-center tw:gap-7 tw:text-[12px] tw:text-cream-muted tw:lg:flex">
        {[{ id: "product", label: c.productNav }, { id: "flow", label: c.flowNav }, { id: "trust", label: c.trustNav }].map(link => <a key={link.id} href={`#${link.id}`} className="tw:flex tw:min-h-11 tw:items-center tw:transition-colors tw:hover:text-signal tw:motion-reduce:transition-none">{link.label}</a>)}
      </nav>
      <div className="tw:flex tw:items-center tw:gap-5 tw:max-sm:gap-4">
        <a href={otherLang === "ko" ? "/ko" : "/"} hrefLang={otherLang} aria-label={otherLang === "ko" ? "한국어로 보기" : "View in English"} className="tw:flex tw:min-h-11 tw:items-center tw:font-mono tw:text-[11px] tw:text-cream-muted tw:hover:text-signal">{otherLang === "ko" ? "KO" : "EN"}</a>
        <TrackedLink href={workspaceUrls[lang]} event="Workspace Opened" properties={{ source: "header" }} className="tw:hidden tw:min-h-11 tw:items-center tw:gap-2 tw:text-[12px] tw:text-cream-muted tw:hover:text-cream tw:md:flex">{c.workspace}<Arrow diagonal className="tw:size-3" /></TrackedLink>
        <RecommendedHeaderDownload copy={existing.download} fallbackLabel={c.download} />
      </div>
    </div>
  </header>;
}

export function HomeFooter({ c: existing, lang }: { c: HomeCopy; lang: Lang }) {
  const c = existing.landing;
  return <footer className="tw:relative tw:z-10 tw:border-t tw:border-hairline tw:bg-night tw:px-6 tw:py-7 tw:md:px-12">
    <div className="tw:mx-auto tw:flex tw:max-w-[1264px] tw:flex-wrap tw:items-center tw:justify-between tw:gap-5 tw:text-[11px] tw:text-cream-muted/70">
      <span>© {new Date().getFullYear()} DopeDB. Your data. Your orbit.</span>
      <nav aria-label={lang === "ko" ? "하단 메뉴" : "Footer navigation"} className="tw:flex tw:flex-wrap tw:gap-x-6 tw:gap-y-3">
        <TrackedLink href={workspaceUrls[lang]} event="Workspace Opened" properties={{ source: "footer" }} className="tw:flex tw:min-h-11 tw:items-center tw:hover:text-signal">{c.workspace}</TrackedLink>
        <a href={repoUrl} target="_blank" rel="noreferrer" className="tw:flex tw:min-h-11 tw:items-center tw:hover:text-signal">GitHub ↗</a>
        <a href={lang === "ko" ? "/ko/privacy" : "/privacy"} className="tw:flex tw:min-h-11 tw:items-center tw:hover:text-signal">{c.privacy}</a>
        <a href={lang === "ko" ? "/ko/terms" : "/terms"} className="tw:flex tw:min-h-11 tw:items-center tw:hover:text-signal">{c.terms}</a>
      </nav>
    </div>
  </footer>;
}
