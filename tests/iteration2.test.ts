import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Creature, CreatureManager, findHabitat, habitatOk, type RideInput } from '../src/entities/Creatures.ts';
import { VehicleFleet, type DriveInput } from '../src/entities/Vehicles.ts';
import { Physics } from '../src/physics/Physics.ts';
import { groundHeight, heightAt, LANDMARKS, WATER_LEVEL } from '../src/world/WorldGen.ts';
import type { WorkerPool } from '../src/core/WorkerPool.ts';
import type { WorkerRequest } from '../src/world/world.worker.ts';

const vehra = LANDMARKS.find((l) => l.id === 'vehra-tal')!;

const ride = (o: Partial<RideInput> = {}): RideInput => ({
  moveX: 0, moveZ: 0, fwd: 0, right: 0, sprint: false, crouch: false, jumpPressed: false, jumpHeld: false, camYaw: 0, camPitch: 0.2, ...o,
});

describe('créatures', () => {
  it('chaque espèce a un habitat à proximité de Vehra-Tal', () => {
    for (const kind of ['vexil', 'tormaq', 'skarel'] as const) {
      const p = findHabitat(kind, vehra.x, vehra.z, kind === 'skarel' ? 1600 : 700);
      expect(p, kind).not.toBeNull();
      expect(habitatOk(kind, p!.x, p!.z)).toBe(true);
    }
  });

  it('vol du Skarel : le piqué accélère, le cabré ralentit jusqu’au décrochage', () => {
    const sk = findHabitat('skarel', vehra.x, vehra.z, 1600)!;
    const c = new Creature('skarel', sk.x, sk.z, 'test', 1);
    c.pos.y += 300;
    c.takeOff();
    const h = 1 / 60;
    // Piqué (caméra vers le bas + Maj)
    for (let i = 0; i < 300; i++) c.updateRidden(h, ride({ camPitch: 0.9, sprint: true, camYaw: c.yaw }));
    expect(c.airSpeed).toBeGreaterThan(28);
    const fast = c.airSpeed;
    // Cabré : perte de vitesse
    for (let i = 0; i < 240; i++) c.updateRidden(h, ride({ camPitch: -0.9, camYaw: c.yaw }));
    expect(c.airSpeed).toBeLessThan(fast - 10);
    c.dispose();
  });

  it('un Skarel se pose quand il atteint le sol lentement', () => {
    const sk = findHabitat('skarel', vehra.x, vehra.z, 1600)!;
    const c = new Creature('skarel', sk.x, sk.z, 'test', 2);
    c.pos.y += 6;
    c.takeOff();
    for (let i = 0; i < 60 * 20 && c.flying; i++) c.updateRidden(1 / 60, ride({ crouch: true, camPitch: 0.6, camYaw: c.yaw }));
    expect(c.flying).toBe(false);
    expect(c.pos.y).toBeCloseTo(groundHeight(c.pos.x, c.pos.z), 1);
    c.dispose();
  });

  it('apprivoisement : offrande, trois appels en rythme, harnais', () => {
    const added: Creature[] = [];
    const m = new CreatureManager((c) => added.push(c), () => undefined);
    const vx = findHabitat('vexil', vehra.x, vehra.z, 700)!;
    const player = new Vector3(vx.x, groundHeight(vx.x, vx.z), vx.z);
    m.update(1 / 60, player, true, true, false, 0, 0, 0); // fait apparaître la harde garantie
    const target = m.creatures.find((c) => c.kind === 'vexil')!;
    expect(target).toBeDefined();
    // Le joueur s'accroupit à côté de la bête.
    player.set(target.pos.x + 3, target.pos.y, target.pos.z);
    const keys = { interactPressed: false, interactHeld: false, abilityPressed: false };
    let t = 1;
    const step = (k: Partial<typeof keys> = {}) => {
      t += 1 / 60;
      m.update(1 / 60, player, true, true, false, t, t, 0);
      return m.updateTaming(1 / 60, player, true, true, false, { ...keys, ...k }, t);
    };
    step();
    step({ interactPressed: true }); // offrande
    expect(target.phase).toBe('appel');
    expect(target.trust).toBe(40);
    // Trois réponses au bon tempo.
    for (let round = 0; round < 3; round++) {
      while (t < target.callAt + target.def.tempo - 1 / 120) step();
      step({ abilityPressed: true });
    }
    expect(target.trust).toBe(100);
    expect(target.phase).toBe('harnais');
    for (let i = 0; i < 130; i++) step({ interactHeld: true });
    expect(target.tamed).toBe(true);
    expect(m.tamed.get('vexil')).toBe(target);
    m.dispose();
  });

  it('un joueur debout fait fuir la bête ; deux contretemps aussi', () => {
    const m = new CreatureManager(() => undefined, () => undefined);
    const tq = findHabitat('tormaq', vehra.x, vehra.z, 700)!;
    const player = new Vector3(tq.x, groundHeight(tq.x, tq.z), tq.z);
    m.update(1 / 60, player, false, true, false, 0, 0, 0);
    const c = m.creatures.find((x) => x.kind === 'tormaq')!;
    player.set(c.pos.x + 4, c.pos.y, c.pos.z);
    m.update(1 / 60, player, false, true, false, 0.1, 0.1, 0);
    expect(c.mode).toBe('flee');
    m.dispose();
  });

  it('monte : le Vexil sprinte plus vite que le Tormaq ne charge', () => {
    const vx = findHabitat('vexil', vehra.x, vehra.z, 700)!;
    const tq = findHabitat('tormaq', vehra.x, vehra.z, 700)!;
    const v = new Creature('vexil', vx.x, vx.z, 't', 3);
    const t = new Creature('tormaq', tq.x, tq.z, 't', 4);
    v.startRiding();
    t.startRiding();
    for (let i = 0; i < 120; i++) {
      v.updateRidden(1 / 60, ride({ moveZ: -1, fwd: 1, sprint: true }));
      t.updateRidden(1 / 60, ride({ moveZ: -1, fwd: 1, sprint: true }));
    }
    expect(Math.abs(v.speed)).toBeGreaterThan(Math.abs(t.speed));
    v.dispose();
    t.dispose();
  });
});

/** Pool factice : exécute les requêtes de tuiles comme le ferait le worker. */
const fakePool = {
  request: async (req: WorkerRequest) => {
    if (req.type !== 'hf') throw new Error('non pris en charge');
    const n = req.cells + 1;
    const step = req.size / req.cells;
    const h = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h[j + i * n] = heightAt(req.x0 + i * step, req.z0 + j * step);
    return h;
  },
} as unknown as WorkerPool;

const drive = (o: Partial<DriveInput> = {}): DriveInput => ({ fwd: 0, right: 0, up: false, upPressed: false, down: false, boost: false, action: false, engineToggle: false, ...o });

async function run(fleet: VehicleFleet, player: Vector3, seconds: number, input: () => DriveInput | null): Promise<void> {
  for (let i = 0; i < seconds * 60; i++) {
    fleet.update(1 / 60, player, input(), i / 60, 0);
    await Promise.resolve();
  }
}

describe('véhicules (Rapier)', () => {
  it('le dépôt de Kessel accueille les quatre véhicules, qui se comportent différemment', async () => {
    const physics = await Physics.load(fakePool);
    const fleet = new VehicleFleet(physics, ['gyro', 'marcheur', 'chenille', 'hydro']);
    const player = fleet.depot.clone();
    // Laisse les tuiles se charger et les véhicules se poser.
    await run(fleet, player, 2, () => null);
    expect(physics.stats.tiles).toBeGreaterThan(0);

    // Chenillé : avance vers son avant.
    const crawler = fleet.vehicles.get('chenille')!;
    const c0 = crawler.position.clone();
    fleet.enter(crawler);
    await run(fleet, player, 4, () => drive({ fwd: 1 }));
    expect(crawler.position.distanceTo(c0)).toBeGreaterThan(3);
    expect(crawler.forwardSpeed).toBeGreaterThan(1);
    fleet.exit();

    // Gyrocoptère : décolle en maintenant Espace.
    const gyro = fleet.vehicles.get('gyro')!;
    const g0 = gyro.position.y;
    fleet.enter(gyro);
    await run(fleet, player, 4, () => drive({ up: true }));
    expect(gyro.position.y - g0).toBeGreaterThan(5);
    expect(gyro.engineOn).toBe(true); // (au dépôt, la recharge compense la consommation)
    fleet.exit();

    // Marcheur : avance sur ses quatre pattes.
    const walker = fleet.vehicles.get('marcheur')!;
    const w0 = walker.position.clone();
    fleet.enter(walker);
    await run(fleet, player, 4, () => drive({ fwd: 1 }));
    expect(walker.position.distanceTo(w0)).toBeGreaterThan(5);
    fleet.exit();

    // Hydroglisseur : flotte dans le chenal de la faille.
    const hydro = fleet.vehicles.get('hydro')!;
    const hp = hydro.position.clone();
    await run(fleet, hp, 3, () => null);
    expect(hydro.position.y).toBeGreaterThan(WATER_LEVEL - 1);
    expect(hydro.position.y).toBeLessThan(WATER_LEVEL + 3);
    fleet.enter(hydro);
    await run(fleet, hp, 3, () => drive({ fwd: 1 }));
    expect(hydro.position.distanceTo(hp)).toBeGreaterThan(4);
    fleet.exit();

    // Les véhicules laissés ailleurs y restent après rechargement de la sauvegarde.
    const saved = fleet.saveState();
    fleet.dispose();
    const again = new VehicleFleet(physics, ['gyro', 'marcheur', 'chenille', 'hydro'], saved);
    for (const k of ['chenille', 'marcheur', 'hydro'] as const) {
      const before = saved[k]!;
      const v = again.vehicles.get(k)!;
      expect(Math.hypot(v.position.x - before.x!, v.position.z - before.z!), k).toBeLessThan(0.5);
    }
    // Sans position enregistrée : stationnement au dépôt, chenillé à ≈ 52 m de l'aire.
    const fresh = new VehicleFleet(physics, ['chenille'], {});
    const cp = fresh.vehicles.get('chenille')!.position;
    expect(Math.hypot(cp.x - fresh.depot.x, cp.z - fresh.depot.z)).toBeCloseTo(52.5, 0);
    again.dispose();
    fresh.dispose();
  }, 60000);
});
