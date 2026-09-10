// Owns one decorative WebGL canvas, camera input, scheduling, fallback and GPU cleanup.
import { createParticles, galaxyFragmentShader, galaxyVertexShader, PARTICLE_STRIDE, type GalaxyPalette } from "./galaxyParticles";
export type GalaxyController = {
  setPaused(value: boolean): void;
  setExploring(value: boolean): void;
  reset(): void;
  dispose(): void;
};
export function createGalaxy(canvas: HTMLCanvasElement, onAvailability: (available: boolean) => void): GalaxyController {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => {
    const hex = styles.getPropertyValue(name).trim().replace("#", "");
    return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  const palette: GalaxyPalette = {
    cream: color("--landing-cream"),
    signal: color("--landing-signal"),
    electric: color("--landing-electric")
  };
  const compact = window.innerWidth < 760;
  const particles = createParticles(compact, palette);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power"
  });
  if (!gl) {
    onAvailability(false);
    return staticFallback(canvas, particles, palette);
  }
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram()!;
  const buffer = gl.createBuffer()!;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, galaxyVertexShader], [gl.FRAGMENT_SHADER, galaxyFragmentShader]] as const) {
      const shader = gl.createShader(type)!;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Program failed");
  } catch (error) {
    console.warn("Galaxy canvas unavailable", error);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    onAvailability(false);
    return {
      setPaused() {},
      setExploring() {},
      reset() {},
      dispose() {}
    };
  }
  onAvailability(true);
  canvas.dataset.renderer = "webgl";
  canvas.dataset.particles = String(particles.length / PARTICLE_STRIDE);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
  ["aPosition", "aColor", "aStyle"].forEach((name, i) => {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, PARTICLE_STRIDE * 4, i * 12);
  });
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const locations = Object.fromEntries(["uPointer", "uCenter", "uAspect", "uZoom", "uTime", "uDpr", "uTurn", "uFade"].map(name => [name, uniform(name)]));
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motion.matches,
    paused = false,
    exploring = false,
    disposed = false,
    contextLost = false;
  let inView = true;
  let frame = 0,
    clock = 0,
    lastTime = 0,
    turn = 0,
    targetTurn = 0,
    zoom = 1,
    centerX = compact ? 0.02 : 0.48;
  let pointerX = 0,
    pointerY = 0,
    targetX = 0,
    targetY = 0,
    dragX: number | null = null;
  let width = 0,
    height = 0,
    dpr = 1;
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.4 : 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    inView = window.scrollY < height * 1.6;
    requestDraw();
  }
  function draw(time: number) {
    frame = 0;
    if (disposed || contextLost || document.hidden) return;
    const delta = Math.min((time - (lastTime || time)) / 1000, 0.05);
    lastTime = time;
    if (!paused && !reduced) clock += delta;
    const ease = reduced || paused ? 1 : 0.065;
    pointerX += ((reduced ? 0 : targetX) - pointerX) * ease;
    pointerY += ((reduced ? 0 : targetY) - pointerY) * ease;
    turn += (targetTurn - turn) * ease;
    const progress = Math.min(window.scrollY / height, 1.6);
    zoom += ((exploring ? 1.17 : 1 + progress * 0.18) - zoom) * ease;
    centerX += ((exploring ? 0 : width < 760 ? 0.04 : 0.48 - progress * 0.14) - centerX) * ease;
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.uniform2f(locations.uPointer, pointerX, pointerY);
    gl!.uniform2f(locations.uCenter, centerX, width < 760 ? 0.35 : 0.10 + progress * 0.18);
    gl!.uniform1f(locations.uAspect, width / height);
    gl!.uniform1f(locations.uZoom, zoom);
    gl!.uniform1f(locations.uTime, clock);
    gl!.uniform1f(locations.uDpr, dpr);
    gl!.uniform1f(locations.uTurn, turn);
    gl!.uniform1f(locations.uFade, Math.max(0.13, 1 - progress * 0.75));
    gl!.drawArrays(gl!.POINTS, 0, particles.length / PARTICLE_STRIDE);
    canvas.dataset.rendered = "true";
    canvas.dataset.paused = String(paused || reduced);
    if (!paused && !reduced && inView) requestDraw();
  }
  function requestDraw() {
    if (!frame && !disposed && !contextLost && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function scroll() {
    const next = window.scrollY < height * 1.6;
    if (next || inView) requestDraw();
    inView = next;
  }
  function pointer(event: PointerEvent) {
    if (reduced && !exploring || window.scrollY > height) return;
    targetX = event.clientX / width * 2 - 1;
    targetY = -(event.clientY / height * 2 - 1);
    if (dragX !== null) {
      targetTurn += (event.clientX - dragX) * 0.006;
      dragX = event.clientX;
    }
    requestDraw();
  }
  function down(event: PointerEvent) {
    if (exploring && !(event.target as Element).closest("a,button")) dragX = event.clientX;
  }
  const up = () => {
    dragX = null;
  };
  function key(event: KeyboardEvent) {
    if (!exploring || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    targetTurn += event.key === "ArrowLeft" ? -0.25 : 0.25;
    requestDraw();
  }
  function visibility() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (!document.hidden) requestDraw();
  }
  function preference() {
    reduced = motion.matches;
    requestDraw();
  }
  // A lost decorative context must never reload the page or reset the user's demo.
  const loss = () => {
    contextLost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    canvas.dataset.rendered = "false";
    onAvailability(false);
  };
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", scroll, {
    passive: true
  });
  window.addEventListener("pointermove", pointer, {
    passive: true
  });
  window.addEventListener("pointerdown", down, {
    passive: true
  });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", preference);
  canvas.addEventListener("webglcontextlost", loss);
  resize();
  return {
    setPaused(value) {
      paused = value;
      requestDraw();
    },
    setExploring(value) {
      exploring = value;
      targetTurn = 0;
      requestDraw();
    },
    reset() {
      targetX = targetY = targetTurn = 0;
      requestDraw();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", preference);
      canvas.removeEventListener("webglcontextlost", loss);
      gl!.deleteBuffer(buffer);
      gl!.deleteProgram(program);
      shaders.forEach(shader => gl!.deleteShader(shader));
    }
  };
}
function staticFallback(canvas: HTMLCanvasElement, particles: Float32Array, palette: GalaxyPalette): GalaxyController {
  const ctx = canvas.getContext("2d");
  canvas.dataset.renderer = "static";
  function render() {
    if (!ctx) return;
    const width = canvas.width = window.innerWidth,
      height = canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += PARTICLE_STRIDE * 3) {
      const x = particles[i],
        y = particles[i + 1],
        kind = particles[i + 8];
      if (kind > 0.5 && kind < 2.5) continue;
      const px = kind > 2.5 ? (x + 1) * width / 2 : width * 0.73 + (x * 0.91 + y * 0.24) * height * 0.14;
      const py = kind > 2.5 ? (y + 1) * height / 2 : height * 0.43 + (-x * 0.40 + y * 0.55) * height * 0.14;
      ctx.fillStyle = `rgba(${palette.cream.map(c => Math.round(c * 255)).join(",")},${particles[i + 7]})`;
      ctx.fillRect(px, py, Math.max(0.7, particles[i + 6]), Math.max(0.7, particles[i + 6]));
    }
    canvas.dataset.rendered = "true";
  }
  render();
  window.addEventListener("resize", render);
  return {
    setPaused() {},
    setExploring() {},
    reset() {},
    dispose() {
      window.removeEventListener("resize", render);
    }
  };
}
