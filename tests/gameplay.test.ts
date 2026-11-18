import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Inventory, RECIPES, rollLoot } from '../src/gameplay/Items.ts';
import { FaunaManager, FAUNA, type FaunaContext } from '../src/gameplay/Fauna.ts';
import { groundHeight, LANDMARKS } from '../src/world/WorldGen.ts';
import { WIND } from '../src/world/Wind.ts';

const ctx = (p: Vector3, o: Partial<FaunaContext> = {}): FaunaContext => ({
  player: p, crouching: false, sprinting: false, sheltered: false, night: 0, time: 0, movers: [], ...o,
});

describe('objets et fabrication', () => {
  it('fabrique des flèches et refuse sans ressources', () => {
    const inv = new Inventory({ bois: 1, plume: 1, os: 1 });
    const r = RECIPES.find((x) => x.id === 'r_fleche')!;
    expect(inv.craft(r)).toBe(true);
    expect(inv.count('fleche')).toBe(4);
    expect(inv.count('bois')).toBe(0);
    expect(inv.craft(r)).toBe(false);
  });

  it('une amélioration ne se fabrique qu’une fois', () => {
    const inv = new Inventory({ os: 8, fibre: 8, bois: 6, resine: 4 });
    const r = RECIPES.find((x) => x.out === 'arc_composite')!;
    expect(inv.craft(r)).toBe(true);
    expect(inv.canCraft(r)).toBe(false);
  });

  it('les tables de butin respectent les bornes', () => {
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const l = rollLoot([['viande', 2, 3, 1]], rnd);
      expect(l.viande).toBeGreaterThanOrEqual(2);
      expect(l.viande).toBeLessThanOrEqual(3);
    }
  });
});

describe('faune', () => {
  const vehra = LANDMARKS.find((l) => l.id === 'vehra-tal')!;
  const p = new Vector3(vehra.x + 400, 0, vehra.z + 300);
  p.y = groundHeight(p.x, p.z);

  it('fait apparaître plusieurs espèces autour du joueur, jamais tout près', () => {
    const kinds = new Set<string>();
    for (let epoch = 0; epoch < 6; epoch++) {
      const m = new FaunaManager(() => undefined, () => undefined);
      m.update(1 / 60, ctx(p, { time: epoch * 300 }));
      for (const a of m.animals) {
        kinds.add(a.def.kind);
        expect(Math.hypot(a.pos.x - p.x, a.pos.z - p.z)).toBeGreaterThan(50);
      }
      m.dispose();
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('une proie fuit le joueur ; le troupeau suit', () => {
    const m = new FaunaManager(() => undefined, () => undefined);
    const g = m.spawnGroup('ruminel', p.x + 20, p.z, 0.5);
    for (let i = 0; i < 30; i++) m.update(1 / 60, ctx(p));
    expect(g.every((a) => a.state === 'fuite')).toBe(true);
    const d0 = g[0].pos.distanceTo(p);
    for (let i = 0; i < 180; i++) m.update(1 / 60, ctx(p));
    expect(g[0].pos.distanceTo(p)).toBeGreaterThan(d0);
    m.dispose();
  });

  it('un prédateur agressif charge et mord ; les dégâts le tuent', () => {
    const m = new FaunaManager(() => undefined, () => undefined);
    let bitten = 0;
    m.events.onPlayerHit = (d) => (bitten += d);
    const v = new Vector3(vehra.x + 6, 0, vehra.z + 6);
    v.y = groundHeight(v.x, v.z);
    p.copy(v);
    const [w] = m.spawnGroup('griffal', p.x + 22, p.z, 0.1);
    for (const a of m.animals) a.aggressive = true;
    for (let i = 0; i < 60 * 10 && !bitten; i++) m.update(1 / 60, ctx(p, { time: i / 60 }));
    expect(bitten).toBeGreaterThan(0);
    expect(m.damage(w, 1000, p)).toBe(true);
    expect(w.alive).toBe(false);
    expect(m.nearestCarcass(w.pos, 2)).toBe(w);
    m.dispose();
  });

  it('accroupi et sous le vent, on approche bien plus près', () => {
    WIND.update(10, 0.6);
    const m = new FaunaManager(() => undefined, () => undefined);
    const def = FAUNA.ruminel;
    // Animal placé au vent du joueur (le vent souffle de l'animal vers le joueur).
    const ax = p.x - WIND.dir.x * 22;
    const az = p.z - WIND.dir.z * 22;
    const [a] = m.spawnGroup('ruminel', ax, az, 0.99);
    for (const o of m.animals) if (o !== a) o.pos.set(ax, o.pos.y, az);
    for (let i = 0; i < 20; i++) m.update(1 / 60, ctx(p, { crouching: true }));
    expect(a.state).not.toBe('fuite');
    expect(def.sense).toBeGreaterThan(22);
    m.dispose();
  });
});
