// Contrats partagés entre les contrôleurs (physique, IA, monte) et les modèles 3D procéduraux.
// Les modèles ne déplacent JAMAIS leur racine : le contrôleur positionne et oriente `root`.
// Convention commune : unités en mètres, l'avant regarde vers -Z, Y vers le haut.

import type { Group, Object3D, Vector3 } from 'three';

// ---------------------------------------------------------------------------------------------
// Créatures (Skarel, Tormaq, Vexil)

export type CreatureKind = 'skarel' | 'tormaq' | 'vexil';

/** État d'animation d'une créature, fourni à chaque image par son contrôleur. */
export interface CreatureAnim {
  time: number; // s, horloge globale (pour les oscillations)
  speed: number; // vitesse horizontale (m/s)
  gait: number; // 0 arrêt, 1 marche, 2 course, 3 sprint/charge (valeurs intermédiaires acceptées)
  grounded: boolean; // au sol
  crouch: number; // 0..1 : couché (Vexil caché dans les lamelles, Tormaq au repos, Skarel posé ailes repliées)
  night: number; // 0 jour … 1 nuit (intensité des émissifs)
  call: number; // 0..1 : l'animal pousse un cri (tête levée, crête/pores plus lumineux)
  // Skarel uniquement (ignoré par les autres)
  flying: number; // 0 au sol … 1 en vol (ailes déployées)
  flap: number; // 0..1 : battement en cours (impulsion qui décroît vers 0)
  bank: number; // roulis (rad, + = virage à droite) — posture des ailes seulement
  dive: number; // 0..1 : piqué, ailes arrière repliées
  boost: number; // 0..1 : vol rapide (la crête vire du violet à l'ambre)
}

export interface CreatureModel {
  /** Origine au sol sous le centre du corps, regard vers -Z, taille réelle en mètres. */
  readonly root: Group;
  /** Point d'attache du cavalier : ses pieds y sont posés, il regarde vers -Z. Enfant (indirect) de root. */
  readonly saddle: Object3D;
  /** Hauteur totale approximative (m), pour la caméra. */
  readonly height: number;
  update(dt: number, a: CreatureAnim): void;
  dispose(): void;
}

export function idleCreatureAnim(): CreatureAnim {
  return { time: 0, speed: 0, gait: 0, grounded: true, crouch: 0, night: 0, call: 0, flying: 0, flap: 0, bank: 0, dive: 0, boost: 0 };
}

// ---------------------------------------------------------------------------------------------
// Véhicules Halden

export type VehicleKind = 'gyro' | 'marcheur' | 'chenille' | 'hydro';

export interface VehicleAnim {
  time: number;
  speed: number; // m/s, signée (+ = vers l'avant)
  throttle: number; // -1..1
  steer: number; // -1..1 (+ = vers la droite)
  power: number; // 0..1 régime moteur (rotor, hélice, grondement)
  lights: boolean; // phares allumés
  damage: number; // 0 intact … 1 hors service
  night: number;
  // Chenillé
  trackLeft: number; // vitesse de défilement de la chenille gauche (m/s)
  trackRight: number;
  drill: number; // 0..1 rotation de la foreuse
  // Marcheur : position des pieds dans le repère LOCAL de root (ordre AG, AD, ArG, ArD), ou null
  feet: Vector3[] | null;
}

export interface WalkerLegs {
  /** Rotules de hanche dans le repère local de root (ordre AG, AD, ArG, ArD). */
  hips: Vector3[];
  upper: number; // longueur du segment haut (m)
  lower: number; // longueur du segment bas (m)
}

export interface VehicleModel {
  /** Origine = centre du corps rigide (centre de la boîte de collision), regard vers -Z. */
  readonly root: Group;
  /** Siège du pilote : ses pieds y sont posés, il regarde vers -Z. Enfant (indirect) de root. */
  readonly seat: Object3D;
  /** Demi-dimensions de la boîte de collision principale, centrée sur root. */
  readonly halfExtents: Vector3;
  /** Marcheur uniquement : géométrie des jambes pour la cinématique inverse. */
  readonly legs?: WalkerLegs;
  update(dt: number, a: VehicleAnim): void;
  dispose(): void;
}

export function idleVehicleAnim(): VehicleAnim {
  return { time: 0, speed: 0, throttle: 0, steer: 0, power: 0, lights: false, damage: 0, night: 0, trackLeft: 0, trackRight: 0, drill: 0, feet: null };
}
