// GPU allocation and palette conversion stay outside the animation hot path.
import type { CosmicSceneRecipe } from "./domain";
import { cosmicFragmentShader, cosmicVertexShader } from "./shaders";

export function createCosmicResources(canvas: HTMLCanvasElement, recipe: CosmicSceneRecipe) {
  const gl = canvas.getContext("webgl2", {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: "low-power", preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const shaders: WebGLShader[] = [];
  const dispose = () => {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
  };
  if (!program || !buffer) { dispose(); return null; }
  try {
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, cosmicVertexShader],
      [gl.FRAGMENT_SHADER, cosmicFragmentShader],
    ] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("Scene shader unavailable");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? "Scene shader compilation failed");
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Scene shader link failed");
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform4fv(uniform("uSeeds"), recipe.seeds.map(seed => seed / 4_294_967_295));
    gl.uniform1f(uniform("uSpin"), recipe.spin);
    gl.uniform1f(uniform("uTilt"), recipe.tilt);
    gl.uniform1f(uniform("uHorizon"), recipe.horizon);
    const styles = getComputedStyle(document.documentElement);
    for (const [name, role] of [
      ["uNight", "--ds-cosmic-night"], ["uNightRaised", "--ds-cosmic-night-raised"],
      ["uCream", "--ds-cosmic-cream"], ["uWarm", "--ds-cosmic-warm"],
      ["uElectric", "--ds-cosmic-electric"],
    ]) {
      const hex = styles.getPropertyValue(role).trim();
      if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid scene palette token");
      gl.uniform3f(uniform(name), ...([1, 3, 5].map(i =>
        parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]));
    }
    return {
      gl, dispose,
      resolution: uniform("uResolution"), time: uniform("uTime"),
      pointer: uniform("uPointer"), orbit: uniform("uOrbit"), zoom: uniform("uZoom"),
    };
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Cosmic backdrop unavailable", error);
    dispose();
    return null;
  }
}
