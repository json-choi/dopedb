"use client";

// Without JavaScript, the screenshot link still opens the real public image.
import Image from "next/image";
import { useEffect, useRef } from "react";
import { Arrow, MarketingAction } from "./MarketingButton";
import type { HomeCopy, LandingCopy } from "./homeContent";

type ImageLabels = Pick<LandingCopy, "desktopLabel" | "desktopSample" | "enlarge" | "close" | "imageDialog">;

export function HomeDemoShowcase({ product, c }: { product: HomeCopy["product"]; c: ImageLabels }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const ownsScrollLock = useRef(false);
  function unlock() {
    if (ownsScrollLock.current) document.documentElement.classList.remove("tw:overflow-hidden");
    ownsScrollLock.current = false;
  }
  useEffect(() => unlock, []);
  return <>
    <figure className="tw:m-0 tw:overflow-hidden tw:rounded-xl tw:border tw:border-hairline-strong tw:bg-night-raised tw:shadow-stage">
      <figcaption className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-x-4 tw:gap-y-2 tw:border-b tw:border-hairline tw:px-5 tw:py-4 tw:font-mono tw:text-[10px] tw:tracking-[0.04em] tw:text-cream-muted"><span>{c.desktopLabel}</span><span>{c.desktopSample}</span></figcaption>
      <a ref={opener} href={product.imageSrc} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !dialog.current?.showModal) return;
        event.preventDefault();
        dialog.current.showModal();
        ownsScrollLock.current = !document.documentElement.classList.contains("tw:overflow-hidden");
        document.documentElement.classList.add("tw:overflow-hidden");
      }} aria-label={c.enlarge} aria-haspopup="dialog" className="tw:group tw:relative tw:block tw:w-full tw:cursor-zoom-in tw:overflow-hidden tw:bg-night">
        <Image src={product.imageSrc} alt={product.imageAlt} width={2400} height={1600} sizes="(max-width: 768px) calc(100vw - 48px), (max-width: 1360px) calc(100vw - 96px), 1264px" className="tw:block tw:h-auto tw:max-h-[640px] tw:w-full tw:object-cover tw:object-top tw:transition-[filter] tw:duration-300 tw:group-hover:brightness-110 tw:motion-reduce:transition-none" />
        <span className="tw:absolute tw:right-4 tw:bottom-4 tw:flex tw:items-center tw:gap-3 tw:rounded-full tw:border tw:border-hairline-strong tw:bg-night/90 tw:px-4 tw:py-3 tw:text-[12px] tw:text-cream tw:backdrop-blur-md tw:group-hover:border-signal">{c.enlarge}<Arrow diagonal /></span>
      </a>
    </figure>
    <dialog ref={dialog} aria-label={c.imageDialog} onClose={() => { unlock(); opener.current?.focus({ preventScroll: true }); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const r = event.currentTarget.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.currentTarget.close();
    }} className="tw:fixed tw:inset-0 tw:m-auto tw:max-h-[calc(100dvh-32px)] tw:w-[min(1320px,calc(100vw-32px))] tw:max-w-none tw:overflow-auto tw:rounded-lg tw:border tw:border-hairline-strong tw:bg-night tw:p-0 tw:text-cream tw:shadow-stage tw:backdrop:bg-night/95">
      <div className="tw:sticky tw:top-0 tw:flex tw:items-center tw:justify-between tw:gap-4 tw:border-b tw:border-hairline tw:bg-night tw:px-5 tw:py-3">
        <p className="tw:text-[12px] tw:text-cream-muted">{c.desktopLabel}</p><MarketingAction autoFocus onClick={() => dialog.current?.close()}>{c.close} ×</MarketingAction>
      </div>
      <Image src={product.imageSrc} alt={product.imageAlt} width={2400} height={1600} sizes="(max-width: 1352px) calc(100vw - 32px), 1320px" className="tw:block tw:h-auto tw:w-full" />
    </dialog>
  </>;
}
