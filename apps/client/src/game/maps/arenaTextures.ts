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

/** Inside of the chamber wall: dark panels, a stripe band and huge painted numbers. */
export function chamberWallTexture(label: string, repeat: number): THREE.Texture {
  const tex = canvasTexture(`wall-chamber-${label}`, 2048, 512, (g) => {
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
    for (let i = 0; i < 4; i++) g.fillText(label, 256 + i * 512, 300);
    g.font = '700 44px "Barlow Condensed", sans-serif';
    g.fillStyle = 'rgba(236,230,214,0.25)';
    for (let i = 0; i < 4; i++) g.fillText('TEST CHAMBER', 256 + i * 512, 150);
  }).clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
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


function tiled(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

/** One 4 m floor tile per texture repeat. */
export function floorTexture(theme: 'clean' | 'chamber' | 'factory' | 'cooling', rx: number, ry: number): THREE.Texture {
  const base = canvasTexture(`floor-${theme}`, 512, 512, (g) => {
    if (theme === 'clean') {
      // Bright 2 m checker: easy to judge distances and positions at a glance.
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          g.fillStyle = (x + y) % 2 === 0 ? '#f6f7f9' : '#e4e8ec';
          g.fillRect(x * 256, y * 256, 256, 256);
        }
      }
      g.strokeStyle = 'rgba(150,160,170,0.35)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, 510, 510);
    } else if (theme === 'chamber') {
      g.fillStyle = '#3a4148';
      g.fillRect(0, 0, 512, 512);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 0; y < 512; y += 16) {
        for (let x = (y / 16) % 2 === 0 ? 0 : 8; x < 512; x += 16) {
          g.save();
          g.translate(x, y);
          g.rotate(Math.PI / 4);
          g.fillRect(-4, -1.5, 8, 3);
          g.restore();
        }
      }
      g.strokeStyle = 'rgba(8,10,12,0.6)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, 506, 506);
      g.fillStyle = 'rgba(200,210,220,0.2)';
      for (const [x, y] of [[18, 18], [494, 18], [18, 494], [494, 494]] as const) {
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
      }
    } else if (theme === 'factory') {
      g.fillStyle = '#6b6559';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2500; i++) {
        const v = 80 + Math.random() * 50;
        g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.35)`;
        g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
      }
      g.strokeStyle = 'rgba(30,28,24,0.55)';
      g.lineWidth = 4;
      g.strokeRect(2, 2, 508, 508);
      g.fillStyle = 'rgba(40,30,20,0.1)';
      g.beginPath();
      g.ellipse(170, 330, 90, 50, 0.4, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#c9d6dc';
      g.fillRect(0, 0, 512, 512);
      g.strokeStyle = '#8fa3ad';
      g.lineWidth = 4;
      for (let i = 0; i <= 512; i += 128) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 512);
        g.moveTo(0, i);
        g.lineTo(512, i);
        g.stroke();
      }
      g.fillStyle = 'rgba(70,140,180,0.18)';
      g.fillRect(128, 128, 128, 128);
      g.fillRect(256, 256, 128, 128);
    }
  });
  return tiled(base, rx, ry);
}

export function factoryWallTexture(label: string, repeat: number): THREE.Texture {
  const tex = canvasTexture(`wall-factory-${label}`, 1024, 512, (g) => {
    g.fillStyle = '#5a3a2e';
    g.fillRect(0, 0, 1024, 512);
    for (let y = 0; y < 400; y += 32) {
      for (let x = (y / 32) % 2 === 0 ? 0 : 32; x < 1024; x += 64) {
        const v = 70 + Math.random() * 25;
        g.fillStyle = `rgb(${v + 20},${v - 15},${v - 30})`;
        g.fillRect(x + 2, y + 2, 60, 28);
      }
    }
    g.fillStyle = '#2b2f33';
    g.fillRect(0, 400, 1024, 112);
    g.save();
    g.translate(0, 400);
    stripes(g, 1024, 30, 22);
    g.restore();
    g.font = '200px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(236,230,214,0.28)';
    g.fillText(label, 512, 230);
  });
  return tiled(tex, repeat, 1);
}

export function coolingWallTexture(label: string, repeat: number): THREE.Texture {
  const tex = canvasTexture(`wall-cooling-${label}`, 1024, 512, (g) => {
    g.fillStyle = '#7f98a6';
    g.fillRect(0, 0, 1024, 512);
    for (let x = 0; x < 1024; x += 128) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x + 6, 10, 116, 380);
      g.fillStyle = 'rgba(20,40,55,0.35)';
      g.fillRect(x + 6, 388, 116, 6);
    }
    g.fillStyle = '#2f6f8f';
    g.fillRect(0, 420, 1024, 92);
    g.font = '180px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(20,50,70,0.35)';
    g.fillText(label, 512, 210);
    g.font = '700 40px "Barlow Condensed", sans-serif';
    g.fillStyle = 'rgba(236,240,244,0.85)';
    g.fillText('COOLANT LOOP · KEEP CLEAR', 512, 466);
  });
  return tiled(tex, repeat, 1);
}

export function crateTexture(): THREE.Texture {
  return canvasTexture('crate', 256, 256, (g) => {
    g.fillStyle = '#b07a3e';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(80,45,15,0.35)';
    for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 3);
    g.strokeStyle = '#6e4519';
    g.lineWidth = 18;
    g.strokeRect(9, 9, 238, 238);
    g.beginPath();
    g.moveTo(18, 18);
    g.lineTo(238, 238);
    g.moveTo(238, 18);
    g.lineTo(18, 238);
    g.stroke();
  });
}

export function tankTexture(): THREE.Texture {
  const tex = canvasTexture('tank', 512, 256, (g) => {
    g.fillStyle = '#dfe6ea';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#2f6f8f';
    g.fillRect(0, 150, 512, 36);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 4, 256);
    g.font = '60px Anton, Impact, sans-serif';
    g.fillStyle = '#2f6f8f';
    g.textAlign = 'center';
    g.fillText('LN2', 128, 110);
    g.fillText('LN2', 384, 110);
  });
  return tiled(tex, 1, 1);
}

/** Large painted floor emblem (transparent), e.g. the chamber number at the centre. */
export function emblemTexture(label: string, color: string): THREE.Texture {
  return canvasTexture(`emblem-${label}-${color}`, 512, 512, (g) => {
    g.strokeStyle = color;
    g.globalAlpha = 0.75;
    g.lineWidth = 16;
    g.beginPath();
    g.arc(256, 256, 200, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 10;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      g.beginPath();
      g.moveTo(256 + dx * 150, 256 + dy * 150);
      g.lineTo(256 + dx * 250, 256 + dy * 250);
      g.stroke();
    }
    g.globalAlpha = 0.85;
    g.fillStyle = 'rgba(236,230,214,0.9)';
    g.font = '200px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 256, 266);
  });
}

export function cleanWallTexture(_label: string, repeat: number): THREE.Texture {
  const tex = canvasTexture('wall-clean', 512, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#d5dbe1';
    g.fillRect(0, 108, 512, 20);
    g.fillStyle = 'rgba(160,170,180,0.35)';
    for (let x = 0; x < 512; x += 128) g.fillRect(x, 0, 3, 108);
  });
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(repeat * 3, 1);
  t.needsUpdate = true;
  return t;
}
