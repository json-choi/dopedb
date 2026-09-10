"use client";

// A lazy Three.js backdrop follows the whole landing page; server content never waits for WebGL.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { createGalaxyRenderer } from "../lib/galaxyRenderer";
import type { LandingCopy, Lang } from "./homeContent";
import { DopeDBMark } from "./DopeDBMark";
import { Arrow, MarketingAction } from "./MarketingButton";
type GalaxyLabels = Pick<LandingCopy, "explore" | "return" | "exploreHelp" | "moveHelp" | "pause" | "play" | "reduced" | "scroll">;
export function GalaxyHero({
  children,
  c,
  lang
}: {
  children: ReactNode;
  c: GalaxyLabels;
  lang: Lang;
}) {
  const scene = useRef<HTMLCanvasElement>(null);
  const galaxy = useRef<ReturnType<typeof createGalaxyRenderer> | null>(null);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(media.matches);
    preference();
    media.addEventListener("change", preference);
    let disposed = false;
    void import("../lib/galaxyRenderer").then(({ createGalaxyRenderer }) => {
      if (!disposed && scene.current) galaxy.current = createGalaxyRenderer(scene.current, ready => {
        if (!disposed) { setAvailable(ready); if (!ready) setExploring(false); }
      });
    }).catch(() => { if (!disposed) setAvailable(false); });
    return () => {
      disposed = true;
      media.removeEventListener("change", preference);
      galaxy.current?.dispose();
      galaxy.current = null;
    };
  }, []);
  useEffect(() => {
    galaxy.current?.setPaused(paused);
  }, [paused, available]);
  useEffect(() => {
    galaxy.current?.setExploring(exploring);
  }, [exploring, available]);
  useEffect(() => {
    if (!exploring) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExploring(false);
      exploreButton.current?.focus({
        preventScroll: true
      });
    };
    const scroll = () => {
      if (window.scrollY > window.innerHeight * .7) setExploring(false);
    };
    const navigate = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a")?.getAttribute("href")?.startsWith("#")) setExploring(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, {
      passive: true
    });
    window.addEventListener("click", navigate);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("click", navigate);
    };
  }, [exploring]);
  return <section id="top" data-exploring={exploring} className="tw:relative tw:min-h-[max(830px,100svh)] tw:px-6 tw:pt-[156px] tw:pb-28 tw:data-[exploring=true]:cursor-grab tw:data-[exploring=true]:touch-none tw:md:px-12 tw:max-md:min-h-[940px] tw:max-md:pt-[300px]">
    <div data-galaxy-backdrop data-ready={available} className="tw:pointer-events-none tw:fixed tw:inset-0 tw:-z-10 tw:bg-galaxy-fallback" aria-hidden="true">
      <canvas ref={scene} data-ready={available} className="tw:block tw:size-full tw:opacity-0 tw:transition-opacity tw:duration-1000 tw:data-[ready=true]:opacity-100 tw:motion-reduce:transition-none" />
    </div>
    <div data-exploring={exploring} className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-galaxy-veil tw:transition-opacity tw:duration-700 tw:data-[exploring=true]:opacity-0 tw:motion-reduce:transition-none tw:max-md:bg-galaxy-mobile-veil" />
    <div className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:bottom-0 tw:h-44 tw:bg-galaxy-bottom" />
    <div className="tw:relative tw:z-10 tw:mx-auto tw:max-w-[1264px]">
      <div inert={exploring} aria-hidden={exploring} data-exploring={exploring} className="tw:max-w-[720px] tw:transition-[opacity,transform] tw:duration-700 tw:data-[exploring=true]:translate-y-3 tw:data-[exploring=true]:opacity-0 tw:motion-reduce:transition-none">
        {children}
      </div>
    </div>
    {available && <div className="tw:absolute tw:top-[46%] tw:right-[9%] tw:z-20 tw:max-md:top-[206px] tw:max-md:right-6">
      <MarketingAction ref={exploreButton} shape="orbit" aria-pressed={exploring} onClick={() => setExploring(value => !value)}>
        <span className="tw:text-signal"><DopeDBMark className="tw:size-6" /></span>{exploring ? c.return : c.explore}<Arrow diagonal className="tw:size-3" />
      </MarketingAction>
      <p className="tw:mt-3 tw:text-center tw:text-[10px] tw:tracking-[0.03em] tw:text-cream-muted/65">
        <span className="tw:max-md:hidden">{exploring ? c.exploreHelp : c.moveHelp}</span>
        <span className="tw:md:hidden">{exploring ? lang === "ko" ? "손가락으로 드래그해 둘러보세요" : "Drag with your finger to look around" : lang === "ko" ? "터치해서 은하를 둘러보세요" : "Tap to explore the galaxy"}</span>
      </p>
    </div>}
    <div className="tw:absolute tw:inset-x-6 tw:bottom-8 tw:z-10 tw:flex tw:items-center tw:justify-between tw:gap-5 tw:md:inset-x-12">
      <a href="#product" className="tw:flex tw:min-h-11 tw:items-center tw:gap-3 tw:text-[11px] tw:text-cream-muted/65"><span className="tw:h-6 tw:w-px tw:bg-hairline-strong" />{c.scroll}<span>↓</span></a>
    </div>
    {available && <div className="tw:fixed tw:right-6 tw:bottom-6 tw:z-30 tw:md:right-12"><MarketingAction shape="icon" aria-pressed={paused || reduced} aria-label={reduced ? c.reduced : paused ? c.play : c.pause} disabled={reduced} onClick={() => setPaused(value => !value)}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">{paused || reduced ? <path d="M2 1 9 5 2 9Z" /> : <path d="M2 1h2v8H2ZM6 1h2v8H6Z" />}</svg>
    </MarketingAction></div>}
  </section>;
}
