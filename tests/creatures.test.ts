import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { createSkarelModel, createTormaqModel, createVexilModel } from '../src/entities/models/creatures.ts';
import { idleCreatureAnim, type CreatureAnim, type CreatureModel } from '../src/entities/types.ts';

/** Nombre de triangles rendus (× nombre d'instances pour les InstancedMesh). */
function triangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const t = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    const im = o as InstancedMesh;
    n += im.isInstancedMesh ? t * im.count : t;
  });
  return n;
}

function isDescendant(o: Object3D, root: Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Vérifie que toutes les matrices (objets et instances) sont finies. */
function allFinite(root: Object3D): boolean {
  root.updateMatrixWorld(true);
  let ok = true;
  const m = new Matrix4();
  root.traverse((o) => {
    if (!o.matrixWorld.elements.every(Number.isFinite)) ok = false;
    const im = o as InstancedMesh;
    if (im.isInstancedMesh) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        if (!m.elements.every(Number.isFinite)) ok = false;
      }
    }
    const me = o as Mesh;
    if (me.isMesh && !finiteArray(me.geometry.getAttribute('position').array)) ok = false;
  });
  return ok;
}

function finiteArray(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

const STATES: Record<string, Partial<CreatureAnim>> = {
  repos: {},
  marche: { speed: 1.5, gait: 1 },
  course: { speed: 9, gait: 2 },
  sprint: { speed: 16, gait: 3, call: 1, night: 1 },
  couche: { crouch: 1, night: 0.5 },
  saut: { grounded: false, speed: 9, gait: 2 },
  vol: { flying: 1, grounded: false, speed: 20 },
  battement: { flying: 1, flap: 1, grounded: false, bank: 0.5, speed: 18 },
  pique: { flying: 1, dive: 1, boost: 1, grounded: false, speed: 45, night: 1, bank: -0.4 },
};

const FACTORIES: Record<string, () => CreatureModel> = {
  skarel: createSkarelModel,
  tormaq: createTormaqModel,
  vexil: createVexilModel,
};

describe('modèles de créatures', () => {
  for (const [name, make] of Object.entries(FACTORIES)) {
    it(`${name} : racine immobile, selle rattachée, budget de triangles`, () => {
      const model = make();
      const { root, saddle } = model;
      expect(isDescendant(saddle, root)).toBe(true);
      expect(model.height).toBeGreaterThan(1);

      let time = 0;
      const dt = 1 / 60;
      for (const [label, patch] of Object.entries(STATES)) {
        for (let f = 0; f < 40; f++) {
          time += dt;
          model.update(dt, { ...idleCreatureAnim(), ...patch, time });
        }
        expect(root.position.toArray(), label).toEqual([0, 0, 0]);
        expect([root.rotation.x, root.rotation.y, root.rotation.z], label).toEqual([0, 0, 0]);
        expect(root.scale.toArray(), label).toEqual([1, 1, 1]);
        expect(allFinite(root), label).toBe(true);
        const s = saddle.getWorldPosition(new Vector3());
        expect(s.y, label).toBeGreaterThan(0.3);
        expect(s.y, label).toBeLessThan(3);
      }

      const tris = triangles(root);
      console.log(`${name} : ${tris} triangles`);
      expect(tris).toBeLessThanOrEqual(1500);

      model.dispose();
    });
  }
});
