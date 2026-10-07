import * as THREE from 'three';

export type FrameCallback = (dt: number, time: number) => void;

/**
 * Owns the WebGL renderer, the scene, the main camera and the frame loop.
 * Created once for the lifetime of the page; menus and matches attach to it.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly callbacks = new Set<FrameCallback>();
  private readonly clock = new THREE.Clock();
  private running = false;
  private elapsed = 0;
  private frameHandle = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#0d1114');
    this.scene.fog = new THREE.Fog('#0d1114', 22, 46);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.camera.position.set(0, 8, -14);
    this.camera.lookAt(0, 0, 0);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setShadows(enabled: boolean): void {
    if (this.renderer.shadowMap.enabled === enabled) return;
    this.renderer.shadowMap.enabled = enabled;
    // Materials must recompile when the shadow setting flips.
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.needsUpdate = true;
    });
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      // Clamp dt so a background tab does not explode physics / animation.
      const dt = Math.min(this.clock.getDelta(), 1 / 20);
      this.elapsed += dt;
      for (const cb of this.callbacks) cb(dt, this.elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** Debug/test helper: advance the game by `seconds` in fixed steps without rAF, then render. */
  advance(seconds: number, step = 1 / 60): void {
    for (let t = 0; t < seconds; t += step) {
      this.elapsed += step;
      for (const cb of this.callbacks) cb(step, this.elapsed);
    }
    this.renderer.render(this.scene, this.camera);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }

  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };
}
