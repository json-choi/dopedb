// Stable workflow, FAQ, download, and documentation sections own their composition.
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  LockKeyhole,
  SquareTerminal,
} from "lucide-react";
import { MarketingButton } from "./MarketingButton";
import {
  PlatformDownloadOptions,
  RecommendedMarketingDownload,
} from "./PlatformDownloads";
import { TrackedLink } from "./TrackedLink";
import { SectionLabel } from "./HomePrimitives";
import {
  repoUrl,
  type HomeCopy,
} from "./homeContent";

export function HomeActionSections({ c }: { c: HomeCopy }) {
  return (
    <>
    <section
      className="tw:relative tw:border-b tw:border-hairline tw:bg-night"
      id="flow"
    >
      <div className="tw:mx-auto tw:grid tw:max-w-[1520px] tw:grid-cols-[minmax(380px,0.82fr)_minmax(0,1fr)] tw:gap-[clamp(50px,8vw,130px)] tw:px-[clamp(16px,4vw,64px)] tw:py-[clamp(90px,12vw,180px)] tw:max-[980px]:grid-cols-1">
        <div className="tw:self-start tw:min-[981px]:sticky tw:min-[981px]:top-28">
          <SectionLabel>{c.workflow.eyebrow}</SectionLabel>
          <h2 className="tw:mt-6 tw:max-w-[740px] tw:font-display tw:text-[clamp(48px,6.4vw,100px)] tw:leading-[0.92] tw:font-normal tw:tracking-[-0.05em] tw:text-balance">
            {c.workflow.title}
          </h2>
          <p className="tw:mt-7 tw:max-w-[560px] tw:text-[clamp(15px,1.25vw,19px)] tw:leading-[1.75] tw:text-cream-muted">
            {c.workflow.body}
          </p>

          <div className="tw:mt-10 tw:overflow-hidden tw:border tw:border-hairline-strong tw:bg-night-raised tw:shadow-stage">
            <div className="tw:flex tw:h-10 tw:items-center tw:justify-between tw:border-b tw:border-hairline tw:px-3.5">
              <div className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-[9px] tw:font-semibold tw:tracking-[0.12em] tw:text-cream-muted tw:uppercase">
                <SquareTerminal className="tw:text-signal" size={14} />
                Operation console
              </div>
              <span className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-[9px] tw:text-warning tw:uppercase">
                <span className="tw:size-1.5 tw:rounded-full tw:bg-warning" />
                Awaiting approval
              </span>
            </div>
            <pre className="tw:m-0 tw:overflow-x-auto tw:p-[clamp(18px,3vw,30px)] tw:font-mono tw:text-[clamp(11px,1.05vw,14px)] tw:leading-[1.72] tw:text-cream-muted">
              <code className="tw:font-mono">{c.workflow.terminal}</code>
            </pre>
          </div>
        </div>

        <ol className="tw:border-t tw:border-hairline-strong">
          {c.workflow.steps.map((step) => (
            <li
              className="tw:group tw:grid tw:grid-cols-[66px_minmax(0,1fr)_28px] tw:items-start tw:gap-5 tw:border-b tw:border-hairline-strong tw:py-[clamp(26px,4vw,46px)]"
              key={step.index}
            >
              <span className="tw:font-mono tw:text-[11px] tw:font-semibold tw:tracking-[0.12em] tw:text-signal">
                / {step.index}
              </span>
              <div>
                <h3 className="tw:text-[clamp(24px,2.4vw,38px)] tw:leading-[1.05] tw:font-medium tw:tracking-[-0.03em]">
                  {step.title}
                </h3>
                <p className="tw:mt-4 tw:max-w-[560px] tw:text-[15px] tw:leading-[1.7] tw:text-cream-muted">
                  {step.body}
                </p>
              </div>
              <ArrowRight className="tw:mt-1 tw:text-cream/25 tw:transition-[color,transform] tw:duration-300 tw:group-hover:translate-x-1 tw:group-hover:text-signal" size={20} />
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className="tw:bg-cream tw:text-night">
      <div className="tw:mx-auto tw:grid tw:max-w-[1520px] tw:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)] tw:gap-[clamp(50px,8vw,140px)] tw:px-[clamp(16px,4vw,64px)] tw:py-[clamp(90px,11vw,160px)] tw:max-[940px]:grid-cols-1">
        <div>
          <SectionLabel tone="light">{c.faq.eyebrow}</SectionLabel>
          <h2 className="tw:mt-6 tw:max-w-[650px] tw:font-display tw:text-[clamp(46px,5.8vw,92px)] tw:leading-[0.94] tw:font-normal tw:tracking-[-0.045em] tw:text-balance">
            {c.faq.title}
          </h2>
        </div>

        <div className="tw:border-t tw:border-night/20">
          {c.faq.items.map((item) => (
            <details className="tw:group tw:border-b tw:border-night/20" key={item.question}>
              <summary className="tw:flex tw:cursor-pointer tw:list-none tw:items-start tw:justify-between tw:gap-6 tw:py-6 tw:text-[clamp(18px,1.7vw,25px)] tw:leading-tight tw:font-medium tw:tracking-[-0.02em] tw:[&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronRight className="tw:mt-1 tw:shrink-0 tw:text-night/40 tw:transition-transform tw:duration-200 tw:group-open:rotate-90" size={20} />
              </summary>
              <p className="tw:max-w-[720px] tw:pb-7 tw:pr-12 tw:text-[15px] tw:leading-[1.75] tw:text-night/62">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>

    <section
      className="tw:relative tw:isolate tw:overflow-hidden tw:border-y tw:border-hairline tw:bg-night"
      id="download"
    >
      <div className="tw:pointer-events-none tw:absolute tw:inset-0 tw:-z-10 tw:bg-control-grid tw:opacity-60 tw:[background-size:44px_44px]" />
      <div className="tw:pointer-events-none tw:absolute tw:-right-[0.06em] tw:-bottom-[0.18em] tw:-z-10 tw:font-display tw:text-[clamp(180px,35vw,560px)] tw:leading-none tw:font-normal tw:tracking-[-0.07em] tw:text-cream/[0.025] tw:select-none">
        ALPHA
      </div>

      <div className="tw:mx-auto tw:grid tw:max-w-[1520px] tw:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)] tw:items-center tw:gap-[clamp(50px,8vw,130px)] tw:px-[clamp(16px,4vw,64px)] tw:py-[clamp(100px,14vw,210px)] tw:max-[940px]:grid-cols-1">
        <div>
          <SectionLabel>{c.download.eyebrow}</SectionLabel>
          <h2 className="tw:mt-6 tw:max-w-[900px] tw:font-display tw:text-[clamp(50px,7vw,116px)] tw:leading-[0.9] tw:font-normal tw:tracking-[-0.055em] tw:text-balance">
            {c.download.title}
          </h2>
          <p className="tw:mt-7 tw:max-w-[650px] tw:text-[clamp(16px,1.35vw,20px)] tw:leading-[1.7] tw:text-cream-muted">
            {c.download.body}
          </p>
        </div>

        <div data-primary-flow>
          <div className="tw:flex tw:flex-wrap tw:gap-3 tw:max-[620px]:grid tw:max-[620px]:grid-cols-1">
            <RecommendedMarketingDownload
              copy={c.download}
              fallbackLabel={c.download.primary}
              source="download_section"
            />
            <MarketingButton
              variant="secondary"
              href={`${repoUrl}/blob/main/docs/PROJECT.md#development`}
            >
              {c.download.source}
              <ArrowUpRight size={16} />
            </MarketingButton>
          </div>

          <p className="tw:mt-3 tw:text-xs tw:leading-relaxed tw:text-cream-muted">
            {c.download.sourceNote}
          </p>

          <PlatformDownloadOptions copy={c.download} />

          <div className="tw:mt-5 tw:flex tw:gap-3 tw:border tw:border-warning/30 tw:bg-warning/5 tw:p-4">
            <LockKeyhole className="tw:mt-0.5 tw:shrink-0 tw:text-warning" size={17} />
            <div>
              <h3 className="tw:text-[13px] tw:font-medium tw:text-cream">
                {c.download.windowsWarningTitle}
              </h3>
              <p className="tw:mt-1.5 tw:text-xs tw:leading-relaxed tw:text-cream-muted">
                {c.download.windowsWarningBody}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="tw:bg-night" id="docs">
      <div className="tw:mx-auto tw:max-w-[1520px] tw:px-[clamp(16px,4vw,64px)] tw:py-[clamp(78px,9vw,130px)]">
        <div className="tw:grid tw:grid-cols-[minmax(280px,0.62fr)_minmax(0,1.38fr)] tw:gap-[clamp(40px,7vw,110px)] tw:max-[860px]:grid-cols-1">
          <div>
            <SectionLabel>{c.docs.eyebrow}</SectionLabel>
            <h2 className="tw:mt-6 tw:max-w-[580px] tw:text-[clamp(34px,4.5vw,68px)] tw:leading-[1] tw:font-medium tw:tracking-[-0.04em] tw:text-balance">
              {c.docs.title}
            </h2>
          </div>
          <div className="tw:grid tw:grid-cols-3 tw:gap-px tw:bg-hairline tw:max-[760px]:grid-cols-1">
            {c.docs.items.map((doc, index) => (
              <TrackedLink
                className="tw:group tw:relative tw:flex tw:min-h-[230px] tw:flex-col tw:bg-night-raised tw:p-6 tw:transition-colors tw:hover:bg-night-soft"
                href={doc.href}
                key={doc.title}
              >
                <span className="tw:font-mono tw:text-[9px] tw:font-semibold tw:tracking-[0.1em] tw:text-signal tw:uppercase">
                  DOC / 0{index + 1}
                </span>
                <span className="tw:mt-7 tw:text-[21px] tw:font-medium tw:tracking-[-0.02em] tw:text-cream">
                  {doc.title}
                </span>
                <p className="tw:mt-3 tw:max-w-[300px] tw:text-[13px] tw:leading-relaxed tw:text-cream-muted">
                  {doc.body}
                </p>
                <ExternalLink className="tw:mt-auto tw:translate-y-1 tw:self-end tw:text-cream/25 tw:transition-[color,transform] tw:duration-200 tw:group-hover:translate-y-0 tw:group-hover:text-signal" size={17} />
              </TrackedLink>
            ))}
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
