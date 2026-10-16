// Server-rendered workflow narratives share one layout and never simulate product receipts.
import { Arrow, SectionLabel } from "./MarketingButton";
import { repoUrl, type Lang } from "./homeContent";
import { workflowCopy } from "./homeWorkflowContent";

export function HomeWorkflows({ lang }: { readonly lang: Lang }) {
  const c = workflowCopy[lang];
  return (
    <section id="workflows" aria-labelledby="workflows-title" className="tw:relative tw:z-10 tw:scroll-mt-24 tw:bg-night/65 tw:px-6 tw:py-24 tw:md:px-12">
      <div className="tw:mx-auto tw:max-w-[1264px] tw:break-keep">
        <SectionLabel>{c.label}</SectionLabel>
        <h2 id="workflows-title" className="tw:mt-5 tw:max-w-4xl tw:text-4xl tw:leading-tight tw:font-medium tw:tracking-tight tw:md:text-5xl">{c.title}</h2>
        <p className="tw:mt-6 tw:max-w-2xl tw:text-lg tw:leading-relaxed tw:text-cream-muted">{c.introduction}</p>
        <p className="tw:mt-6 tw:max-w-2xl tw:text-base tw:leading-relaxed tw:text-cream-muted">{c.notice}</p>
        <a href={`${repoUrl}/blob/main/docs/WORKSPACE_ROADMAP.md#introduction-site-candidates-in-recommended-display-order`} target="_blank" rel="noreferrer" className="tw:mt-3 tw:inline-flex tw:min-h-11 tw:items-center tw:gap-3 tw:text-base tw:text-signal tw:hover:underline tw:focus-visible:outline-2 tw:focus-visible:outline-offset-4 tw:focus-visible:outline-signal">{c.evidenceLink}<Arrow diagonal /></a>
        <div className="tw:mt-12 tw:divide-y tw:divide-hairline-strong">
          {c.items.map((flow) => (
            <article key={flow.id} id={flow.id} aria-labelledby={`${flow.id}-title`} className="tw:grid tw:scroll-mt-24 tw:gap-8 tw:py-12 tw:lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:lg:gap-20">
              <div>
                <SectionLabel>{flow.task}</SectionLabel>
                <p className="tw:mt-5 tw:max-w-xl tw:text-lg tw:leading-relaxed tw:text-cream-muted">{flow.problem}</p>
                <h3 id={`${flow.id}-title`} className="tw:mt-5 tw:max-w-xl tw:text-3xl tw:leading-snug tw:font-medium tw:tracking-tight">{flow.title}</h3>
              </div>
              <div>
                <ol className="tw:m-0 tw:list-decimal tw:space-y-4 tw:pl-6 tw:text-lg tw:leading-relaxed tw:marker:text-cream-muted">
                  {flow.steps.map((step) => <li key={step} className="tw:pl-2">{step}</li>)}
                </ol>
                <dl className="tw:mt-8 tw:space-y-6">
                  <div><dt className="tw:text-base tw:font-semibold">{c.result}</dt><dd className="tw:m-0 tw:mt-2 tw:text-lg tw:leading-relaxed tw:text-cream-muted">{flow.benefit}</dd></div>
                  <div><dt className="tw:text-base tw:font-semibold">{c.requires}</dt><dd className="tw:m-0 tw:mt-2 tw:text-base tw:leading-relaxed tw:text-cream-muted">{flow.prerequisite}</dd></div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
