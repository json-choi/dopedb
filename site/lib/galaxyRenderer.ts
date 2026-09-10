// A single viewport-sized Three.js scene follows native section scroll, with explicit GPU lifecycle.
import { MathUtils, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { createGalaxyControls } from "./galaxyControls";
import { createGalaxyScene } from "./galaxyScene";

const chapters = ["top", "product", "flow", "trust", "download"];

export function createGalaxyRenderer(canvas: HTMLCanvasElement, onReady: (ready: boolean) => void) {
  const host = canvas.closest("section")!, layer = canvas.parentElement!;
  const main = host.closest("main")!;
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
  const scene = new Scene(), camera = new PerspectiveCamera(46, 1, 0.1, 240);
  const resources = createGalaxyScene(getComputedStyle(canvas), window.innerWidth < 768);
  const controls = createGalaxyControls(host);
  layer.dataset.axis = resources.axis.toArray().map(value => value.toFixed(4)).join(",");
  scene.add(resources.group, resources.field);
  scene.background = resources.night;
  camera.position.z = 24;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const abort = new AbortController(), options = { signal: abort.signal };
  let frame = 0, last = 0, elapsed = 0, progress = 0, target = 0;
  let paused = false, lost = false, disposed = false, failed = false;
  let offsets = chapters.map(() => 0);
  const viewport = { width: 0, height: 0 };
  function measure() {
    offsets = chapters.map(id => (document.getElementById(id)?.getBoundingClientRect().top ?? 0) + window.scrollY);
    scroll();
    const width = window.innerWidth, height = window.innerHeight;
    if (width !== viewport.width || height !== viewport.height) {
      viewport.width = width; viewport.height = height;
      const ratio = Math.min(devicePixelRatio, 1.5, Math.sqrt(2000000 / (width * height)));
      renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
      resources.starMaterial.uniforms.uPixelRatio.value = ratio;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      if (paused || motion.matches) render(0, true);
    }
  }
  function scroll() {
    const y = window.scrollY;
    let index = 0;
    while (index < chapters.length - 2 && y >= offsets[index + 1]) index++;
    target = index + MathUtils.clamp((y - offsets[index]) / Math.max(1, offsets[index + 1] - offsets[index]), 0, 1);
  }
  function render(delta: number, immediate = false) {
    if (lost || disposed || failed) return;
    if (!paused && !motion.matches) {
      elapsed += delta;
      progress = immediate ? target : MathUtils.damp(progress, target, 3.5, delta);
    }
    const journey = progress / (chapters.length - 1);
    const input = controls.state;
    const compact = viewport.width < 768;
    resources.group.position.set(0, compact ? 10 * (1 - Math.min(journey * 4, 1)) : 0, -34);
    resources.disk.rotation.z = journey * 1.7 + elapsed * 0.012;
    const ease = immediate ? 1 : 1 - Math.exp(-delta * 4);
    camera.position.x = MathUtils.lerp(camera.position.x, input.x, ease);
    camera.position.y = MathUtils.lerp(camera.position.y, input.y, ease);
    camera.position.z = MathUtils.lerp(camera.position.z, (58 - journey * 47) / input.zoom - 34 - (input.exploring ? 5 : 0), ease);
    camera.lookAt(0, 0, -50);
    resources.cloudMaterial.uniforms.uTime.value = elapsed;
    resources.cloudMaterial.uniforms.uJourney.value = journey;
    resources.starMaterial.uniforms.uTime.value = elapsed;
    renderer.render(scene, camera);
    layer.dataset.chapter = chapters[Math.round(progress)];
    layer.dataset.progress = progress.toFixed(3);
    layer.dataset.depth = camera.position.z.toFixed(3);
    layer.dataset.rotation = resources.disk.rotation.z.toFixed(3);
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || paused || motion.matches || document.hidden || failed) return;
    const delta = (now - last) / 1000;
    if (delta >= 1 / 30) { last = now; render(Math.min(delta, 0.1)); }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; last = performance.now();
    const running = !disposed && !lost && !paused && !motion.matches && !document.hidden && !failed;
    controls.setEnabled(running);
    layer.dataset.running = String(running);
    if (running) frame = requestAnimationFrame(tick);
  }
  renderer.debug.onShaderError = () => { failed = true; onReady(false); sync(); };
  const resize = new ResizeObserver(measure);
  function dispose() {
    disposed = true; sync(); abort.abort(); resize.disconnect(); controls.dispose();
    resources.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
  try {
    measure(); render(0, true);
    if (failed) throw new Error("Galaxy shader unavailable");
    resize.observe(main);
    window.addEventListener("resize", measure, options);
    window.addEventListener("scroll", scroll, { ...options, passive: true });
    document.addEventListener("visibilitychange", sync, options);
    motion.addEventListener("change", () => { sync(); render(0, true); }, options);
    canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); lost = true; onReady(false); sync(); }, options);
    canvas.addEventListener("webglcontextrestored", () => { lost = false; failed = false; render(0, true); onReady(!failed); sync(); }, options);
    onReady(true); sync();
  } catch (error) { dispose(); throw error; }
  return {
    setPaused(value: boolean) { paused = value; sync(); },
    setExploring(value: boolean) { controls.setExploring(value); if (paused || motion.matches) render(0, true); },
    dispose,
  };
}
