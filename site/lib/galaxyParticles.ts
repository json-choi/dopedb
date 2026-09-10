// Seeded particle geometry gives the interactive scene a repeatable spiral structure.
export type GalaxyPalette = {
  cream: number[];
  signal: number[];
  electric: number[];
};
export const PARTICLE_STRIDE = 9;
export function createParticles(compact: boolean, palette: GalaxyPalette) {
  let seed = 73641;
  const random = () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 0.00001))) * Math.cos(random() * Math.PI * 2);
  const vertices: number[] = [];
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t);
  function point(x: number, y: number, z: number, color: number[], size: number, opacity: number, kind: number) {
    vertices.push(x, y, z, ...color, size, opacity, kind);
  }
  const stars = compact ? 33000 : 76000;
  for (let i = 0; i < stars; i++) {
    const radius = Math.pow(random(), 0.62) * 6.1 + 0.08;
    const arm = Math.floor(random() * 3);
    const angle = arm * Math.PI * 2 / 3 + radius * 1.16 + normal() * (0.11 + radius * 0.024);
    const color = mix(palette.cream, random() < 0.22 ? palette.signal : palette.electric, random() * (radius / 8));
    const bright = random() > 0.997;
    point(Math.cos(angle) * radius, Math.sin(angle) * radius, normal() * (0.05 + radius * 0.023), color, bright ? 3.4 + random() * 2 : 0.65 + random() * 1.2, bright ? 0.95 : 0.2 + random() * 0.44, 0);
  }
  for (let i = 0; i < (compact ? 2800 : 7200); i++) {
    const radius = Math.pow(random(), 1.5) * 1.65;
    const angle = random() * Math.PI * 2;
    point(Math.cos(angle) * radius, Math.sin(angle) * radius, normal() * 0.11, mix(palette.cream, palette.signal, 0.13), 0.8 + random() * 1.25, 0.28 + random() * 0.4, 0);
  }
  for (let i = 0; i < (compact ? 1200 : 3000); i++) {
    const radius = Math.pow(random(), 0.66) * 6;
    const angle = Math.floor(random() * 3) * Math.PI * 2 / 3 + radius * 1.16 + normal() * 0.17;
    point(Math.cos(angle) * radius, Math.sin(angle) * radius, normal() * 0.13, mix(palette.cream, radius < 2.5 ? palette.signal : palette.electric, radius < 2.5 ? 0.55 : 0.35), 18 + random() * 42, 0.015 + random() * 0.018, 1);
  }
  for (let i = 0; i < (compact ? 500 : 1450); i++) {
    const bright = random() > 0.982;
    point(random() * 2.2 - 1.1, random() * 2.2 - 1.1, random(), mix(palette.cream, palette.electric, random() * 0.6), bright ? 2.7 : 0.6 + random(), bright ? 0.75 : 0.12 + random() * 0.36, 3);
  }
  point(0, 0, 0, palette.signal, 460, 0.075, 2);
  point(0, 0, 0, palette.cream, 210, 0.16, 2);
  point(0, 0, 0, palette.cream, 62, 0.6, 2);
  return new Float32Array(vertices);
}
export const galaxyVertexShader = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aColor;
attribute vec3 aStyle;
uniform vec2 uPointer;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uZoom;
uniform float uTime;
uniform float uDpr;
uniform float uTurn;
uniform float uFade;
varying vec3 vColor;
varying float vOpacity;
varying float vKind;
mat2 rotate(float a) { float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
void main() {
  vec3 p = aPosition;
  vColor = aColor;
  vKind = aStyle.z;
  vOpacity = aStyle.y;
  if (aStyle.z > 2.5) {
    gl_Position = vec4(p.xy + uPointer * 0.008 * p.z, 0.9, 1.0);
    gl_PointSize = aStyle.x * uDpr;
    vOpacity *= 0.86 + 0.14 * sin(uTime * 0.4 + p.x * 92.0);
  } else {
    p.xy = rotate(uTime * 0.012 + uTurn) * p.xy;
    p.yz = rotate(0.94 + uPointer.y * 0.10) * p.yz;
    p.xz = rotate(uPointer.x * 0.12) * p.xz;
    p.xy = rotate(-0.41888) * p.xy;
    float depth = 1.0 / (1.0 + p.z * 0.045);
    vec2 projection = p.xy * vec2(0.29 / uAspect, 0.29) * depth * uZoom;
    gl_Position = vec4(projection + uCenter + uPointer * vec2(0.022,0.018), 0.0, 1.0);
    gl_PointSize = min(900.0, aStyle.x * uDpr * depth * pow(uZoom, 0.6));
    vOpacity *= uFade;
  }
}`;
export const galaxyFragmentShader = `
precision mediump float;
varying vec3 vColor;
varying float vOpacity;
varying float vKind;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float radius = length(p);
  if (radius > 0.5) discard;
  float falloff = exp(-radius * radius * (vKind > 0.5 && vKind < 2.5 ? 17.0 : 22.0));
  falloff *= 1.0 - smoothstep(0.30, 0.50, radius);
  gl_FragColor = vec4(vColor, falloff * vOpacity);
}`;
