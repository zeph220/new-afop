// Modèles procéduraux des personnages (designs originaux, docs/DESIGN.md §3) et animation procédurale.
// Origine aux pieds, regard vers -Z.

import {
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  TorusGeometry,
  RepeatWrapping,
  type Material,
} from 'three';
import type { FactionDef } from './Factions.ts';
import type { PlayerController } from './PlayerController.ts';

interface Rig {
  hips: Group;
  torso: Group;
  head: Group;
  armL: Group;
  armR: Group;
  foreL: Group;
  foreR: Group;
  legL: Group;
  legR: Group;
  shinL: Group;
  shinR: Group;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function barkTexture(): CanvasTexture {
  return canvasTex(128, 256, (g) => {
    g.fillStyle = '#7a5236';
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * 128;
      const w = 2 + Math.random() * 6;
      g.fillStyle = Math.random() < 0.45 ? 'rgba(70,98,52,0.55)' : Math.random() < 0.5 ? 'rgba(150,96,58,0.5)' : 'rgba(40,26,18,0.55)';
      g.fillRect(x, Math.random() * 256, w, 20 + Math.random() * 90);
    }
    g.strokeStyle = 'rgba(30,20,14,0.6)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      let x = Math.random() * 128;
      g.moveTo(x, 0);
      for (let y = 0; y <= 256; y += 16) {
        x += (Math.random() - 0.5) * 6;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function weaveTexture(a: string, b: string): CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = b;
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        if (((x + y) / 8) % 2 === 0) g.fillRect(x, y, 8, 4);
        else g.fillRect(x, y + 4, 8, 4);
      }
    }
  });
}

function limb(len: number, r0: number, r1: number, mat: Material): Group {
  const pivot = new Group();
  const geo = new CylinderGeometry(r1, r0, len, 8, 1);
  const m = new Mesh(geo, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  pivot.add(m);
  const joint = new Mesh(new SphereGeometry(r0 * 1.02, 8, 6), mat);
  joint.castShadow = true;
  pivot.add(joint);
  return pivot;
}

const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial(o);

export class CharacterModel {
  readonly root = new Group();
  private rig!: Rig;
  private phase = 0;
  private climbPhase = 0;
  private f: FactionDef;
  private nozzles: MeshStandardMaterial | null = null;
  private flames: Mesh[] = [];
  readonly lamp: SpotLight | null = null;
  lampOn = false;
  private legLen = 1;
  private hipY = 1;

  constructor(f: FactionDef) {
    this.f = f;
    this.root.name = 'player-' + f.id;
    if (f.id === 'sylmar') this.buildSylmar();
    else this.lamp = this.buildHalden();
  }

  private buildSkeleton(H: number, mats: { skin: Material; upper: Material; lower: Material; arm: Material }, bulk: number): Rig {
    const legLen = H * 0.47;
    const thigh = legLen * 0.52;
    const shin = legLen * 0.48;
    const torsoLen = H * 0.3;
    const armLen = H * 0.36;
    this.legLen = legLen;
    this.hipY = legLen;
    const hips = new Group();
    hips.position.y = legLen;
    this.root.add(hips);
    const pelvis = new Mesh(new CapsuleGeometry(0.16 * bulk, 0.1, 4, 8), mats.lower);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.castShadow = true;
    hips.add(pelvis);
    const torso = new Group();
    hips.add(torso);
    const chest = new Mesh(new CapsuleGeometry(0.19 * bulk, torsoLen * 0.6, 4, 10), mats.upper);
    chest.position.y = torsoLen * 0.5;
    chest.scale.set(1.15, 1, 0.75);
    chest.castShadow = true;
    torso.add(chest);
    const head = new Group();
    head.position.y = torsoLen + 0.08;
    torso.add(head);
    const mkLeg = (side: number) => {
      const leg = limb(thigh, 0.1 * bulk, 0.085 * bulk, mats.lower);
      leg.position.set(0.13 * side * bulk, 0, 0);
      hips.add(leg);
      const sh = limb(shin, 0.08 * bulk, 0.06 * bulk, mats.lower);
      sh.position.y = -thigh;
      leg.add(sh);
      const foot = new Mesh(new BoxGeometry(0.12 * bulk, 0.07, 0.26 * bulk), mats.lower);
      foot.position.set(0, -shin + 0.02, -0.07);
      foot.castShadow = true;
      sh.add(foot);
      return [leg, sh];
    };
    const [legL, shinL] = mkLeg(-1);
    const [legR, shinR] = mkLeg(1);
    const mkArm = (side: number) => {
      const arm = limb(armLen * 0.52, 0.07 * bulk, 0.06 * bulk, mats.arm);
      arm.position.set(0.27 * side * bulk, torsoLen * 0.92, 0);
      arm.rotation.z = 0.08 * side;
      torso.add(arm);
      const fore = limb(armLen * 0.48, 0.055 * bulk, 0.045 * bulk, mats.skin);
      fore.position.y = -armLen * 0.52;
      arm.add(fore);
      const hand = new Mesh(new SphereGeometry(0.055 * bulk, 8, 6), mats.skin);
      hand.position.y = -armLen * 0.48;
      hand.scale.set(0.8, 1.2, 0.6);
      fore.add(hand);
      return [arm, fore];
    };
    const [armL, foreL] = mkArm(-1);
    const [armR, foreR] = mkArm(1);
    return { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR };
  }

  private buildSylmar(): void {
    const H = this.f.height;
    const bark = barkTexture();
    bark.repeat.set(1, 2);
    const skin = std({ map: bark, roughness: 0.85, color: 0xffffff });
    const weave = weaveTexture('#8a6a3c', '#5e4526');
    weave.repeat.set(3, 3);
    const cloth = std({ map: weave, roughness: 0.95 });
    this.rig = this.buildSkeleton(H, { skin, upper: skin, lower: skin, arm: skin }, 0.95);
    const r = this.rig;
    // Tête allongée, mâchoire fine
    const skull = new Mesh(new SphereGeometry(0.15, 12, 10), skin);
    skull.scale.set(0.9, 1.25, 1.05);
    skull.position.y = 0.17;
    skull.castShadow = true;
    r.head.add(skull);
    const neck = new Mesh(new CylinderGeometry(0.06, 0.08, 0.14, 8), skin);
    neck.position.y = 0.02;
    r.head.add(neck);
    const eyeMat = std({ color: 0x2a1a08, emissive: new Color(1.0, 0.62, 0.18), emissiveIntensity: 2.2 });
    for (const s of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.022, 8, 6), eyeMat);
      eye.position.set(0.055 * s, 0.2, -0.13);
      eye.scale.set(1.4, 0.7, 0.6);
      r.head.add(eye);
    }
    // Crête de fibres : frondes raides du front à la nuque
    const fiber = std({ color: 0x2d4a2a, roughness: 0.9, emissive: new Color(0.9, 0.5, 0.15), emissiveIntensity: 0.0 });
    const tipMat = std({ color: 0x9a6a2a, emissive: new Color(1.0, 0.6, 0.2), emissiveIntensity: 0.8 });
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const len = 0.18 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.1));
      const frond = new Mesh(new ConeGeometry(0.025, len, 5), fiber);
      const ang = -0.9 + t * 2.2;
      frond.position.set(0, 0.17 + Math.cos(ang) * 0.19, Math.sin(ang) * 0.17);
      frond.rotation.x = ang + 0.25;
      frond.translateY(len / 2);
      r.head.add(frond);
      const tip = new Mesh(new SphereGeometry(0.012, 5, 4), tipMat);
      tip.position.copy(frond.position);
      tip.rotation.copy(frond.rotation);
      tip.translateY(len / 2);
      r.head.add(tip);
    }
    // Vêtements tressés : écharpe croisée, pagne à franges, bracelets
    const sash = new Mesh(new BoxGeometry(0.1, 0.62, 0.36), cloth);
    sash.position.set(0, H * 0.15, 0);
    sash.rotation.z = 0.6;
    sash.scale.set(1, 1, 1);
    r.torso.add(sash);
    const skirt = new Mesh(new CylinderGeometry(0.2, 0.3, 0.42, 10, 1, true), cloth);
    skirt.position.y = -0.12;
    (skirt.material as MeshStandardMaterial).side = 2;
    r.hips.add(skirt);
    for (const fore of [r.foreL, r.foreR]) {
      const band = new Mesh(new CylinderGeometry(0.06, 0.06, 0.18, 8), cloth);
      band.position.y = -0.22;
      fore.add(band);
    }
    // Arc et lance dans le dos
    const wood = std({ color: 0x4a3322, roughness: 0.8 });
    const bow = new Mesh(new TorusGeometry(0.55, 0.018, 5, 18, Math.PI * 0.9), wood);
    bow.position.set(0.05, H * 0.17, 0.2);
    bow.rotation.set(0, Math.PI / 2, 1.75);
    r.torso.add(bow);
    const spear = new Mesh(new CylinderGeometry(0.018, 0.018, 2.0, 5), wood);
    spear.position.set(-0.05, H * 0.15, 0.24);
    spear.rotation.z = -0.5;
    r.torso.add(spear);
    const tip = new Mesh(new ConeGeometry(0.04, 0.16, 5), std({ color: 0x7a7f86, roughness: 0.4, metalness: 0.2 }));
    tip.position.set(0, 1.07, 0);
    spear.add(tip);
  }

  private buildHalden(): SpotLight {
    const H = this.f.height;
    const ochre = std({ color: 0xa8772e, roughness: 0.75 });
    const steel = std({ color: 0x6b7178, roughness: 0.45, metalness: 0.6 });
    const dark = std({ color: 0x2b2d30, roughness: 0.8 });
    this.rig = this.buildSkeleton(H, { skin: dark, upper: ochre, lower: ochre, arm: ochre }, 1.12);
    const r = this.rig;
    // Plaques d'armure
    const plate = new Mesh(new BoxGeometry(0.42, 0.34, 0.12), steel);
    plate.position.set(0, H * 0.17, -0.15);
    plate.castShadow = true;
    r.torso.add(plate);
    for (const s of [-1, 1]) {
      const pad = new Mesh(new SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      pad.position.set(0.3 * s, H * 0.28, 0);
      pad.scale.set(1.2, 0.8, 1);
      r.torso.add(pad);
    }
    for (const sh of [r.shinL, r.shinR]) {
      const knee = new Mesh(new BoxGeometry(0.15, 0.14, 0.08), steel);
      knee.position.set(0, -0.05, -0.08);
      sh.add(knee);
    }
    // Marquage numéroté (bande sombre)
    const stripe = new Mesh(new BoxGeometry(0.44, 0.05, 0.36), dark);
    stripe.position.set(0, H * 0.07, 0);
    r.torso.add(stripe);
    // Casque et visière orange
    const helmet = new Mesh(new SphereGeometry(0.17, 14, 12), ochre);
    helmet.position.y = 0.15;
    helmet.castShadow = true;
    r.head.add(helmet);
    const visor = new Mesh(
      new SphereGeometry(0.155, 14, 10, -Math.PI * 0.35 - Math.PI / 2, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3),
      std({ color: 0x331a08, emissive: new Color(1.0, 0.45, 0.1), emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.3 }),
    );
    visor.position.set(0, 0.16, -0.025);
    r.head.add(visor);
    const lampBody = new Mesh(new CylinderGeometry(0.03, 0.035, 0.07, 8), steel);
    lampBody.rotation.x = Math.PI / 2;
    lampBody.position.set(0.1, 0.27, -0.12);
    r.head.add(lampBody);
    // Propulseur dorsal
    const pack = new Mesh(new BoxGeometry(0.4, 0.5, 0.2), steel);
    pack.position.set(0, H * 0.16, 0.2);
    pack.castShadow = true;
    r.torso.add(pack);
    const tank = new Mesh(new CapsuleGeometry(0.07, 0.3, 4, 8), ochre);
    tank.position.set(0, H * 0.18, 0.31);
    r.torso.add(tank);
    this.nozzles = std({ color: 0x222222, emissive: new Color(1.0, 0.5, 0.15), emissiveIntensity: 0 });
    for (const s of [-1, 1]) {
      const nz = new Mesh(new CylinderGeometry(0.05, 0.07, 0.14, 10), this.nozzles);
      nz.position.set(0.13 * s, H * 0.16 - 0.3, 0.22);
      r.torso.add(nz);
      const flame = new Mesh(
        new ConeGeometry(0.06, 0.5, 8, 1, true),
        std({ color: 0x000000, emissive: new Color(1.0, 0.55, 0.2), emissiveIntensity: 4, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      flame.rotation.x = Math.PI;
      flame.position.set(0.13 * s, H * 0.16 - 0.62, 0.22);
      flame.visible = false;
      r.torso.add(flame);
      this.flames.push(flame);
    }
    // Lampe frontale
    const lamp = new SpotLight(0xffe8c8, 0, 55, 0.42, 0.55, 1.2);
    lamp.position.set(0.1, 0.27, -0.15);
    const target = new Object3D();
    target.position.set(0.1, -0.6, -6);
    r.head.add(lamp, target);
    lamp.target = target;
    return lamp;
  }

  update(dt: number, p: PlayerController): void {
    const r = this.rig;
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.root.rotation.y = p.yaw;
    const spd = p.horizontalSpeed;
    const run = Math.min(1, spd / p.f.run);
    const k = 1 - Math.exp(-14 * dt);
    const T: Record<string, number> = {
      hipsY: this.hipY,
      hipsX: 0,
      torsoX: -0.08 * run,
      legL: 0,
      legR: 0,
      shinL: 0,
      shinR: 0,
      armL: 0.05,
      armR: 0.05,
      armLz: -0.1,
      armRz: 0.1,
      foreL: 0.25,
      foreR: 0.25,
      headX: 0,
    };
    const stride = p.f.height * 0.62;
    if (p.state === 'ground' && spd > 0.2) {
      this.phase += ((spd * dt) / stride) * Math.PI;
      const amp = 0.25 + 0.5 * run;
      const s = Math.sin(this.phase);
      T.legL = s * amp;
      T.legR = -s * amp;
      T.shinL = -Math.max(0, -Math.sin(this.phase + 0.6)) * amp * 1.6;
      T.shinR = -Math.max(0, Math.sin(this.phase + 0.6)) * amp * 1.6;
      T.armL = -s * amp * 0.9;
      T.armR = s * amp * 0.9;
      T.foreL = 0.3 + run * 0.9;
      T.foreR = 0.3 + run * 0.9;
      T.hipsY = this.hipY - 0.03 * run + Math.abs(Math.cos(this.phase)) * 0.05 * run;
      T.torsoX = -0.1 - 0.22 * run;
    } else if (p.state === 'ground') {
      const b = Math.sin(performance.now() * 0.002) * 0.012;
      T.hipsY = this.hipY + b;
      T.armL = 0.05 + b;
      T.armR = 0.05 - b;
    }
    if (p.crouching && p.state === 'ground') {
      T.hipsY -= this.legLen * 0.35;
      T.legL += 0.95;
      T.legR += 0.95;
      T.shinL -= 1.5;
      T.shinR -= 1.5;
      T.torsoX -= 0.35;
    }
    if (p.state === 'air') {
      const j = p.jetpack > 0.1;
      T.legL = j ? -0.15 : 0.6;
      T.legR = j ? -0.25 : -0.2;
      T.shinL = j ? -0.3 : -0.9;
      T.shinR = j ? -0.4 : -0.5;
      T.armL = j ? -0.3 : 0.6;
      T.armR = j ? -0.3 : -0.4;
      T.armLz = -0.5;
      T.armRz = 0.5;
    }
    if (p.state === 'swim') {
      this.phase += dt * 4;
      const s = Math.sin(this.phase);
      T.hipsX = -1.25;
      T.armL = 2.4 + s * 1.2;
      T.armR = 2.4 - s * 1.2;
      T.legL = s * 0.4;
      T.legR = -s * 0.4;
      T.hipsY = this.hipY * 0.9;
    }
    if (p.climbing) {
      const moving = Math.abs(p.vel.y) > 0.05 || spd > 0.05;
      if (moving) this.climbPhase += dt * 6;
      const s = Math.sin(this.climbPhase);
      T.armL = 2.5 + s * 0.45;
      T.armR = 2.5 - s * 0.45;
      T.foreL = 0.4 + Math.max(0, s) * 0.6;
      T.foreR = 0.4 + Math.max(0, -s) * 0.6;
      T.legL = 0.7 + s * 0.35;
      T.legR = 0.7 - s * 0.35;
      T.shinL = -1.0 - s * 0.3;
      T.shinR = -1.0 + s * 0.3;
      T.torsoX = 0.15;
      T.headX = -0.3;
    }
    r.hips.position.y += (T.hipsY - r.hips.position.y) * k;
    r.hips.rotation.x += (T.hipsX - r.hips.rotation.x) * k;
    r.torso.rotation.x += (T.torsoX - r.torso.rotation.x) * k;
    r.head.rotation.x += (T.headX - r.head.rotation.x) * k;
    r.legL.rotation.x += (T.legL - r.legL.rotation.x) * k;
    r.legR.rotation.x += (T.legR - r.legR.rotation.x) * k;
    r.shinL.rotation.x += (T.shinL - r.shinL.rotation.x) * k;
    r.shinR.rotation.x += (T.shinR - r.shinR.rotation.x) * k;
    r.armL.rotation.x += (T.armL - r.armL.rotation.x) * k;
    r.armR.rotation.x += (T.armR - r.armR.rotation.x) * k;
    r.armL.rotation.z += (T.armLz - r.armL.rotation.z) * k;
    r.armR.rotation.z += (T.armRz - r.armR.rotation.z) * k;
    r.foreL.rotation.x += (T.foreL - r.foreL.rotation.x) * k;
    r.foreR.rotation.x += (T.foreR - r.foreR.rotation.x) * k;

    if (this.nozzles) {
      this.nozzles.emissiveIntensity = p.jetpack * 3;
      for (const fl of this.flames) {
        fl.visible = p.jetpack > 0.05;
        fl.scale.set(1, 0.6 + Math.random() * 0.6 * p.jetpack, 1);
      }
    }
    if (this.lamp) this.lamp.intensity = this.lampOn ? 450 : 0;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}
