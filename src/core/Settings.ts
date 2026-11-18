// Réglages persistants (localStorage) et préréglages de qualité graphique.

export type QualityPreset = 'auto' | 'elevee' | 'moyenne' | 'basse';

export interface QualityParams {
  pixelRatio: number; // multiplicateur du devicePixelRatio (plafonné)
  terrainRange: number; // facteur de plage LOD du terrain
  vegDensity: number;
  vegDistance: number;
  shadows: boolean;
  shadowMap: number;
  bloom: boolean;
  triplanar: boolean;
  textureSize: number;
}

export const QUALITY: Record<Exclude<QualityPreset, 'auto'>, QualityParams> = {
  elevee: { pixelRatio: 1.0, terrainRange: 3.4, vegDensity: 1, vegDistance: 1.45, shadows: true, shadowMap: 2048, bloom: true, triplanar: true, textureSize: 4096 },
  moyenne: { pixelRatio: 0.85, terrainRange: 2.8, vegDensity: 0.75, vegDistance: 1.1, shadows: true, shadowMap: 1024, bloom: true, triplanar: true, textureSize: 2048 },
  basse: { pixelRatio: 0.7, terrainRange: 2.2, vegDensity: 0.5, vegDistance: 0.8, shadows: false, shadowMap: 512, bloom: false, triplanar: false, textureSize: 1024 },
};

export interface Settings {
  quality: QualityPreset;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  volume: number; // 0..1
  showFps: boolean;
  dynamicResolution: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  fov: 70,
  sensitivity: 1,
  invertY: false,
  volume: 0.7,
  showFps: false,
  dynamicResolution: true,
};

const KEY = 'veyra.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const s = { ...DEFAULT_SETTINGS, ...parsed };
    if (!['auto', 'elevee', 'moyenne', 'basse'].includes(s.quality)) s.quality = 'auto';
    s.fov = clampNum(s.fov, 55, 100, 70);
    s.sensitivity = clampNum(s.sensitivity, 0.2, 3, 1);
    s.volume = clampNum(s.volume, 0, 1, 0.7);
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : réglages non persistés */
  }
}

/** Préréglage effectif : en « auto », estimation à partir du matériel. */
export function resolveQuality(preset: QualityPreset, hints: { cores: number; memoryGB?: number; renderer?: string }): Exclude<QualityPreset, 'auto'> {
  if (preset !== 'auto') return preset;
  const r = (hints.renderer ?? '').toLowerCase();
  const integrated = /intel|uhd|iris|mali|adreno|apple m1|swiftshader|llvmpipe|basic render/.test(r);
  if (/swiftshader|llvmpipe|basic render/.test(r)) return 'basse';
  if (integrated || hints.cores <= 4 || (hints.memoryGB ?? 8) <= 4) return 'moyenne';
  return 'elevee';
}

function clampNum(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
