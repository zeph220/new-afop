import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VehicleFleet, type DriveInput } from '../src/entities/Vehicles.ts';
import { Physics } from '../src/physics/Physics.ts';
import { heightAt } from '../src/world/WorldGen.ts';
import type { WorkerPool } from '../src/core/WorkerPool.ts';
import type { WorkerRequest } from '../src/world/world.worker.ts';

const pool = { request: async (req: WorkerRequest) => { if (req.type !== 'hf') throw 0; const n = req.cells + 1; const s = req.size / req.cells; const h = new Float32Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h[j + i * n] = heightAt(req.x0 + i * s, req.z0 + j * s); return h; } } as unknown as WorkerPool;
const drive = (o: Partial<DriveInput> = {}): DriveInput => ({ fwd: 0, right: 0, up: false, upPressed: false, down: false, boost: false, action: false, engineToggle: false, ...o });
const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

it('le chenillé tourne ; l’hydroglisseur se stabilise quand on le quitte', async () => {
  const ph = await Physics.load(pool);
  const fleet = new VehicleFleet(ph, ['chenille', 'hydro']);
  const run = async (s: number, p: Vector3, i: () => DriveInput | null) => {
    for (let k = 0; k < s * 60; k++) {
      fleet.update(1 / 60, p, i(), k / 60, 0);
      await Promise.resolve();
    }
  };
  const c = fleet.vehicles.get('chenille')!;
  const pc = c.position.clone();
  await run(2, pc, () => null);
  fleet.enter(c);
  const y0 = yawOf(c.quaternion);
  await run(3, pc, () => drive({ right: 1 }));
  expect(Math.abs(yawOf(c.quaternion) - y0)).toBeGreaterThan(0.4); // pivot sur place
  fleet.exit();

  const h = fleet.vehicles.get('hydro')!;
  const hp = h.position.clone();
  await run(2, hp, () => null);
  fleet.enter(h);
  await run(3, hp, () => drive({ fwd: 1, right: 0.6 }));
  fleet.exit();
  await run(4, hp, () => null);
  const w = (h as unknown as { body: { angvel(): { x: number; y: number; z: number } } }).body.angvel();
  expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(0.2);
  expect(new Vector3(0, 1, 0).applyQuaternion(h.quaternion).y).toBeGreaterThan(0.97);
  fleet.dispose();
}, 60000);
