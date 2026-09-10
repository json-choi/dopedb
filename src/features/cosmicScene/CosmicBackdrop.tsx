// Welcome-only scene: query-backed native recipe, post-paint GPU and real controls.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import { FALLBACK_COSMIC_RECIPE } from "./domain";
import { cosmicSceneOptions } from "./tauriAdapter";
import { createCosmicScene, type CosmicSceneController, type CosmicSceneStatus } from "./renderer";

export default function CosmicBackdrop() {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<CosmicSceneController | null>(null);
  const [status, setStatus] = useState<CosmicSceneStatus>({ available: false, paused: false });
  const { data } = useQuery(cosmicSceneOptions);
  const recipe = data ?? FALLBACK_COSMIC_RECIPE;

  useEffect(() => {
    let disposed = false, secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (!disposed && canvasRef.current) {
          controller.current = createCosmicScene(canvasRef.current, recipe, next => {
            if (!disposed) setStatus(next);
          });
        }
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      controller.current?.dispose();
      controller.current = null;
    };
  }, [recipe]);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" data-cosmic-backdrop
        className="tw:pointer-events-none tw:absolute tw:inset-0 tw:size-full tw:opacity-0 tw:transition-opacity tw:duration-700 tw:data-[rendered=true]:opacity-100 tw:motion-reduce:transition-none" />
      <div aria-hidden="true"
        className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-cosmic-veil" />
      {status.available ? (
        <div data-cosmic-controls className="tw:absolute tw:inset-x-4 tw:bottom-3 tw:z-20 tw:flex tw:items-center tw:justify-end tw:gap-1">
          <span className="tw:mr-auto tw:text-xs tw:text-muted-foreground tw:max-[760px]:hidden">
            {t("onboarding.cosmicHint")}
          </span>
          <Button iconOnly size="compact" variant="ghost" title={t("onboarding.cosmicZoomOut")}
            onClick={() => controller.current?.zoomBy(-0.16)}><Icon name="minus" /></Button>
          <Button iconOnly size="compact" variant="ghost" title={t("onboarding.cosmicZoomIn")}
            onClick={() => controller.current?.zoomBy(0.16)}><Icon name="plus" /></Button>
          <Button iconOnly size="compact" variant="ghost" title={t("onboarding.cosmicReset")}
            onClick={() => controller.current?.reset()}><Icon name="refresh" /></Button>
          <Button iconOnly size="compact" variant="ghost"
            title={t(status.paused ? "onboarding.cosmicPlay" : "onboarding.cosmicPause")}
            aria-pressed={status.paused}
            onClick={() => controller.current?.setPaused(!status.paused)}>
            <Icon name={status.paused ? "play" : "pause"} />
          </Button>
        </div>
      ) : null}
    </>
  );
}
