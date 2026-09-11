// Welcome-only scene: query-backed native recipe and post-paint GPU lifecycle.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { FALLBACK_COSMIC_RECIPE } from "./domain";
import { cosmicSceneOptions } from "./tauriAdapter";
import { createCosmicScene, type CosmicSceneController } from "./renderer";

export default function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<CosmicSceneController | null>(null);
  const { data } = useQuery(cosmicSceneOptions);
  const recipe = data ?? FALLBACK_COSMIC_RECIPE;

  useEffect(() => {
    let disposed = false, secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (!disposed && canvasRef.current) {
          controller.current = createCosmicScene(canvasRef.current, recipe);
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
    </>
  );
}
