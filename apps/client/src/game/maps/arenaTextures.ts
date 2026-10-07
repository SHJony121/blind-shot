import * as THREE from 'three';
import { canvasTexture } from '../characters/textures';

const YELLOW = '#e3b23c';
const INK = '#16191d';

function stripes(g: CanvasRenderingContext2D, w: number, h: number, size: number): void {
  g.fillStyle = YELLOW;
  g.fillRect(0, 0, w, h);
  g.fillStyle = INK;
  for (let x = -h; x < w + h; x += size * 2) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + size, 0);
    g.lineTo(x + size + h, h);
    g.lineTo(x + h, h);
    g.closePath();
    g.fill();
  }
}

export function hazardStripeTexture(repeat: number): THREE.Texture {
  const tex = canvasTexture('hazard', 256, 64, (g) => stripes(g, 256, 64, 32)).clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
  tex.needsUpdate = true;
  return tex;
}

/** Top of the circular platform: steel plates, seams, a hazard ring and the chamber emblem. */
export function platformTexture(): THREE.Texture {
  return canvasTexture('platform', 1024, 1024, (g) => {
    const c = 512;
    const R = 512;
    g.fillStyle = '#3b4249';
    g.fillRect(0, 0, 1024, 1024);

    // Diamond plate texture.
    g.fillStyle = 'rgba(255,255,255,0.045)';
    for (let y = 0; y < 1024; y += 18) {
      for (let x = (y / 18) % 2 === 0 ? 0 : 9; x < 1024; x += 18) {
        g.save();
        g.translate(x, y);
        g.rotate(Math.PI / 4);
        g.fillRect(-4, -1.5, 8, 3);
        g.restore();
      }
    }
    // Concentric seams and radial plate joints.
    g.strokeStyle = 'rgba(10,12,14,0.55)';
    g.lineWidth = 4;
    for (const r of [0.22, 0.48, 0.72]) {
      g.beginPath();
      g.arc(c, c, R * r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * R * 0.22, c + Math.sin(a) * R * 0.22);
      g.lineTo(c + Math.cos(a) * R * 0.9, c + Math.sin(a) * R * 0.9);
      g.stroke();
    }
    // Rivets along the seams.
    g.fillStyle = 'rgba(200,210,220,0.18)';
    for (const r of [0.48, 0.72]) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        g.beginPath();
        g.arc(c + Math.cos(a) * R * r, c + Math.sin(a) * R * r, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Hazard ring at the edge.
    const inner = R * 0.91;
    const outer = R * 0.995;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const skew = (Math.PI * 2) / n / 2;
      g.fillStyle = i % 2 === 0 ? YELLOW : INK;
      g.beginPath();
      g.moveTo(c + Math.cos(a0) * inner, c + Math.sin(a0) * inner);
      g.lineTo(c + Math.cos(a0 + skew) * outer, c + Math.sin(a0 + skew) * outer);
      g.lineTo(c + Math.cos(a1 + skew) * outer, c + Math.sin(a1 + skew) * outer);
      g.lineTo(c + Math.cos(a1) * inner, c + Math.sin(a1) * inner);
      g.closePath();
      g.fill();
    }
    // Centre emblem: target ring + chamber number.
    g.strokeStyle = 'rgba(227,178,60,0.75)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(c, c, R * 0.17, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(c + dx * R * 0.12, c + dy * R * 0.12);
      g.lineTo(c + dx * R * 0.22, c + dy * R * 0.22);
      g.stroke();
    }
    g.fillStyle = 'rgba(236,230,214,0.85)';
    g.font = '120px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('01', c, c + 6);
  });
}

/** Inside of the chamber wall: dark panels, a stripe band and huge painted numbers. */
export function wallTexture(): THREE.Texture {
  const tex = canvasTexture('wall', 2048, 512, (g) => {
    g.fillStyle = '#1f262c';
    g.fillRect(0, 0, 2048, 512);
    // Panels.
    for (let x = 0; x < 2048; x += 128) {
      for (let y = 0; y < 512; y += 128) {
        const shadeV = 28 + ((x * 7 + y * 13) % 9);
        g.fillStyle = `rgb(${shadeV},${shadeV + 7},${shadeV + 12})`;
        g.fillRect(x + 4, y + 4, 120, 120);
      }
    }
    // Stripe band near the floor line.
    g.save();
    g.translate(0, 440);
    stripes(g, 2048, 40, 26);
    g.restore();
    // Giant painted chamber numbers.
    g.font = '230px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(227,178,60,0.22)';
    for (let i = 0; i < 4; i++) g.fillText('01', 256 + i * 512, 300);
    g.font = '700 44px "Barlow Condensed", sans-serif';
    g.fillStyle = 'rgba(236,230,214,0.25)';
    for (let i = 0; i < 4; i++) g.fillText('TEST CHAMBER', 256 + i * 512, 150);
  }).clone();
  tex.wrapS = THREE.RepeatWrapping;
  // Negative repeat un-mirrors the texture on the inside (BackSide) of the wall.
  tex.repeat.set(-2, 1);
  tex.needsUpdate = true;
  return tex;
}

/** Observation window with a few silhouetted observers behind the glass. */
export function windowTexture(variant: number): THREE.Texture {
  return canvasTexture(`window-${variant}`, 256, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#7fd6e6');
    grad.addColorStop(1, '#2d6f86');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(10,20,26,0.85)';
    const count = 1 + (variant % 3);
    for (let i = 0; i < count; i++) {
      const x = 50 + i * 70 + ((variant * 37) % 30);
      g.beginPath();
      g.arc(x, 70, 17, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(x, 128, 34, 40, 0, Math.PI, 0);
      g.fill();
      // Clipboard.
      if ((i + variant) % 2 === 0) g.fillRect(x + 14, 92, 16, 22);
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 8; y < 128; y += 16) g.fillRect(0, y, 256, 3);
  });
}

export function pitTexture(): THREE.Texture {
  const tex = canvasTexture('pit', 256, 256, (g) => {
    g.fillStyle = '#0b0e10';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(227,178,60,0.12)';
    g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
  }).clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.needsUpdate = true;
  return tex;
}
