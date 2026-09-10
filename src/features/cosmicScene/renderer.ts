// Owns camera input, bounded GPU scheduling, visibility and resource teardown.
import type { CosmicSceneRecipe } from "./domain";
import { createCosmicResources } from "./resources";

export type CosmicSceneController = {
  setPaused(value: boolean): void;
  zoomBy(delta: number): void;
  reset(): void;
  dispose(): void;
};
export type CosmicSceneStatus = { available: boolean; paused: boolean };

export function createCosmicScene(
  canvas: HTMLCanvasElement,
  recipe: CosmicSceneRecipe,
  onStatus: (status: CosmicSceneStatus) => void = () => {},
): CosmicSceneController {
  const host = canvas.parentElement!;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let resources = createCosmicResources(canvas, recipe);
  let disposed = false, lost = false, inView = true, rendered = false;
  let frame = 0, timer = 0, lastTick = 0, clock = 0;
  let pauseOverride: boolean | null = null;
  let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  let orbitX = 0, orbitY = 0, targetOrbitX = 0, targetOrbitY = 0;
  let zoom = 1, targetZoom = 1;
  let drag: { id: number; x: number; y: number } | null = null;
  let bounds = host.getBoundingClientRect();
  const paused = () => pauseOverride ?? motion.matches;
  const report = () => {
    canvas.dataset.renderer = resources && !lost ? "webgl2" : "static";
    canvas.dataset.paused = String(paused());
    onStatus({ available: Boolean(resources) && !lost, paused: paused() });
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    lastTick = 0;
  };
  function requestDraw() {
    if (!frame && !disposed && !lost && resources && !document.hidden && inView) {
      clearTimeout(timer); timer = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || lost || !resources || document.hidden || !inView) return;
    const delta = lastTick ? Math.min((now - lastTick) / 1000, 0.10) : 1 / 30;
    lastTick = now;
    if (!paused()) clock += delta;
    const ease = motion.matches ? 1 : 1 - Math.exp(-delta * 6);
    pointerX += ((motion.matches ? 0 : targetX) - pointerX) * ease;
    pointerY += ((motion.matches ? 0 : targetY) - pointerY) * ease;
    orbitX += (targetOrbitX - orbitX) * ease;
    orbitY += (targetOrbitY - orbitY) * ease;
    zoom += (targetZoom - zoom) * ease;
    const { gl } = resources;
    gl.uniform2f(resources.pointer, pointerX, pointerY);
    gl.uniform2f(resources.orbit, orbitX, orbitY);
    gl.uniform1f(resources.zoom, zoom);
    gl.uniform1f(resources.time, clock);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!rendered) { canvas.dataset.rendered = "true"; rendered = true; }
    const moving = Math.abs(targetOrbitX - orbitX) + Math.abs(targetOrbitY - orbitY)
      + Math.abs(targetZoom - zoom) + (motion.matches ? 0 :
        Math.abs(targetX - pointerX) + Math.abs(targetY - pointerY)) > 0.001;
    if (!paused() || moving) {
      // One timer + one frame at most; no allocations or IPC in the frame loop.
      timer = window.setTimeout(() => { timer = 0; requestDraw(); },
        Math.max(0, 1000 / 30 - (performance.now() - now)));
    }
  }
  function resize() {
    bounds = host.getBoundingClientRect();
    if (!resources || lost) return;
    const dpr = Math.min(devicePixelRatio || 1, 2,
      Math.sqrt(4_000_000 / Math.max(1, bounds.width * bounds.height)));
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    canvas.width = width;
    canvas.height = height;
    resources.gl.viewport(0, 0, width, height);
    resources.gl.uniform2f(resources.resolution, width, height);
    requestDraw();
  }
  const interactive = (target: EventTarget | null) => target instanceof Element
    && Boolean(target.closest("button,a,input,textarea,select,[role=menuitem],[data-cosmic-controls]"));
  const move = (event: PointerEvent) => {
    if (interactive(event.target) && !drag) return;
    targetX = clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1) * 2 - 1, -1, 1);
    targetY = clamp(1 - (event.clientY - bounds.top) / Math.max(bounds.height, 1) * 2, -1, 1);
    if (drag && drag.id === event.pointerId) {
      targetOrbitX += (event.clientX - drag.x) * 0.006;
      targetOrbitY = clamp(targetOrbitY + (event.clientY - drag.y) * 0.003, -0.38, 0.38);
      drag.x = event.clientX; drag.y = event.clientY;
    }
    requestDraw();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || interactive(event.target)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    host.setPointerCapture(event.pointerId);
    host.dataset.dragging = "true";
    host.focus({ preventScroll: true });
  };
  const up = () => {
    const activeDrag = drag;
    drag = null;
    if (activeDrag && host.hasPointerCapture(activeDrag.id)) host.releasePointerCapture(activeDrag.id);
    host.dataset.dragging = "false";
  };
  const leave = () => { if (!drag) { targetX = targetY = 0; requestDraw(); } };
  const zoomBy = (delta: number) => {
    targetZoom = clamp(targetZoom * Math.exp(delta), 0.65, 1.65);
    requestDraw();
  };
  const reset = () => {
    targetX = targetY = targetOrbitX = targetOrbitY = 0;
    targetZoom = 1;
    requestDraw();
  };
  const setPaused = (value: boolean) => {
    pauseOverride = value;
    stop(); report(); requestDraw();
  };
  const wheel = (event: WheelEvent) => {
    if (interactive(event.target) || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    zoomBy(-clamp(event.deltaY, -80, 80) * (event.deltaMode === 1 ? 0.018 : 0.0018));
  };
  const key = (event: KeyboardEvent) => {
    if (event.target !== host) return;
    switch (event.key) {
      case "ArrowLeft": targetOrbitX -= 0.15; break;
      case "ArrowRight": targetOrbitX += 0.15; break;
      case "ArrowUp": targetOrbitY = clamp(targetOrbitY - 0.06, -0.38, 0.38); break;
      case "ArrowDown": targetOrbitY = clamp(targetOrbitY + 0.06, -0.38, 0.38); break;
      case "+": case "=": zoomBy(0.12); break;
      case "-": zoomBy(-0.12); break;
      case "0": reset(); break;
      case " ": setPaused(!paused()); break;
      default: return;
    }
    event.preventDefault();
    requestDraw();
  };
  const visibility = () => { stop(); if (!document.hidden) requestDraw(); };
  const preference = () => { stop(); report(); requestDraw(); };
  const loss = (event: Event) => {
    event.preventDefault();
    lost = true; rendered = false;
    canvas.dataset.rendered = "false";
    stop(); report();
  };
  const restore = () => {
    resources?.dispose();
    resources = createCosmicResources(canvas, recipe);
    lost = false;
    report(); resize();
  };
  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    stop(); if (inView) requestDraw();
  });
  resizeObserver.observe(host);
  intersectionObserver.observe(canvas);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("lostpointercapture", up);
  host.addEventListener("pointerleave", leave);
  host.addEventListener("wheel", wheel, { passive: false });
  host.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", preference);
  canvas.addEventListener("webglcontextlost", loss);
  canvas.addEventListener("webglcontextrestored", restore);
  report(); resize();

  return {
    setPaused, zoomBy, reset,
    dispose() {
      disposed = true;
      stop(); up();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("lostpointercapture", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", preference);
      canvas.removeEventListener("webglcontextlost", loss);
      canvas.removeEventListener("webglcontextrestored", restore);
      resources?.dispose();
      const gl = resources?.gl;
      queueMicrotask(() => {
        if (!canvas.isConnected) gl?.getExtension("WEBGL_lose_context")?.loseContext();
      });
      resources = null;
      canvas.width = canvas.height = 1;
    },
  };
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
