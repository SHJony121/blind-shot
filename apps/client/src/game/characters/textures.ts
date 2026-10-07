import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Stencilled subject number patch, e.g. "03". */
export function numberPatchTexture(subject: number): THREE.Texture {
  return canvasTexture(`patch-${subject}`, 256, 192, (g) => {
    g.fillStyle = '#ece6d6';
    roundRect(g, 6, 6, 244, 180, 22);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#1b1e22';
    g.stroke();
    g.fillStyle = '#1b1e22';
    g.font = '132px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(subject).padStart(2, '0'), 128, 104);
  });
}

/** Yellow/black quadrant target, the classic test-dummy calibration marker. */
export function crashMarkerTexture(): THREE.Texture {
  return canvasTexture('marker', 128, 128, (g) => {
    const c = 64;
    g.fillStyle = '#1b1e22';
    g.beginPath();
    g.arc(c, c, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2c230';
    for (const start of [0, Math.PI]) {
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, 56, start, start + Math.PI / 2);
      g.closePath();
      g.fill();
    }
  });
}

/** Soft round sprite used by smoke / glow particles. */
export function softDotTexture(): THREE.Texture {
  return canvasTexture('soft-dot', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/** Four-point star for muzzle flashes. */
export function flashTexture(): THREE.Texture {
  return canvasTexture('flash', 128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,220,120,0.9)');
    grad.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 64 : 18;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(64, 64, 30, 0, Math.PI * 2);
    g.fill();
  });
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export { canvasTexture };
