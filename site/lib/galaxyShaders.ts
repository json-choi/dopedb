// Procedural starlight and irregular dust extinction; no photographic textures or postprocessing.
export const cloudVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const cloudFragment = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uTime;
uniform float uJourney;
varying vec2 vUv;
float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float value = 0.0, weight = 0.5;
  for (int i = 0; i < 6; i++) {
    value += noise(p) * weight;
    p = p * 2.07 + vec3(17.1, 9.2, 5.7);
    weight *= 0.5;
  }
  return value;
}
void main() {
  vec2 p = (vUv - 0.5) * 120.0;
  float radius = length(p);
  vec3 q = vec3(p * 0.23, uTime * 0.009);
  float cloud = fbm(q + fbm(q * 0.65) * 2.8);
  float filament = fbm(q * vec3(1.5, 3.2, 1.0) + 23.0);
  float angle = atan(p.y, p.x);
  float spiral = angle * 2.0 - log(radius + 2.0) * 4.8;
  float arms = exp(-pow(sin(spiral + (cloud - 0.5) * 3.8) * 1.6, 2.0));
  float lane = exp(-pow(sin(spiral + 0.5 + filament * 2.0) * 3.5, 2.0));
  float extinction = exp(-lane * (1.0 + filament * 2.0) * smoothstep(1.0, 8.0, radius));
  float band = exp(-radius / 24.0) * (0.26 + arms * 1.3);
  float structure = pow(cloud, 2.5) * 3.2 + pow(filament, 5.0) * 2.0;
  float fine = mix(0.72, 1.25, noise(vec3(p * 65.0, 8.0)));
  float core = mix(1.0, smoothstep(0.6, 3.5, radius), uJourney * 0.5);
  float density = band * structure * extinction * fine * core;
  float ends = 1.0 - smoothstep(36.0, 55.0, radius);
  vec3 light = mix(uWarm, uCool, smoothstep(6.0, 38.0, radius) * 0.48);
  gl_FragColor = vec4(light * (0.6 + filament * 0.55), clamp(density * ends * (1.0 - uJourney * 0.4), 0.0, 0.72));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const starVertex = /* glsl */ `
attribute float aSize;
attribute float aLight;
attribute float aGalaxy;
uniform float uPixelRatio;
uniform float uTime;
varying vec3 vColor;
varying float vLight;
void main() {
  vColor = color;
  vLight = aLight;
  vec3 p = position;
  if (aGalaxy < 0.5) p.z = -70.0 + mod(p.z + 70.0 + uTime * 0.25, 85.0);
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  vLight *= smoothstep(0.5, 4.0, -viewPosition.z);
  gl_PointSize = clamp(aSize * uPixelRatio * 55.0 / -viewPosition.z, 0.7, 7.0);
  gl_Position = projectionMatrix * viewPosition;
}`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vLight;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float light = exp(-r * r * 9.0) + exp(-r * r * 2.0) * 0.12;
  gl_FragColor = vec4(vColor, light * vLight);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
