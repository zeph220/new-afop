// Définition des deux camps jouables (voir docs/DESIGN.md §3).

export type FactionId = 'sylmar' | 'halden';

export interface FactionDef {
  id: FactionId;
  name: string;
  people: string;
  tagline: string;
  description: string;
  playstyle: string[];
  height: number; // m
  radius: number; // m
  walk: number; // m/s
  run: number;
  crouch: number;
  swim: number;
  jump: number; // impulsion verticale m/s
  canClimb: boolean;
  hasJetpack: boolean;
  staminaMax: number;
  fuelMax: number;
  abilityName: string;
  abilityHint: string;
  abilityCooldown: number; // s
  nightVision: number; // bonus d'exposition la nuit
  eyeHeight: number;
  cameraDistance: number;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  sylmar: {
    id: 'sylmar',
    name: 'Les Sylmar',
    people: 'Peuple autochtone de Veyra',
    tagline: 'Grimper, se fondre, écouter la brume.',
    description:
      "Grands, la peau écorcée aux teintes de mousse et de cuivre, les Sylmar vivent dans les ombrelles des Colonniers. Ils lisent la brume, gagnent la confiance des bêtes et se déplacent sans bruit.",
    playstyle: ['Escalade des falaises et des troncs', 'Course rapide, sauts amples', 'Déplacement accroupi silencieux', "Écho de sève : la flore s'illumine autour de vous", 'Vision nocturne'],
    height: 2.5,
    radius: 0.42,
    walk: 3.6,
    run: 8.5,
    crouch: 1.7,
    swim: 2.6,
    jump: 6.8,
    canClimb: true,
    hasJetpack: false,
    staminaMax: 100,
    fuelMax: 0,
    abilityName: 'Écho de sève',
    abilityHint: 'F : Écho de sève',
    abilityCooldown: 6,
    nightVision: 0.55,
    eyeHeight: 2.25,
    cameraDistance: 6.2,
  },
  halden: {
    id: 'halden',
    name: 'Le Consortium Halden',
    people: "Colons industriels d'extraction",
    tagline: 'Mesurer, forer, tenir le quota.',
    description:
      "Équipes d'extraction en combinaisons ocre et gris acier, venues pour l'orvène. Leur matériel est lourd, modulaire et rafistolé ; leur force, c'est la technologie.",
    playstyle: ['Propulseur dorsal (maintenir Espace en l’air)', 'Scan géologique : courbes de niveau et relevés', 'Lampe frontale (L)', 'HUD technique : altitude, coordonnées, cap', 'Véhicules et drones (itération 2)'],
    height: 1.85,
    radius: 0.4,
    walk: 3.2,
    run: 6.8,
    crouch: 1.5,
    swim: 2.0,
    jump: 5.0,
    canClimb: false,
    hasJetpack: true,
    staminaMax: 0,
    fuelMax: 100,
    abilityName: 'Scan géologique',
    abilityHint: 'F : Scan géologique',
    abilityCooldown: 6,
    nightVision: 0,
    eyeHeight: 1.65,
    cameraDistance: 5.2,
  },
};
