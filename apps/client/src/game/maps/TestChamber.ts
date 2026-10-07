import * as THREE from 'three';
import { PAD_MOVE_RADIUS, type ArenaDef, type SpawnPad } from '@blindshot/shared';
import { inkedMesh, toon } from '../characters/materials';
import { canvasTexture } from '../characters/textures';
import {
  hazardStripeTexture,
  pitTexture,
  platformTexture,
  wallTexture,
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

const MOODS: Record<LightMood, MoodLevels> = {
  menu: { key: 2.0, fill: 0.7, hemi: 0.75, practical: 40, emergency: 0, exposure: 1.0 },
  normal: { key: 2.4, fill: 0.75, hemi: 0.8, practical: 45, emergency: 0, exposure: 1.05 },
  blind: { key: 0.35, fill: 0.25, hemi: 0.3, practical: 6, emergency: 40, exposure: 0.95 },
  alert: { key: 0.5, fill: 0.3, hemi: 0.35, practical: 8, emergency: 70, exposure: 1.0 },
};

/**
 * TEST CHAMBER 01 — a small elevated circular platform inside an industrial experiment
 * facility. Visual only; gameplay geometry comes from the shared ArenaDef.
 */
export class TestChamber {
  readonly group = new THREE.Group();
  readonly ventPositions: THREE.Vector3[] = [];

  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly practicals: THREE.PointLight[] = [];
  private readonly emergency: THREE.PointLight[] = [];
  private readonly lampMaterial: THREE.MeshBasicMaterial;
  private readonly emergencyMaterial: THREE.MeshBasicMaterial;
  private readonly displays: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private readonly padGroup = new THREE.Group();

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
    this.group.name = 'TestChamber01';

    // --- Lights -------------------------------------------------------------
    this.hemi = new THREE.HemisphereLight('#a9bfd6', '#1d1712', 0.8);
    this.key = new THREE.DirectionalLight('#fff0d8', 2.4);
    this.key.position.set(5, 18, -6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -11;
    sc.right = 11;
    sc.top = 11;
    sc.bottom = -11;
    sc.near = 4;
    sc.far = 40;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.fill = new THREE.DirectionalLight('#86a9d8', 0.75);
    this.fill.position.set(-8, 7, 10);
    this.group.add(this.hemi, this.key, this.key.target, this.fill);

    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const warm = new THREE.PointLight('#ffcf8a', 45, 26, 1.6);
      warm.position.set(Math.sin(a) * 10.5, 8, Math.cos(a) * 10.5);
      this.practicals.push(warm);
      const red = new THREE.PointLight('#ff3a2a', 0, 24, 1.6);
      red.position.set(Math.sin(a + Math.PI / 4) * 11.5, 3.5, Math.cos(a + Math.PI / 4) * 11.5);
      this.emergency.push(red);
      this.group.add(warm, red);
    }

    this.lampMaterial = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
    this.emergencyMaterial = new THREE.MeshBasicMaterial({ color: '#4a1410' });

    this.buildPlatform();
    this.buildRailing();
    this.buildPillars();
    this.buildWalls();
    this.buildCeiling();
    this.group.add(this.padGroup);
  }

  // --- Lighting control ------------------------------------------------------

  setMood(mood: LightMood): void {
    this.mood = mood;
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
      g.font = '110px Anton, Impact, sans-serif';
      g.fillText(line1, d.canvas.width / 2, line2 ? 110 : 130);
      if (line2) {
        g.font = '700 46px "Barlow Condensed", sans-serif';
        g.fillStyle = '#c9d3d6';
        g.fillText(line2, d.canvas.width / 2, 200);
      }
      // Scanlines.
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < d.canvas.height; y += 6) g.fillRect(0, y, d.canvas.width, 2);
      d.tex.needsUpdate = true;
    }
  }

  /** Spawn pad markers for the current match. */
  setPads(pads: readonly SpawnPad[], colors: readonly string[]): void {
    for (const child of [...this.padGroup.children]) {
      child.removeFromParent();
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
    }
    const ring = new THREE.RingGeometry(0.62, 0.78, 40);
    const area = new THREE.RingGeometry(PAD_MOVE_RADIUS + 0.42, PAD_MOVE_RADIUS + 0.5, 64);
    pads.forEach((pad, i) => {
      const color = colors[i] ?? '#e3b23c';
      const r = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(pad.pos.x, 0.012, pad.pos.z);
      const a = new THREE.Mesh(
        area,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      a.rotation.x = -Math.PI / 2;
      a.position.set(pad.pos.x, 0.011, pad.pos.z);
      this.padGroup.add(r, a);
    });
  }

  update(dt: number): void {
    this.time += dt;
    const target = MOODS[this.mood];
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
    const emergency = L.emergency * (0.55 + 0.45 * Math.sin(this.time * 6)) + this.pulseT * 90;
    for (const e of this.emergency) e.intensity = emergency;
    this.lampMaterial.color.setScalar(Math.min(1, (L.practical / 45) * flick)).multiply(new THREE.Color('#ffe2b0'));
    const er = Math.min(1, emergency / 80);
    this.emergencyMaterial.color.setRGB(0.29 + er * 0.71, 0.08 + er * 0.1, 0.06);
    this.renderer.toneMappingExposure = L.exposure;
  }

  // --- Construction ----------------------------------------------------------

  private buildPlatform(): void {
    const R = this.arena.platformRadius;
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshStandardMaterial({ map: platformTexture(), roughness: 0.7, metalness: 0.35 }),
    );
    top.rotation.set(-Math.PI / 2, 0, Math.PI);
    top.receiveShadow = true;
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R - 0.25, 0.6, 96, 1, true),
      new THREE.MeshStandardMaterial({ map: hazardStripeTexture(28), roughness: 0.6 }),
    );
    side.position.y = -0.3;
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.25, 2.2, 3.2, 48), toon('#23292f'));
    under.position.y = -2.2;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 6, 24), toon('#1b2025'));
    column.position.y = -6.5;
    const pit = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: pitTexture(), roughness: 0.9 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -7;
    pit.receiveShadow = true;
    this.group.add(top, side, under, column, pit);
  }

  private buildRailing(): void {
    const r = this.arena.railingRadius;
    const yellow = toon('#d6a531');
    for (const y of [1.0, 0.55]) {
      const tube = new THREE.Mesh(new THREE.TorusGeometry(r, y > 0.9 ? 0.055 : 0.04, 8, 128), yellow);
      tube.rotation.x = Math.PI / 2;
      tube.position.y = y;
      tube.castShadow = true;
      this.group.add(tube);
    }
    const posts = 40;
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), toon('#2b3036'), posts);
    const m = new THREE.Matrix4();
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      m.makeTranslation(Math.sin(a) * r, 0.5, Math.cos(a) * r);
      post.setMatrixAt(i, m);
    }
    post.castShadow = true;
    this.group.add(post);
  }

  private buildPillars(): void {
    const body = toon('#4b555e');
    const band = new THREE.MeshStandardMaterial({ map: hazardStripeTexture(3), roughness: 0.6 });
    for (const p of this.arena.pillars) {
      const g = new THREE.Group();
      g.position.set(p.pos.x, 0, p.pos.z);
      const col = inkedMesh(new THREE.CylinderGeometry(p.radius, p.radius * 1.08, p.height, 24), body, 0.03);
      col.position.y = p.height / 2;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(p.radius + 0.01, p.radius + 0.01, 0.35, 24, 1, true), band);
      stripe.position.y = 0.45;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.radius * 0.7, p.radius * 0.8, 0.12, 20), this.lampMaterial);
      cap.position.y = p.height + 0.06;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(p.radius * 1.3, p.radius * 1.4, 0.14, 24), toon('#2b3036'));
      base.position.y = 0.07;
      base.receiveShadow = true;
      g.add(col, stripe, cap, base);
      this.group.add(g);
    }
  }

  private buildWalls(): void {
    const W = this.arena.wallRadius;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(W, W, 20, 72, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTexture(), side: THREE.BackSide, roughness: 0.85, metalness: 0.2 }),
    );
    wall.position.y = 3;
    this.group.add(wall);

    // Observation windows ring.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 0.3), toon('#14191d'));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.6), new THREE.MeshBasicMaterial({ map: windowTexture(i) }));
      const pos = new THREE.Vector3(Math.sin(a) * (W - 0.2), 6.6, Math.cos(a) * (W - 0.2));
      frame.position.copy(pos);
      frame.lookAt(0, 6.6, 0);
      glass.position.copy(pos).multiplyScalar((W - 0.38) / (W - 0.2));
      glass.position.y = 6.6;
      glass.lookAt(0, 6.6, 0);
      this.group.add(frame, glass);
    }

    // Experiment displays (mirror the round phase).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.displays.push({ canvas, tex });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshBasicMaterial({ map: tex }));
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.0, 0.3), toon('#101418'));
      const pos = new THREE.Vector3(Math.sin(a) * (W - 0.4), 10.2, Math.cos(a) * (W - 0.4));
      bezel.position.copy(pos);
      bezel.lookAt(0, 10.2, 0);
      screen.position.copy(pos).multiplyScalar((W - 0.58) / (W - 0.4));
      screen.position.y = 10.2;
      screen.lookAt(0, 10.2, 0);
      this.group.add(bezel, screen);
    }
    this.setDisplay('TEST CHAMBER 01', 'SUBJECTS STAND BY');

    // Pipes.
    const pipeMat = toon('#59646d');
    for (const [y, rad] of [
      [12.2, 0.32],
      [12.9, 0.22],
      [-0.9, 0.28],
    ] as const) {
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(W - 0.6, rad, 10, 96), pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.y = y;
      this.group.add(pipe);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 20, 12), pipeMat);
      pipe.position.set(Math.sin(a) * (W - 0.6), 3, Math.cos(a) * (W - 0.6));
      this.group.add(pipe);
      this.ventPositions.push(new THREE.Vector3(Math.sin(a) * (W - 1.1), -0.6, Math.cos(a) * (W - 1.1)));
    }

    // Emergency beacons.
    for (const red of this.emergency) {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), this.emergencyMaterial);
      beacon.position.copy(red.position).multiplyScalar(W / red.position.length() * 0.97);
      beacon.position.y = 3.5;
      this.group.add(beacon);
    }

    // Floor-level label decal on the wall band.
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 0.8),
      new THREE.MeshBasicMaterial({
        map: canvasTexture('subjects-label', 512, 100, (g) => {
          g.fillStyle = '#e3b23c';
          g.font = '72px Anton, Impact, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('AUTHORISED SUBJECTS ONLY', 256, 52);
        }),
        transparent: true,
      }),
    );
    label.position.set(0, 2.6, W - 0.35);
    label.lookAt(0, 2.6, 0);
    this.group.add(label);
  }

  private buildCeiling(): void {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.2, 32), toon('#1a1f24'));
    housing.position.y = 15.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 48), this.lampMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 14.85;
    this.group.add(housing, ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), this.lampMaterial);
      lamp.position.set(Math.sin(a) * 10, 13.4, Math.cos(a) * 10);
      lamp.lookAt(0, 13.4, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.6), toon('#20262b'));
      arm.position.set(Math.sin(a) * 11.9, 13.55, Math.cos(a) * 11.9);
      arm.lookAt(0, 13.55, 0);
      this.group.add(lamp, arm);
    }
  }
}
