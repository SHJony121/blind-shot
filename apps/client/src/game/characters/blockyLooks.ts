import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SkinId } from '@blindshot/shared';
import { inkedMesh, toon } from './materials';
import { canvasTexture } from './textures';
import type { SubjectPartName } from './SubjectModel';

type Face = 'smile' | 'grin' | 'serious' | 'smirk' | 'mouthOnly' | 'screen';
type Hair = 'spiky' | 'mohawk' | 'slick' | 'buzz' | 'none';

/**
 * A blocky, toy-figure character. Each one has its own proportions, hair / hat, outfit and
 * accessories: genuinely different silhouettes, not recolours of one model.
 */
export interface BlockyDef {
  label: string;
  skin: string;
  shirt: string;
  pants: string;
  shoes: string;
  /** Torso width / depth and limb thickness (metres). */
  torsoW: number;
  torsoD: number;
  limbW: number;
  /** Head cube size. */
  headS: number;
  face: Face;
  hair: Hair;
  hairColor?: string;
  hat?: 'cowboy';
  hatColor?: string;
  band?: { kind: 'blindfold' | 'headband'; color: string };
  shades?: boolean;
  jacket?: string;
  tie?: string;
  scarf?: string;
  antenna?: boolean;
}

export const BLOCKY_LOOKS: Partial<Record<SkinId, BlockyDef>> = {
  BLIND: {
    label: 'THE BLIND',
    skin: '#f1d3bd',
    shirt: '#1f2433',
    pants: '#262b38',
    shoes: '#111318',
    torsoW: 0.64,
    torsoD: 0.36,
    limbW: 0.2,
    headS: 0.56,
    face: 'mouthOnly',
    hair: 'spiky',
    hairColor: '#eef1f6',
    band: { kind: 'blindfold', color: '#15171c' },
  },
  BRAWLER: {
    label: 'BRAWLER',
    skin: '#d9a27c',
    shirt: '#c8352e',
    pants: '#3f8f3a',
    shoes: '#2a2a2a',
    torsoW: 0.92,
    torsoD: 0.48,
    limbW: 0.27,
    headS: 0.58,
    face: 'grin',
    hair: 'buzz',
    hairColor: '#2b1d14',
    band: { kind: 'headband', color: '#f2f2f2' },
  },
  AGENT: {
    label: 'AGENT',
    skin: '#c98d6a',
    shirt: '#f2f2f2',
    pants: '#1d1f24',
    shoes: '#0d0e10',
    torsoW: 0.7,
    torsoD: 0.38,
    limbW: 0.2,
    headS: 0.54,
    face: 'serious',
    hair: 'slick',
    hairColor: '#141414',
    shades: true,
    jacket: '#1d1f24',
    tie: '#b3262b',
  },
  PUNK: {
    label: 'PUNK',
    skin: '#f0c8a8',
    shirt: '#d9d9d9',
    pants: '#3b5a8a',
    shoes: '#151515',
    torsoW: 0.6,
    torsoD: 0.34,
    limbW: 0.18,
    headS: 0.52,
    face: 'smirk',
    hair: 'mohawk',
    hairColor: '#ff3e9a',
    jacket: '#2a2a2a',
  },
  COWBOY: {
    label: 'COWPOKE',
    skin: '#c58a5e',
    shirt: '#b56a33',
    pants: '#4a3a2a',
    shoes: '#5a3a1e',
    torsoW: 0.74,
    torsoD: 0.4,
    limbW: 0.22,
    headS: 0.55,
    face: 'smile',
    hair: 'none',
    hat: 'cowboy',
    hatColor: '#7a4a24',
    scarf: '#c0392b',
  },
  ROBOT: {
    label: 'UNIT BOT',
    skin: '#9aa5ae',
    shirt: '#7c8791',
    pants: '#5f6a73',
    shoes: '#3a4148',
    torsoW: 0.8,
    torsoD: 0.5,
    limbW: 0.22,
    headS: 0.64,
    face: 'screen',
    hair: 'none',
    antenna: true,
  },
};

export const isBlocky = (skin: SkinId | undefined): boolean => !!skin && !!BLOCKY_LOOKS[skin];

const geoCache = new Map<string, THREE.BufferGeometry>();
function rbox(w: number, h: number, d: number, r = 0.04): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    geoCache.set(key, g);
  }
  return g;
}

function faceTexture(kind: Face): THREE.Texture {
  return canvasTexture(`blocky-face-${kind}`, 128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    if (kind === 'screen') {
      g.fillStyle = '#10161c';
      g.fillRect(14, 30, 100, 60);
      g.fillStyle = '#5cf2ff';
      g.fillRect(36, 48, 14, 22);
      g.fillRect(78, 48, 14, 22);
      return;
    }
    g.fillStyle = '#16181c';
    g.strokeStyle = '#16181c';
    g.lineCap = 'round';
    if (kind !== 'mouthOnly') {
      if (kind === 'serious') {
        g.fillRect(34, 50, 18, 7);
        g.fillRect(76, 50, 18, 7);
      } else {
        g.beginPath();
        g.ellipse(43, 54, 7, 10, 0, 0, Math.PI * 2);
        g.ellipse(85, 54, 7, 10, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.lineWidth = 6;
    g.beginPath();
    if (kind === 'grin') {
      g.fillStyle = '#16181c';
      g.moveTo(40, 82);
      g.quadraticCurveTo(64, 108, 88, 82);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(48, 84, 32, 6);
    } else if (kind === 'serious') {
      g.moveTo(50, 90);
      g.lineTo(78, 90);
      g.stroke();
    } else if (kind === 'smirk') {
      g.moveTo(48, 90);
      g.quadraticCurveTo(70, 96, 84, 82);
      g.stroke();
    } else {
      g.moveTo(46, 84);
      g.quadraticCurveTo(64, 100, 82, 84);
      g.stroke();
    }
  });
}

export interface BlockyBuild {
  materials: THREE.MeshToonMaterial[];
  shoulderX: number;
}

/**
 * Builds the blocky body into the shared part groups. Joint positions match the toon
 * subject (so animation, aiming and the gun mount behave identically); everything else
 * (widths, head, hair, outfit, accessories) is per character.
 */
export function buildBlocky(parts: Record<SubjectPartName, THREE.Group>, def: BlockyDef, tint?: string): BlockyBuild {
  const shirtColor = tint ?? def.shirt;
  const skin = toon(def.skin);
  const shirt = toon(def.jacket && !tint ? def.jacket : shirtColor);
  const under = toon(def.jacket ? (tint ?? def.shirt) : shirtColor);
  const pants = toon(def.pants);
  const shoes = toon(def.shoes);
  const hairMat = toon(def.hairColor ?? '#222222');
  const materials = [skin, shirt, under, pants, shoes, hairMat];
  const { hips, torso, head, armL, armR, legL, legR } = parts;
  const w = def.torsoW;
  const d = def.torsoD;
  const lw = def.limbW;

  hips.position.y = 0.72;
  const pelvis = inkedMesh(rbox(w * 0.96, 0.24, d * 0.95), pants);
  pelvis.position.y = -0.02;
  hips.add(pelvis);

  for (const [leg, side] of [
    [legL, 1],
    [legR, -1],
  ] as const) {
    leg.position.set((w / 4) * side, -0.06, 0);
    const limb = inkedMesh(rbox(lw * 1.15, 0.56, lw * 1.15), pants);
    limb.position.y = -0.3;
    const shoe = inkedMesh(rbox(lw * 1.25, 0.14, lw * 1.25 + 0.12), shoes);
    shoe.position.set(0, -0.6, 0.05);
    leg.add(limb, shoe);
    hips.add(leg);
  }

  torso.position.y = 0.1;
  hips.add(torso);
  const chest = inkedMesh(rbox(w, 0.72, d), shirt);
  chest.position.y = 0.36;
  torso.add(chest);
  if (def.jacket) {
    // Open jacket: a strip of the shirt underneath shows down the front.
    const strip = new THREE.Mesh(rbox(w * 0.3, 0.66, 0.04, 0.01), under);
    strip.position.set(0, 0.37, d / 2 + 0.005);
    torso.add(strip);
  }
  if (def.tie) {
    const tie = new THREE.Mesh(rbox(0.08, 0.42, 0.03, 0.01), toon(def.tie));
    tie.position.set(0, 0.45, d / 2 + 0.03);
    torso.add(tie);
  }
  if (def.scarf) {
    const scarf = inkedMesh(rbox(w * 0.75, 0.12, d * 1.1, 0.05), toon(def.scarf), 0.015);
    scarf.position.y = 0.74;
    torso.add(scarf);
  }

  // Head.
  head.position.y = 0.8;
  torso.add(head);
  const s = def.headS;
  const cube = inkedMesh(rbox(s, s, s, 0.08), skin, 0.022);
  cube.position.y = s / 2 + 0.03;
  head.add(cube);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.9, s * 0.9), new THREE.MeshBasicMaterial({ map: faceTexture(def.face), transparent: true }));
  face.position.set(0, s / 2 + 0.03, s / 2 + 0.006);
  head.add(face);
  const top = s + 0.03;

  if (def.hair === 'spiky') {
    const spikeGeo = new THREE.ConeGeometry(0.11, 0.34, 5);
    const cap = inkedMesh(rbox(s * 1.04, 0.14, s * 1.04, 0.05), hairMat, 0.015);
    cap.position.y = top - 0.02;
    head.add(cap);
    const spots: [number, number][] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) spots.push([(i / 3 - 0.5) * s * 0.85, (j / 2 - 0.5) * s * 0.8]);
    spots.forEach(([x, z], k) => {
      const spike = inkedMesh(spikeGeo, hairMat, 0.012);
      spike.position.set(x, top + 0.12, z);
      spike.rotation.set(-0.35 - z * 0.6, 0, x * -0.9 + (k % 2 ? 0.15 : -0.15));
      head.add(spike);
    });
  } else if (def.hair === 'mohawk') {
    for (let i = 0; i < 5; i++) {
      const fin = inkedMesh(rbox(0.09, 0.3 - Math.abs(i - 2) * 0.04, 0.12, 0.03), hairMat, 0.012);
      fin.position.set(0, top + 0.12, (i - 2) * 0.11);
      fin.rotation.x = (i - 2) * 0.12;
      head.add(fin);
    }
  } else if (def.hair === 'slick') {
    const cap = inkedMesh(rbox(s * 1.05, 0.16, s * 1.05, 0.06), hairMat, 0.015);
    cap.position.set(0, top - 0.04, -0.02);
    const back = inkedMesh(rbox(s * 1.05, s * 0.55, 0.08, 0.04), hairMat, 0.015);
    back.position.set(0, top - s * 0.3, -s / 2 - 0.02);
    head.add(cap, back);
  } else if (def.hair === 'buzz') {
    const cap = inkedMesh(rbox(s * 1.03, 0.1, s * 1.03, 0.04), hairMat, 0.012);
    cap.position.y = top - 0.03;
    head.add(cap);
  }

  if (def.band) {
    const bandMat = toon(def.band.color);
    materials.push(bandMat);
    const blind = def.band.kind === 'blindfold';
    const band = inkedMesh(rbox(s * 1.06, blind ? 0.16 : 0.1, s * 1.06, 0.03), bandMat, 0.012);
    band.position.y = blind ? s * 0.62 : top - 0.13;
    head.add(band);
    // Knot tails hanging at the back.
    for (const side of [1, -1]) {
      const tail = inkedMesh(rbox(0.06, 0.32, 0.04, 0.015), bandMat, 0.01);
      tail.position.set(0.07 * side, band.position.y - 0.16, -s / 2 - 0.06);
      tail.rotation.z = 0.25 * side;
      head.add(tail);
    }
  }
  if (def.shades) {
    const shades = new THREE.Mesh(rbox(s * 0.86, 0.12, 0.05, 0.02), new THREE.MeshPhongMaterial({ color: '#0b0c0e', shininess: 100, specular: '#8899aa' }));
    shades.position.set(0, s * 0.62, s / 2 + 0.03);
    head.add(shades);
  }
  if (def.hat === 'cowboy') {
    const hatMat = toon(def.hatColor ?? '#7a4a24');
    materials.push(hatMat);
    const brim = inkedMesh(new THREE.CylinderGeometry(s * 0.95, s * 0.95, 0.05, 24), hatMat, 0.015);
    brim.position.y = top + 0.02;
    brim.scale.set(1, 1, 0.85);
    const crown = inkedMesh(rbox(s * 0.82, 0.3, s * 0.72, 0.09), hatMat, 0.015);
    crown.position.y = top + 0.17;
    head.add(brim, crown);
  }
  if (def.antenna) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 6), shoes);
    rod.position.set(s * 0.25, top + 0.15, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4b3a' }));
    knob.position.set(s * 0.25, top + 0.33, 0);
    head.add(rod, knob);
  }

  // Arms: shoulder pivots sit just outside the torso.
  const shoulderX = w / 2 + lw * 0.55;
  for (const [arm, side] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.position.set(shoulderX * side, 0.6, 0);
    const sleeve = inkedMesh(rbox(lw, 0.36, lw), shirt);
    sleeve.position.y = -0.17;
    const fore = inkedMesh(rbox(lw * 0.92, 0.26, lw * 0.92), def.jacket ? shirt : skin);
    fore.position.y = -0.45;
    const hand = inkedMesh(rbox(lw * 0.95, 0.14, lw * 0.95), skin);
    hand.position.y = -0.63;
    arm.add(sleeve, fore, hand);
    torso.add(arm);
  }

  return { materials, shoulderX };
}
