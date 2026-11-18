// Modèles de véhicules téléchargés (scripts/fetch-models.mjs) : ils remplacent l'aspect procédural.
// La physique (boîte de collision, siège) ne change pas : le modèle est ajusté à la boîte du véhicule.

import { AnimationMixer, Box3, Vector3, type AnimationClip, type Mesh, type Object3D } from 'three';
import type { Vehicle } from './Vehicles.ts';

const skins = new Map<Vehicle, (dt: number) => void>();

/** À appeler chaque image : rotors, foreuse, jambes, animations intégrées. */
export function updateVehicleSkins(dt: number, vehicles: Vehicle[]): void {
  for (const v of vehicles) skins.get(v)?.(dt);
}

export function clearVehicleSkins(): void {
  skins.clear();
}

/** Anime les pièces reconnues par leur nom (rotors, tuyaux de forage, jambes) et les clips intégrés. */
function makeAnimator(v: Vehicle, model: Object3D, clips: AnimationClip[]): (dt: number) => void {
  const find = (re: RegExp) => {
    const out: Object3D[] = [];
    model.traverse((o) => {
      if (re.test(o.name)) out.push(o);
    });
    return out;
  };
  // Armes éventuelles du modèle : masquées (véhicules civils).
  for (const o of find(/gun|weapon|missile/i)) o.visible = false;
  const rotors = v.kind === 'gyro' ? find(/^[fb]_rotor_\d+$|rotor(?!_?root|_?end)/i) : v.kind === 'hydro' ? find(/fan|turbine|propel/i) : [];
  const pipes = v.kind === 'chenille' ? find(/^PIPES$|drill|kelly|bit$/i) : [];
  const pipeY = pipes.map((p) => p.position.y);
  const legs = v.kind === 'marcheur' ? { l1: find(/LLeg1/)[0], l2: find(/LLeg2/)[0], r1: find(/RLeg1/)[0], r2: find(/RLeg2/)[0] } : null;
  const legRest = legs ? Object.fromEntries(Object.entries(legs).map(([k, o]) => [k, o?.rotation.x ?? 0])) : {};
  let mixer: AnimationMixer | null = null;
  // Clip intégré : seulement s'il s'agit d'un mouvement de croisière (pas d'une animation de coup).
  const loopClip = clips.find((c) => !/hit|death|die|attack/i.test(c.name));
  if (loopClip) {
    mixer = new AnimationMixer(model);
    mixer.clipAction(loopClip).play();
  }
  let spin = 0;
  let phase = 0;
  let t = 0;
  return (dt) => {
    t += dt;
    const power = v.anim.power;
    const speed = Math.abs(v.forwardSpeed);
    spin += dt * (v.kind === 'gyro' ? 4 + power * 46 : 2 + power * 30);
    for (const r of rotors) r.rotation.y = spin;
    if (pipes.length) {
      // Train de tiges qui monte et descend quand la foreuse travaille.
      const d = v.anim.drill;
      pipes.forEach((p, i) => (p.position.y = pipeY[i] - d * (0.5 + 0.5 * Math.sin(t * 2.2)) * 0.6));
    }
    if (legs) {
      phase += dt * speed * 1.4;
      const a = Math.min(0.6, speed * 0.25);
      const s = Math.sin(phase);
      if (legs.l1) legs.l1.rotation.x = legRest.l1 + s * a;
      if (legs.r1) legs.r1.rotation.x = legRest.r1 - s * a;
      if (legs.l2) legs.l2.rotation.x = legRest.l2 + Math.max(0, -s) * a * 1.2;
      if (legs.r2) legs.r2.rotation.x = legRest.r2 + Math.max(0, s) * a * 1.2;
    }
    if (mixer) {
      mixer.timeScale = v.kind === 'hydro' ? 0.3 + power * 1.5 : 1;
      mixer.update(dt);
    }
    // Léger flottement de l'aéroglisseur.
    if (v.kind === 'hydro') model.position.y += Math.sin(t * 2.4) * 0.002 * (0.3 + power);
  };
}

interface Entry {
  file: string;
  rotY?: number;
}

export async function applyVehicleSkins(vehicles: Vehicle[], baseUrl: string): Promise<void> {
  let man: Record<string, Entry>;
  try {
    const r = await fetch(`${baseUrl}manifest.json`);
    if (!r.ok) return;
    man = await r.json();
  } catch {
    return;
  }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  await Promise.all(
    vehicles.map(async (v) => {
      const e = man[v.kind];
      if (!e) return;
      try {
        const g = await loader.loadAsync(baseUrl + e.file);
        const model = g.scene;
        // Oriente la plus grande dimension horizontale le long de Z (axe avant-arrière du véhicule).
        model.updateMatrixWorld(true);
        let box = new Box3().setFromObject(model);
        let size = box.getSize(new Vector3());
        model.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + (e.rotY ?? 0);
        model.updateMatrixWorld(true);
        box = new Box3().setFromObject(model);
        size = box.getSize(new Vector3());
        const he = v.model.halfExtents;
        const k = Math.min((2 * he.z * 1.1) / size.z, (2 * he.x * 1.6) / size.x, (2 * he.y * 3.5) / size.y);
        model.scale.multiplyScalar(k);
        const c = box.getCenter(new Vector3()).multiplyScalar(k);
        model.position.set(-c.x, -he.y - box.min.y * k, -c.z);
        model.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        // Masque la géométrie procédurale (le siège et tout ce qui y est attaché restent).
        const seat = v.model.seat;
        const keep = (o: Object3D): boolean => {
          for (let p: Object3D | null = o; p; p = p.parent) if (p === seat) return true;
          return false;
        };
        v.model.root.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh && !keep(m)) m.visible = false;
        });
        v.model.root.add(model);
        skins.set(v, makeAnimator(v, model, g.animations));
      } catch (err) {
        console.warn('Modèle de véhicule illisible :', v.kind, err);
      }
    }),
  );
}
