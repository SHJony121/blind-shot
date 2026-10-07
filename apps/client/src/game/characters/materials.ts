import * as THREE from 'three';

let gradientMap: THREE.DataTexture | null = null;

/** Three-band ramp for the cartoon look. */
export function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

const outlineCache = new Map<number, THREE.MeshBasicMaterial>();

/** Ink outline via the inverted-hull trick: back faces pushed out along their normals. */
export function outlineMaterial(width = 0.025, color = '#101316'): THREE.MeshBasicMaterial {
  const key = Math.round(width * 10000);
  const cached = outlineCache.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.name = 'shared-outline';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`,
    );
  };
  mat.customProgramCacheKey = () => `outline-${key}`;
  outlineCache.set(key, mat);
  return mat;
}

/** Create a mesh plus its outline hull (as a child, so it follows every transform). */
export function inkedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  outlineWidth = 0.022,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outlineWidth > 0) {
    const hull = new THREE.Mesh(geometry, outlineMaterial(outlineWidth));
    hull.name = 'outline';
    hull.castShadow = false;
    hull.receiveShadow = false;
    mesh.add(hull);
  }
  return mesh;
}

/** Brighten / darken a hex colour. */
export function shade(color: string, amount: number): THREE.Color {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return c;
}
