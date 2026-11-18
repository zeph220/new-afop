// Montures de Veyra (docs/DESIGN.md §5) : comportement sauvage, apprivoisement par la confiance
// (offrande, appel en trois temps, harnais tressé), monte au sol et vol du Skarel.
// Aucun moteur physique : contrôleurs cinématiques sur la heightmap, comme le personnage.

import { Vector3, type Object3D } from 'three';
import { createSkarelModel, createTormaqModel, createVexilModel } from './models/creatures.ts';
import { idleCreatureAnim, type CreatureAnim, type CreatureKind, type CreatureModel } from './types.ts';
import { hash2 } from '../world/noise.ts';
import { createSample, edgeDistance, forestDensity, groundHeight, LANDMARKS, sampleWorld, WATER_LEVEL } from '../world/WorldGen.ts';
import { collidersNear, type Cylinder } from '../world/VegetationPlacement.ts';
import { GRAVITY } from '../player/PlayerController.ts';
import { WIND } from '../world/Wind.ts';

export interface CreatureDef {
  name: string;
  plural: string;
  walk: number;
  trot: number;
  sprint: number;
  turnRate: number; // rad/s au sol
  slopeCos: number; // pente max praticable (cosinus)
  wade: number; // profondeur d'eau max (m)
  jump: number; // impulsion de saut (m/s), 0 = pas de saut
  radius: number;
  tempo: number; // intervalle de l'appel en trois temps (s)
  offering: string;
  fleeDist: number;
  cameraDistance: number;
  staminaMax: number;
  sprintCost: number; // endurance / s en sprint
}

export const CREATURE_DEFS: Record<CreatureKind, CreatureDef> = {
  tormaq: {
    name: 'Tormaq', plural: 'Tormaqs', walk: 3, trot: 5.5, sprint: 9, turnRate: 0.785, slopeCos: 0.866, wade: 1.8, jump: 0, radius: 1.7,
    tempo: 0.8, offering: 'une brassée de coupes-de-brume', fleeDist: 12, cameraDistance: 10, staminaMax: 100, sprintCost: 10,
  },
  vexil: {
    name: 'Vexil', plural: 'Vexils', walk: 3, trot: 9, sprint: 16, turnRate: 3.14, slopeCos: 0.76, wade: 0.8, jump: 9, radius: 0.6,
    tempo: 0.5, offering: "une grappe de feuilles d'Arqué", fleeDist: 14, cameraDistance: 7, staminaMax: 100, sprintCost: 10,
  },
  skarel: {
    name: 'Skarel', plural: 'Skarels', walk: 2, trot: 2.5, sprint: 3, turnRate: 1.5, slopeCos: 0.7, wade: 0.5, jump: 0, radius: 1.6,
    tempo: 1.2, offering: 'un bulbe de fougère-lanterne', fleeDist: 15, cameraDistance: 13, staminaMax: 100, sprintCost: 0,
  },
};

export interface RideInput {
  moveX: number; // direction voulue dans le monde (caméra), longueur 0..1
  moveZ: number;
  fwd: number; // axes bruts (vol)
  right: number;
  sprint: boolean;
  crouch: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  camYaw: number; // cap de la caméra (vol)
  camPitch: number; // tangage de la caméra (vol)
}

type Mode = 'idle' | 'wander' | 'flee' | 'graze' | 'alert' | 'follow' | 'wait' | 'ridden' | 'circle';
export type TamingPhase = 'aucune' | 'offrande' | 'appel' | 'harnais';

const tmpN = { x: 0, y: 1, z: 0 };
const sample = createSample();

export class Creature {
  readonly kind: CreatureKind;
  readonly def: CreatureDef;
  readonly model: CreatureModel;
  readonly anim: CreatureAnim = idleCreatureAnim();
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly home = new Vector3();
  yaw = 0;
  speed = 0;
  mode: Mode = 'idle';
  modeTimer = 2;
  tamed = false;
  grounded = true;
  stamina: number;
  // Vol (Skarel)
  flying = false;
  pitch = 0;
  bank = 0;
  airSpeed = 0;
  flapCharges = 3;
  private flapTimer = 0;
  private flapAnim = 0;
  private dive = 0;
  // Apprivoisement
  trust = 0;
  phase: TamingPhase = 'aucune';
  callRound = 0;
  fails = 0;
  callAt = -1; // instant du dernier cri de la bête
  answered = false;
  shouted = false;
  cooldownUntil = 0;
  harnessHold = 0;
  private callAnim = 0;
  private target = new Vector3();
  private cyl: Cylinder[] = [];
  readonly groupKey: string;
  readonly slot: number; // décalage pour répartir les mises à jour à cadence réduite
  private rand: () => number;

  constructor(kind: CreatureKind, x: number, z: number, groupKey: string, seed: number) {
    this.kind = kind;
    this.def = CREATURE_DEFS[kind];
    this.model = kind === 'skarel' ? createSkarelModel() : kind === 'tormaq' ? createTormaqModel() : createVexilModel();
    this.pos.set(x, groundHeight(x, z), z);
    this.home.copy(this.pos);
    this.groupKey = groupKey;
    this.slot = seed & 3;
    this.stamina = this.def.staminaMax;
    let s = seed >>> 0 || 1;
    this.rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.yaw = this.rand() * Math.PI * 2;
    this.modeTimer = 1 + this.rand() * 4;
  }

  get saddle(): Object3D {
    return this.model.saddle;
  }

  get ridden(): boolean {
    return this.mode === 'ridden';
  }

  /** Cri de la bête (anim + événement sonore côté manager). */
  shout(): void {
    this.callAnim = 1;
  }

  // -------------------------------------------------------------------------------------------
  // Déplacement au sol : virage limité, pente et eau bloquantes, troncs contournés.
  private moveGround(h: number, dirX: number, dirZ: number, targetSpeed: number, jump: boolean): void {
    const d = this.def;
    const want = Math.hypot(dirX, dirZ);
    if (want > 0.05) {
      const targetYaw = Math.atan2(-dirX, -dirZ);
      let dy = targetYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const maxTurn = d.turnRate * h * (this.kind === 'tormaq' && this.speed > 6 ? 0.6 : 1);
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    }
    const accel = this.kind === 'tormaq' ? 2.2 : this.kind === 'vexil' ? 9 : 3;
    const tgt = targetSpeed * Math.min(1, want);
    this.speed += Math.sign(tgt - this.speed) * Math.min(Math.abs(tgt - this.speed), accel * h);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let nx = this.pos.x + fx * this.speed * h;
    let nz = this.pos.z + fz * this.speed * h;
    const gNew = groundHeight(nx, nz, tmpN);
    const gHere = groundHeight(this.pos.x, this.pos.z);
    // Saut (Vexil)
    if (jump && this.grounded && d.jump > 0) {
      this.vel.y = d.jump;
      this.grounded = false;
    }
    if (this.grounded) {
      const steep = tmpN.y < d.slopeCos && gNew > gHere + 0.05;
      const deep = WATER_LEVEL - gNew > d.wade && edgeDistance(nx, nz) < 3600;
      if (steep || deep) {
        nx = this.pos.x;
        nz = this.pos.z;
        this.speed *= 0.5;
      }
    }
    // Troncs et rochers : contournement par poussée latérale.
    collidersNear(nx, nz, d.radius, 1, this.cyl);
    for (const c of this.cyl) {
      if (c.y1 < this.pos.y + 0.6 || c.y0 > this.pos.y + 2.5) continue;
      const dx = nx - c.x;
      const dz = nz - c.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      const min = c.r + d.radius;
      if (dist < min) {
        nx = c.x + (dx / dist) * min;
        nz = c.z + (dz / dist) * min;
      }
    }
    if (edgeDistance(nx, nz) > 3600) {
      nx = this.pos.x;
      nz = this.pos.z;
    }
    this.vel.x = (nx - this.pos.x) / h;
    this.vel.z = (nz - this.pos.z) / h;
    this.pos.x = nx;
    this.pos.z = nz;
    const g = groundHeight(nx, nz);
    if (this.grounded) {
      this.pos.y = g;
      this.vel.y = 0;
    } else {
      this.vel.y -= GRAVITY * h;
      this.pos.y += this.vel.y * h;
      if (this.pos.y <= g) {
        this.pos.y = g;
        this.vel.y = 0;
        this.grounded = true;
      }
    }
    // Le Tormaq nage lentement si l'eau est plus profonde que ses pattes (cas rare).
    const depth = WATER_LEVEL - g;
    if (depth > d.wade && this.grounded) this.pos.y = Math.max(g, WATER_LEVEL - d.wade);
  }

  // -------------------------------------------------------------------------------------------
  // Vol du Skarel : modèle d'énergie (piqué → vitesse, cabré → perte de vitesse, décrochage < 11 m/s).
  private moveFlight(h: number, yawTarget: number, pitchTarget: number, flap: boolean, dive: boolean, brake: boolean, thermal: number): void {
    this.flapTimer += h;
    if (this.flapTimer > 8 && this.flapCharges < 3) {
      this.flapCharges++;
      this.flapTimer = 0;
    }
    if (thermal > 0) {
      this.stamina = Math.min(100, this.stamina + 10 * h);
      if (this.flapCharges < 3 && this.flapTimer > 2) {
        this.flapCharges++;
        this.flapTimer = 0;
      }
    } else this.stamina = Math.max(0, this.stamina - 0.8 * h);
    // Cap
    let dy = yawTarget - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turn = Math.max(-1.25, Math.min(1.25, dy * 2.2));
    this.yaw += turn * h;
    this.bank += (turn * 0.55 - this.bank) * Math.min(1, h * 4);
    // Tangage
    const pT = Math.max(-1.0, Math.min(0.6, pitchTarget - (dive ? 0.35 : 0)));
    this.pitch += (pT - this.pitch) * Math.min(1, h * 2.5);
    // Énergie : g·sin(θ) et traînée quadratique
    const cd = dive ? 0.0013 : brake ? 0.008 : 0.00265;
    this.airSpeed += (-GRAVITY * Math.sin(this.pitch) - cd * this.airSpeed * this.airSpeed) * h;
    if (flap && this.flapCharges > 0 && this.stamina > 3) {
      this.flapCharges--;
      this.flapTimer = 0;
      this.stamina -= 6;
      this.vel.y = Math.max(this.vel.y, 0) + 6;
      this.airSpeed = Math.max(this.airSpeed, 14);
      this.flapAnim = 1;
    }
    this.airSpeed = Math.max(4, Math.min(45, this.airSpeed));
    this.dive += ((dive ? 1 : 0) - this.dive) * Math.min(1, h * 3);
    // Vitesse : le long du cap, plus portance (amortit la composante verticale libre) et décrochage.
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fz = -Math.cos(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const stall = this.airSpeed < 11 ? (11 - this.airSpeed) * 1.4 : 0;
    this.vel.y += (-this.vel.y * 1.8 - stall) * h;
    if (stall > 0) this.pitch -= stall * 0.04 * h;
    this.vel.y += thermal * 1.5 * h;
    this.vel.x = fx * this.airSpeed;
    this.vel.z = fz * this.airSpeed;
    // Dérive due au vent (le vol plané est porté par la masse d'air).
    const wv = WIND.velocityAt(this.pos.y - groundHeight(this.pos.x, this.pos.z));
    this.pos.x += (this.vel.x + wv.x * 0.6) * h;
    this.pos.z += (this.vel.z + wv.z * 0.6) * h;
    this.pos.y += (fy * this.airSpeed + this.vel.y) * h;
    this.speed = this.airSpeed;
    // Bord du monde : on fait demi-tour.
    const e = edgeDistance(this.pos.x, this.pos.z);
    if (e > 3700) {
      this.pos.x *= 3700 / e;
      this.pos.z *= 3700 / e;
      this.yaw += Math.PI * h;
    }
    if (this.pos.y > 900) this.pos.y = 900;
    // Contact avec le sol : atterrissage (lent) ou glissade brutale (rapide).
    const g = groundHeight(this.pos.x, this.pos.z, tmpN);
    if (this.pos.y <= g + 0.2) {
      this.pos.y = g;
      if (this.airSpeed < 20 || tmpN.y > 0.8) this.land();
      else {
        this.airSpeed *= 0.6;
        this.pitch = Math.max(this.pitch, 0.2);
        this.pos.y = g + 0.6;
      }
    }
  }

  takeOff(boost = 1): void {
    if (this.kind !== 'skarel' || this.flying) return;
    this.flying = true;
    this.grounded = false;
    this.airSpeed = Math.max(12, this.speed + 10) * boost;
    this.pitch = 0.15;
    this.vel.y = 6;
    this.flapAnim = 1;
    if (this.flapCharges > 0) this.flapCharges--;
  }

  land(): void {
    this.flying = false;
    this.grounded = true;
    this.pitch = 0;
    this.bank = 0;
    this.speed = Math.min(this.airSpeed, 3);
    this.airSpeed = 0;
    this.vel.set(0, 0, 0);
  }

  /** Hauteur au-dessus du sol. */
  get altitude(): number {
    return this.pos.y - groundHeight(this.pos.x, this.pos.z);
  }

  /** Colonne thermique (au-dessus des veines d'orvène de la Faille d'Ambre). */
  static thermalAt(x: number, z: number, y: number): number {
    if (x < 1700) return 0;
    const cell = Math.floor(z / 220);
    const cx = 1900 + hash2(cell, 7, 3) * 900;
    const cz = cell * 220 + 110;
    const d = Math.hypot(x - cx, z - cz);
    const alt = y - groundHeight(x, z);
    return d < 45 && alt < 400 ? 1 - d / 45 : 0;
  }

  // -------------------------------------------------------------------------------------------
  /** Monte : commande par le cavalier. */
  updateRidden(h: number, i: RideInput): void {
    const d = this.def;
    if (this.kind === 'skarel') {
      if (this.flying) {
        const thermal = Creature.thermalAt(this.pos.x, this.pos.z, this.pos.y);
        // Le cap suit la caméra ; Z/S et la caméra règlent le tangage.
        const pitchT = -i.camPitch * 0.9 + 0.1 + (i.fwd < 0 ? 0.3 : i.fwd > 0 ? -0.2 : 0);
        this.moveFlight(h, i.camYaw - i.right * 0.6, pitchT, i.jumpPressed, i.sprint, i.crouch, thermal);
      } else {
        this.moveGround(h, i.moveX, i.moveZ, i.sprint ? d.sprint : d.trot, false);
        if (i.jumpPressed && (this.flapCharges > 0 || this.dropAhead() > 15)) this.takeOff();
        this.stamina = Math.min(100, this.stamina + 12 * h);
      }
      return;
    }
    let speed = i.crouch ? d.walk * (this.kind === 'vexil' ? 0.6 : 1) : d.trot;
    if (i.sprint && this.stamina > 1) {
      speed = d.sprint;
      this.stamina = Math.max(0, this.stamina - (this.kind === 'tormaq' ? d.sprintCost : 100 / 10) * h * (this.speed > d.trot * 0.8 ? 1 : 0.3));
    } else this.stamina = Math.min(d.staminaMax, this.stamina + (this.kind === 'vexil' ? 100 / 6 : 8) * h);
    this.moveGround(h, i.moveX, i.moveZ, speed, i.jumpPressed);
  }

  /** Dénivelé devant le Skarel (décollage en se laissant tomber d'une falaise). */
  dropAhead(): number {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    return this.pos.y - groundHeight(this.pos.x + fx * 12, this.pos.z + fz * 12);
  }

  // -------------------------------------------------------------------------------------------
  /** Comportement autonome (sauvage ou apprivoisé, non monté). */
  updateAI(h: number, player: Vector3, playerCrouched: boolean, scary: boolean, now: number): void {
    const d = this.def;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.modeTimer -= h;
    this.stamina = Math.min(d.staminaMax, this.stamina + 10 * h);

    if (!this.tamed) {
      // Peur : joueur debout trop près (avant l'offrande), engins, ou bête en délai de méfiance.
      const tolerant = this.phase !== 'aucune' && this.phase !== 'offrande';
      const threat = scary ? dist < 40 : !tolerant && !playerCrouched && dist < d.fleeDist;
      if ((threat || now < this.cooldownUntil && dist < 30) && this.mode !== 'flee' && this.mode !== 'circle') {
        this.startFlee();
      }
    }

    if (this.flying) {
      // Skarel en vol autonome : cercle au-dessus de son perchoir (sauvage) ou rejoint le joueur (apprivoisé), puis se pose.
      const anchor = this.tamed ? player : this.home;
      const ang = Math.atan2(this.pos.x - anchor.x, this.pos.z - anchor.z) + 0.6;
      this.target.set(anchor.x + Math.sin(ang) * 60, anchor.y + 35, anchor.z + Math.cos(ang) * 60);
      const tx = this.target.x - this.pos.x;
      const tz = this.target.z - this.pos.z;
      const yawT = Math.atan2(-tx, -tz);
      const wantLand = this.tamed ? dist < 90 : this.modeTimer <= 0;
      const pitchT = wantLand ? -0.35 : Math.max(-0.4, Math.min(0.3, (this.target.y - this.pos.y) * 0.02));
      if (wantLand) {
        const hx = anchor.x - this.pos.x;
        const hz = anchor.z - this.pos.z;
        this.moveFlight(h, Math.atan2(-hx, -hz), pitchT, false, false, Math.hypot(hx, hz) < 40, 0);
      } else this.moveFlight(h, yawT, pitchT, this.pos.y < anchor.y + 15 && this.flapCharges > 0, false, false, 0);
      if (!this.flying) {
        this.mode = this.tamed ? 'wait' : 'idle';
        this.modeTimer = this.tamed ? 1e9 : 4;
      }
      return;
    }

    let dirX = 0;
    let dirZ = 0;
    let speed = 0;
    switch (this.mode) {
      case 'flee': {
        if (this.kind === 'skarel') {
          this.takeOff();
          this.mode = 'circle';
          this.modeTimer = 12 + this.rand() * 8;
          return;
        }
        const zig = this.kind === 'vexil' ? Math.sin(now * 3 + this.home.x) * 0.6 : 0;
        dirX = -dx / (dist || 1);
        dirZ = -dz / (dist || 1);
        const c = Math.cos(zig);
        const s = Math.sin(zig);
        [dirX, dirZ] = [dirX * c - dirZ * s, dirX * s + dirZ * c];
        speed = this.kind === 'vexil' ? 14 : d.trot;
        if (this.modeTimer <= 0) this.setMode('idle', 3);
        break;
      }
      case 'wander':
      case 'graze': {
        const tx = this.target.x - this.pos.x;
        const tz = this.target.z - this.pos.z;
        const td = Math.hypot(tx, tz);
        if (td < 2 || this.modeTimer <= 0) this.setMode(this.rand() < 0.5 ? 'idle' : 'graze', 3 + this.rand() * 5);
        else {
          dirX = tx / td;
          dirZ = tz / td;
          speed = this.mode === 'graze' ? d.walk * 0.6 : d.walk;
        }
        break;
      }
      case 'alert': {
        // Regarde le joueur, immobile.
        const yawT = Math.atan2(dx, dz);
        let dy = yawT - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += Math.max(-d.turnRate * h, Math.min(d.turnRate * h, dy));
        if (this.modeTimer <= 0) this.setMode('idle', 2);
        break;
      }
      case 'follow': {
        if (dist > 7) {
          dirX = dx / dist;
          dirZ = dz / dist;
          speed = dist > 40 ? (this.kind === 'skarel' ? d.sprint : d.sprint * 0.8) : dist > 15 ? d.trot : d.walk;
        } else this.setMode('wait', 1e9);
        if (this.kind === 'skarel' && dist > 60 && !this.flying) this.takeOff();
        break;
      }
      case 'wait':
        if (dist > 30 && this.tamed) this.setMode('follow', 1e9);
        break;
      default: {
        if (this.modeTimer <= 0) {
          if (this.tamed) this.setMode('wait', 1e9);
          else {
            const a = this.rand() * Math.PI * 2;
            const r = 6 + this.rand() * 30;
            this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
            this.setMode('wander', 10);
          }
        }
        // Bête curieuse : un joueur accroupi tout près la rend attentive.
        if (!this.tamed && playerCrouched && dist < 10 && this.phase === 'aucune') this.setMode('alert', 2);
      }
    }
    // Pendant l'apprivoisement, la bête reste près du joueur.
    if (this.phase !== 'aucune' && !this.tamed) {
      if (dist > 5) {
        dirX = dx / dist;
        dirZ = dz / dist;
        speed = d.walk * 0.7;
      } else {
        speed = 0;
        const yawT = Math.atan2(dx, dz);
        let dy = yawT - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += Math.max(-d.turnRate * h, Math.min(d.turnRate * h, dy));
      }
    }
    this.moveGround(h, dirX, dirZ, speed, false);
  }

  private setMode(m: Mode, t: number): void {
    this.mode = m;
    this.modeTimer = t;
  }

  startFlee(): void {
    this.setMode('flee', 6 + this.rand() * 3);
    this.phase = 'aucune';
    this.trust = 0;
    this.callRound = 0;
    this.fails = 0;
    this.callAt = -1;
  }

  /** Après l'apprivoisement : la bête suit le joueur. */
  follow(): void {
    this.setMode('follow', 1e9);
  }

  stopRiding(): void {
    this.setMode('wait', 1e9);
  }

  startRiding(): void {
    this.mode = 'ridden';
  }

  /** Mise à jour visuelle. */
  sync(dt: number, time: number, night: number): void {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.set(this.flying ? this.pitch : 0, this.yaw, this.flying ? -this.bank : 0, 'YXZ');
    const a = this.anim;
    this.flapAnim = Math.max(0, this.flapAnim - dt * 1.6);
    this.callAnim = Math.max(0, this.callAnim - dt * 1.5);
    a.time = time;
    a.speed = this.flying ? this.airSpeed : Math.abs(this.speed);
    const s = Math.abs(this.speed);
    a.gait = this.flying ? 0 : s < 0.2 ? 0 : s <= this.def.walk + 0.5 ? 1 : s <= this.def.trot + 0.5 ? 2 : 3;
    a.grounded = this.grounded;
    a.crouch += ((this.mode === 'ridden' ? 0 : this.mode === 'idle' && this.kind === 'tormaq' && this.modeTimer > 2 ? 0.6 : 0) - a.crouch) * Math.min(1, dt * 2);
    a.night = night;
    a.call = this.callAnim;
    a.flying += ((this.flying ? 1 : 0) - a.flying) * Math.min(1, dt * 3);
    a.flap = this.flapAnim;
    a.bank = this.bank;
    a.dive = this.dive;
    a.boost = Math.max(0, Math.min(1, (this.airSpeed - 25) / 15));
    this.model.update(dt, a);
  }

  /** Accroupissement du Vexil monté (Ctrl) : posture couchée. */
  setCrouchPose(on: boolean): void {
    if (on && !this.flying) this.anim.crouch = Math.max(this.anim.crouch, 0.8);
  }

  dispose(): void {
    this.model.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Gestion des hardes sauvages et des montures apprivoisées.

export interface TamingView {
  name: string;
  trust: number;
  phase: TamingPhase;
  hint: string;
  rhythm: number; // 0..1 progression vers l'instant où répondre (−1 si inactif)
  harness: number; // 0..1 maintien de E
}

export interface CreatureEvents {
  onCall?(kind: CreatureKind, pan: number, gain: number): void;
  onToast?(msg: string): void;
  onTamed?(kind: CreatureKind): void;
  onFlap?(): void;
}

const CELL = 420;

export class CreatureManager {
  readonly creatures: Creature[] = [];
  readonly tamed = new Map<CreatureKind, Creature | null>();
  private groups = new Map<string, Creature[]>();
  private fixedGroups: { key: string; kind: CreatureKind; x: number; z: number }[] = [];
  focus: Creature | null = null;
  ridden: Creature | null = null;
  private callIndex = 0;
  events: CreatureEvents = {};
  private onAdd: (c: Creature) => void;
  private onRemove: (c: Creature) => void;

  constructor(onAdd: (c: Creature) => void, onRemove: (c: Creature) => void, tamedKinds: CreatureKind[] = []) {
    this.onAdd = onAdd;
    this.onRemove = onRemove;
    for (const k of tamedKinds) this.tamed.set(k, null);
    // Hardes garanties près de Vehra-Tal, pour que chaque espèce soit trouvable rapidement.
    const lm = LANDMARKS.find((l) => l.id === 'vehra-tal')!;
    for (const kind of ['vexil', 'tormaq', 'skarel'] as CreatureKind[]) {
      const p = findHabitat(kind, lm.x, lm.z, kind === 'skarel' ? 1600 : 700);
      if (p) this.fixedGroups.push({ key: `fixe:${kind}`, kind, x: p.x, z: p.z });
    }
  }

  get habitats(): { kind: CreatureKind; x: number; z: number }[] {
    return this.fixedGroups;
  }

  update(h: number, player: Vector3, crouched: boolean, sylmar: boolean, inVehicle: boolean, now: number, time: number, night: number): void {
    this.stream(player);
    this.frame++;
    for (const c of this.creatures) {
      const d = c === this.ridden ? 0 : c.pos.distanceTo(player);
      // Au-delà de 320 m : invisible ; au-delà de 200 m : IA et animation à cadence réduite.
      c.model.root.visible = d < 320 || c.tamed;
      const slow = d > 200 && !c.tamed;
      if (slow && (this.frame + c.slot) % 4 !== 0) continue;
      const hh = slow ? h * 4 : h;
      if (c !== this.ridden) c.updateAI(hh, player, crouched, !sylmar || inVehicle, now);
      if (c.model.root.visible) c.sync(hh, time, night);
    }
  }

  private frame = 0;

  /** Apparition / disparition des hardes autour du joueur. */
  private stream(p: Vector3): void {
    const wanted = new Set<string>();
    const r = 520;
    for (let cz = Math.floor((p.z - r) / CELL); cz <= Math.floor((p.z + r) / CELL); cz++) {
      for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++) {
        const key = `${cx}:${cz}`;
        const cxm = (cx + 0.5) * CELL;
        const czm = (cz + 0.5) * CELL;
        if (Math.hypot(cxm - p.x, czm - p.z) > r) continue;
        if (hash2(cx, cz, 911) > 0.55) continue;
        wanted.add(key);
        if (!this.groups.has(key)) this.spawnCellGroup(key, cx, cz);
      }
    }
    for (const g of this.fixedGroups) {
      if (Math.hypot(g.x - p.x, g.z - p.z) < 450) {
        wanted.add(g.key);
        if (!this.groups.has(g.key)) this.spawnGroup(g.key, g.kind, g.x, g.z, hash2(g.x | 0, g.z | 0, 5));
      }
    }
    for (const [key, list] of this.groups) {
      if (wanted.has(key)) continue;
      const far = list.every((c) => c.pos.distanceTo(p) > 600);
      if (!far) continue;
      for (const c of list) this.removeCreature(c);
      this.groups.delete(key);
    }
  }

  private spawnCellGroup(key: string, cx: number, cz: number): void {
    for (let k = 0; k < 6; k++) {
      const x = (cx + hash2(cx, cz, 100 + k)) * CELL;
      const z = (cz + hash2(cx, cz, 200 + k)) * CELL;
      const order: CreatureKind[] = ['tormaq', 'vexil', 'skarel'];
      const start = Math.floor(hash2(cx, cz, 300) * 3);
      for (let j = 0; j < 3; j++) {
        const kind = order[(start + j) % 3];
        if (habitatOk(kind, x, z)) {
          this.spawnGroup(key, kind, x, z, hash2(cx, cz, 400 + k));
          return;
        }
      }
    }
    this.groups.set(key, []);
  }

  private spawnGroup(key: string, kind: CreatureKind, x: number, z: number, seed: number): void {
    const n = kind === 'tormaq' ? 3 + Math.floor(seed * 3) : 2 + Math.floor(seed * 3);
    const list: Creature[] = [];
    for (let i = 0; i < n; i++) {
      if (this.tamed.get(kind) && i === 0) continue;
      const a = (i / n) * Math.PI * 2 + seed * 6;
      const r = 4 + i * 3;
      const c = new Creature(kind, x + Math.cos(a) * r, z + Math.sin(a) * r, key, Math.floor(seed * 1e6) + i * 7919);
      c.home.set(x, groundHeight(x, z), z);
      list.push(c);
      this.addCreature(c);
    }
    this.groups.set(key, list);
  }

  private addCreature(c: Creature): void {
    this.creatures.push(c);
    this.onAdd(c);
  }

  private removeCreature(c: Creature): void {
    if (c === this.ridden || c.tamed) return;
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
    if (this.focus === c) this.focus = null;
    this.onRemove(c);
    c.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // Apprivoisement

  /** Met à jour la cible d'apprivoisement. Retourne l'état à afficher (ou null). */
  updateTaming(
    h: number,
    player: Vector3,
    crouched: boolean,
    sylmar: boolean,
    duskOrNight: boolean,
    keys: { interactPressed: boolean; interactHeld: boolean; abilityPressed: boolean },
    now: number,
  ): { view: TamingView | null; consumedAbility: boolean; consumedInteract: boolean } {
    let consumedAbility = false;
    let consumedInteract = false;
    // Cible : bête déjà en cours d'apprivoisement, sinon la plus proche à moins de 9 m.
    if (this.focus && (this.focus.tamed || this.focus.phase === 'aucune' || this.focus.pos.distanceTo(player) > 14 || !this.creatures.includes(this.focus))) this.focus = null;
    if (!this.focus) {
      let best: Creature | null = null;
      let bd = 9;
      for (const c of this.creatures) {
        if (c.tamed || c.flying || c.mode === 'flee') continue;
        const d = c.pos.distanceTo(player);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      this.focus = best;
    }
    const c = this.focus;
    if (!c) return { view: null, consumedAbility, consumedInteract };
    const def = c.def;
    const dist = c.pos.distanceTo(player);
    if (!sylmar) {
      return {
        view: { name: def.name, trust: 0, phase: 'aucune', hint: 'Seuls les Sylmar savent gagner la confiance des bêtes.', rhythm: -1, harness: 0 },
        consumedAbility,
        consumedInteract,
      };
    }
    if (this.tamed.get(c.kind)) {
      return {
        view: { name: def.name, trust: 0, phase: 'aucune', hint: `Vous avez déjà un ${def.name} : appelez-le avec R.`, rhythm: -1, harness: 0 },
        consumedAbility,
        consumedInteract,
      };
    }
    let hint = '';
    let rhythm = -1;
    if (now < c.cooldownUntil) hint = `Le ${def.name} se méfie encore (${Math.ceil(c.cooldownUntil - now)} s).`;
    else if (c.phase === 'aucune') {
      if (c.kind === 'skarel' && !duskOrNight) hint = 'Les Skarels ne se laissent approcher qu’au crépuscule ou la nuit.';
      else if (!crouched) hint = 'Approchez accroupi (C) pour ne pas l’effrayer.';
      else if (dist > 6) hint = `Approchez encore (${dist.toFixed(0)} m)…`;
      else {
        hint = `E : déposer ${def.offering}`;
        if (keys.interactPressed) {
          consumedInteract = true;
          c.trust = 40;
          c.phase = 'appel';
          c.callRound = 0;
          c.fails = 0;
          c.callAt = now + 1.5;
          c.answered = false;
          c.shouted = false;
          this.events.onToast?.(`Le ${def.name} accepte l’offrande. Écoutez son appel, puis répondez en rythme (F).`);
        }
      }
    } else if (c.phase === 'appel') {
      consumedAbility = keys.abilityPressed;
      // La bête crie à callAt ; le joueur doit répondre à callAt + tempo (± 0,25 s).
      const expected = c.callAt + def.tempo;
      if (now >= c.callAt && c.callAt > 0 && !c.shouted) {
        c.shouted = true;
        c.shout();
        this.events.onCall?.(c.kind, 0, 1);
      }
      if (now >= c.callAt && c.callAt > 0) {
        rhythm = Math.min(1, (now - c.callAt) / def.tempo);
        hint = `Appel ${c.callRound + 1}/3 — répondez avec F au même tempo`;
      } else hint = 'Écoutez…';
      let resolved: 'ok' | 'raté' | null = null;
      if (keys.abilityPressed && !c.answered && c.callAt > 0 && now > c.callAt) {
        resolved = Math.abs(now - expected) <= 0.25 ? 'ok' : 'raté';
      } else if (!c.answered && c.callAt > 0 && now > expected + 0.45) resolved = 'raté';
      if (resolved) {
        c.answered = true;
        if (resolved === 'ok') {
          c.trust = Math.min(100, c.trust + 20);
          this.events.onToast?.('Juste ! La bête vous répond.');
        } else {
          c.trust = Math.max(0, c.trust - 20);
          c.fails++;
          this.events.onToast?.('Contretemps…');
        }
        c.callRound++;
        if (c.fails >= 2) {
          c.cooldownUntil = now + 120;
          c.startFlee();
          this.events.onToast?.(`Le ${def.name} s’enfuit. Il reviendra dans deux minutes.`);
          this.focus = null;
        } else if (c.trust >= 100) {
          c.phase = 'harnais';
          c.harnessHold = 0;
          this.events.onToast?.('Confiance acquise. Maintenez E pour poser le harnais tressé.');
        } else {
          c.callAt = now + 1.4;
          c.answered = false;
          c.shouted = false;
        }
      }
    } else if (c.phase === 'harnais') {
      hint = 'Maintenez E pour poser le harnais tressé';
      if (keys.interactHeld && dist < 6) {
        consumedInteract = true;
        c.harnessHold += h;
        if (c.harnessHold >= 2) {
          c.tamed = true;
          c.phase = 'aucune';
          c.follow();
          this.detachFromGroup(c);
          this.tamed.set(c.kind, c);
          this.focus = null;
          this.events.onTamed?.(c.kind);
          return { view: null, consumedAbility, consumedInteract: true };
        }
      } else c.harnessHold = Math.max(0, c.harnessHold - h * 2);
    }
    return {
      view: { name: def.name, trust: c.trust, phase: c.phase, hint, rhythm, harness: c.harnessHold / 2 },
      consumedAbility,
      consumedInteract,
    };
  }

  private detachFromGroup(c: Creature): void {
    const list = this.groups.get(c.groupKey);
    if (list) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Montures apprivoisées

  /** Appelle la monture suivante (R). */
  callNext(player: Vector3, yaw: number): string {
    const kinds = [...this.tamed.keys()];
    if (!kinds.length) return 'Aucune monture apprivoisée. Gagnez la confiance d’une bête sauvage (accroupi, E puis F).';
    const kind = kinds[this.callIndex % kinds.length];
    this.callIndex++;
    let c = this.tamed.get(kind) ?? null;
    if (!c) {
      // La monture rejoint le joueur depuis l'arrière (hors champ).
      const x = player.x + Math.sin(yaw) * 70;
      const z = player.z + Math.cos(yaw) * 70;
      c = new Creature(kind, x, z, 'apprivoisé', 12345);
      c.tamed = true;
      this.tamed.set(kind, c);
      this.addCreature(c);
      if (kind === 'skarel') {
        c.pos.y += 25;
        c.takeOff();
      }
    }
    if (c === this.ridden) return `Vous êtes déjà sur votre ${c.def.name}.`;
    c.follow();
    c.shout();
    this.events.onCall?.(kind, 0, 0.7);
    return `Appel en trois temps : votre ${c.def.name} arrive.`;
  }

  /** Monture apprivoisée à portée de monte. */
  mountable(player: Vector3): Creature | null {
    for (const c of this.tamed.values()) {
      if (c && c !== this.ridden && !c.flying && c.pos.distanceTo(player) < c.def.radius + 3) return c;
    }
    return null;
  }

  mount(c: Creature): void {
    this.ridden = c;
    c.startRiding();
  }

  dismount(): Creature | null {
    const c = this.ridden;
    if (!c) return null;
    c.stopRiding();
    this.ridden = null;
    return c;
  }

  /** Bêtes sauvages proches (boussole). */
  herdsNear(p: Vector3, r: number): { name: string; x: number; z: number; dist: number }[] {
    const out: { name: string; x: number; z: number; dist: number }[] = [];
    for (const [key, list] of this.groups) {
      const wild = list.filter((c) => !c.tamed);
      if (!wild.length) continue;
      const c = wild[0];
      const d = c.pos.distanceTo(p);
      if (d < r && d > 25) out.push({ name: c.def.plural, x: c.pos.x, z: c.pos.z, dist: d });
      void key;
    }
    return out;
  }

  dispose(): void {
    for (const c of [...this.creatures]) {
      const i = this.creatures.indexOf(c);
      this.creatures.splice(i, 1);
      this.onRemove(c);
      c.dispose();
    }
    this.groups.clear();
    this.ridden = null;
    this.focus = null;
  }
}

/** Le lieu convient-il à l'espèce ? */
export function habitatOk(kind: CreatureKind, x: number, z: number): boolean {
  if (edgeDistance(x, z) > 3300) return false;
  const s = sampleWorld(x, z, sample);
  const g = groundHeight(x, z, tmpN);
  if (g < WATER_LEVEL + 0.4 || tmpN.y < 0.9 || s.pad > 0.1) return false;
  switch (kind) {
    case 'skarel':
      return s.mesa > 0.85 && g > 120;
    case 'tormaq':
      return (s.bank > 0.25 || s.south > 0.6) && g < 25 && s.mesa < 0.2;
    case 'vexil': {
      const f = forestDensity(x, z, s);
      return f > 0.15 && f < 0.75 && s.mesa < 0.2 && s.east < 0.5 && s.bank < 0.2;
    }
  }
}

/** Recherche en spirale du plus proche habitat d'une espèce. */
export function findHabitat(kind: CreatureKind, x: number, z: number, radius: number): { x: number; z: number } | null {
  for (let r = 60; r <= radius; r += 30) {
    const n = Math.max(6, Math.floor((2 * Math.PI * r) / 40));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r * 0.01;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (habitatOk(kind, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
