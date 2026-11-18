/// <reference lib="webworker" />
// Worker de génération : maillages de terrain, instances de végétation, textures procédurales.

import { buildNodeMesh } from './TerrainMesh.ts';
import { placeCell, INSTANCE_STRIDE, type VegLayerId } from './VegetationPlacement.ts';
import { generateMaterialTexture, type TerrainMaterialId } from '../textures/TextureGen.ts';

export type WorkerRequest =
  | { type: 'node'; x0: number; z0: number; size: number; morphEnd: number }
  | { type: 'veg'; layer: VegLayerId; cx: number; cz: number; density: number }
  | { type: 'tex'; material: TerrainMaterialId; size: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  try {
    if (req.type === 'node') {
      const m = buildNodeMesh(req.x0, req.z0, req.size, req.morphEnd);
      ctx.postMessage({ id, result: m }, [m.positions.buffer, m.normals.buffer, m.morph.buffer]);
    } else if (req.type === 'veg') {
      const inst = placeCell(req.layer, req.cx, req.cz, req.density);
      const n = inst.length / INSTANCE_STRIDE;
      const matrices = new Float32Array(n * 16);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = i * INSTANCE_STRIDE;
        const x = inst[o];
        const y = inst[o + 1];
        const z = inst[o + 2];
        const rot = inst[o + 3];
        const s = inst[o + 4];
        const t = inst[o + 5];
        const c = Math.cos(rot) * s;
        const sn = Math.sin(rot) * s;
        const m = i * 16;
        // matrice colonne-majeure : rotation Y + échelle uniforme + translation
        matrices[m] = c;
        matrices[m + 1] = 0;
        matrices[m + 2] = -sn;
        matrices[m + 3] = 0;
        matrices[m + 4] = 0;
        matrices[m + 5] = s;
        matrices[m + 6] = 0;
        matrices[m + 7] = 0;
        matrices[m + 8] = sn;
        matrices[m + 9] = 0;
        matrices[m + 10] = c;
        matrices[m + 11] = 0;
        matrices[m + 12] = x;
        matrices[m + 13] = y;
        matrices[m + 14] = z;
        matrices[m + 15] = 1;
        const b = 0.82 + 0.34 * t;
        colors[i * 3] = b * (1 + 0.16 * (t - 0.5));
        colors[i * 3 + 1] = b;
        colors[i * 3 + 2] = b * (1 - 0.12 * (t - 0.5));
      }
      ctx.postMessage({ id, result: { count: n, matrices, colors } }, [matrices.buffer, colors.buffer]);
    } else if (req.type === 'tex') {
      const t = generateMaterialTexture(req.material, req.size);
      ctx.postMessage({ id, result: t }, [t.albedoRough.buffer, t.normalHeight.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
