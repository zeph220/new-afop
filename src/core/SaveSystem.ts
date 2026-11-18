// Sauvegarde de la progression. Itération 1 : stockage local (localStorage).
// Itération 3 : un second « backend » Supabase implémentera la même interface,
// le local restant le secours hors ligne.

import type { FactionId } from '../player/Factions.ts';
import type { WeatherKind } from '../world/Environment.ts';

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  faction: FactionId;
  position: { x: number; y: number; z: number };
  yaw: number;
  timeOfDay: number;
  weather: WeatherKind;
  playTime: number; // secondes
  savedAt: string; // ISO 8601
  // Prévu pour les itérations suivantes (déjà sérialisé pour la compatibilité).
  inventory: Record<string, number>;
  tamed: string[];
  vehicles: string[];
  quests: Record<string, string>;
}

export interface SaveBackend {
  readonly name: string;
  load(): Promise<SaveData | null>;
  save(data: SaveData): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'veyra.save.v1';

/** Valide et complète des données brutes (tolère les sauvegardes anciennes ou partielles). */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SaveData>;
  if (r.faction !== 'sylmar' && r.faction !== 'halden') return null;
  const p = r.position;
  if (!p || ![p.x, p.y, p.z].every((v) => typeof v === 'number' && isFinite(v))) return null;
  return {
    version: SAVE_VERSION,
    faction: r.faction,
    position: { x: p.x, y: p.y, z: p.z },
    yaw: typeof r.yaw === 'number' ? r.yaw : 0,
    timeOfDay: typeof r.timeOfDay === 'number' ? ((r.timeOfDay % 1) + 1) % 1 : 0.36,
    weather: r.weather === 'brume' || r.weather === 'orage' ? r.weather : 'clair',
    playTime: typeof r.playTime === 'number' ? r.playTime : 0,
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : new Date(0).toISOString(),
    inventory: r.inventory ?? {},
    tamed: r.tamed ?? [],
    vehicles: r.vehicles ?? [],
    quests: r.quests ?? {},
  };
}

export class LocalSaveBackend implements SaveBackend {
  readonly name = 'local';
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {
    this.storage = storage;
  }
  async load(): Promise<SaveData | null> {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? parseSave(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  async save(data: SaveData): Promise<void> {
    this.storage?.setItem(KEY, JSON.stringify(data));
  }
  async clear(): Promise<void> {
    this.storage?.removeItem(KEY);
  }
}

/** Sauvegarde automatique périodique + à la fermeture de l'onglet. */
export class AutoSaver {
  private timer = 0;
  private backend: SaveBackend;
  private collect: () => SaveData | null;
  interval = 60;
  lastSaved: Date | null = null;

  constructor(backend: SaveBackend, collect: () => SaveData | null) {
    this.backend = backend;
    this.collect = collect;
    if (typeof window !== 'undefined') {
      const flush = () => void this.saveNow();
      window.addEventListener('beforeunload', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  tick(dt: number): void {
    this.timer += dt;
    if (this.timer >= this.interval) {
      this.timer = 0;
      void this.saveNow();
    }
  }

  async saveNow(): Promise<boolean> {
    const d = this.collect();
    if (!d) return false;
    try {
      await this.backend.save(d);
      this.lastSaved = new Date();
      return true;
    } catch (e) {
      console.warn('Sauvegarde impossible', e);
      return false;
    }
  }
}
