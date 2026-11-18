// Objets, inventaire et fabrication.

import type { FactionId } from '../player/Factions.ts';

export type ItemKind = 'ressource' | 'munition' | 'soin' | 'nourriture' | 'outil' | 'amelioration';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  /** Points de vie rendus (soin) ou satiété (nourriture). */
  heal?: number;
  food?: number;
}

const D = (id: string, name: string, kind: ItemKind, desc: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id, name, kind, desc, ...extra });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  [
    D('fibre', 'Fibre végétale', 'ressource', 'Tiges souples des sous-bois, tressées pour les cordes.'),
    D('bois', 'Bois', 'ressource', 'Bois dense prélevé sur les troncs.'),
    D('resine', 'Résine', 'ressource', 'Sève figée, collante et inflammable.'),
    D('pierre', 'Pierre', 'ressource', 'Éclats de roche taillables.'),
    D('peau', 'Peau', 'ressource', 'Peau d’animal à tanner.'),
    D('os', 'Os', 'ressource', 'Os solides, pour les pointes et les renforts.'),
    D('plume', 'Plume', 'ressource', 'Plumes d’oiseau, pour l’empennage des flèches.'),
    D('orvene', 'Orvène', 'ressource', 'Minerai ambré, source d’énergie des Halden.'),
    D('ferraille', 'Ferraille', 'ressource', 'Pièces métalliques récupérées.'),
    D('viande', 'Viande crue', 'nourriture', 'Mangeable, mais peu nourrissante crue.', { food: 10, heal: -3 }),
    D('viande_cuite', 'Viande grillée', 'nourriture', 'Cuite sur un feu.', { food: 35, heal: 5 }),
    D('baie', 'Baies d’ambre', 'nourriture', 'Petites baies sucrées.', { food: 8 }),
    D('herbe_soin', 'Herbe-sève', 'soin', 'Feuilles cicatrisantes à mâcher.', { heal: 10 }),
    D('baume', 'Baume de sève', 'soin', 'Onguent puissant.', { heal: 45 }),
    D('trousse', 'Trousse de soins', 'soin', 'Pansements et stimulant Halden.', { heal: 60 }),
    D('ration', 'Ration de terrain', 'nourriture', 'Repas compact et complet.', { food: 60, heal: 10 }),
    D('fleche', 'Flèche', 'munition', 'Flèche à pointe d’os.'),
    D('fleche_feu', 'Flèche à résine', 'munition', 'Enflammée à l’impact : dégâts accrus, effraie la faune.'),
    D('cellule', 'Cellule d’orvène', 'munition', 'Recharge le pulseur (10 décharges).'),
    D('fusee', 'Fusée éclairante', 'munition', 'Éclaire la nuit et fait fuir les prédateurs.'),
    D('feu_camp', 'Feu de camp (kit)', 'outil', 'À poser (G) : permet de cuisiner et de se reposer.'),
    D('arc_composite', 'Arc composite', 'amelioration', 'Arc renforcé d’os : +35 % de dégâts et de portée.'),
    D('lame_os', 'Lame d’os', 'amelioration', 'Lance et couteau plus tranchants : +40 % de dégâts.'),
    D('condensateur', 'Condensateur', 'amelioration', 'Pulseur : +40 % de dégâts, portée accrue.'),
    D('blindage', 'Plaques de blindage', 'amelioration', 'Combinaison renforcée : −25 % de dégâts subis.'),
    D('armure_peau', 'Armure de peau', 'amelioration', 'Cuir épais : −20 % de dégâts subis.'),
  ].map((d) => [d.id, d]),
);

export interface Recipe {
  id: string;
  out: string;
  qty: number;
  needs: Record<string, number>;
  faction?: FactionId;
  /** 'feu' : près d'un feu ; 'etabli' : établi de Kessel ou de Vehra-Tal. */
  station?: 'feu' | 'etabli';
}

export const RECIPES: Recipe[] = [
  { id: 'r_fleche', out: 'fleche', qty: 4, needs: { bois: 1, plume: 1, os: 1 }, faction: 'sylmar' },
  { id: 'r_fleche_simple', out: 'fleche', qty: 2, needs: { bois: 1, pierre: 1, fibre: 1 }, faction: 'sylmar' },
  { id: 'r_fleche_feu', out: 'fleche_feu', qty: 2, needs: { fleche: 2, resine: 1, fibre: 1 }, faction: 'sylmar' },
  { id: 'r_baume', out: 'baume', qty: 1, needs: { herbe_soin: 2, resine: 1 }, faction: 'sylmar' },
  { id: 'r_arc', out: 'arc_composite', qty: 1, needs: { os: 4, fibre: 4, bois: 3, resine: 2 }, faction: 'sylmar', station: 'etabli' },
  { id: 'r_lame', out: 'lame_os', qty: 1, needs: { os: 3, pierre: 2, fibre: 2 }, faction: 'sylmar', station: 'etabli' },
  { id: 'r_armure', out: 'armure_peau', qty: 1, needs: { peau: 6, fibre: 4, os: 2 }, faction: 'sylmar', station: 'etabli' },
  { id: 'r_cellule', out: 'cellule', qty: 2, needs: { orvene: 1, ferraille: 1 }, faction: 'halden' },
  { id: 'r_fusee', out: 'fusee', qty: 2, needs: { ferraille: 1, resine: 1 }, faction: 'halden' },
  { id: 'r_trousse', out: 'trousse', qty: 1, needs: { herbe_soin: 1, fibre: 2, ferraille: 1 }, faction: 'halden' },
  { id: 'r_ration', out: 'ration', qty: 1, needs: { viande_cuite: 1, baie: 2 }, faction: 'halden' },
  { id: 'r_condo', out: 'condensateur', qty: 1, needs: { orvene: 3, ferraille: 4, resine: 1 }, faction: 'halden', station: 'etabli' },
  { id: 'r_blindage', out: 'blindage', qty: 1, needs: { ferraille: 6, peau: 2 }, faction: 'halden', station: 'etabli' },
  { id: 'r_cuire', out: 'viande_cuite', qty: 1, needs: { viande: 1 }, station: 'feu' },
  { id: 'r_feu', out: 'feu_camp', qty: 1, needs: { bois: 3, pierre: 2 } },
];

export const UPGRADES = new Set(['arc_composite', 'lame_os', 'condensateur', 'blindage', 'armure_peau']);

export class Inventory {
  readonly items: Record<string, number>;
  onChange?: () => void;

  constructor(initial: Record<string, number> = {}) {
    this.items = {};
    for (const [k, v] of Object.entries(initial)) if (typeof v === 'number' && v > 0 && isFinite(v)) this.items[k] = Math.floor(v);
  }

  count(id: string): number {
    return this.items[id] ?? 0;
  }

  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  add(id: string, n = 1): void {
    if (n <= 0) return;
    this.items[id] = this.count(id) + n;
    this.onChange?.();
  }

  remove(id: string, n = 1): boolean {
    if (!this.has(id, n)) return false;
    this.items[id] -= n;
    if (this.items[id] <= 0) delete this.items[id];
    this.onChange?.();
    return true;
  }

  canCraft(r: Recipe): boolean {
    if (UPGRADES.has(r.out) && this.has(r.out)) return false;
    return Object.entries(r.needs).every(([k, n]) => this.has(k, n));
  }

  craft(r: Recipe): boolean {
    if (!this.canCraft(r)) return false;
    for (const [k, n] of Object.entries(r.needs)) this.items[k] -= n;
    for (const k of Object.keys(r.needs)) if (this.items[k] <= 0) delete this.items[k];
    this.add(r.out, r.qty);
    return true;
  }
}

/** Tirage d'un butin : [objet, min, max, probabilité]. */
export type LootTable = [string, number, number, number][];

export function rollLoot(table: LootTable, rnd: () => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, a, b, p] of table) {
    if (rnd() > p) continue;
    const n = a + Math.floor(rnd() * (b - a + 1));
    if (n > 0) out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

export function lootText(l: Record<string, number>): string {
  return Object.entries(l)
    .map(([k, n]) => `${n} × ${ITEMS[k]?.name ?? k}`)
    .join(', ');
}
