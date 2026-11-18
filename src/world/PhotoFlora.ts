// Flore photoréaliste : modèles glTF scannés (Poly Haven, CC0) qui remplacent la géométrie
// procédurale de certaines couches. Les instances (placement, collisions) ne changent pas :
// seul l'aspect change. Vent, fondu d'apparition et lueur nocturne sont conservés.

import { Box3, BufferAttribute, DoubleSide, Float32BufferAttribute, Vector3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial } from 'three';
import { createVegetationMaterial } from '../render/VegetationMaterial.ts';
import { geometryFor } from './VegetationGeometry.ts';
import type { ColliderSlice, VegLayerId } from './VegetationPlacement.ts';
import type { Color } from 'three';

interface FloraSpec {
  model: string;
  url?: string;
  /** Dimension de référence : hauteur (plantes) ou plus grande dimension (rochers). */
  fit: 'height' | 'extent';
  /** Facteur d'échelle par rapport au modèle procédural remplacé. */
  scale: number;
  wind: number;
  glow: number;
  sink?: number; // enfoncement dans le sol (fraction de la hauteur)
  /** Distance (m) en deçà de laquelle le modèle scanné remplace le modèle procédural. */
  near: number;
}

export const PHOTO_FLORA: Partial<Record<VegLayerId, FloraSpec>> = {
  fougere: { model: 'fern_02', fit: 'height', scale: 1.15, wind: 1, glow: 0.15, near: 45 },
  lamelle: { model: 'calathea_orbifolia_01', fit: 'height', scale: 1.4, wind: 0.6, glow: 0.1, near: 15 },
  coupe: { model: 'anthurium_botany_01', fit: 'height', scale: 1.3, wind: 0.4, glow: 0.2, near: 12 },
  bloc: { model: 'boulder_01', fit: 'extent', scale: 1.0, wind: 0, glow: 0, sink: 0.12, near: 70 },
};

export interface PhotoFloraLayer {
  id: VegLayerId;
  geometry: BufferGeometry;
  materials: Material[];
  near: number;
  /** Forme de collision mesurée (null pour les petites plantes, traversables). */
  colliders: ColliderSlice[] | null;
}

/**
 * Découpe le modèle en tranches horizontales et mesure son rayon dans chacune :
 * le tronc, les branches basses, la canopée ou les plateformes ont chacun leur cylindre.
 */
function measureShape(id: VegLayerId, geo: BufferGeometry): ColliderSlice[] | null {
  if (id !== 'colonnier' && id !== 'arque' && id !== 'bloc') return null;
  const pos = geo.attributes.position;
  let H = 0;
  for (let i = 0; i < pos.count; i++) H = Math.max(H, pos.getY(i));
  const N = id === 'bloc' ? 4 : 10;
  const bands: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) continue;
    bands[Math.min(N - 1, Math.floor((y / H) * N))].push(Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  const raw = bands.map((d, k) => {
    if (d.length < 8) return null;
    d.sort((a, b) => a - b);
    // Tronc : médiane (le feuillage épars ne gonfle pas le cylindre) ; rocher : 85e centile.
    const r = d[Math.floor(d.length * (id === 'bloc' ? 0.85 : 0.5))];
    return { r: Math.max(0.18, r * (id === 'bloc' ? 0.95 : 0.9)), y0: (k / N) * H, y1: ((k + 1) / N) * H };
  });
  // Fusion des tranches de rayon voisin.
  const out: ColliderSlice[] = [];
  for (const b of raw) {
    if (!b) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.r - b.r) / Math.max(last.r, b.r) < 0.25 && Math.abs(last.y1 - b.y0) < 1e-3) {
      last.r = Math.max(last.r, b.r);
      last.y1 = b.y1;
    } else {
      const wide = b.r > 1.4;
      out.push({ ...b, climbable: id === 'colonnier' && !wide, platform: id === 'bloc' || (id === 'colonnier' && wide) });
    }
  }
  return out.length ? out.slice(0, 8) : null;
}

/** Charge les modèles ; chaque couche est livrée dès qu'elle est prête. */
export async function loadPhotoFlora(baseUrl: string, glow: (id: VegLayerId) => Color, onLayer: (l: PhotoFloraLayer) => void): Promise<void> {
  const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/utils/BufferGeometryUtils.js'),
  ]);
  const loader = new GLTFLoader();
  // Arbres téléchargés (scripts/fetch-models.mjs) : public/models/trees/manifest.json.
  const specs = { ...PHOTO_FLORA };
  try {
    const treeBase = new URL('../trees/', baseUrl).href;
    const r = await fetch(`${treeBase}manifest.json`);
    if (r.ok) {
      const man = (await r.json()) as Record<string, { file: string }>;
      for (const [id, e] of Object.entries(man)) {
        if (id !== 'colonnier' && id !== 'arque') continue;
        specs[id] = { model: id, url: treeBase + e.file, fit: 'height', scale: id === 'colonnier' ? 1 : 1.05, wind: 0.25, glow: 0, near: id === 'colonnier' ? 190 : 150 };
      }
    }
  } catch {
    /* pas d'arbres téléchargés */
  }
  await Promise.all(
    (Object.entries(specs) as [VegLayerId, FloraSpec][]).map(async ([id, spec]) => {
      try {
        const g = await loader.loadAsync(spec.url ?? `${baseUrl}${spec.model}/${spec.model}.gltf`);
        g.scene.updateMatrixWorld(true);
        // Regroupe les maillages par matériau.
        const byMat = new Map<Material, BufferGeometry[]>();
        g.scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
          if (!geo.attributes.uv) geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          const mat = m.material as Material;
          if (!byMat.has(mat)) byMat.set(mat, []);
          byMat.get(mat)!.push(geo.index ? geo : geo.toNonIndexed());
        });
        const parts: BufferGeometry[] = [];
        const srcMats: Material[] = [];
        for (const [mat, list] of byMat) {
          const indexed = list.every((x) => x.index);
          const merged = mergeGeometries(indexed ? list : list.map((x) => (x.index ? x.toNonIndexed() : x)), false);
          if (merged) {
            parts.push(merged);
            srcMats.push(mat);
          }
        }
        if (!parts.length) return;
        const geometry = mergeGeometries(parts, true);
        if (!geometry) return;
        // Mise à l'échelle sur la géométrie procédurale remplacée.
        const ref = new Box3().setFromBufferAttribute(geometryFor(id, true).attributes.position as BufferAttribute);
        const box = new Box3().setFromBufferAttribute(geometry.attributes.position as BufferAttribute);
        const size = box.getSize(new Vector3());
        const refSize = ref.getSize(new Vector3());
        const k = spec.fit === 'height' ? (refSize.y / Math.max(1e-3, size.y)) * spec.scale : (Math.max(refSize.x, refSize.y, refSize.z) / Math.max(1e-3, size.x, size.y, size.z)) * spec.scale;
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        geometry.translate(-cx, -box.min.y - size.y * (spec.sink ?? 0), -cz);
        geometry.scale(k, k, k);
        // Attributs attendus par le matériau de flore.
        const pos = geometry.attributes.position;
        const h = size.y * k;
        const flex = new Float32Array(pos.count);
        const glowA = new Float32Array(pos.count);
        const col = new Float32Array(pos.count * 3).fill(1);
        for (let i = 0; i < pos.count; i++) {
          const t = Math.max(0, pos.getY(i) / Math.max(0.01, h));
          flex[i] = spec.wind > 0 ? Math.pow(t, 1.6) * Math.min(1, h * 0.25) : 0;
          glowA[i] = spec.glow * t;
        }
        geometry.setAttribute('aFlex', new BufferAttribute(flex, 1));
        geometry.setAttribute('aGlow', new BufferAttribute(glowA, 1));
        geometry.setAttribute('color', new BufferAttribute(col, 3));
        geometry.computeBoundingSphere();
        const materials = srcMats.map((src) => {
          const s = src as MeshStandardMaterial;
          const m = createVegetationMaterial({ glowColor: glow(id), glowBoost: spec.glow > 0 ? 0.9 : 0, doubleSide: spec.wind > 0, windAmp: spec.wind });
          m.map = s.map ?? null;
          m.normalMap = s.normalMap ?? null;
          if (s.normalScale) m.normalScale.copy(s.normalScale);
          m.roughnessMap = s.roughnessMap ?? null;
          m.roughness = s.roughnessMap ? 1 : s.roughness;
          m.aoMap = null;
          m.alphaTest = s.alphaTest > 0 ? s.alphaTest : s.transparent || s.alphaMap || (s.map && spec.wind > 0) ? 0.5 : 0;
          m.side = spec.wind > 0 ? DoubleSide : s.side;
          m.needsUpdate = true;
          return m;
        });
        onLayer({ id, geometry, materials, near: spec.near, colliders: measureShape(id, geometry) });
      } catch (e) {
        console.warn('Flore photoréaliste indisponible :', id, e);
      }
    }),
  );
}
