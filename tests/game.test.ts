import { describe, expect, it } from 'vitest';
import { PlayerController, GRAVITY, type PlayerInput, type WorldQuery } from '../src/player/PlayerController.ts';
import { FACTIONS } from '../src/player/Factions.ts';
import type { Cylinder } from '../src/world/VegetationPlacement.ts';
import { StateMachine } from '../src/core/StateMachine.ts';
import { DEFAULT_SETTINGS, loadSettings, resolveQuality, saveSettings } from '../src/core/Settings.ts';
import { LocalSaveBackend, parseSave } from '../src/core/SaveSystem.ts';

/** Monde de test : sol plat à y=0, falaise raide au-delà de x=20, un tronc à (0, -10). */
function testWorld(cyl: Cylinder[] = []): WorldQuery {
  return {
    ground(x, _z, n) {
      if (x < 20) {
        if (n) Object.assign(n, { x: 0, y: 1, z: 0 });
        return 0;
      }
      // pente de 70° montant vers +x
      const s = Math.tan((70 * Math.PI) / 180);
      if (n) {
        const l = Math.hypot(s, 1);
        Object.assign(n, { x: -s / l, y: 1 / l, z: 0 });
      }
      return (x - 20) * s;
    },
    colliders: (_x, _z, _r, out) => {
      out.length = 0;
      out.push(...cyl);
      return out;
    },
    waterLevel: -50,
    edgeDistance: (x, z) => Math.hypot(x, z),
  };
}

const idle = (): PlayerInput => ({ moveX: 0, moveZ: 0, fwd: 0, right: 0, sprint: false, crouch: false, crouchPressed: false, jumpPressed: false, jumpHeld: false });

function run(p: PlayerController, seconds: number, input: Partial<PlayerInput> = {}): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) p.update(dt, { ...idle(), ...input });
}

describe('contrôleur du personnage', () => {
  it('retombe au sol et y reste', () => {
    const p = new PlayerController(FACTIONS.sylmar, testWorld());
    p.teleport(0, 5, 0);
    run(p, 2);
    expect(p.state).toBe('ground');
    expect(p.pos.y).toBeCloseTo(0, 3);
  });

  it('saute à la hauteur prévue (v²/2g)', () => {
    const p = new PlayerController(FACTIONS.sylmar, testWorld());
    p.teleport(0, 0, 0);
    run(p, 0.2);
    p.update(1 / 60, { ...idle(), jumpPressed: true });
    let max = 0;
    for (let i = 0; i < 120; i++) {
      p.update(1 / 60, idle());
      max = Math.max(max, p.pos.y);
    }
    const expected = (FACTIONS.sylmar.jump * FACTIONS.sylmar.jump) / (2 * GRAVITY);
    expect(max).toBeGreaterThan(expected * 0.9);
    expect(max).toBeLessThan(expected * 1.05);
  });

  it('court plus vite qu’il ne marche', () => {
    const a = new PlayerController(FACTIONS.halden, testWorld());
    const b = new PlayerController(FACTIONS.halden, testWorld());
    a.teleport(-100, 0, 0);
    b.teleport(-100, 0, 0);
    run(a, 2, { moveX: 1 });
    run(b, 2, { moveX: 1, sprint: true });
    expect(b.pos.x - -100).toBeGreaterThan((a.pos.x - -100) * 1.8);
  });

  it('un Halden est bloqué par une falaise, un Sylmar l’escalade', () => {
    const h = new PlayerController(FACTIONS.halden, testWorld());
    h.teleport(15, 0, 0);
    run(h, 3, { moveX: 1, fwd: 1 });
    expect(h.pos.y).toBeLessThan(1);
    expect(h.state).toBe('ground');

    const s = new PlayerController(FACTIONS.sylmar, testWorld());
    s.teleport(15, 0, 0);
    run(s, 1.6, { moveX: 1, fwd: 1 }); // 5 m à parcourir avant la paroi
    expect(s.state).toBe('climb');
    run(s, 3, { moveX: 1, fwd: 1 });
    expect(s.pos.y).toBeGreaterThan(4);
    expect(s.stamina).toBeLessThan(FACTIONS.sylmar.staminaMax);
  });

  it('le propulseur Halden fait monter et consomme du carburant', () => {
    const h = new PlayerController(FACTIONS.halden, testWorld());
    h.teleport(0, 0, 0);
    run(h, 0.2);
    h.update(1 / 60, { ...idle(), jumpPressed: true, jumpHeld: true });
    run(h, 2, { jumpHeld: true });
    expect(h.pos.y).toBeGreaterThan(5);
    expect(h.fuel).toBeLessThan(FACTIONS.halden.fuelMax);
    // Les Sylmar n'ont pas de propulseur.
    const s = new PlayerController(FACTIONS.sylmar, testWorld());
    s.teleport(0, 0, 0);
    run(s, 0.2);
    s.update(1 / 60, { ...idle(), jumpPressed: true, jumpHeld: true });
    run(s, 2, { jumpHeld: true });
    expect(s.pos.y).toBeLessThan(0.01);
  });

  it('un tronc bloque le passage ; un Sylmar le grimpe jusqu’à l’ombrelle', () => {
    const trunk: Cylinder = { x: 0, z: -10, r: 1.2, y0: -4, y1: 40, climbable: true, platform: true };
    const disc: Cylinder = { x: 0, z: -10, r: 8, y0: 22, y1: 23, climbable: false, platform: true };
    const h = new PlayerController(FACTIONS.halden, testWorld([trunk, disc]));
    h.teleport(0, 0, -5);
    run(h, 3, { moveZ: -1, fwd: 1 });
    expect(h.pos.z).toBeGreaterThan(-10 + 1.2 + 0.3);

    const s = new PlayerController(FACTIONS.sylmar, testWorld([trunk, disc]));
    s.teleport(0, 0, -5);
    run(s, 1.5, { moveZ: -1, fwd: 1 });
    expect(s.state).toBe('trunk');
    // On grimpe jusqu'à se hisser sur l'ombrelle, puis on relâche les commandes.
    for (let i = 0; i < 60 * 15 && !(s.state === 'ground' && s.pos.y > 20); i++) s.update(1 / 60, { ...idle(), moveZ: -1, fwd: 1 });
    run(s, 1);
    expect(s.pos.y).toBeCloseTo(23, 1); // debout sur l'ombrelle
    expect(s.state).toBe('ground');
  });
});

describe('machine à états', () => {
  it('suit les transitions autorisées', () => {
    const sm = new StateMachine();
    const seen: string[] = [];
    sm.on((to) => seen.push(to));
    expect(sm.go('playing')).toBe(false);
    expect(sm.go('menu')).toBe(true);
    expect(sm.go('factionSelect')).toBe(true);
    expect(sm.go('playing')).toBe(true);
    expect(sm.go('paused')).toBe(true);
    expect(sm.go('factionSelect')).toBe(false);
    expect(sm.go('playing')).toBe(true);
    expect(seen).toEqual(['menu', 'factionSelect', 'playing', 'paused', 'playing']);
  });
});

describe('réglages et sauvegarde', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('les réglages invalides reviennent aux valeurs par défaut', () => {
    const st = memory();
    st.setItem('veyra.settings.v1', JSON.stringify({ quality: 'ultra', fov: 400, volume: -1 }));
    const s = loadSettings(st);
    expect(s.quality).toBe('auto');
    expect(s.fov).toBe(100);
    expect(s.volume).toBe(0);
    saveSettings({ ...DEFAULT_SETTINGS, fov: 80 }, st);
    expect(loadSettings(st).fov).toBe(80);
  });

  it('la qualité automatique s’adapte au matériel', () => {
    expect(resolveQuality('auto', { cores: 8, renderer: 'NVIDIA GeForce GTX 1050 Ti' })).toBe('elevee');
    expect(resolveQuality('auto', { cores: 8, renderer: 'Intel(R) UHD Graphics 620' })).toBe('moyenne');
    expect(resolveQuality('auto', { cores: 8, renderer: 'Google SwiftShader' })).toBe('basse');
    expect(resolveQuality('basse', { cores: 16 })).toBe('basse');
  });

  it('une sauvegarde se relit à l’identique ; les données corrompues sont rejetées', async () => {
    const be = new LocalSaveBackend(memory());
    expect(await be.load()).toBeNull();
    const data = parseSave({ faction: 'halden', position: { x: 1, y: 2, z: 3 }, yaw: 0.5, timeOfDay: 1.25, weather: 'orage', playTime: 99 })!;
    expect(data.timeOfDay).toBeCloseTo(0.25);
    await be.save(data);
    expect(await be.load()).toEqual(data);
    expect(parseSave({ faction: 'autre', position: { x: 0, y: 0, z: 0 } })).toBeNull();
    expect(parseSave({ faction: 'sylmar', position: { x: NaN, y: 0, z: 0 } })).toBeNull();
  });
});
