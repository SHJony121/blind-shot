import * as THREE from 'three';
import type { ArenaDef, ArenaTheme, Obstacle } from '@blindshot/shared';
import { inkedMesh, toon, toonGradient } from '../characters/materials';
import { canvasTexture } from '../characters/textures';
import {
  chamberWallTexture,
  cleanWallTexture,
  coolingWallTexture,
  crateTexture,
  emblemTexture,
  factoryWallTexture,
  floorTexture,
  hazardStripeTexture,
  tankTexture,
  windowTexture,
} from './arenaTextures';

export type LightMood = 'menu' | 'normal' | 'blind' | 'alert';

interface MoodLevels {
  key: number;
  fill: number;
  hemi: number;
  practical: number;
  emergency: number;
  exposure: number;
}

const BRIGHT_MOODS: Record<LightMood, MoodLevels> = {
  menu: { key: 2.4, fill: 1.0, hemi: 1.6, practical: 0, emergency: 0, exposure: 1.0 },
  normal: { key: 2.6, fill: 1.0, hemi: 1.7, practical: 0, emergency: 0, exposure: 1.0 },
  blind: { key: 0.6, fill: 0.3, hemi: 0.45, practical: 0, emergency: 50, exposure: 0.95 },
  alert: { key: 0.7, fill: 0.35, hemi: 0.5, practical: 0, emergency: 80, exposure: 1.0 },
};

const MOODS: Record<LightMood, MoodLevels> = {
  menu: { key: 2.0, fill: 0.7, hemi: 0.8, practical: 60, emergency: 0, exposure: 1.0 },
  normal: { key: 2.5, fill: 0.8, hemi: 0.85, practical: 70, emergency: 0, exposure: 1.05 },
  blind: { key: 0.35, fill: 0.25, hemi: 0.3, practical: 8, emergency: 70, exposure: 0.95 },
  alert: { key: 0.45, fill: 0.3, hemi: 0.35, practical: 10, emergency: 110, exposure: 1.0 },
};

interface ThemeStyle {
  /** Bright open-sky look (no industrial props, light lighting). */
  bright: boolean;
  label: string;
  wall: (label: string, repeat: number) => THREE.Texture;
  pillar: string;
  block: 'metal' | 'crate' | 'machine';
  emblem: string | null;
  windows: boolean;
  trim: string;
}

const THEMES: Record<ArenaTheme, ThemeStyle> = {
  clean: { bright: true, label: '00', wall: cleanWallTexture, pillar: '#f2f4f6', block: 'metal', emblem: null, windows: false, trim: '#d5dbe1' },
  chamber: { bright: false, label: '01', wall: chamberWallTexture, pillar: '#4b555e', block: 'metal', emblem: '#e3b23c', windows: true, trim: '#d6a531' },
  factory: { bright: false, label: '02', wall: factoryWallTexture, pillar: '#d6a531', block: 'crate', emblem: '#e3b23c', windows: false, trim: '#2b2f33' },
  cooling: { bright: false, label: '03', wall: coolingWallTexture, pillar: '#dfe6ea', block: 'machine', emblem: null, windows: true, trim: '#2f6f8f' },
};

/**
 * Visual build of any arena (Test Chamber 01, Factory Floor, Cooling Room): floor, walls,
 * obstacles, wall displays, lights and the lighting "moods" used by the round phases.
 * Gameplay geometry comes from the shared ArenaDef, so what you see is what blocks bullets.
 */
export class ArenaView {
  readonly group = new THREE.Group();
  readonly ventPositions: THREE.Vector3[] = [];
  /** Floor + boundary: animated when the arena shrinks between volleys. */
  private readonly edge = new THREE.Group();
  private edgeFrom = { x: 1, z: 1 };
  private edgeT = 1;

  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly practicals: THREE.PointLight[] = [];
  private readonly emergency: THREE.PointLight[] = [];
  private readonly lampMaterial = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
  private readonly emergencyMaterial = new THREE.MeshBasicMaterial({ color: '#4a1410' });
  private readonly displays: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private readonly style: ThemeStyle;
  private readonly lampBase = new THREE.Color('#ffe2b0');

  private mood: LightMood = 'menu';
  private levels: MoodLevels = { ...MOODS.menu };
  private flickerT = 0;
  private flashT = 0;
  private pulseT = 0;
  private idleFlickerIn = 4;
  private time = 0;

  constructor(
    readonly arena: ArenaDef,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.group.name = arena.name;
    this.style = THEMES[arena.theme];
    const { halfX: hx, halfZ: hz } = arena;

    // --- Lights (same count on every map so shaders never recompile) ---------
    this.hemi = this.style.bright
      ? new THREE.HemisphereLight('#dff1ff', '#b9c2c9', 1.6)
      : new THREE.HemisphereLight('#a9bfd6', '#1d1712', 0.8);
    this.key = new THREE.DirectionalLight('#fff0d8', 2.5);
    this.key.position.set(6, 26, -8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    const ext = Math.max(hx, hz) + 2;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 4;
    sc.far = 60;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.04;
    this.fill = new THREE.DirectionalLight('#86a9d8', 0.8);
    this.fill.position.set(-10, 9, 14);
    this.group.add(this.hemi, this.key, this.key.target, this.fill);

    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    for (const [sx, sz] of corners) {
      const warm = new THREE.PointLight('#ffcf8a', 70, 45, 1.5);
      warm.position.set(sx * (hx - 2), 8, sz * (hz - 2));
      this.practicals.push(warm);
      this.group.add(warm);
    }
    for (const [x, z] of [
      [hx * 0.45, hz - 1],
      [-hx * 0.45, hz - 1],
      [-hx + 1, 0],
      [hx - 1, 0],
    ] as const) {
      const red = new THREE.PointLight('#ff3a2a', 0, 34, 1.5);
      red.position.set(x, 2.6, z);
      this.emergency.push(red);
      this.group.add(red);
    }

    this.group.add(this.edge);
    this.buildFloor();
    this.buildWalls();
    for (const ob of arena.obstacles) this.buildObstacle(ob);
  }

  /** Sky / fog for this map (bright maps get an open sky). */
  applyEnvironment(scene: THREE.Scene): void {
    const sky = this.style.bright ? '#bfe0f5' : '#0d1114';
    scene.background = new THREE.Color(sky);
    scene.fog = this.style.bright ? new THREE.Fog(sky, 60, 140) : new THREE.Fog(sky, 30, 70);
  }

  // --- Lighting control ------------------------------------------------------

  setMood(mood: LightMood): void {
    this.mood = mood;
  }

  /** Bright (daylight) map: lasers switch to solid colours so they read on white. */
  get bright(): boolean {
    return this.style.bright;
  }

  /** Slide the floor edge / walls in from the previous (bigger) size. */
  animateFrom(oldHalfX: number, oldHalfZ: number): void {
    this.edgeFrom = { x: oldHalfX / this.arena.halfX, z: oldHalfZ / this.arena.halfZ };
    this.edgeT = 0;
    this.edge.scale.set(this.edgeFrom.x, 1, this.edgeFrom.z);
  }

  get currentMood(): LightMood {
    return this.mood;
  }

  /** Stuttering power-cut flicker (used when targets are hidden). */
  flicker(duration = 0.5): void {
    this.flickerT = duration;
  }

  /** Brief bright flash (gunshots). `strength` 0..1. */
  flash(strength = 1): void {
    this.flashT = Math.max(this.flashT, strength);
  }

  /** Red emergency pulse (countdown ticks). */
  pulse(): void {
    this.pulseT = 1;
  }

  setDisplay(line1: string, line2 = '', color = '#e3b23c'): void {
    for (const d of this.displays) {
      const g = d.canvas.getContext('2d');
      if (!g) continue;
      g.fillStyle = '#0c1214';
      g.fillRect(0, 0, d.canvas.width, d.canvas.height);
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.strokeRect(10, 10, d.canvas.width - 20, d.canvas.height - 20);
      g.fillStyle = color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '100px Anton, Impact, sans-serif';
      g.fillText(line1, d.canvas.width / 2, line2 ? 110 : 130, d.canvas.width - 40);
      if (line2) {
        g.font = '700 46px "Barlow Condensed", sans-serif';
        g.fillStyle = '#c9d3d6';
        g.fillText(line2, d.canvas.width / 2, 200, d.canvas.width - 40);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < d.canvas.height; y += 6) g.fillRect(0, y, d.canvas.width, 2);
      d.tex.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.edgeT < 1) {
      this.edgeT = Math.min(1, this.edgeT + dt / 1.4);
      const e = 1 - (1 - this.edgeT) ** 3;
      this.edge.scale.set(this.edgeFrom.x + (1 - this.edgeFrom.x) * e, 1, this.edgeFrom.z + (1 - this.edgeFrom.z) * e);
    }
    const target = (this.style.bright ? BRIGHT_MOODS : MOODS)[this.mood];
    const k = Math.min(1, dt * 5);
    for (const key of Object.keys(this.levels) as (keyof MoodLevels)[]) {
      this.levels[key] += (target[key] - this.levels[key]) * k;
    }

    // Occasional idle flicker of one practical keeps the room alive.
    this.idleFlickerIn -= dt;
    let idleDip = 1;
    if (this.idleFlickerIn < 0) {
      idleDip = Math.random() > 0.5 ? 0.2 : 1;
      if (this.idleFlickerIn < -0.25) this.idleFlickerIn = 3 + Math.random() * 6;
    }
    let flick = 1;
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      flick = Math.random() > 0.45 ? 0.08 : 1.4;
    }
    this.flashT = Math.max(0, this.flashT - dt * 5);
    this.pulseT = Math.max(0, this.pulseT - dt * 2.2);

    const L = this.levels;
    const flash = this.flashT * 3;
    this.key.intensity = L.key * flick + flash * 2;
    this.fill.intensity = L.fill * flick + flash;
    this.hemi.intensity = L.hemi * flick + flash * 0.6;
    this.practicals.forEach((p, i) => {
      p.intensity = L.practical * flick * (i === 0 ? idleDip : 1);
    });
    const emergency = L.emergency * (0.55 + 0.45 * Math.sin(this.time * 6)) + this.pulseT * 130;
    for (const e of this.emergency) e.intensity = emergency;
    this.lampMaterial.color.copy(this.lampBase).multiplyScalar(Math.min(1, (L.practical / 70) * flick));
    const er = Math.min(1, emergency / 120);
    this.emergencyMaterial.color.setRGB(0.29 + er * 0.71, 0.08 + er * 0.1, 0.06);
    this.renderer.toneMappingExposure = L.exposure;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m.name !== 'shared-outline') m.dispose();
    });
    for (const d of this.displays) d.tex.dispose();
  }

  // --- Construction ----------------------------------------------------------

  private buildFloor(): void {
    const { halfX: hx, halfZ: hz, theme } = this.arena;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(hx * 2, hz * 2),
      new THREE.MeshStandardMaterial({ map: floorTexture(theme, hx / 2, hz / 2), roughness: 0.75, metalness: theme === 'chamber' ? 0.35 : 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.edge.add(floor);

    // Hazard border along every wall. Bright maps have no walls: a bold boundary line marks the edge.
    const band = this.style.bright ? 0.35 : 0.9;
    for (const [w, d, x, z] of [
      [hx * 2, band, 0, -hz + band / 2],
      [hx * 2, band, 0, hz - band / 2],
      [band, hz * 2 - band * 2, -hx + band / 2, 0],
      [band, hz * 2 - band * 2, hx - band / 2, 0],
    ] as const) {
      const long = w > d;
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(long ? w : d, long ? d : w),
        this.style.bright
          ? new THREE.MeshBasicMaterial({ color: '#ff6b3d' })
          : new THREE.MeshStandardMaterial({ map: hazardStripeTexture(Math.max(w, d) / 1.6), roughness: 0.7 }),
      );
      strip.rotation.x = -Math.PI / 2;
      if (!long) strip.rotation.z = Math.PI / 2;
      strip.position.set(x, 0.01, z);
      strip.receiveShadow = true;
      this.edge.add(strip);
    }

    if (this.style.emblem) {
      const emblem = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 7),
        new THREE.MeshBasicMaterial({ map: emblemTexture(this.style.label, this.style.emblem), transparent: true, depthWrite: false }),
      );
      emblem.rotation.x = -Math.PI / 2;
      emblem.rotation.z = Math.PI;
      emblem.position.y = 0.015;
      this.group.add(emblem);
    }

    // Dark void around the room (visible through the open near side).
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      this.style.bright
        ? // Out of bounds: the same checker, greyed out, so the shrinking edge is easy to see.
          new THREE.MeshStandardMaterial({ map: floorTexture('clean', 100, 100), color: '#aab4bd', roughness: 1 })
        : new THREE.MeshBasicMaterial({ color: '#07090b' }),
    );
    outside.receiveShadow = this.style.bright;
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.05;
    this.group.add(outside);
  }

  private buildWalls(): void {
    const { halfX: hx, halfZ: hz, wallHeight: h } = this.arena;
    // Single-sided planes facing inward: the wall nearest the camera disappears from behind,
    // so it never blocks the view of the floor.
    const walls = [
      { w: hx * 2, x: 0, z: -hz, rot: 0 },
      { w: hx * 2, x: 0, z: hz, rot: Math.PI },
      { w: hz * 2, x: -hx, z: 0, rot: Math.PI / 2 },
      { w: hz * 2, x: hx, z: 0, rot: -Math.PI / 2 },
    ];
    for (const wall of walls) {
      // Bright maps are open: no raised walls at all, just the boundary line on the floor.
      if (this.style.bright) continue;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(wall.w, h),
        new THREE.MeshStandardMaterial({ map: this.style.wall(this.style.label, wall.w / 12), roughness: 0.85, metalness: 0.15 }),
      );
      mesh.position.set(wall.x, h / 2, wall.z);
      mesh.rotation.y = wall.rot;
      mesh.receiveShadow = true;
      this.edge.add(mesh);
      // Nothing is mounted on the camera-side wall: it would sit between the camera and the floor.
      if (wall.z < 0 && wall.x === 0) continue;

      // Lamp strip along the top of each wall.
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(wall.w * 0.8, 0.25, 0.25), this.lampMaterial);
      lamp.position.set(wall.x, h - 0.6, wall.z);
      lamp.rotation.y = wall.rot;
      lamp.translateZ(0.3);
      this.edge.add(lamp);

      // Pipes running along the wall.
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, wall.w, 12), toon('#59646d'));
      pipe.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(pipe);
      holder.position.set(wall.x, h - 1.5, wall.z);
      holder.rotation.y = wall.rot;
      holder.translateZ(0.45);
      this.edge.add(holder);
    }

    if (this.style.bright) {
      this.buildBrightDecor();
      return;
    }
    // Wall displays (mirror the round phase): centre of the far wall and both side walls.
    const displaySpots = [
      { x: 0, z: hz - 0.15, rot: Math.PI, y: h * 0.62 },
      { x: -hx + 0.15, z: hz * 0.35, rot: Math.PI / 2, y: h * 0.62 },
      { x: hx - 0.15, z: hz * 0.35, rot: -Math.PI / 2, y: h * 0.62 },
    ];
    for (const spot of displaySpots) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.displays.push({ canvas, tex });
      const frame = new THREE.Group();
      frame.position.set(spot.x, spot.y, spot.z);
      frame.rotation.y = spot.rot;
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.3, 0.3), toon('#101418'));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 2.9), new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.z = 0.17;
      frame.add(bezel, screen);
      this.group.add(frame);
    }
    this.setDisplay(this.arena.name, 'SUBJECTS STAND BY');

    // Observation windows with silhouetted observers.
    if (this.style.windows) {
      let variant = 0;
      for (const side of [1]) {
        for (const t of [-0.55, 0.55]) {
          const frame = new THREE.Group();
          frame.position.set(t * hx, h * 0.62, side * (hz - 0.12));
          frame.rotation.y = side > 0 ? Math.PI : 0;
          const box = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.1, 0.25), toon('#14191d'));
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.8), new THREE.MeshBasicMaterial({ map: windowTexture(variant++) }));
          glass.position.z = 0.14;
          frame.add(box, glass);
          this.group.add(frame);
        }
      }
    }

    // Emergency beacons next to the red lights, and steam vents along the walls.
    for (const red of this.emergency) {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), this.emergencyMaterial);
      beacon.position.copy(red.position);
      this.group.add(beacon);
    }
    for (const [x, z] of [
      [-hx + 0.8, -hz * 0.5],
      [hx - 0.8, hz * 0.5],
      [hx * 0.2, hz - 0.8],
      [-hx * 0.5, hz - 0.8],
    ] as const) {
      this.ventPositions.push(new THREE.Vector3(x, 0.1, z));
      const grate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), toon('#1b2025'));
      grate.position.set(x, 0.04, z);
      this.group.add(grate);
    }

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.1),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(`label-${this.arena.id}`, 640, 120, (g) => {
          g.fillStyle = '#e3b23c';
          g.font = '80px Anton, Impact, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(this.arena.name, 320, 62);
        }),
        transparent: true,
      }),
    );
    label.position.set(0, h * 0.3, hz - 0.14);
    label.rotation.y = Math.PI;
    this.group.add(label);
  }

  /** Open-sky decor for bright maps: a big scoreboard sign and distant clouds. */
  private buildBrightDecor(): void {
    const { halfZ: hz } = this.arena;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.displays.push({ canvas, tex });
    const sign = new THREE.Group();
    sign.position.set(0, 7, hz + 3);
    sign.rotation.y = Math.PI;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(9.4, 4.9, 0.4), toon('#20262b'));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: tex }));
    screen.position.z = 0.21;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 10), toon('#c9d1d8'));
    post.position.y = -4.5;
    sign.add(bezel, screen, post);
    this.group.add(sign);
    this.setDisplay(this.arena.name, 'SUBJECTS STAND BY');
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const cloud = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 2, 12, 8), cloudMat);
        puff.position.set(k * 3.5, Math.random() * 1.5, Math.random() * 2);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set(Math.sin(a) * 85, 14 + Math.random() * 10, Math.cos(a) * 85);
      cloud.lookAt(0, cloud.position.y, 0);
      this.group.add(cloud);
    }
  }

  private buildObstacle(ob: Obstacle): void {
    const g = new THREE.Group();
    g.position.set(ob.pos.x, 0, ob.pos.z);
    if (ob.kind === 'circle') {
      const tank = this.arena.theme === 'cooling';
      const mat = tank
        ? new THREE.MeshToonMaterial({ map: tankTexture(), gradientMap: toonGradient() })
        : toon(this.style.pillar);
      const col = inkedMesh(new THREE.CylinderGeometry(ob.radius, ob.radius * 1.04, ob.height, 28), mat, 0.03);
      col.position.y = ob.height / 2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(ob.radius * 1.2, ob.radius * 1.28, 0.16, 28), toon('#2b3036'));
      base.position.y = 0.08;
      base.receiveShadow = true;
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(ob.radius * (tank ? 0.95 : 0.7), ob.radius * 0.8, tank ? 0.3 : 0.12, 24),
        tank ? toon('#9fb2bc') : this.style.bright ? toon('#ffffff') : this.lampMaterial,
      );
      cap.position.y = ob.height + (tank ? 0.15 : 0.06);
      if (!tank && !this.style.bright) {
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(ob.radius + 0.01, ob.radius + 0.01, 0.4, 24, 1, true),
          new THREE.MeshStandardMaterial({ map: hazardStripeTexture(3), roughness: 0.6 }),
        );
        stripe.position.y = 0.5;
        g.add(stripe);
      }
      g.add(col, base, cap);
    } else {
      const geo = new THREE.BoxGeometry(ob.halfX * 2, ob.height, ob.halfZ * 2);
      let mat: THREE.Material;
      if (this.style.block === 'crate') mat = new THREE.MeshToonMaterial({ map: crateTexture(), gradientMap: toonGradient() });
      else if (this.style.block === 'machine') mat = toon('#3f7f9f');
      else mat = toon(this.style.bright ? '#ffffff' : '#55606a');
      const block = inkedMesh(geo, mat, 0.03);
      block.position.y = ob.height / 2;
      g.add(block);
      if (this.style.block !== 'crate' && !this.style.bright) {
        const top = new THREE.Mesh(
          new THREE.PlaneGeometry(ob.halfX * 2, ob.halfZ * 2),
          new THREE.MeshStandardMaterial({ map: hazardStripeTexture(Math.max(ob.halfX, ob.halfZ)), roughness: 0.6 }),
        );
        top.rotation.x = -Math.PI / 2;
        top.position.y = ob.height + 0.01;
        g.add(top);
      }
    }
    this.group.add(g);
  }
}
