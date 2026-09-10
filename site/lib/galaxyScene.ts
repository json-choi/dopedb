// One photographic texture plus sparse foreground stars; no particle cloud or postprocessing buffers.
const vertex = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() { vUv=aPosition*0.5+0.5; gl_Position=vec4(aPosition,0.0,1.0); }
`;
const fragment = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uCover;
uniform vec2 uCenter;
uniform vec2 uPointer;
uniform vec3 uStarlight;
uniform float uZoom;
uniform float uTime;
uniform float uFade;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float stars(vec2 p, float scale) {
  vec2 grid=p*scale, cell=floor(grid), local=fract(grid);
  float seed=hash(cell);
  vec2 location=vec2(0.15)+vec2(hash(cell+17.0),hash(cell+43.0))*0.7;
  float distance=length((local-location)*uResolution.y/scale);
  float light=exp(-distance*distance*1.5)+exp(-distance*distance*0.10)*0.045;
  return light*step(0.987,seed)*(0.5+0.5*hash(cell+71.0))*(0.94+0.06*sin(uTime*0.7+seed*90.0));
}
void main() {
  vec2 screen=vec2(vUv.x,1.0-vUv.y);
  float breathe=1.0+sin(uTime*0.045)*0.003;
  vec2 uv=(screen-0.5)*uCover/(uZoom*breathe)+uCenter;
  // Very small image-space depth cue; dust filaments must not turn into liquid distortion.
  vec3 sampleColor=texture2D(uImage,uv).rgb;
  float depth=dot(sampleColor,vec3(0.2126,0.7152,0.0722));
  uv+=uPointer*uCover*(0.006+depth*0.004);
  vec3 color=texture2D(uImage,clamp(uv,0.001,0.999)).rgb;
  vec2 sky=(screen-0.5)*vec2(uResolution.x/uResolution.y,1.0);
  float foreground=stars(sky+uPointer*0.026,43.0)+stars(sky+uPointer*0.013,71.0)*0.5;
  color+=uStarlight*foreground*0.35;
  gl_FragColor=vec4(color*uFade,1.0);
}
`;
export type GalaxyFrame = {
  width: number; height: number; centerX: number; centerY: number;
  pointerX: number; pointerY: number; zoom: number; time: number; fade: number;
};
export function createGalaxyScene(gl: WebGLRenderingContext, image: HTMLImageElement) {
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram(), buffer = gl.createBuffer(), texture = gl.createTexture();
  const dispose = () => {
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
  };
  try {
    if (!program || !buffer || !texture) throw new Error("Galaxy GPU allocation unavailable");
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Galaxy shader allocation unavailable");
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Galaxy shader failed");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Galaxy program failed");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const names = ["uResolution", "uCover", "uCenter", "uPointer", "uZoom", "uTime", "uFade"];
    const locations = Object.fromEntries(names.map(name => [name, uniform(name)]));
    gl.uniform1i(uniform("uImage"), 0);
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--galaxy-starlight").trim().replace("#", "");
    gl.uniform3fv(uniform("uStarlight"), [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255));
    const imageAspect = image.naturalWidth / image.naturalHeight;
    return {
      dispose,
      draw(f: GalaxyFrame) {
        const aspect = f.width / f.height;
        const coverX = Math.min(1, aspect / imageAspect), coverY = Math.min(1, imageAspect / aspect);
        const marginX = coverX / f.zoom * 0.5 + 0.013, marginY = coverY / f.zoom * 0.5 + 0.013;
        const clampCenter = (value: number, margin: number) => Math.max(margin, Math.min(1 - margin, value));
        gl.uniform2f(locations.uResolution, f.width, f.height);
        gl.uniform2f(locations.uCover, coverX, coverY);
        gl.uniform2f(locations.uCenter, clampCenter(f.centerX, marginX), clampCenter(f.centerY, marginY));
        gl.uniform2f(locations.uPointer, f.pointerX, f.pointerY);
        gl.uniform1f(locations.uZoom, f.zoom); gl.uniform1f(locations.uTime, f.time); gl.uniform1f(locations.uFade, f.fade);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  } catch (error) { dispose(); throw error; }
}
