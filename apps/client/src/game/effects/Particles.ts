import * as THREE from 'three';
import { softDotTexture } from '../characters/textures';

export interface ParticleSpawn {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.ColorRepresentation;
  size: number;
  /** Size multiplier reached at end of life. */
  grow?: number;
  life: number;
  gravity?: number;
  drag?: number;
  alpha?: number;
}

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  size: number;
  grow: number;
  life: number;
  age: number;
  gravity: number;
  drag: number;
  alpha: number;
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a < 0.003) discard;
    #include <fog_fragment>
  }
`;

/** A single-draw-call pooled particle system (smoke, sparks, debris, steam). */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly pool: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly colors: Float32Array;
  private cursor = 0;

  constructor(
    private readonly capacity: number,
    additive: boolean,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: softDotTexture() },
        uScale: { value: window.innerHeight * 0.9 },
        ...THREE.UniformsLib.fog,
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(),
        size: 0,
        grow: 1,
        life: 1,
        age: 0,
        gravity: 0,
        drag: 0,
        alpha: 1,
      });
    }
  }

  spawn(s: ParticleSpawn): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!p) return;
    p.alive = true;
    p.pos.copy(s.position);
    p.vel.copy(s.velocity);
    p.color.set(s.color);
    p.size = s.size;
    p.grow = s.grow ?? 1;
    p.life = s.life;
    p.age = 0;
    p.gravity = s.gravity ?? 0;
    p.drag = s.drag ?? 0;
    p.alpha = s.alpha ?? 1;
  }

  update(dt: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = window.innerHeight * 0.9;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i]!;
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      if (!p.alive) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const t = p.age / p.life;
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
      this.sizes[i] = p.size * (1 + (p.grow - 1) * t);
      this.alphas[i] = p.alpha * (1 - t) * Math.min(1, t * 12 + 0.2);
      this.colors[i * 3] = p.color.r;
      this.colors[i * 3 + 1] = p.color.g;
      this.colors[i * 3 + 2] = p.color.b;
    }
    const geo = this.points.geometry;
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }
}
