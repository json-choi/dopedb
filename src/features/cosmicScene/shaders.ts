// One full-screen pass traces curved rays through a rotating, textured gas disk.
// This is an artistic weak-field approximation, not a scientific Kerr solver.
export const cosmicVertexShader = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const cosmicFragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec4 uSeeds;
uniform vec2 uPointer;
uniform vec2 uOrbit;
uniform float uZoom;
uniform float uTime;
uniform float uSpin;
uniform float uTilt;
uniform float uHorizon;
uniform vec3 uNight;
uniform vec3 uNightRaised;
uniform vec3 uCream;
uniform vec3 uWarm;
uniform vec3 uElectric;

mat2 rotate(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33 + uSeeds.x * 7.0);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
float turbulence(vec2 p) {
  float n = 0.0, weight = 0.5;
  for (int i = 0; i < 5; i++) {
    n += weight * noise(p);
    p = rotate(0.37) * p * 2.07 + 13.4;
    weight *= 0.5;
  }
  return n;
}
vec3 stars(vec2 p, float scale, float cutoff) {
  p *= scale;
  vec2 cell = floor(p);
  float id = hash(cell);
  vec2 center = vec2(hash(cell + 17.1), hash(cell + 31.7));
  vec2 delta = fract(p) - 0.15 - center * 0.7;
  float aa = max(fwidth(p.x), fwidth(p.y));
  float size = mix(0.022, 0.065, pow(id, 24.0));
  float point = 1.0 - smoothstep(size, size + aa, length(delta));
  float glow = exp(-length(delta) * 17.0) * 0.22;
  float flicker = 0.84 + 0.16 * sin(uTime * 1.4 + id * 135.0);
  return mix(uElectric, uCream, hash(cell + 9.0))
    * (point + glow) * step(cutoff, id) * flicker;
}
vec3 space(vec3 ray) {
  vec2 p = ray.xy / max(abs(ray.z), 0.45);
  p *= 1.0 + 0.022 / max(dot(p, p), 0.035);
  p += uSeeds.zw * 20.0;
  float cloud = turbulence(p * 3.5);
  float dust = turbulence(p * 12.0 + cloud * 2.0);
  float band = exp(-pow((p.y - uSeeds.w * 20.0 + sin(p.x * 1.7) * 0.18) * 2.0, 2.0));
  vec3 sky = mix(uNight, uNightRaised, cloud * 0.58);
  sky += uElectric * pow(cloud * dust, 2.0) * band * 0.28;
  return sky + stars(p, 75.0, 0.975) * 0.7 + stars(p + 42.0, 145.0, 0.992) * 0.38;
}
vec4 gas(vec3 position) {
  float r = length(position.xz);
  float envelope = smoothstep(2.25, 2.65, r) * (1.0 - smoothstep(6.4, 9.2, r));
  float phi = atan(position.z, position.x);
  // Differential angular speed shears the same gas into orbiting filaments.
  float phase = phi + uTime * (uSpin * 23.0) / pow(r / 3.0, 1.5);
  vec2 orbital = vec2(cos(phase), sin(phase)) * r;
  float broad = turbulence(orbital * 2.0 + uSeeds.y * 40.0);
  float fine = turbulence(orbital * 7.0 + broad * 3.0);
  float lanes = noise(vec2(r * 14.0 + broad * 6.0, phase * 8.0));
  float density = pow(0.12 + broad * 0.88 + fine * 0.70, 2.4);
  density *= 0.74 + lanes * 0.36;
  float heat = pow(3.1 / max(r, 3.1), 2.6);
  float doppler = 0.88 + position.x / r * 0.22;
  vec3 tint = mix(uWarm, uCream, clamp(heat * 0.9 + density * 0.22, 0.0, 1.0));
  return vec4(tint * density * (1.5 + heat * 11.5) * doppler,
    envelope * clamp(0.74 + density * 0.35, 0.0, 0.99));
}
void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 screen = vUv;
  screen.y -= 0.28;
  screen.x *= aspect;
  screen = rotate(uTilt + 0.32 + uPointer.x * 0.055 + uOrbit.x * 0.10) * screen;
  screen /= uZoom;
  float azimuth = uOrbit.x + uPointer.x * 0.14 + sin(uTime * 0.06) * 0.025;
  float elevation = clamp(0.085 + uOrbit.y + uPointer.y * 0.06, -0.40, 0.48);
  vec3 camera = vec3(sin(azimuth) * cos(elevation), sin(elevation), cos(azimuth) * cos(elevation)) * 13.0;
  vec3 forward = normalize(-camera);
  vec3 right = normalize(cross(forward, vec3(0, 1, 0)));
  vec3 up = cross(right, forward);
  vec3 direction = normalize(forward + (right * screen.x + up * screen.y) * (0.75 * 0.168 / uHorizon));
  vec3 originalRay = direction;
  vec3 position = camera;
  float momentum = dot(cross(position, direction), cross(position, direction));
  vec3 radiance = vec3(0.0);
  float transmission = 1.0;
  float closest = 100.0;
  bool captured = false;
  for (int stepIndex = 0; stepIndex < 120; stepIndex++) {
    float r = length(position);
    closest = min(closest, r);
    if (r < 1.0) { captured = true; break; }
    if (r > 22.0) break;
    float dt = clamp((r - 0.8) * 0.13, 0.035, 1.0);
    vec3 previous = position;
    vec3 acceleration = -1.5 * momentum * position / pow(r, 5.0);
    position += direction * dt + 0.5 * acceleration * dt * dt;
    float nextR = length(position);
    vec3 nextAcceleration = -1.5 * momentum * position / pow(max(nextR, 0.8), 5.0);
    direction += (acceleration + nextAcceleration) * (0.5 * dt);
    if (previous.y * position.y < 0.0) {
      vec3 intersection = mix(previous, position, previous.y / (previous.y - position.y));
      vec4 emission = gas(intersection);
      radiance += transmission * emission.rgb * emission.a;
      transmission *= 1.0 - emission.a;
    }
  }
  vec3 sky = captured ? uNight * 0.28 : space(originalRay);
  radiance += sky * transmission;
  // Optical scatter needs no full-frame bloom textures.
  float impact = sqrt(momentum);
  float halo = exp(-abs(impact - 2.75) * 1.9) * 0.065;
  radiance += uWarm * halo * smoothstep(1.0, 1.6, closest);
  float haze = exp(-dot(screen, screen) * 0.85) * 0.045;
  radiance += uElectric * haze;
  vec3 mapped = 1.0 - exp(-radiance * 0.86);
  mapped = pow(mapped, vec3(0.94));
  float vignette = 1.0 - smoothstep(0.6, 2.0, length(vUv * vec2(aspect * 0.6, 0.8)));
  mapped *= 0.78 + 0.22 * vignette;
  outColor = vec4(mapped, 1.0);
}`;
