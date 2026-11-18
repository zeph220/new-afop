// Interface HTML superposée : écrans de menu et HUD.

import { FACTIONS, type FactionId } from '../player/Factions.ts';
import type { QualityPreset, Settings } from '../core/Settings.ts';
import type { TamingView } from '../entities/Creatures.ts';

/** Panneau de monte / pilotage. */
export interface RideHud {
  name: string;
  speed: number; // m/s
  gauges: { label: string; value: number; kind: 'stamina' | 'energy' | 'hp' }[];
  extra: string;
  hint: string;
}

export type ScreenId = 'loading' | 'menu' | 'factions' | 'hud' | 'pause' | 'settings' | 'help' | 'credits';

export interface UICallbacks {
  onNewGame(): void;
  onContinue(): void;
  onPickFaction(f: FactionId): void;
  onBackToMenu(): void;
  onResume(): void;
  onQuitToMenu(): void;
  onSettingsChange(s: Settings): void;
  onSaveNow(): void;
  onClickToPlay(): void;
  onUiSound(): void;
}

export interface HudData {
  heading: number; // radians, 0 = nord
  region: string;
  clock: string;
  weather: string;
  faction: FactionId;
  stamina: number; // 0..1
  fuel: number; // 0..1
  abilityReady: number; // 0..1
  abilityName: string;
  x: number;
  y: number;
  z: number;
  groundClearance: number;
  pois: { name: string; bearing: number; dist: number }[];
  hint: string;
  fps: string;
  pointerLocked: boolean;
  usingPad: boolean;
  ride?: RideHud | null;
  taming?: TamingView | null;
}

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const CONTROLS = `
<table class="keys">
<tr><td>Se déplacer</td><td><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> (AZERTY) · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (QWERTY) · flèches · stick gauche</td></tr>
<tr><td>Caméra</td><td>Souris (cliquer pour capturer) · stick droit · molette = zoom</td></tr>
<tr><td>Courir</td><td><kbd>Maj</kbd> · gâchette gauche</td></tr>
<tr><td>Sauter / propulseur</td><td><kbd>Espace</kbd> (maintenir en l'air : propulseur Halden) · A</td></tr>
<tr><td>S'accroupir / lâcher prise</td><td><kbd>Ctrl</kbd> ou <kbd>C</kbd> · B</td></tr>
<tr><td>Escalade (Sylmar)</td><td>Avancer face à une falaise raide ou un tronc de Colonnier</td></tr>
<tr><td>Capacité de camp</td><td><kbd>F</kbd> · X</td></tr>
<tr><td>Lampe (Halden) / phares</td><td><kbd>L</kbd> · Y</td></tr>
<tr><td>Monter, piloter, descendre</td><td><kbd>E</kbd> · RB</td></tr>
<tr><td>Appeler sa monture (Sylmar) · livraison de véhicule par drone (Halden)</td><td><kbd>R</kbd> · LB</td></tr>
<tr><td>Apprivoiser (Sylmar)</td><td>Approcher accroupi, <kbd>E</kbd> offrande, répondre en rythme avec <kbd>F</kbd>, maintenir <kbd>E</kbd> (harnais)</td></tr>
<tr><td>Attaquer / tirer</td><td>Clic gauche (maintenir pour tendre l’arc) · clic droit : viser</td></tr>
<tr><td>Changer d’arme</td><td><kbd>X</kbd></td></tr>
<tr><td>Panneau rapide (armes / nourriture)</td><td>Maintenir <kbd>A</kbd> · <kbd>T</kbd> : basculer · molette ou 1–9 · clic : valider</td></tr>
<tr><td>Inventaire, fabrication</td><td><kbd>Tab</kbd> ou <kbd>I</kbd></td></tr>
<tr><td>Fouiller, récolter, dépecer, se reposer</td><td><kbd>E</kbd> près de l’objet</td></tr>
<tr><td>Soin rapide / poser un feu</td><td><kbd>G</kbd></td></tr>
<tr><td>Moteur du gyrocoptère</td><td><kbd>V</kbd></td></tr>
<tr><td>Aide des commandes</td><td><kbd>H</kbd></td></tr>
<tr><td>Pause</td><td><kbd>Échap</kbd> · Start</td></tr>
</table>`;

export class UI {
  private root: HTMLElement;
  private screens = new Map<ScreenId, HTMLElement>();
  private cb: UICallbacks;
  private settings: Settings;
  private settingsReturn: ScreenId = 'menu';
  private hudEls!: Record<string, HTMLElement>;
  private lastHint = '';
  private compassMarks: HTMLElement[] = [];
  private poiMarks = new Map<string, HTMLElement>();

  /** Calque du HUD (pour les modules qui y ajoutent leurs éléments). */
  get hudRoot(): HTMLElement {
    return this.screens.get('hud')!;
  }

  constructor(root: HTMLElement, cb: UICallbacks, settings: Settings) {
    this.root = root;
    this.cb = cb;
    this.settings = { ...settings };
    this.build();
  }

  private add(id: ScreenId, el: HTMLElement): HTMLElement {
    el.id = id;
    el.classList.add('screen');
    this.root.appendChild(el);
    this.screens.set(id, el);
    return el;
  }

  private build(): void {
    this.add('loading', h(`<div><div class="title">VEYRA</div><div class="subtitle">Lune d'Orun</div><div class="bar"><i></i></div><div class="status">Initialisation…</div></div>`));

    const menu = this.add(
      'menu',
      h(`<div><div class="col">
        <div class="title">VEYRA</div><div class="subtitle">Lune d'Orun · exploration</div>
        <button data-a="continue" class="primary">Continuer</button><div class="save-info"></div>
        <button data-a="new">Nouvelle partie</button>
        <button data-a="settings">Réglages</button>
        <button data-a="help">Commandes</button>
        <button data-a="credits">Crédits</button>
      </div><div class="legal">Univers original. Textures, modèles et sons générés procéduralement. Voir les crédits.</div></div>`),
    );
    menu.querySelector('[data-a=continue]')!.addEventListener('click', () => this.click(() => this.cb.onContinue()));
    menu.querySelector('[data-a=new]')!.addEventListener('click', () => this.click(() => this.cb.onNewGame()));
    menu.querySelector('[data-a=settings]')!.addEventListener('click', () => this.click(() => this.openSettings('menu')));
    menu.querySelector('[data-a=help]')!.addEventListener('click', () => this.click(() => this.openOverlay('help', 'menu')));
    menu.querySelector('[data-a=credits]')!.addEventListener('click', () => this.click(() => this.openOverlay('credits', 'menu')));

    const card = (id: FactionId) => {
      const f = FACTIONS[id];
      return `<div class="card ${id}"><h3>${f.name}</h3><div class="people">${f.people}</div><div class="tag">${f.tagline}</div>
        <p>${f.description}</p><ul>${f.playstyle.map((p) => `<li>${p}</li>`).join('')}</ul>
        <button class="primary" data-f="${id}">Incarner ${id === 'sylmar' ? 'une Sylmar' : 'un·e technicien·ne Halden'}</button></div>`;
    };
    const fac = this.add('factions', h(`<div><h2>Choisissez votre camp</h2><div class="cards">${card('sylmar')}${card('halden')}</div><button class="back">Retour</button></div>`));
    fac.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => this.click(() => this.cb.onPickFaction(b.dataset.f as FactionId))));
    fac.querySelector('.back')!.addEventListener('click', () => this.click(() => this.cb.onBackToMenu()));

    const hud = this.add(
      'hud',
      h(`<div>
        <div class="compass"><div class="strip"></div><div class="needle"></div></div>
        <div class="region"></div>
        <div class="clock"></div>
        <div class="techpanel"></div>
        <div class="crosshair"></div>
        <div class="vitals"><div class="label"></div><div class="bar"><i></i></div></div>
        <div class="ability"><div class="name"></div><div class="ring"><span>F</span></div></div>
        <div class="hint"></div>
        <div class="toasts"></div>
        <div class="fps"></div>
        <div class="ridepanel"><div class="rp-head"><span class="rp-name"></span><span class="rp-speed"></span></div><div class="rp-gauges"></div><div class="rp-extra"></div></div>
        <div class="tamepanel"><div class="tp-name"></div><div class="bar tp-trust"><i></i></div><div class="tp-rhythm"><i></i><b></b></div><div class="tp-hint"></div></div>
        <div class="click-to-play">Cliquez pour reprendre le contrôle de la caméra</div>
      </div>`),
    );
    hud.querySelector('.click-to-play')!.addEventListener('click', () => this.cb.onClickToPlay());
    this.hudEls = {
      strip: hud.querySelector('.strip')!,
      region: hud.querySelector('.region')!,
      clock: hud.querySelector('.clock')!,
      tech: hud.querySelector('.techpanel')!,
      vitals: hud.querySelector('.vitals')!,
      vitalsLabel: hud.querySelector('.vitals .label')!,
      vitalsBar: hud.querySelector('.vitals .bar')!,
      vitalsFill: hud.querySelector('.vitals .bar i')!,
      abilityName: hud.querySelector('.ability .name')!,
      abilityRing: hud.querySelector('.ability .ring')!,
      hint: hud.querySelector('.hint')!,
      toasts: hud.querySelector('.toasts')!,
      fps: hud.querySelector('.fps')!,
      clickToPlay: hud.querySelector('.click-to-play')!,
      ride: hud.querySelector('.ridepanel')!,
      rideName: hud.querySelector('.rp-name')!,
      rideSpeed: hud.querySelector('.rp-speed')!,
      rideGauges: hud.querySelector('.rp-gauges')!,
      rideExtra: hud.querySelector('.rp-extra')!,
      tame: hud.querySelector('.tamepanel')!,
      tameName: hud.querySelector('.tp-name')!,
      tameTrust: hud.querySelector('.tp-trust i')!,
      tameRhythm: hud.querySelector('.tp-rhythm')!,
      tameRhythmFill: hud.querySelector('.tp-rhythm i')!,
      tameHint: hud.querySelector('.tp-hint')!,
    };
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    for (let i = 0; i < 8; i++) {
      const m = h(`<div class="mark ${i % 2 === 0 ? 'card' : ''}">${labels[i]}</div>`);
      this.hudEls.strip.appendChild(m);
      this.compassMarks.push(m);
    }

    const pause = this.add(
      'pause',
      h(`<div class="modal"><div class="panel"><h2>Pause</h2><div class="stack">
        <button data-a="resume" class="primary">Reprendre</button>
        <button data-a="save">Sauvegarder maintenant</button>
        <button data-a="settings">Réglages</button>
        <button data-a="help">Commandes</button>
        <button data-a="quit">Retour au menu principal</button>
      </div></div></div>`),
    );
    pause.classList.add('modal');
    pause.querySelector('[data-a=resume]')!.addEventListener('click', () => this.click(() => this.cb.onResume()));
    pause.querySelector('[data-a=save]')!.addEventListener('click', () => this.click(() => this.cb.onSaveNow()));
    pause.querySelector('[data-a=settings]')!.addEventListener('click', () => this.click(() => this.openSettings('pause')));
    pause.querySelector('[data-a=help]')!.addEventListener('click', () => this.click(() => this.openOverlay('help', 'pause')));
    pause.querySelector('[data-a=quit]')!.addEventListener('click', () => this.click(() => this.cb.onQuitToMenu()));

    const settings = this.add(
      'settings',
      h(`<div class="modal"><div class="panel"><h2>Réglages</h2><div class="form">
        <label for="s-quality">Qualité graphique</label>
        <select id="s-quality"><option value="auto">Automatique</option><option value="elevee">Élevée</option><option value="moyenne">Moyenne</option><option value="basse">Basse</option></select>
        <small>« Automatique » choisit selon votre matériel et ajuste la résolution pour rester fluide.</small>
        <label for="s-dyn">Résolution dynamique</label><input id="s-dyn" type="checkbox">
        <label for="s-fov">Champ de vision <span id="s-fov-v"></span></label><input id="s-fov" type="range" min="55" max="100" step="1">
        <label for="s-sens">Sensibilité caméra <span id="s-sens-v"></span></label><input id="s-sens" type="range" min="0.2" max="3" step="0.05">
        <label for="s-inv">Inverser l'axe vertical</label><input id="s-inv" type="checkbox">
        <label for="s-vol">Volume <span id="s-vol-v"></span></label><input id="s-vol" type="range" min="0" max="1" step="0.01">
        <label for="s-fps">Afficher les performances</label><input id="s-fps" type="checkbox">
      </div><div class="row-end"><button data-a="close" class="primary">Fermer</button></div></div></div>`),
    );
    settings.classList.add('modal');
    const q = <T extends HTMLElement>(s: string) => settings.querySelector(s) as T;
    const sync = () => {
      (q<HTMLSelectElement>('#s-quality')).value = this.settings.quality;
      q<HTMLInputElement>('#s-dyn').checked = this.settings.dynamicResolution;
      q<HTMLInputElement>('#s-fov').value = String(this.settings.fov);
      q<HTMLElement>('#s-fov-v').textContent = `(${this.settings.fov}°)`;
      q<HTMLInputElement>('#s-sens').value = String(this.settings.sensitivity);
      q<HTMLElement>('#s-sens-v').textContent = `(${this.settings.sensitivity.toFixed(2)})`;
      q<HTMLInputElement>('#s-inv').checked = this.settings.invertY;
      q<HTMLInputElement>('#s-vol').value = String(this.settings.volume);
      q<HTMLElement>('#s-vol-v').textContent = `(${Math.round(this.settings.volume * 100)} %)`;
      q<HTMLInputElement>('#s-fps').checked = this.settings.showFps;
    };
    this.syncSettings = sync;
    const change = () => {
      this.settings = {
        quality: q<HTMLSelectElement>('#s-quality').value as QualityPreset,
        dynamicResolution: q<HTMLInputElement>('#s-dyn').checked,
        fov: Number(q<HTMLInputElement>('#s-fov').value),
        sensitivity: Number(q<HTMLInputElement>('#s-sens').value),
        invertY: q<HTMLInputElement>('#s-inv').checked,
        volume: Number(q<HTMLInputElement>('#s-vol').value),
        showFps: q<HTMLInputElement>('#s-fps').checked,
      };
      sync();
      this.cb.onSettingsChange({ ...this.settings });
    };
    settings.querySelectorAll('select, input').forEach((el) => el.addEventListener('input', change));
    settings.querySelector('[data-a=close]')!.addEventListener('click', () => this.click(() => this.show(this.settingsReturn)));

    const help = this.add('help', h(`<div class="modal"><div class="panel"><h2>Commandes</h2>${CONTROLS}<div class="row-end"><button data-a="close" class="primary">Fermer</button></div></div></div>`));
    help.classList.add('modal');
    help.querySelector('[data-a=close]')!.addEventListener('click', () => this.click(() => this.closeOverlay()));

    const credits = this.add(
      'credits',
      h(`<div class="modal"><div class="panel credits"><h2>Crédits</h2>
        <p><strong>Veyra</strong> est un univers original. Les noms, créatures, personnages et designs ont été créés pour ce projet.</p>
        <ul>
          <li>Rendu : <a href="https://threejs.org" target="_blank" rel="noopener" style="color:var(--amber)">three.js</a> (licence MIT)</li>
          <li>Outils : Vite, TypeScript, Vitest (licences MIT / Apache-2.0)</li>
          <li>Textures du terrain : générées procéduralement</li>
          <li>Personnages, flore, structures : géométrie procédurale</li>
          <li>Sons : synthétisés en temps réel (Web Audio API)</li>
        </ul>
        <p>Le détail des sources et licences figure dans <code>docs/CREDITS.md</code>.</p>
        <div class="row-end"><button data-a="close" class="primary">Fermer</button></div></div></div>`),
    );
    credits.classList.add('modal');
    credits.querySelector('[data-a=close]')!.addEventListener('click', () => this.click(() => this.closeOverlay()));
  }

  private syncSettings: () => void = () => undefined;
  private overlayReturn: ScreenId = 'menu';

  private click(fn: () => void): void {
    this.cb.onUiSound();
    fn();
  }

  private openSettings(from: ScreenId): void {
    this.settingsReturn = from;
    this.syncSettings();
    this.show('settings');
  }

  private openOverlay(id: ScreenId, from: ScreenId): void {
    this.overlayReturn = from;
    this.show(id);
  }

  private closeOverlay(): void {
    this.show(this.overlayReturn);
  }

  /** Affiche un écran. Le HUD reste visible sous la pause et ses sous-menus. */
  show(id: ScreenId): void {
    const keepHud = id === 'hud' || ((id === 'pause' || id === 'settings' || id === 'help') && this.screens.get('hud')!.classList.contains('visible') && this.current !== 'menu');
    for (const [k, el] of this.screens) el.classList.toggle('visible', k === id || (k === 'hud' && keepHud));
    this.current = id;
    const first = this.screens.get(id)!.querySelector<HTMLButtonElement>('button.primary:not([disabled]), button:not([disabled])');
    if (first && id !== 'hud') first.focus({ preventScroll: true });
  }

  current: ScreenId = 'loading';

  isOverlayOpen(): boolean {
    return this.current === 'help' || this.current === 'settings';
  }

  closeTopOverlay(): void {
    if (this.current === 'settings') this.show(this.settingsReturn);
    else if (this.current === 'help' || this.current === 'credits') this.closeOverlay();
  }

  setLoading(p: number, text: string): void {
    const el = this.screens.get('loading')!;
    (el.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    el.querySelector('.status')!.textContent = text;
  }

  setContinueInfo(info: string | null): void {
    const menu = this.screens.get('menu')!;
    const b = menu.querySelector<HTMLButtonElement>('[data-a=continue]')!;
    b.style.display = info ? '' : 'none';
    (menu.querySelector('.save-info') as HTMLElement).textContent = info ?? '';
    (menu.querySelector('[data-a=new]') as HTMLElement).classList.toggle('primary', !info);
  }

  setFactionTheme(f: FactionId): void {
    this.root.style.setProperty('--accent', f === 'sylmar' ? 'var(--amber)' : 'var(--ochre)');
  }

  toast(msg: string): void {
    const t = h(`<div class="toast"></div>`);
    t.textContent = msg;
    this.hudEls.toasts.appendChild(t);
    setTimeout(() => t.remove(), 4100);
  }

  updateHud(d: HudData): void {
    const e = this.hudEls;
    // Boussole : 1 radian = 160 px
    const pxPerRad = 160;
    const width = (e.strip.parentElement as HTMLElement).clientWidth;
    const place = (el: HTMLElement, bearing: number) => {
      let delta = bearing - d.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      el.style.left = `${width / 2 + delta * pxPerRad}px`;
      el.style.display = Math.abs(delta) < 1.7 ? '' : 'none';
    };
    this.compassMarks.forEach((m, i) => place(m, (i / 8) * Math.PI * 2));
    const seen = new Set<string>();
    // Du plus proche au plus lointain ; un repère qui en chevaucherait un autre est masqué.
    const placed: number[] = [];
    for (const p of [...d.pois].sort((a, b) => a.dist - b.dist)) {
      let m = this.poiMarks.get(p.name);
      if (!m) {
        m = h(`<div class="mark poi"></div>`);
        e.strip.appendChild(m);
        this.poiMarks.set(p.name, m);
      }
      let delta = p.bearing - d.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const x = delta * pxPerRad;
      if (placed.some((px) => Math.abs(px - x) < 150)) continue;
      placed.push(x);
      m.textContent = `◆ ${p.name} ${p.dist >= 1000 ? (p.dist / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(p.dist) + ' m'}`;
      place(m, p.bearing);
      seen.add(p.name);
    }
    for (const [k, m] of this.poiMarks) if (!seen.has(k)) m.style.display = 'none';

    e.region.textContent = d.region;
    e.clock.innerHTML = `${d.clock}<br><small>${d.weather}</small>`;
    const isHalden = d.faction === 'halden';
    e.tech.classList.toggle('visible', isHalden);
    if (isHalden) {
      const deg = ((d.heading * 180) / Math.PI + 360) % 360;
      e.tech.innerHTML = `CAP ${deg.toFixed(0).padStart(3, '0')}°<br>ALT ${d.y.toFixed(1)} m · SOL +${Math.max(0, d.groundClearance).toFixed(1)} m<br>POS ${d.x.toFixed(0)} / ${d.z.toFixed(0)}`;
    }
    e.vitalsLabel.textContent = isHalden ? 'Propulseur' : 'Endurance';
    e.vitalsBar.className = 'bar ' + (isHalden ? 'fuel' : 'stamina');
    e.vitalsFill.style.width = `${Math.round((isHalden ? d.fuel : d.stamina) * 100)}%`;
    e.vitals.style.display = d.ride ? 'none' : '';
    // Monte / pilotage
    e.ride.classList.toggle('visible', !!d.ride);
    if (d.ride) {
      const r = d.ride;
      e.rideName.textContent = r.name;
      e.rideSpeed.textContent = `${Math.round(r.speed * 3.6)} km/h`;
      const html = r.gauges
        .map((g) => `<div class="label">${g.label}</div><div class="bar ${g.kind}${g.value < 0.2 ? ' low' : ''}"><i style="width:${Math.round(Math.max(0, Math.min(1, g.value)) * 100)}%"></i></div>`)
        .join('');
      if (e.rideGauges.innerHTML !== html) e.rideGauges.innerHTML = html;
      e.rideExtra.textContent = r.extra;
    }
    // Apprivoisement
    const t = d.taming;
    e.tame.classList.toggle('visible', !!t);
    if (t) {
      e.tameName.textContent = t.phase === 'aucune' ? t.name : `${t.name} — confiance ${Math.round(t.trust)} %`;
      e.tameTrust.style.width = `${Math.round(t.trust)}%`;
      e.tameRhythm.style.display = t.rhythm >= 0 || t.harness > 0 ? '' : 'none';
      e.tameRhythmFill.style.width = `${Math.round((t.harness > 0 ? t.harness : Math.max(0, t.rhythm)) * 100)}%`;
      e.tameHint.textContent = t.hint;
    }
    e.abilityName.textContent = d.abilityName;
    e.abilityRing.style.setProperty('--p', `${Math.round(d.abilityReady * 100)}%`);
    if (d.hint !== this.lastHint) {
      this.lastHint = d.hint;
      e.hint.textContent = d.hint;
      e.hint.classList.toggle('visible', d.hint !== '');
    }
    e.fps.classList.toggle('visible', this.settings.showFps);
    if (this.settings.showFps) e.fps.innerHTML = d.fps;
    e.clickToPlay.classList.toggle('visible', !d.pointerLocked && !d.usingPad);
  }

  applySettings(s: Settings): void {
    this.settings = { ...s };
    this.syncSettings();
  }
}
