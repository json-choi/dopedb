"use client";

// A deterministic, browser-only story. No backend, credentials, SQL execution or persistence.
import { useEffect, useReducer, useRef } from "react";
import { DopeDBMark } from "./DopeDBMark";
import type { LandingCopy, Lang } from "./homeContent";
import { Arrow, Detail, SectionLabel, MarketingAction } from "./MarketingButton";
type DemoState = {
  phase: number;
  database: boolean;
  source: boolean;
  outcome: "approved" | "rejected" | null;
};
type DemoAction = {
  type: "database" | "source" | "next" | "back" | "approve" | "reject" | "reset";
};
const initial: DemoState = {
  phase: 0,
  database: true,
  source: true,
  outcome: null
};
const proposal = "UPDATE orders\nSET status = 'shipped'\nWHERE id = 10102\n  AND status = 'paid';";
function reducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return {
    ...initial
  };
  if (action.type === "database" && state.phase === 0) return {
    ...state,
    database: !state.database
  };
  if (action.type === "source" && state.phase === 0) return {
    ...state,
    source: !state.source
  };
  if (action.type === "next" && state.database && state.phase < 2) return {
    ...state,
    phase: state.phase + 1
  };
  if (action.type === "back" && state.phase > 0 && state.phase < 3) return {
    ...state,
    phase: state.phase - 1
  };
  if (state.phase === 2 && state.database && (action.type === "approve" || action.type === "reject")) {
    return {
      ...state,
      phase: 3,
      outcome: action.type === "approve" ? "approved" : "rejected"
    };
  }
  return state;
}
function ResourceOrbit({
  state,
  lang
}: {
  state: DemoState;
  lang: Lang;
}) {
  const ko = lang === "ko";
  return <svg viewBox="0 0 480 340" className="tw:block tw:w-full tw:overflow-visible tw:text-cream" role="img" aria-label={ko ? "선택한 DB와 소스만 Agent의 궤도 안에 포함되는 설명용 관계도" : "Diagram: only the selected database and source are inside the agent’s scope"}>
    <g fill="none" stroke="currentColor" className="tw:text-hairline">
      <ellipse cx="245" cy="164" rx="197" ry="94" transform="rotate(-24 245 164)" />
      <ellipse cx="245" cy="164" rx="160" ry="61" transform="rotate(-24 245 164)" />
      <circle cx="245" cy="164" r="135" strokeDasharray="2 9" />
    </g>
    <ellipse cx="245" cy="164" rx="160" ry="61" transform="rotate(-24 245 164)" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="72 740" strokeDashoffset={-state.phase * 190} className="tw:text-signal tw:transition-[stroke-dashoffset] tw:duration-700 tw:motion-reduce:transition-none" />
    <circle cx="245" cy="164" r="49" fill="currentColor" className="tw:text-night" />
    <g transform="translate(200 119)" className="tw:text-signal"><DopeDBMark size={90} className="tw:size-[90px]" /></g>
    <text x="245" y="221" textAnchor="middle" fill="currentColor" className="tw:font-mono tw:text-[10px] tw:tracking-widest tw:text-cream-muted">DEMO COMMERCE</text>
    {[{
      x: 115,
      y: 238,
      label: "Demo SQLite",
      sub: ko ? "선택한 쓰기 대상" : "Selected write target",
      selected: state.database
    }, {
      x: 368,
      y: 79,
      label: "Storefront source",
      sub: ko ? "읽기 전용 소스" : "Read-only source",
      selected: state.source
    }, {
      x: 391,
      y: 210,
      label: "CODEX",
      sub: ko ? "정확한 리소스 범위" : "Exact resource scope",
      selected: state.phase > 0
    }].map(node => <g key={node.label} transform={`translate(${node.x} ${node.y})`} data-selected={node.selected} className="tw:text-cream-muted/45 tw:transition-colors tw:duration-500 tw:data-[selected=true]:text-signal">
      <circle r="12" fill="currentColor" opacity=".08" /><circle r="4" fill="currentColor" /><circle r="9" fill="none" stroke="currentColor" opacity=".5" />
      <text y="30" textAnchor="middle" fill="currentColor" className="tw:font-mono tw:text-[11px]">{node.label}</text>
      <text y="48" textAnchor="middle" fill="currentColor" opacity=".7" className="tw:text-[11px]">{node.sub}</text>
    </g>)}
    <g transform="translate(66 48)" className="tw:text-cream-muted/40"><path d="m-3-3 6 6m0-6-6 6" stroke="currentColor" fill="none" /><text x="14" y="4" fill="currentColor" className="tw:font-mono tw:text-[10px]">Other databases</text><text x="14" y="21" fill="currentColor" className="tw:text-[10px]">{ko ? "범위 밖 · 접근 없음" : "Outside scope · no access"}</text></g>
  </svg>;
}
export function HomeScopeWalkthrough({
  lang,
  c
}: {
  lang: Lang;
  c: Pick<LandingCopy, "flowLabel" | "flowTitle" | "flowBody" | "demoNotice">;
}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previousPhase = useRef(0);
  const ko = lang === "ko";
  const t = (korean: string, english: string) => ko ? korean : english;
  const stages = ko ? ["리소스 선택", "Agent 작업", "SQL 승인", "결과 확인"] : ["Select resources", "Agent work", "Review SQL", "Check the result"];
  const titles = ko ? ["먼저, 일할 수 있는 곳을 정하세요.", "선택한 범위에서만 제안합니다.", "이 SQL을 실행해도 될까요?", state.outcome === "approved" ? "승인한 변경만, 확인 가능한 결과로." : "거절하면, 변경하지 않습니다."] : ["First, choose where it can work.", "A proposal within your selected scope.", "May this exact SQL run?", state.outcome === "approved" ? "The approved change. A visible result." : "Declined means unchanged."];
  useEffect(() => {
    if (previousPhase.current !== state.phase) {
      heading.current?.focus({
        preventScroll: true
      });
      if (window.innerWidth < 1024) panel.current?.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
      });
    }
    previousPhase.current = state.phase;
  }, [state.phase]);
  return <section id="flow" className="tw:relative tw:z-10 tw:scroll-mt-24 tw:border-y tw:border-hairline tw:bg-night/60 tw:px-6 tw:py-24 tw:md:px-12 tw:lg:py-32">
    <div className="tw:mx-auto tw:grid tw:max-w-[1264px] tw:gap-12 tw:lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] tw:lg:gap-20">
      <div>
        <SectionLabel>{c.flowLabel}</SectionLabel>
        <h2 className="tw:mt-7 tw:whitespace-pre-line tw:text-[clamp(36px,4.2vw,58px)] tw:leading-[1.16] tw:font-medium tw:tracking-[-0.05em]">{c.flowTitle}</h2>
        <p className="tw:mt-6 tw:max-w-[400px] tw:text-[15px] tw:leading-[1.85] tw:text-cream-muted">{c.flowBody}</p>
        <div className="tw:mt-4 tw:bg-galaxy-orbit-light tw:max-lg:mx-auto tw:max-lg:max-w-[440px]"><ResourceOrbit state={state} lang={lang} /></div>
        <p className="tw:mt-2 tw:max-w-[410px] tw:text-[12px] tw:leading-[1.8] tw:text-cream-muted/75">{c.demoNotice}</p>
        <noscript><p className="tw:mt-3 tw:text-[12px] tw:leading-relaxed tw:text-cream-muted">{t("체험 데모에는 JavaScript가 필요합니다. 제품 소개와 다운로드는 그대로 사용할 수 있습니다.", "The walkthrough needs JavaScript. Product information and downloads remain available.")}</p></noscript>
      </div>

      <div ref={panel} data-demo-phase={state.phase} data-demo-outcome={state.outcome ?? "none"} className="tw:scroll-mt-28 tw:self-center tw:overflow-hidden tw:rounded-xl tw:border tw:border-hairline-strong tw:bg-night-raised tw:scheme-dark">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-4 tw:border-b tw:border-hairline tw:px-6 tw:py-4 tw:font-mono tw:text-[10px] tw:tracking-[0.08em]"><span className="tw:text-cream-muted">DOPEDB / INTERACTIVE WALKTHROUGH</span><span className="tw:shrink-0 tw:text-signal">DEMO</span></div>
        <ol aria-label={t("데모 진행 단계", "Demo progress")} className="tw:m-0 tw:grid tw:list-none tw:grid-cols-4 tw:gap-2 tw:border-b tw:border-hairline tw:px-6 tw:py-5 tw:max-sm:px-4">
          {stages.map((stage, index) => <li key={stage} data-active={state.phase === index} data-done={state.phase > index} aria-current={state.phase === index ? "step" : undefined} className="tw:border-t tw:border-hairline-strong tw:pt-3 tw:text-cream-muted/55 tw:transition-colors tw:data-[active=true]:border-signal tw:data-[active=true]:text-signal tw:data-[done=true]:border-signal/40 tw:data-[done=true]:text-cream-muted"><span className="tw:font-mono tw:text-[10px]">0{index + 1}</span><span className="tw:mt-1.5 tw:block tw:text-[12px] tw:leading-tight">{stage}</span></li>)}
        </ol>
        <div className="tw:flex tw:min-h-[470px] tw:flex-col tw:p-7 tw:max-sm:p-5">
          <h3 ref={heading} tabIndex={-1} className="tw:m-0 tw:text-[23px] tw:leading-[1.35] tw:font-medium tw:tracking-[-0.035em] tw:outline-none">{titles[state.phase]}</h3>
          <p className="tw:sr-only" role="status">{t("현재 단계", "Current step")}: {stages[state.phase]}</p>

          {state.phase === 0 && <>
            <p className="tw:mt-7 tw:font-mono tw:text-[10px] tw:tracking-widest tw:text-cream-muted">PROJECT / DEMO COMMERCE</p>
            {[{
              key: "database" as const,
              title: "Demo SQLite",
              desc: t("읽기 + 쓰기 대상 · 로컬 샘플 DB", "Read + write target · local sample DB"),
              value: state.database
            }, {
              key: "source" as const,
              title: "Storefront source",
              desc: t("읽기 전용 · 샘플 소스", "Read only · sample source"),
              value: state.source
            }].map(resource => <label key={resource.key} className="tw:flex tw:cursor-pointer tw:items-center tw:gap-4 tw:border-b tw:border-hairline tw:py-4"><input type="checkbox" checked={resource.value} onChange={() => dispatch({
                type: resource.key
              })} className="tw:size-4 tw:shrink-0 tw:accent-signal" /><span><span className="tw:block tw:text-[14px] tw:font-medium">{resource.title}</span><span className="tw:mt-1 tw:block tw:text-[12px] tw:text-cream-muted">{resource.desc}</span></span></label>)}
            <p className="tw:mt-4 tw:text-[12px] tw:text-cream-muted" role="status">{state.database ? t("선택되지 않은 리소스에는 접근할 수 없습니다.", "Unselected resources stay outside the grant.") : t("이 예시를 진행하려면 Demo SQLite를 선택하세요.", "Select Demo SQLite to continue this example.")}</p>
          </>}

          {state.phase === 1 && <>
            <div className="tw:mt-6 tw:border-l-2 tw:border-signal/65 tw:pl-4"><p className="tw:font-mono tw:text-[10px] tw:text-signal">YOU / {t("샘플 요청", "SAMPLE REQUEST")}</p><p className="tw:mt-2 tw:text-[15px] tw:leading-[1.75]">{t("주문 10102가 배송됐어. 상태를 shipped로 바꿔줘.", "Order 10102 has shipped. Change its status to shipped.")}</p></div>
            <div className="tw:mt-7 tw:space-y-4 tw:text-[13px] tw:leading-[1.75] tw:text-cream-muted">
              <p><span className="tw:mr-3 tw:font-mono tw:text-signal">01</span>{t("선택한 Demo SQLite의 orders 스키마 확인", "Inspect the orders schema in the selected Demo SQLite")}</p>
              <p><span className="tw:mr-3 tw:font-mono tw:text-signal">02</span>{t("주문 10102의 기존 상태 확인: paid", "Check order 10102’s current status: paid")}</p>
              <p><span className="tw:mr-3 tw:font-mono tw:text-warning">03</span>{t("변경 SQL 제안 · 사람의 승인 전에는 실행하지 않음", "Propose a change · wait for human approval before execution")}</p>
            </div>
            <p className="tw:mt-6 tw:font-mono tw:text-[10px] tw:text-cream-muted/65">{state.source ? "SCOPE / Demo SQLite + Storefront source" : "SCOPE / Demo SQLite"}</p>
          </>}

          {state.phase === 2 && <>
            <p className="tw:mt-3 tw:text-[13px] tw:leading-[1.8] tw:text-cream-muted">{t("변경할 대상과 SQL을 직접 확인하세요. Agent는 자신의 제안을 승인할 수 없습니다.", "Review the target and exact SQL. An agent cannot approve its own proposal.")}</p>
            <dl className="tw:mt-4"><Detail label={t("쓰기 대상", "Write target")}>Demo SQLite / orders</Detail><Detail label={t("실행 상태", "Execution state")}><span className="tw:text-warning">{t("승인 대기 · 미실행", "Awaiting approval · not executed")}</span></Detail></dl>
            <pre className="tw:mt-5 tw:overflow-x-auto tw:rounded-sm tw:border-l-2 tw:border-signal/65 tw:bg-night tw:p-5 tw:font-mono tw:text-[13px] tw:leading-[1.9] tw:text-cream"><code>{proposal}</code></pre>
          </>}

          {state.phase === 3 && <>
            <p className="tw:mt-3 tw:text-[13px] tw:leading-[1.8] tw:text-cream-muted">{state.outcome === "approved" ? t("샘플 화면에서 승인한 변경 결과입니다. 실제 DB에 영향을 주지 않습니다.", "This sample shows the approved outcome. No real database was affected.") : t("샘플 요청을 거절했습니다. 실행하지 않았고, 주문 상태는 그대로입니다.", "The sample request was declined. Nothing ran and the order status is unchanged.")}</p>
            <div className="tw:mt-7 tw:flex tw:items-center tw:justify-between tw:gap-4 tw:border-y tw:border-hairline tw:py-6"><span className="tw:font-mono tw:text-[12px] tw:text-cream-muted">ORDER / 10102</span><span className="tw:flex tw:items-center tw:gap-4 tw:font-mono tw:text-[18px]"><span className="tw:text-cream-muted">paid</span><Arrow /><span data-approved={state.outcome === "approved"} className="tw:text-cream tw:data-[approved=true]:text-signal">{state.outcome === "approved" ? "shipped" : "paid"}</span></span></div>
            <dl className="tw:mt-5"><Detail label={t("사람의 결정", "Human decision")}>{state.outcome === "approved" ? t("승인 (예시)", "Approved (example)") : t("거절 (예시)", "Declined (example)")}</Detail><Detail label={t("결과 확인", "Result review")}>{t("내 기기의 Desktop", "Your local Desktop")}</Detail><Detail label={t("실제 DB 실행", "Real DB execution")}>{t("없음 · 설명용 데모", "None · illustrative demo")}</Detail></dl>
          </>}

          <div className="tw:mt-auto tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:pt-7" data-primary-flow>
            {state.phase === 0 && <MarketingAction tone="primary" disabled={!state.database} onClick={() => dispatch({
              type: "next"
            })}>{t("이 범위로 Agent 시작해보기", "Start an agent in this scope")} <Arrow /></MarketingAction>}
            {state.phase > 0 && state.phase < 3 && <MarketingAction onClick={() => dispatch({
              type: "back"
            })}>{t("이전", "Back")}</MarketingAction>}
            {state.phase === 1 && <MarketingAction tone="primary" onClick={() => dispatch({
              type: "next"
            })}>{t("제안한 SQL 검토", "Review the proposed SQL")} <Arrow /></MarketingAction>}
            {state.phase === 2 && <div className="tw:flex tw:flex-wrap tw:gap-2"><MarketingAction onClick={() => dispatch({
                type: "reject"
              })}>{t("거절해보기", "Try declining")}</MarketingAction><MarketingAction tone="primary" onClick={() => dispatch({
                type: "approve"
              })}>{t("승인해보기", "Try approving")} <Arrow /></MarketingAction></div>}
            {state.phase === 3 && <MarketingAction onClick={() => dispatch({
              type: "reset"
            })}>{t("다른 선택으로 다시 해보기", "Try a different decision")} <Arrow /></MarketingAction>}
            <span className="tw:font-mono tw:text-[9px] tw:tracking-widest tw:text-cream-muted/55">{state.phase + 1} / 4</span>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
