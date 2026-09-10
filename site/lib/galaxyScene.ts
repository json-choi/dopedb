// Owns the bounded GPU scene and semantic palette; buffers are generated once, never per frame.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh,
  PlaneGeometry, Points, ShaderMaterial, Vector3,
} from "three";
import { cloudFragment, cloudVertex, starFragment, starVertex } from "./galaxyShaders";

export function createGalaxyScene(style: CSSStyleDeclaration, compact: boolean) {
  const color = (role: string) => new Color(style.getPropertyValue(role).trim());
  const warm = color("--galaxy-starlight"), cool = color("--galaxy-cool");
  const night = color("--landing-night");
  const group = new Group();
  // The disk's normal is tilted like a globe axis; only its child spins around that normal.
  group.rotation.set(1.08, 0, 0.44, "ZXY");
  const disk = new Group();
  group.add(disk);
  const axis = new Vector3(0, 0, 1).applyQuaternion(group.quaternion);
  const cloudMaterial = new ShaderMaterial({
    vertexShader: cloudVertex, fragmentShader: cloudFragment, transparent: true,
    depthWrite: false, uniforms: { uWarm: { value: color("--galaxy-cloud") }, uCool: { value: cool }, uTime: { value: 0 }, uJourney: { value: 0 } },
  });
  const cloudGeometry = new PlaneGeometry(120, 120);
  const clouds = new Mesh(cloudGeometry, cloudMaterial);
  clouds.position.z = -2;
  disk.add(clouds);
  const starMaterial = new ShaderMaterial({
    vertexShader: starVertex, fragmentShader: starFragment,
    vertexColors: true, transparent: true, depthWrite: false,
    blending: AdditiveBlending, uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
  });
  let seed = 1937;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 0.0001))) * Math.cos(random() * Math.PI * 2);
  function stars(count: number, foreground: boolean) {
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count), lights = new Float32Array(count);
    const tint = new Color();
    for (let i = 0; i < count; i++) {
      const radius = Math.pow(random(), 0.65) * 48;
      const angle = i % 5 === 0 ? random() * Math.PI * 2 : (i % 2) * Math.PI + Math.log(radius + 2) * 2.4 + normal() * 0.34;
      const x = foreground ? (random() - 0.5) * 150 : Math.cos(angle) * radius;
      const y = foreground ? (random() - 0.5) * 90 : Math.sin(angle) * radius;
      positions.set([x, y, foreground ? -65 + random() * 65 : normal() * 0.65], i * 3);
      tint.copy(warm).lerp(cool, random() * 0.7).toArray(colors, i * 3);
      sizes[i] = foreground ? 0.8 + random() ** 7 * 3 : 0.6 + random() ** 6 * 2.8;
      lights[i] = (0.2 + random() * 0.7) * (foreground ? 0.7 : Math.exp(-radius / 55));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    geometry.setAttribute("aLight", new BufferAttribute(lights, 1));
    geometry.setAttribute("aGalaxy", new BufferAttribute(new Float32Array(count).fill(foreground ? 0 : 1), 1));
    return new Points(geometry, starMaterial);
  }
  const distant = stars(compact ? 10000 : 22000, false), field = stars(compact ? 600 : 1200, true);
  disk.add(distant);
  return {
    group, disk, axis, field, night, cloudMaterial, starMaterial,
    dispose() {
      cloudGeometry.dispose(); cloudMaterial.dispose(); starMaterial.dispose();
      distant.geometry.dispose(); field.geometry.dispose();
    },
  };
}
