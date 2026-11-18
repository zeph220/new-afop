// Véhicules du Consortium Halden (docs/DESIGN.md §6) : physique Rapier, énergie, dégâts, dépôt,
// livraison par drone. Le gyrocoptère, le chenillé et l'hydroglisseur sont des corps dynamiques ;
// le marcheur est cinématique (ses pieds suivent la heightmap).

import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import type * as RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics.ts';
import { createCrawlerModel, createGyroModel, createHydroModel, createWalkerModel } from './models/vehicles.ts';
import { idleVehicleAnim, type VehicleAnim, type VehicleKind, type VehicleModel } from './types.ts';
import { canyonCenterX, edgeDistance, groundHeight, LANDMARKS, WATER_EDGE, WATER_LEVEL } from '../world/WorldGen.ts';
import { collidersNear, type Cylinder } from '../world/VegetationPlacement.ts';
import { GRAVITY } from '../player/PlayerController.ts';
import { WIND } from '../world/Wind.ts';

const _v3 = new Vector3();

export interface DriveInput {
  fwd: number; // -1..1 (Z/S)
  right: number; // -1..1 (Q/D)
  up: boolean; // Espace maintenu
  upPressed: boolean; // Espace appuyé
  down: boolean; // Ctrl maintenu
  boost: boolean; // Maj
  action: boolean; // F maintenu (foreuse)
  engineToggle: boolean; // V
}

export interface VehicleDef {
  name: string;
  short: string;
  maxHp: number;
  shock: number; // seuil de choc (m/s)
  drain: number; // % d'énergie par seconde à plein régime
  cameraDistance: number;
  cameraHeight: number;
}

export const VEHICLE_DEFS: Record<VehicleKind, VehicleDef> = {
  gyro: { name: 'Gyrocoptère « Rotor »', short: 'Gyrocoptère', maxHp: 100, shock: 6, drain: 100 / 360, cameraDistance: 13, cameraHeight: 2.5 },
  marcheur: { name: 'Marcheur de transport', short: 'Marcheur', maxHp: 250, shock: 4, drain: 100 / 720, cameraDistance: 15, cameraHeight: 4 },
  chenille: { name: "Chenillé d'extraction", short: 'Chenillé', maxHp: 400, shock: 3, drain: 100 / 900, cameraDistance: 17, cameraHeight: 4 },
  hydro: { name: 'Hydroglisseur', short: 'Hydroglisseur', maxHp: 120, shock: 7, drain: 100 / 540, cameraDistance: 10, cameraHeight: 2.5 },
};

export const VEHICLE_ORDER: VehicleKind[] = ['gyro', 'marcheur', 'chenille', 'hydro'];

export interface VehicleEvents {
  onDamage?(v: Vehicle, amount: number): void;
  onDisabled?(v: Vehicle): void;
  onOre?(v: Vehicle): void;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const DEPOT_RADIUS = 75;

/** Lacet (rotation autour de Y) d'un quaternion. */
function yawOf(q: Quaternion): number {
  _e.setFromQuaternion(q, 'YXZ');
  return _e.y;
}

function waterAt(x: number, z: number): boolean {
  return groundHeight(x, z) < WATER_LEVEL - 0.1 && edgeDistance(x, z) < WATER_EDGE;
}

export abstract class Vehicle {
  readonly kind: VehicleKind;
  readonly def: VehicleDef;
  readonly model: VehicleModel;
  readonly anim: VehicleAnim = idleVehicleAnim();
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  energy = 100;
  hp: number;
  occupied = false;
  lights = false;
  engineOn = false;
  disabledTimer = 0; // > 0 : hors service, rapatriement en cours
  awake = true;
  events: VehicleEvents = {};
  protected physics: Physics;
  protected body!: RAPIER_NS.RigidBody;
  protected collider!: RAPIER_NS.Collider;
  private prevVel = new Vector3();
  private impactCooldown = 0;
  protected input: DriveInput | null = null;

  constructor(kind: VehicleKind, physics: Physics, model: VehicleModel) {
    this.kind = kind;
    this.def = VEHICLE_DEFS[kind];
    this.physics = physics;
    this.model = model;
    this.hp = this.def.maxHp;
  }

  get name(): string {
    return this.def.name;
  }

  get seat(): Object3D {
    return this.model.seat;
  }

  /** Facteur de puissance selon l'énergie : réserve à 40 % sous 5 %, rien à 0. */
  get powerFactor(): number {
    if (this.disabledTimer > 0 || this.energy <= 0) return 0;
    let p = this.energy < 5 ? 0.4 : 1;
    if (this.hp < this.def.maxHp * 0.5) p *= 0.75;
    return p;
  }

  /** Vitesse signée le long de l'avant (-Z local). */
  get forwardSpeed(): number {
    _v.set(0, 0, -1).applyQuaternion(this.quaternion);
    return this.velocity.dot(_v);
  }

  get damageRatio(): number {
    return 1 - this.hp / this.def.maxHp;
  }

  /** Rayon d'interaction (monter à bord). */
  get reach(): number {
    const h = this.model.halfExtents;
    return Math.max(h.x, h.z) + 3;
  }

  protected createBody(desc: RAPIER_NS.RigidBodyDesc, mass: number, friction = 0.6): void {
    const R = this.physics.R;
    const h = this.model.halfExtents;
    this.body = this.physics.world.createRigidBody(desc.setCanSleep(true).setCcdEnabled(true));
    const vol = 8 * h.x * h.y * h.z;
    this.collider = this.physics.world.createCollider(R.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(mass / vol).setFriction(friction), this.body);
  }

  /** Place le véhicule (au repos) à une position donnée. */
  placeAt(x: number, y: number, z: number, yaw: number): void {
    _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ'));
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    if (this.body.isDynamic()) {
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.readPose();
    this.prevVel.set(0, 0, 0);
    this.impactCooldown = 0.5;
  }

  protected readPose(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    if (this.body.isDynamic()) {
      const v = this.body.linvel();
      if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) this.velocity.set(v.x, v.y, v.z);
      else {
        // Filet de sécurité : vitesses invalides remises à zéro plutôt que de figer le véhicule.
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.velocity.set(0, 0, 0);
      }
    }
  }

  /** Active la simulation uniquement si le sol est chargé et le véhicule proche du joueur. */
  setAwake(on: boolean): void {
    if (on === this.awake) return;
    this.awake = on;
    this.body.setEnabled(on);
  }

  /** Appelé avant chaque pas physique. */
  step(h: number, input: DriveInput | null): void {
    this.input = input;
    if (input?.engineToggle && this.disabledTimer <= 0) this.engineOn = !this.engineOn;
    if (!this.occupied) this.engineOn = false;
    if (this.engineOn && this.occupied) this.energy = Math.max(0, this.energy - this.def.drain * h * (0.35 + 0.65 * this.load()));
    this.control(h);
  }

  /** Charge moteur 0..1 (pour la consommation). */
  protected load(): number {
    const i = this.input;
    if (!i) return 0;
    return Math.min(1, Math.abs(i.fwd) + Math.abs(i.right) * 0.5 + (i.up ? 0.6 : 0) + (i.boost ? 0.3 : 0));
  }

  protected abstract control(h: number): void;

  /** Appelé après chaque pas : lecture de la pose et dégâts de choc. */
  afterStep(h: number): void {
    this.readPose();
    this.impactCooldown = Math.max(0, this.impactCooldown - h);
    const dv = _v2.copy(this.velocity).sub(this.prevVel).length();
    this.prevVel.copy(this.velocity);
    if (this.body.isDynamic() && this.impactCooldown <= 0 && dv > this.def.shock) {
      this.damage((dv - this.def.shock) * 7);
      this.impactCooldown = 0.35;
    }
  }

  damage(amount: number): void {
    if (this.disabledTimer > 0 || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.events.onDamage?.(this, amount);
    if (this.hp <= 0) {
      this.disabledTimer = 60;
      this.engineOn = false;
      this.events.onDisabled?.(this);
    }
  }

  /** Mise à jour visuelle (une fois par image). */
  sync(dt: number, time: number, night: number): void {
    this.model.root.position.copy(this.position);
    this.model.root.quaternion.copy(this.quaternion);
    const a = this.anim;
    const i = this.occupied ? this.input : null;
    a.time = time;
    a.speed = this.forwardSpeed;
    a.throttle = i ? i.fwd : 0;
    a.steer = i ? i.right : 0;
    const targetPower = this.engineOn ? Math.max(0.25, this.powerFactor * (0.55 + 0.45 * this.load())) : 0;
    a.power += (targetPower - a.power) * (1 - Math.exp(-dt * 1.2));
    a.lights = this.lights && this.disabledTimer <= 0;
    a.damage = this.damageRatio;
    a.night = night;
    this.animate(dt, a);
    this.model.update(dt, a);
  }

  protected animate(_dt: number, _a: VehicleAnim): void {}

  /** Recharge au dépôt et rapatriement. */
  tickService(dt: number, depot: Vector3, respawn: () => void): void {
    if (this.disabledTimer > 0) {
      this.disabledTimer -= dt;
      if (this.disabledTimer <= 0) {
        this.hp = this.def.maxHp;
        this.energy = Math.max(this.energy, 50);
        respawn();
      }
      return;
    }
    if (this.position.distanceTo(depot) < DEPOT_RADIUS) {
      this.energy = Math.min(100, this.energy + 8 * dt);
      if (!this.occupied) this.hp = Math.min(this.def.maxHp, this.hp + 2 * dt);
    }
  }

  /** Point de descente du pilote (à gauche du véhicule, au sol). */
  exitPoint(): Vector3 {
    const h = this.model.halfExtents;
    _v.set(-(h.x + 1.6), 0, 0).applyQuaternion(this.quaternion).add(this.position);
    const g = groundHeight(_v.x, _v.z);
    return new Vector3(_v.x, Math.max(g, this.position.y - h.y), _v.z);
  }

  /** Altitude au-dessus du sol (bas de la caisse). */
  get clearance(): number {
    return this.position.y - this.model.halfExtents.y - groundHeight(this.position.x, this.position.z);
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.model.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Gyrocoptère : portance le long de l'axe haut local, assiette pilotée, traînée quadratique.

class Gyro extends Vehicle {
  private boostTime = 5;
  constructor(physics: Physics) {
    super('gyro', physics, createGyroModel());
    this.createBody(physics.R.RigidBodyDesc.dynamic().setLinearDamping(0.05).setAngularDamping(2.5), 1100, 0.7);
  }

  protected control(h: number): void {
    const b = this.body;
    const m = b.mass();
    b.resetForces(true);
    const v = this.velocity;
    const i = this.occupied ? this.input : null;
    const power = this.engineOn ? this.powerFactor : 0;
    const up = _v.set(0, 1, 0).applyQuaternion(this.quaternion);
    // Collectif : Espace monte, Ctrl descend, sinon maintien d'altitude. Moteur coupé : autorotation (7 m/s).
    let lift = 0;
    if (i) {
      const autorot = !this.engineOn || power === 0;
      const vT = autorot ? -7 : i.up ? 6 : i.down ? -5 : 0;
      lift = m * (GRAVITY + 3 * (vT - v.y));
      const maxLift = m * GRAVITY * (autorot ? 1.0 : 1.9 * power);
      lift = Math.max(0, Math.min(maxLift, lift));
      if (this.clearance < 4 && !autorot) lift *= 1.15; // effet de sol
    }
    const upY = Math.max(0.5, up.y);
    const F = _v2.copy(up).multiplyScalar(lift / upY);
    // Traînée quadratique (vitesse max ≈ 42 m/s inclinaison max).
    // Traînée calculée par rapport à l'air : le vent pousse l'appareil.
    const air = _v3.copy(v).sub(WIND.velocityAt(this.clearance));
    const sp = air.length();
    F.addScaledVector(air, -1.73 * sp);
    b.addForce({ x: F.x, y: F.y, z: F.z }, true);
    // Assiette : tangage/roulis cibles, virage coordonné (le cyclique répond aussi en autorotation).
    if (i) {
      if (i.boost && this.boostTime > 0) this.boostTime = Math.max(0, this.boostTime - h);
      else if (!i.boost) this.boostTime = Math.min(5, this.boostTime + h * 0.5);
      const boost = i.boost && this.boostTime > 0;
      const pitchT = -i.fwd * (boost ? 0.45 : 0.33);
      const rollT = -i.right * 0.3;
      const yaw = yawOf(this.quaternion) - i.right * 1.1 * h;
      _q.setFromEuler(_e.set(pitchT, yaw, rollT, 'YXZ'));
      this.steerTo(_q, -i.right * 1.1);
    } else if (!this.occupied && this.clearance > 1) {
      // Sans pilote en vol : se remet à plat.
      _q.setFromEuler(_e.set(0, yawOf(this.quaternion), 0, 'YXZ'));
      this.steerTo(_q, 0);
    }
  }

  /** Vitesse angulaire pour rejoindre l'orientation cible en ≈ 0,3 s. */
  private steerTo(target: Quaternion, yawRate: number): void {
    const err = target.clone().multiply(this.quaternion.clone().invert());
    if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
    const angle = 2 * Math.acos(Math.min(1, err.w));
    const s = Math.sqrt(Math.max(1e-9, 1 - err.w * err.w));
    const k = angle / 0.3;
    this.body.setAngvel({ x: (err.x / s) * k, y: (err.y / s) * k + yawRate, z: (err.z / s) * k }, true);
  }

  protected animate(): void {
    this.anim.feet = null;
  }

  get boostLeft(): number {
    return this.boostTime / 5;
  }
}

// ---------------------------------------------------------------------------------------------
// Marcheur : corps cinématique, démarche en diagonale, plateforme = plan moyen des pieds.

class Walker extends Vehicle {
  private yaw = 0;
  private speed = 0;
  private feet: Vector3[] = [];
  private swing: { from: Vector3; to: Vector3; t: number }[] = [];
  private stepBoost = 0;
  private stepCooldown = 0;
  private hipDrop: number;
  private hipLocalY: number;
  private cyl: Cylinder[] = [];
  onStep?: () => void;

  constructor(physics: Physics) {
    super('marcheur', physics, createWalkerModel());
    this.createBody(physics.R.RigidBodyDesc.kinematicPositionBased(), 9000, 0.8);
    const legs = this.model.legs!;
    this.hipDrop = (legs.upper + legs.lower) * 0.78;
    this.hipLocalY = legs.hips.reduce((s, p) => s + p.y, 0) / legs.hips.length;
    for (let k = 0; k < 4; k++) {
      this.feet.push(new Vector3());
      this.swing.push({ from: new Vector3(), to: new Vector3(), t: 1 });
    }
  }

  placeAt(x: number, y: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.speed = 0;
    this.position.set(x, y, z);
    for (let k = 0; k < 4; k++) {
      this.home(k, this.feet[k]);
      this.swing[k].t = 1;
    }
    this.pose(0);
    super.placeAt(this.position.x, this.position.y, this.position.z, yaw);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
  }

  /** Position d'appui naturelle d'un pied (hanche projetée vers l'extérieur, au sol). */
  private home(k: number, out: Vector3): Vector3 {
    const hip = this.model.legs!.hips[k];
    _q.setFromEuler(_e.set(0, this.yaw, 0, 'YXZ'));
    out.set(hip.x * 1.35, 0, hip.z * 1.1).applyQuaternion(_q);
    out.x += this.position.x;
    out.z += this.position.z;
    out.y = groundHeight(out.x, out.z);
    return out;
  }

  protected control(h: number): void {
    const i = this.occupied && this.engineOn ? this.input : null;
    const power = this.powerFactor;
    this.stepBoost = Math.max(0, this.stepBoost - h);
    this.stepCooldown = Math.max(0, this.stepCooldown - h);
    if (i?.upPressed && this.stepCooldown <= 0 && power > 0) {
      this.stepBoost = 3;
      this.stepCooldown = 4;
    }
    if (i) this.yaw -= i.right * 0.436 * h * (power > 0 ? 1 : 0);
    const target = i ? i.fwd * (i.boost ? 6.5 : 4.5) * power : 0;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), 2.2 * h);
    // Blocages : pente > 38°, tronc, eau profonde.
    if (Math.abs(this.speed) > 0.01) {
      const dir = Math.sign(this.speed);
      const fx = -Math.sin(this.yaw) * dir;
      const fz = -Math.cos(this.yaw) * dir;
      const probe = this.model.halfExtents.z + 2;
      const px = this.position.x + fx * probe;
      const pz = this.position.z + fz * probe;
      const n = { x: 0, y: 1, z: 0 };
      const gAhead = groundHeight(px, pz, n);
      const gHere = groundHeight(this.position.x, this.position.z);
      let blocked = n.y < 0.788 && gAhead > gHere;
      if (WATER_LEVEL - gAhead > 3 && edgeDistance(px, pz) < WATER_EDGE) blocked = true;
      collidersNear(px, pz, this.model.halfExtents.x, 1, this.cyl);
      for (const c of this.cyl) if (c.r > 0.3 && c.y1 > gAhead + 1.8 && c.y0 < gAhead + 4) blocked = true;
      if (blocked) this.speed = 0;
    }
    this.position.x += -Math.sin(this.yaw) * this.speed * h;
    this.position.z += -Math.cos(this.yaw) * this.speed * h;
    // Pieds : paires diagonales (AG+ArD, AD+ArG) en alternance.
    const stride = 1.7;
    const home = _v2;
    const swingingPair = this.swing.some((s, k) => s.t < 1 && (k === 0 || k === 3)) ? 0 : this.swing.some((s, k) => s.t < 1 && (k === 1 || k === 2)) ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const s = this.swing[k];
      const pair = k === 0 || k === 3 ? 0 : 1;
      if (s.t < 1) {
        s.t = Math.min(1, s.t + h / 0.45);
        this.feet[k].lerpVectors(s.from, s.to, s.t);
        this.feet[k].y += Math.sin(Math.PI * s.t) * 0.9;
        if (s.t >= 1) this.onStep?.();
      } else {
        this.home(k, home);
        if (home.distanceTo(this.feet[k]) > stride && (swingingPair === -1 || swingingPair === pair)) {
          s.from.copy(this.feet[k]);
          const lead = Math.sign(this.speed) * Math.min(1.2, Math.abs(this.speed) * 0.35);
          s.to.set(home.x - Math.sin(this.yaw) * lead, 0, home.z - Math.cos(this.yaw) * lead);
          s.to.y = groundHeight(s.to.x, s.to.z);
          s.t = 0;
        } else this.feet[k].y = Math.max(this.feet[k].y, groundHeight(this.feet[k].x, this.feet[k].z));
      }
    }
    this.pose(h);
  }

  /** Hauteur et inclinaison de la plateforme à partir des pieds. */
  private pose(h: number): void {
    const f = this.feet;
    const avg = (f[0].y + f[1].y + f[2].y + f[3].y) / 4;
    const targetY = avg + this.hipDrop - this.hipLocalY + (this.stepBoost > 0 ? 1 : 0);
    this.position.y = h > 0 ? this.position.y + (targetY - this.position.y) * Math.min(1, h * 4) : targetY;
    const legs = this.model.legs!;
    const len = Math.abs(legs.hips[0].z - legs.hips[2].z) || 4;
    const wid = Math.abs(legs.hips[0].x - legs.hips[1].x) || 4;
    const pitch = Math.atan2((f[0].y + f[1].y) / 2 - (f[2].y + f[3].y) / 2, len) * 0.8;
    const roll = Math.atan2((f[1].y + f[3].y) / 2 - (f[0].y + f[2].y) / 2, wid) * 0.8;
    _q.setFromEuler(_e.set(pitch, this.yaw, roll, 'YXZ'));
    this.quaternion.copy(_q);
    if (h > 0) {
      this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
      this.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      this.velocity.set(-Math.sin(this.yaw) * this.speed, 0, -Math.cos(this.yaw) * this.speed);
    }
  }

  afterStep(): void {
    // Corps cinématique : la pose fait foi, pas de dégâts de choc.
  }

  protected animate(_dt: number, a: VehicleAnim): void {
    const inv = this.quaternion.clone().invert();
    a.feet = this.feet.map((p) => p.clone().sub(this.position).applyQuaternion(inv));
    a.speed = this.speed;
  }

  get forwardSpeed(): number {
    return this.speed;
  }
}

// ---------------------------------------------------------------------------------------------
// Chenillé : contrôleur de véhicule à rayons (6 roues virtuelles par côté), direction différentielle.

class Crawler extends Vehicle {
  private vc: RAPIER_NS.DynamicRayCastVehicleController;
  private drillTime = 0;
  private wheelsPerSide = 6;
  drilling = 0;

  constructor(physics: Physics) {
    super('chenille', physics, createCrawlerModel());
    this.createBody(physics.R.RigidBodyDesc.dynamic().setLinearDamping(0.1).setAngularDamping(1.2), 38000, 0.9);
    const hx = this.model.halfExtents.x;
    const hy = this.model.halfExtents.y;
    const hz = this.model.halfExtents.z;
    // Centre de masse abaissé contre le basculement.
    const m = 38000;
    this.collider.setMassProperties(m, { x: 0, y: -hy * 0.6, z: 0 }, { x: (m * (4 * hy * hy + 4 * hz * hz)) / 12, y: (m * (4 * hx * hx + 4 * hz * hz)) / 12, z: (m * (4 * hx * hx + 4 * hy * hy)) / 12 }, { x: 0, y: 0, z: 0, w: 1 });
    this.vc = physics.world.createVehicleController(this.body);
    for (const side of [-1, 1]) {
      for (let k = 0; k < this.wheelsPerSide; k++) {
        const z = -hz * 0.8 + (k / (this.wheelsPerSide - 1)) * hz * 1.6;
        this.vc.addWheel({ x: side * (hx - 0.4), y: -hy + 0.25, z }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 0.7, 0.55);
      }
    }
    for (let k = 0; k < this.vc.numWheels(); k++) {
      this.vc.setWheelSuspensionStiffness(k, 45);
      this.vc.setWheelMaxSuspensionForce(k, 260000);
      this.vc.setWheelFrictionSlip(k, 2.2);
      this.vc.setWheelSideFrictionStiffness(k, 0.55);
    }
  }

  protected control(h: number): void {
    const i = this.occupied && this.engineOn ? this.input : null;
    const power = this.powerFactor;
    const speed = this.forwardSpeed;
    const vmax = i?.boost ? 8 : 4;
    let throttle = i ? i.fwd : 0;
    if (Math.abs(speed) > vmax && Math.sign(speed) === Math.sign(throttle)) throttle = 0;
    const steer = i ? i.right : 0;
    const base = (i?.boost ? 7500 : 4800) * power;
    const n = this.vc.numWheels();
    for (let k = 0; k < n; k++) {
      const left = k < this.wheelsPerSide;
      const f = base * (throttle + (left ? steer : -steer) * 0.6);
      this.vc.setWheelEngineForce(k, f);
      const braking = i?.up ? 9000 : !i || (throttle === 0 && steer === 0) ? 2500 : 0;
      this.vc.setWheelBrake(k, braking);
    }
    // Juste après le réveil, Rapier n'a pas encore recalculé la masse : le contrôleur de roues
    // diviserait par zéro (vitesses NaN, chenillé figé). On attend le pas suivant.
    if (this.body.mass() > 0) this.vc.updateVehicle(h);
    // Direction différentielle : appliquée APRÈS le calcul des roues, sinon leur adhérence latérale
    // annule la rotation à chaque pas (le chenillé ne tournait presque pas).
    if (i && power > 0 && Math.abs(steer) > 0.05) {
      const w = this.body.angvel();
      const target = -steer * (0.6 + 0.15 * Math.min(1, Math.abs(speed) / 4));
      this.body.setAngvel({ x: w.x, y: w.y + (target - w.y) * Math.min(1, h * 8), z: w.z }, true);
    }
    // Foreuse
    const drilling = !!i?.action && power > 0;
    this.drilling += ((drilling ? 1 : 0) - this.drilling) * Math.min(1, h * 3);
    if (drilling) {
      this.drillTime += h;
      if (this.drillTime > 3) {
        this.drillTime = 0;
        this.events.onOre?.(this);
      }
    } else this.drillTime = 0;
  }

  protected load(): number {
    return Math.max(super.load(), this.drilling);
  }

  protected animate(_dt: number, a: VehicleAnim): void {
    const s = this.forwardSpeed;
    const w = this.body.angvel().y * this.model.halfExtents.x;
    a.trackLeft = s - w;
    a.trackRight = s + w;
    a.drill = this.drilling;
    a.feet = null;
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.vc);
    super.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Hydroglisseur : flottabilité sur 4 points, hélice aérienne, gouvernes, effet de quille.

class Hydro extends Vehicle {
  private hopTimer = 0;
  onWater = false;

  constructor(physics: Physics) {
    super('hydro', physics, createHydroModel());
    this.createBody(physics.R.RigidBodyDesc.dynamic().setLinearDamping(0.08).setAngularDamping(1.6), 900, 0.35);
  }

  protected control(h: number): void {
    const b = this.body;
    b.resetForces(true);
    const m = b.mass();
    const he = this.model.halfExtents;
    const i = this.occupied && this.engineOn ? this.input : null;
    const power = this.powerFactor;
    this.hopTimer = Math.max(0, this.hopTimer - h);
    // Flottabilité
    let wet = 0;
    const corners = [
      [-he.x * 0.8, -he.z * 0.8],
      [he.x * 0.8, -he.z * 0.8],
      [-he.x * 0.8, he.z * 0.8],
      [he.x * 0.8, he.z * 0.8],
    ];
    for (const [lx, lz] of corners) {
      const p = _v.set(lx, -he.y, lz).applyQuaternion(this.quaternion).add(this.position);
      if (!waterAt(p.x, p.z)) continue;
      const depth = WATER_LEVEL - p.y;
      if (depth <= 0) continue;
      wet++;
      const pv = b.velocityAtPoint({ x: p.x, y: p.y, z: p.z });
      // Ressort de flottaison amorti (amortissement proche du critique : plus d'oscillation qui s'emballe).
      const fy = Math.max(0, Math.min(depth, 0.6) * ((m * GRAVITY) / 4 / 0.3) - pv.y * m * 1.6);
      b.addForceAtPoint({ x: 0, y: fy, z: 0 }, { x: p.x, y: p.y, z: p.z }, true);
    }
    this.onWater = wet >= 2;
    const fwd = _v2.set(0, 0, -1).applyQuaternion(this.quaternion);
    const v = this.velocity;
    // Poussée de l'hélice (à la poupe)
    if (i && power > 0) {
      const thrust = i.fwd * (i.boost ? 12000 : 9000) * power * (this.onWater ? 1 : 0.3);
      const stern = this.position.clone().addScaledVector(fwd, -he.z);
      b.addForceAtPoint({ x: fwd.x * thrust, y: 0, z: fwd.z * thrust }, { x: stern.x, y: stern.y, z: stern.z }, true);
      if (i.upPressed && this.hopTimer <= 0 && this.onWater) {
        b.applyImpulse({ x: 0, y: m * 4.8, z: 0 }, true);
        this.hopTimer = 5;
      }
    }
    // Traînée de l'eau, effet de quille (dérive limitée), frottement sur la terre.
    const hs = Math.hypot(v.x, v.z);
    const drag = this.onWater ? 27.8 : 160;
    b.addForce({ x: -drag * hs * v.x, y: 0, z: -drag * hs * v.z }, true);
    const right = _v.set(1, 0, 0).applyQuaternion(this.quaternion);
    const lat = v.dot(right);
    const keel = (this.onWater ? 0.06 : 0.3) * m / h;
    b.addForce({ x: -right.x * lat * keel, y: 0, z: -right.z * lat * keel }, true);
    // Gouvernes d'air : efficaces seulement en mouvement.
    const w = b.angvel();
    const steerRate = i ? -i.right * 1.4 * Math.min(1, Math.abs(this.forwardSpeed) / 5) : 0;
    b.setAngvel({ x: w.x, y: w.y + (steerRate - w.y) * Math.min(1, h * 4), z: w.z }, true);
    // Redressement : couple selon up × Y (ramène la coque à plat ; l'ancien signe la retournait).
    const up = _v.set(0, 1, 0).applyQuaternion(this.quaternion);
    const k = m * (this.occupied ? 8 : 14);
    b.addTorque({ x: -up.z * k, y: 0, z: up.x * k }, true);
    // Un hydroglisseur ne tourne jamais vite : roulis/tangage bornés, lacet borné.
    {
      // Assiette pilotée : la vitesse de roulis/tangage vise à ramener la coque à plat (pas de balancement).
      const a = b.angvel();
      const up2 = _v.set(0, 1, 0).applyQuaternion(this.quaternion);
      const tx = -up2.z * 3;
      const tz = up2.x * 3;
      const blend = Math.min(1, h * 10);
      const yawDamp = this.occupied ? 1 : Math.max(0, 1 - h * 3);
      b.setAngvel({ x: a.x + (tx - a.x) * blend, y: Math.max(-2.2, Math.min(2.2, a.y * yawDamp)), z: a.z + (tz - a.z) * blend }, true);
    }
    // Sans pilote : la coque se calme (plus de dérive résiduelle).
    if (!this.occupied) {
      const lv = b.linvel();
      b.setLinvel({ x: lv.x * Math.max(0, 1 - h * 0.8), y: lv.y, z: lv.z * Math.max(0, 1 - h * 0.8) }, true);
    }
  }

  protected animate(): void {
    this.anim.feet = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Flotte : dépôt de Forage Kessel, appel par drone, activation selon la distance.

interface Delivery {
  kind: VehicleKind;
  timer: number;
  x: number;
  z: number;
  yaw: number;
}

export interface VehicleSaveState {
  energy: number;
  hp: number;
  /** Où le véhicule a été laissé (absent dans les anciennes sauvegardes : il est alors garé au dépôt). */
  x?: number;
  z?: number;
  yaw?: number;
}

export class VehicleFleet {
  readonly vehicles = new Map<VehicleKind, Vehicle>();
  driven: Vehicle | null = null;
  readonly depot: Vector3;
  private physics: Physics;
  private deliveries: Delivery[] = [];
  private selection = 0;
  events: VehicleEvents & { onDelivered?(v: Vehicle): void; onWalkerStep?(): void } = {};

  constructor(physics: Physics, unlocked: VehicleKind[], saved: Partial<Record<VehicleKind, VehicleSaveState>> = {}) {
    this.physics = physics;
    const k = LANDMARKS.find((l) => l.id === 'kessel')!;
    this.depot = new Vector3(k.x, k.padHeight, k.z);
    for (const kind of unlocked) {
      const v = kind === 'gyro' ? new Gyro(physics) : kind === 'marcheur' ? new Walker(physics) : kind === 'chenille' ? new Crawler(physics) : new Hydro(physics);
      v.events = {
        onDamage: (veh, a) => this.events.onDamage?.(veh, a),
        onDisabled: (veh) => this.events.onDisabled?.(veh),
        onOre: (veh) => this.events.onOre?.(veh),
      };
      if (v instanceof Walker) v.onStep = () => this.events.onWalkerStep?.();
      const s = saved[kind];
      if (s) {
        v.energy = s.energy;
        v.hp = Math.max(1, s.hp);
      }
      this.vehicles.set(kind, v);
      if (!s || s.x === undefined || s.z === undefined || !this.parkAt(v, s.x, s.z, s.yaw ?? 0)) this.parkAtDepot(v);
    }
  }

  /** Repose un véhicule là où il a été laissé. Retourne false si l'endroit ne convient pas. */
  parkAt(v: Vehicle, x: number, z: number, yaw: number): boolean {
    if (!isFinite(x) || !isFinite(z) || Math.abs(x) > 4100 || Math.abs(z) > 4100) return false;
    const h = v.model.halfExtents;
    if (v.kind === 'hydro') {
      if (groundHeight(x, z) > WATER_LEVEL - 0.5) return false;
      v.placeAt(x, WATER_LEVEL + h.y + 0.2, z, yaw);
      return true;
    }
    v.placeAt(x, groundHeight(x, z) + h.y + 0.6 + (v.kind === 'gyro' ? 0.36 : 0), z, yaw);
    return true;
  }

  /** Emplacements de stationnement autour de l'aire de fret (hydroglisseur : dans le chenal de la faille). */
  parkAtDepot(v: Vehicle): void {
    const d = this.depot;
    const h = v.model.halfExtents;
    if (v.kind === 'hydro') {
      const z = d.z + 40;
      const x = canyonCenterX(z);
      v.placeAt(x, WATER_LEVEL + h.y + 0.2, z, Math.PI);
      return;
    }
    const spots: Record<Exclude<VehicleKind, 'hydro'>, [number, number, number]> = {
      gyro: [0, 0, 0],
      marcheur: [-38, 22, Math.PI / 2],
      chenille: [-37.1, -37.1, Math.PI / 3], // ≈ 52 m de l'aire de fret
    };
    const [ox, oz, yaw] = spots[v.kind as Exclude<VehicleKind, 'hydro'>];
    const x = d.x + ox;
    const z = d.z + oz;
    const g = groundHeight(x, z) + (v.kind === 'gyro' ? 0.36 : 0);
    v.placeAt(x, g + h.y + 0.6, z, yaw);
  }

  get list(): Vehicle[] {
    return [...this.vehicles.values()];
  }

  /** Véhicule le plus proche à portée de montée. */
  nearest(p: Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = Infinity;
    for (const v of this.vehicles.values()) {
      if (v.disabledTimer > 0) continue;
      const d = v.position.distanceTo(p);
      if (d < v.reach && d < bd) {
        best = v;
        bd = d;
      }
    }
    return best;
  }

  /** Commande la livraison du véhicule suivant près du joueur. Retourne un message. */
  callNext(p: Vector3, yaw: number): string {
    const kinds = [...this.vehicles.keys()];
    if (!kinds.length) return 'Aucun véhicule disponible.';
    const kind = kinds[this.selection % kinds.length];
    this.selection++;
    const v = this.vehicles.get(kind)!;
    if (v === this.driven) return `Vous êtes déjà à bord du ${v.def.short.toLowerCase()}.`;
    if (v.disabledTimer > 0) return `${v.def.short} hors service : rapatriement dans ${Math.ceil(v.disabledTimer)} s.`;
    if (this.deliveries.some((d) => d.kind === kind)) return `${v.def.short} déjà en route.`;
    let x = p.x - Math.sin(yaw) * 16;
    let z = p.z - Math.cos(yaw) * 16;
    if (kind === 'hydro') {
      const spot = findWater(p.x, p.z, 260);
      if (!spot) return 'Hydroglisseur : aucune étendue d’eau à moins de 260 m.';
      x = spot.x;
      z = spot.z;
    }
    this.deliveries.push({ kind, timer: 5, x, z, yaw });
    return `Drone de fret : ${v.def.short.toLowerCase()} livré dans 5 s.`;
  }

  /** À appeler chaque image. `input` est appliqué au véhicule piloté. */
  update(dt: number, playerPos: Vector3, input: DriveInput | null, time: number, night: number): void {
    // Livraisons
    for (const d of [...this.deliveries]) {
      d.timer -= dt;
      this.physics.require(d.x, d.z, 64);
      if (d.timer <= 0 && this.physics.groundReady(d.x, d.z)) {
        const v = this.vehicles.get(d.kind)!;
        const h = v.model.halfExtents;
        const y = d.kind === 'hydro' ? WATER_LEVEL + h.y + 0.5 : groundHeight(d.x, d.z) + h.y + 3;
        v.setAwake(true);
        v.placeAt(d.x, y, d.z, d.yaw);
        this.deliveries.splice(this.deliveries.indexOf(d), 1);
        this.events.onDelivered?.(v);
      }
    }
    // Activation selon la distance et le terrain chargé.
    for (const v of this.vehicles.values()) {
      const near = v === this.driven || v.position.distanceTo(playerPos) < 220;
      const ground = near && this.physics.require(v.position.x, v.position.z, v === this.driven ? 160 : 70);
      // En altitude, inutile d'attendre la tuile de sol : le véhicule reste simulé.
      v.setAwake(near && (ground || v.clearance > 25));
    }
    this.physics.update(
      dt,
      (h) => {
        for (const v of this.vehicles.values()) if (v.awake) v.step(h, v === this.driven ? input : null);
        if (input) input.upPressed = input.engineToggle = false;
      },
      (h) => {
        for (const v of this.vehicles.values()) if (v.awake) v.afterStep(h);
      },
    );
    for (const v of this.vehicles.values()) {
      v.tickService(dt, this.depot, () => {
        if (v === this.driven) this.driven = null;
        v.occupied = false;
        this.parkAtDepot(v);
      });
      // Tombé hors du monde ou sous le terrain : rapatriement.
      if (v.position.y < groundHeight(v.position.x, v.position.z) - 15 && v !== this.driven) this.parkAtDepot(v);
      v.sync(dt, time, night);
    }
  }

  enter(v: Vehicle): void {
    this.driven = v;
    v.occupied = true;
    v.engineOn = v.powerFactor > 0;
    v.setAwake(true);
  }

  exit(): Vehicle | null {
    const v = this.driven;
    if (!v) return null;
    v.occupied = false;
    v.lights = false;
    this.driven = null;
    return v;
  }

  saveState(): Partial<Record<VehicleKind, VehicleSaveState>> {
    const out: Partial<Record<VehicleKind, VehicleSaveState>> = {};
    for (const [k, v] of this.vehicles) {
      const yaw = _e.setFromQuaternion(v.quaternion, 'YXZ').y;
      out[k] = {
        energy: Math.round(v.energy * 10) / 10,
        hp: Math.round(v.hp),
        x: Math.round(v.position.x * 10) / 10,
        z: Math.round(v.position.z * 10) / 10,
        yaw: Math.round(yaw * 1000) / 1000,
      };
    }
    return out;
  }

  dispose(): void {
    for (const v of this.vehicles.values()) v.dispose();
    this.vehicles.clear();
  }
}

/** Point d'eau navigable le plus proche (recherche en spirale). */
export function findWater(x: number, z: number, radius: number): { x: number; z: number } | null {
  for (let r = 0; r <= radius; r += 12) {
    const n = Math.max(1, Math.floor((2 * Math.PI * r) / 12));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (groundHeight(px, pz) < WATER_LEVEL - 1 && edgeDistance(px, pz) < WATER_EDGE - 20) return { x: px, z: pz };
    }
  }
  return null;
}
