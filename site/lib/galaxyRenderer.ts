// Owns photographic galaxy camera input, bounded scheduling, context recovery and cleanup.
import { createGalaxyScene } from "./galaxyScene";
export type GalaxyController = {
  setPaused(value: boolean): void;
  setExploring(value: boolean): void;
  reset(): void;
  dispose(): void;
};
export function createGalaxy(canvas: HTMLCanvasElement, poster: HTMLImageElement, onAvailability: (available: boolean) => void): GalaxyController {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) {
    canvas.dataset.renderer = "photograph";
    onAvailability(false);
    return { setPaused() {}, setExploring() {}, reset() {}, dispose() {} };
  }
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let scene: ReturnType<typeof createGalaxyScene> | undefined;
  let reduced = motion.matches, paused = false, exploring = false, disposed = false, contextLost = false;
  let frame = 0, timer = 0, clock = 0, lastTime = 0, inView = true;
  let width = 0, height = 0, pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  let centerX = 0.5, centerY = 0.5, zoom = 1.06, pan = 0, targetPan = 0, dragX: number | null = null;
  function stop() {
    clearTimeout(timer); cancelAnimationFrame(frame); timer = frame = 0;
  }
  function requestDraw() {
    if (frame || timer || disposed || contextLost || document.hidden || !scene) return;
    timer = window.setTimeout(() => {
      timer = 0; frame = requestAnimationFrame(draw);
    }, Math.max(0, 1000 / 30 - (performance.now() - lastTime)));
  }
  function resize() {
    width = window.innerWidth; height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.4 : 1.75, Math.sqrt(4_000_000 / (width * height)));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    inView = canvas.parentElement!.getBoundingClientRect().bottom > 0;
    requestDraw();
  }
  function draw(time: number) {
    frame = 0;
    if (disposed || contextLost || document.hidden || !scene) return;
    const delta = Math.min((time - (lastTime || time)) / 1000, 0.05);
    lastTime = time;
    if (!paused && !reduced) clock += delta;
    const ease = reduced || paused ? 1 : 0.09;
    pointerX += ((reduced ? 0 : targetX) - pointerX) * ease;
    pointerY += ((reduced ? 0 : targetY) - pointerY) * ease;
    pan += (targetPan - pan) * ease;
    const progress = Math.min(window.scrollY / height, 1.6), compact = width < 760;
    zoom += ((exploring ? 1.28 : 1.06 + progress * 0.08) - zoom) * ease;
    centerX += ((compact || exploring ? 0.65 : 0.50) - centerX) * ease;
    centerY += ((compact ? 0.54 : 0.50) - centerY) * ease;
    scene.draw({ width, height, pointerX, pointerY, centerX: centerX + pan, centerY,
      zoom, time: clock, fade: Math.max(0.13, 1 - progress * 0.75) });
    canvas.dataset.rendered = "true"; canvas.dataset.paused = String(paused || reduced);
    if (!paused && !reduced && inView) requestDraw();
  }
  function initialize() {
    if (disposed || contextLost || !poster.complete || !poster.naturalWidth) return;
    scene?.dispose();
    try {
      scene = createGalaxyScene(gl!, poster);
      canvas.dataset.renderer = "photographic-webgl";
      canvas.dataset.textureBytes = String(poster.naturalWidth * poster.naturalHeight * 4);
      centerX = width < 760 ? 0.65 : 0.5; centerY = width < 760 ? 0.54 : 0.5;
      onAvailability(true); resize();
    } catch (error) {
      scene = undefined; canvas.dataset.rendered = "false"; onAvailability(false);
      console.warn("Galaxy enhancement unavailable; retaining photograph", error);
    }
  }
  function scroll() {
    const next = canvas.parentElement!.getBoundingClientRect().bottom > 0;
    if (next || inView) requestDraw();
    inView = next;
  }
  function pointer(event: PointerEvent) {
    if (reduced && !exploring || window.scrollY > height) return;
    targetX = event.clientX / width * 2 - 1; targetY = event.clientY / height * 2 - 1;
    if (dragX !== null) {
      targetPan = Math.max(-0.09, Math.min(0.09, targetPan - (event.clientX - dragX) / width * 0.3));
      dragX = event.clientX;
    }
    requestDraw();
  }
  function down(event: PointerEvent) {
    if (exploring && event.target instanceof Element && !event.target.closest("a,button")) dragX = event.clientX;
  }
  const up = () => { dragX = null; };
  function key(event: KeyboardEvent) {
    if (!exploring || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    targetPan = Math.max(-0.09, Math.min(0.09, targetPan + (event.key === "ArrowLeft" ? -0.025 : 0.025)));
    requestDraw();
  }
  function visibility() { stop(); lastTime = 0; if (!document.hidden) requestDraw(); }
  function preference() { reduced = motion.matches; stop(); requestDraw(); }
  function loss(event: Event) {
    event.preventDefault(); contextLost = true; stop();
    canvas.dataset.rendered = "false"; onAvailability(false);
  }
  function restore() { contextLost = false; scene = undefined; initialize(); }
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", scroll, { passive: true });
  window.addEventListener("pointermove", pointer, { passive: true });
  window.addEventListener("pointerdown", down, { passive: true });
  window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key); document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", preference);
  canvas.addEventListener("webglcontextlost", loss); canvas.addEventListener("webglcontextrestored", restore);
  poster.addEventListener("load", initialize);
  resize(); initialize();
  return {
    setPaused(value) { paused = value; stop(); requestDraw(); },
    setExploring(value) { exploring = value; targetPan = 0; requestDraw(); },
    reset() { targetX = targetY = targetPan = 0; requestDraw(); },
    dispose() {
      disposed = true; stop(); scene?.dispose();
      window.removeEventListener("resize", resize); window.removeEventListener("scroll", scroll);
      window.removeEventListener("pointermove", pointer); window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", preference); poster.removeEventListener("load", initialize);
      canvas.removeEventListener("webglcontextlost", loss); canvas.removeEventListener("webglcontextrestored", restore);
      queueMicrotask(() => { if (!canvas.isConnected) gl!.getExtension("WEBGL_lose_context")?.loseContext(); });
    }
  };
}
