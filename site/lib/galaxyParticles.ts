// Seeded stellar populations and shared dust extinction form one textured galactic disk.
export type GalaxyPalette = {
  cream: number[];
  warm: number[];
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
  const stars = compact ? 33000 : 66000;
  const bulge = compact ? 3400 : 9000;
  const clouds = compact ? 1500 : 3500;
  const field = compact ? 500 : 1450;
  const vertices = new Float32Array((stars + bulge + clouds + field + 3) * PARTICLE_STRIDE);
  let offset = 0;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t);
  function point(x: number, y: number, z: number, color: number[], size: number, opacity: number, kind: number) {
    vertices.set([x, y, z, ...color, size, opacity, kind], offset);
    offset += PARTICLE_STRIDE;
  }
  const phase = (radius: number) => 3.8 * Math.log(1 + radius * 0.8);
  const extinction = (x: number, y: number, radius: number, angle: number) => {
    const turbulence = Math.sin(x * 3.7 + Math.sin(y * 2.4)) * 0.26 + Math.sin(y * 9.1 + x * 5.2) * 0.07;
    const lane = Math.pow(0.5 + 0.5 * Math.cos((angle - phase(radius) + 0.17 + turbulence) * 4), 14);
    const clouds = 0.65 + 0.35 * Math.sin(x * 4.1 + Math.cos(y * 6.3));
    return Math.exp(-lane * clouds * 4.6 * Math.min(1, radius * 1.3));
  };
  for (let i = 0; i < stars; i++) {
    const radius = Math.pow(random(), 0.8) * 6.1 + 0.04;
    const angle = random() < 0.32 ? random() * Math.PI * 2 : Math.floor(random() * 4) * Math.PI / 2 + phase(radius) + normal() * (0.19 + radius * 0.018);
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    const color = mix(palette.cream, radius < 1.9 ? palette.warm : palette.electric, random() * 0.35);
    const bright = random() > 0.999;
    const fade = Math.pow(Math.max(0, 1 - radius / 6.4), 0.5);
    point(x, y, normal() * (0.035 + radius * 0.017), color, bright ? 2.2 + random() : 0.45 + random() * 0.95, (bright ? 0.85 : 0.12 + random() * 0.32) * extinction(x, y, radius, angle) * fade, 0);
  }
  for (let i = 0; i < bulge; i++) {
    const radius = Math.pow(random(), 1.8) * 1.4;
    const angle = random() * Math.PI * 2;
    point(Math.cos(angle) * radius, Math.sin(angle) * radius, normal() * 0.10, mix(palette.cream, palette.warm, 0.3), 0.6 + random() * 0.9, 0.13 + random() * 0.22, 0);
  }
  for (let i = 0; i < clouds; i++) {
    const radius = Math.pow(random(), 0.9) * 5.8;
    const angle = Math.floor(random() * 4) * Math.PI / 2 + phase(radius) + normal() * 0.23;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    point(x, y, normal() * 0.06, mix(palette.cream, radius < 2.3 ? palette.warm : palette.electric, 0.27), 22 + random() * 58, (0.018 + random() * 0.024) * extinction(x, y, radius, angle) * Math.pow(1 - radius / 6.2, 0.7), 1);
  }
  for (let i = 0; i < field; i++) {
    const bright = random() > 0.982;
    point(random() * 2.2 - 1.1, random() * 2.2 - 1.1, random(), mix(palette.cream, palette.electric, random() * 0.6), bright ? 2.7 : 0.6 + random(), bright ? 0.75 : 0.12 + random() * 0.36, 3);
  }
  point(0, 0, 0, palette.warm, 420, 0.045, 2);
  point(0, 0, 0, palette.warm, 180, 0.14, 2);
  point(0, 0, 0, palette.cream, 65, 0.24, 2);
  return vertices;
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
varying vec2 vCloud;
mat2 rotate(float a) { float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
void main() {
  vec3 p = aPosition;
  vColor = aColor;
  vKind = aStyle.z;
  vOpacity = aStyle.y;
  vCloud = aPosition.xy * 2.7;
  if (aStyle.z > 2.5) {
    gl_Position = vec4(p.xy + uPointer * 0.008 * p.z, 0.9, 1.0);
    gl_PointSize = aStyle.x * uDpr;
    vOpacity *= 0.86 + 0.14 * sin(uTime * 0.4 + p.x * 92.0);
  } else {
    p.xy = rotate(uTime * 0.006 + uTurn) * p.xy;
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
varying vec2 vCloud;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float radius = length(p);
  if (radius > 0.5) discard;
  float falloff = exp(-radius * radius * (vKind > 0.5 && vKind < 2.5 ? 17.0 : 22.0));
  falloff *= 1.0 - smoothstep(0.30, 0.50, radius);
  if (vKind > 0.5 && vKind < 1.5) {
    vec2 cloud = p * 5.0 + vCloud;
    float density = noise(cloud) * 0.57 + noise(cloud * 2.03) * 0.28 + noise(cloud * 4.07) * 0.15;
    falloff *= smoothstep(0.2,0.8,density) * 1.7;
  }
  gl_FragColor = vec4(vColor, falloff * vOpacity);
}`;
