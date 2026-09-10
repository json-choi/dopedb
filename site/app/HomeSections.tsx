// One server-side composition owns all searchable landing sections and their copy.
import { GalaxyHero } from "./GalaxyHero";
import { HomeDemoShowcase } from "./HomeDemoShowcase";
import { HomeScopeWalkthrough } from "./HomeScopeWalkthrough";
import { Arrow, MarketingButton, SectionLabel } from "./MarketingButton";
import { DopeDBMark } from "./DopeDBMark";
import { RecommendedMarketingDownload, PlatformDownloadOptions } from "./PlatformDownloads";
import { repoUrl, workspaceUrls, type HomeCopy, type Lang } from "./homeContent";

export function HomeSections({ c, lang }: { c: HomeCopy; lang: Lang }) {
  return <>
    <HomeAccessSections c={c} lang={lang} />
    <HomeScopeWalkthrough lang={lang} c={{
      flowLabel: c.landing.flowLabel,
      flowTitle: c.landing.flowTitle,
      flowBody: c.landing.flowBody,
      demoNotice: c.landing.demoNotice,
    }} />
    <HomeActionSections c={c} lang={lang} />
  </>;
}

function HomeAccessSections({ c: existing, lang }: { c: HomeCopy; lang: Lang }) {
  const c = existing.landing;
  return <>
    <GalaxyHero lang={lang} c={{
      explore: c.explore, return: c.return,
      exploreHelp: c.exploreHelp, moveHelp: c.moveHelp,
      pause: c.pause, play: c.play, reduced: c.reduced, scroll: c.scroll,
    }}>
      <p className="tw:flex tw:items-center tw:gap-3 tw:font-mono tw:text-[10px] tw:tracking-[0.16em] tw:text-signal">
        <span className="tw:size-1.5 tw:rounded-full tw:bg-signal" />YOUR DATA. YOUR ORBIT.
      </p>
      <h1 data-lang={lang} className="tw:mt-6 tw:text-[clamp(52px,5.7vw,82px)] tw:leading-[1.10] tw:font-medium tw:tracking-[-0.06em] tw:max-md:text-[47px] tw:max-md:data-[lang=en]:text-[40px]">
        {c.heroLineOne}{" "}<br />
        <span className="tw:text-signal">{c.heroLineTwo}</span>{c.heroSuffix}{" "}<br />
        {c.heroLineThree}
      </h1>
      <p className="tw:mt-7 tw:max-w-[570px] tw:text-[17px] tw:leading-[1.55] tw:font-medium tw:tracking-[-0.025em] tw:text-cream tw:max-md:text-[15px]">
        {c.category}
      </p>
      <p className="tw:mt-3 tw:max-w-[540px] tw:whitespace-pre-line tw:text-[14px] tw:leading-[1.85] tw:text-cream-muted tw:max-md:text-[13px]">
        {c.description}
      </p>
      <div data-primary-flow className="tw:mt-7 tw:flex tw:flex-wrap tw:items-center tw:gap-x-7 tw:gap-y-4">
        <RecommendedMarketingDownload copy={existing.download} fallbackLabel={c.download} source="hero" />
        <a href="#product" className="tw:flex tw:min-h-11 tw:items-center tw:gap-3 tw:text-[13px] tw:text-cream-muted tw:hover:text-cream">
          {c.seeProduct}<Arrow />
        </a>
      </div>
      <p className="tw:mt-4 tw:text-[11px] tw:leading-[1.8] tw:text-cream-muted/65">{c.proof}</p>
    </GalaxyHero>
    <section id="product" className="tw:relative tw:z-10 tw:scroll-mt-24 tw:bg-night/45 tw:px-6 tw:pt-5 tw:pb-24 tw:md:px-12 tw:lg:pb-28">
      <div className="tw:mx-auto tw:max-w-[1264px]">
        <div className="tw:mb-9 tw:grid tw:items-end tw:gap-5 tw:md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div>
            <SectionLabel>01 / YOUR ACTUAL WORKSPACE</SectionLabel>
            <h2 className="tw:mt-5 tw:text-[clamp(30px,3.2vw,46px)] tw:leading-[1.2] tw:font-medium tw:tracking-[-0.045em]">{c.desktopTitle}</h2>
          </div>
          <p className="tw:whitespace-pre-line tw:pb-1 tw:text-[14px] tw:leading-[1.85] tw:text-cream-muted">{c.desktopBody}</p>
        </div>
        <HomeDemoShowcase product={existing.product} c={{
          desktopLabel: c.desktopLabel, desktopSample: c.desktopSample,
          enlarge: c.enlarge, close: c.close, imageDialog: c.imageDialog,
        }} />
      </div>
    </section>
  </>;
}

function HomeActionSections({ c: existing, lang }: { c: HomeCopy; lang: Lang }) {
  const c = existing.landing;
  const questions = [0, 1, 2, 5].map(index => existing.faq.items[index]);
  return <>
    <section id="trust" className="tw:relative tw:z-10 tw:scroll-mt-24 tw:bg-night/45 tw:px-6 tw:py-24 tw:md:px-12 tw:lg:py-32">
      <div className="tw:mx-auto tw:grid tw:max-w-[1264px] tw:gap-12 tw:lg:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)] tw:lg:gap-20">
        <div><SectionLabel>{c.faqLabel}</SectionLabel><h2 className="tw:mt-7 tw:whitespace-pre-line tw:text-[clamp(36px,4vw,54px)] tw:leading-[1.17] tw:font-medium tw:tracking-[-0.05em]">{c.faqTitle}</h2><a href={`${repoUrl}/blob/main/docs/PRODUCT_POSITIONING.md`} target="_blank" rel="noreferrer" className="tw:mt-8 tw:inline-flex tw:min-h-11 tw:items-center tw:gap-3 tw:text-[12px] tw:text-signal tw:hover:underline">{c.docs} <Arrow diagonal /></a></div>
        <div className="tw:grid tw:gap-x-8 tw:gap-y-10 tw:sm:grid-cols-2">
          {questions.map((question, index) => <article key={question.question} className="tw:border-t tw:border-hairline-strong tw:pt-5"><span className="tw:font-mono tw:text-[10px] tw:text-signal/70">Q / 0{index + 1}</span><h3 className="tw:mt-4 tw:text-[19px] tw:leading-[1.45] tw:font-medium tw:tracking-[-0.025em]">{question.question}</h3><p className="tw:mt-4 tw:text-[13px] tw:leading-[1.9] tw:text-cream-muted">{question.answer}</p></article>)}
        </div>
      </div>
    </section>

    <section id="download" className="tw:relative tw:z-10 tw:scroll-mt-24 tw:border-t tw:border-hairline tw:bg-night/65 tw:bg-galaxy-halo tw:px-6 tw:py-24 tw:md:px-12 tw:lg:py-32">
      <div className="tw:mx-auto tw:grid tw:max-w-[1264px] tw:items-center tw:gap-12 tw:lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:lg:gap-20">
        <div><div className="tw:text-signal"><DopeDBMark className="tw:size-16" /></div><h2 className="tw:mt-6 tw:whitespace-pre-line tw:text-[clamp(34px,4.1vw,58px)] tw:leading-[1.18] tw:font-medium tw:tracking-[-0.05em]">{c.downloadTitle}</h2><p className="tw:mt-6 tw:max-w-[450px] tw:text-[14px] tw:leading-[1.9] tw:text-cream-muted">{c.downloadBody}</p><a href={workspaceUrls[lang]} target="_blank" rel="noreferrer" className="tw:mt-6 tw:inline-flex tw:min-h-11 tw:items-center tw:gap-3 tw:text-[13px] tw:text-signal tw:hover:underline">{c.workspace} <Arrow diagonal /></a></div>
        <div>
          <div data-primary-flow className="tw:flex tw:flex-wrap tw:gap-3"><RecommendedMarketingDownload copy={existing.download} fallbackLabel={existing.download.primary} source="download_section" /><MarketingButton variant="secondary" href={`${repoUrl}/blob/main/docs/PROJECT.md#development`}>{existing.download.source} <Arrow diagonal /></MarketingButton></div>
          <PlatformDownloadOptions copy={existing.download} />
          <details className="tw:mt-7 tw:border-y tw:border-hairline tw:py-4" open><summary className="tw:cursor-pointer tw:text-[12px] tw:text-cream">{c.install}</summary><div className="tw:mt-4 tw:space-y-3 tw:text-[12px] tw:leading-[1.85] tw:text-cream-muted"><p>{existing.download.macSigning}</p><p><span className="tw:text-warning">{existing.download.windowsWarningTitle}</span><br />{existing.download.windowsWarningBody}</p></div></details>
          <p className="tw:mt-5 tw:text-[11px] tw:leading-[1.8] tw:text-cream-muted/70">{c.alpha}</p>
        </div>
      </div>
    </section>
  </>;
}
