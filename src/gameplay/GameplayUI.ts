// Interface du gameplay : santé, satiété, arme, vent, viseur, invite d'interaction,
// et panneau d'inventaire (objets, fabrication, équipement).

import { ITEMS, RECIPES, UPGRADES, type Inventory, type Recipe } from './Items.ts';
import type { FactionId } from '../player/Factions.ts';

const CSS = `
.gp-vitals { position: absolute; left: 22px; bottom: 100px; width: 230px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.gp-bar { height: 7px; background: rgba(0,0,0,0.45); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
.gp-bar i { display: block; height: 100%; width: 100%; transition: width 0.2s; }
.gp-hp i { background: linear-gradient(90deg, #c8372a, #ff6a4a); }
.gp-food i { background: linear-gradient(90deg, #a77b2a, #e3b45a); }
.gp-lbl { font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-dim); display: flex; justify-content: space-between; }
.gp-weapon { position: absolute; right: 22px; bottom: 96px; text-align: right; pointer-events: none; text-shadow: 0 1px 3px #000; }
.gp-weapon b { display: block; font-size: 0.95rem; color: var(--accent); }
.gp-weapon small { color: var(--ink-dim); font-size: 0.75rem; }
.gp-wind { position: absolute; top: 84px; right: 22px; display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--ink-dim); pointer-events: none; text-shadow: 0 1px 3px #000; }
.gp-wind span.arrow { display: inline-block; width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25); position: relative; }
.gp-wind span.arrow::after { content: ''; position: absolute; left: 50%; top: 3px; width: 2px; height: 14px; margin-left: -1px; background: #cfe6ff; box-shadow: 0 0 4px #9cf; }
.gp-wind span.arrow::before { content: ''; position: absolute; left: 50%; top: 1px; margin-left: -4px; border: 4px solid transparent; border-bottom: 6px solid #cfe6ff; }
.gp-cross { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; pointer-events: none; opacity: 0; transition: opacity 0.15s; }
.gp-cross::before, .gp-cross::after { content: ''; position: absolute; background: rgba(255,255,255,0.85); box-shadow: 0 0 2px #000; }
.gp-cross::before { left: 8px; top: 0; width: 2px; height: 18px; }
.gp-cross::after { top: 8px; left: 0; height: 2px; width: 18px; }
.gp-cross.on { opacity: 0.9; }
.gp-cross.hit::before, .gp-cross.hit::after { background: #ff6a4a; }
.gp-draw { position: absolute; left: 50%; top: calc(50% + 22px); width: 60px; margin-left: -30px; height: 3px; background: rgba(0,0,0,0.4); pointer-events: none; display: none; }
.gp-draw i { display: block; height: 100%; background: var(--accent); width: 0; }
.gp-prompt { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; font-size: 0.85rem; pointer-events: none; display: none; white-space: nowrap; }
.gp-hurt { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px rgba(200, 20, 10, 0.85); opacity: 0; transition: opacity 0.4s; }
.gp-inv { position: absolute; inset: 6% 8%; background: var(--panel-strong); border: 1px solid var(--line); border-radius: 10px; display: none; grid-template-columns: 1.1fr 1.3fr 0.9fr; gap: 18px; padding: 20px 24px; overflow: hidden; pointer-events: auto; z-index: 30; }
.gp-inv.open { display: grid; }
.gp-inv h3 { margin: 0 0 10px; font-size: 0.8rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-dim); font-weight: 600; }
.gp-inv .col { overflow-y: auto; min-height: 0; }
.gp-item, .gp-rec { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 6px; border: 1px solid transparent; font-size: 0.86rem; }
.gp-item:hover, .gp-rec:hover { border-color: var(--line); background: rgba(255,255,255,0.03); }
.gp-item small, .gp-rec small { display: block; color: var(--ink-dim); font-size: 0.74rem; }
.gp-item .n { font-variant-numeric: tabular-nums; color: var(--accent); min-width: 2.5em; text-align: right; }
.gp-inv button { font: inherit; font-size: 0.78rem; background: #23262c; color: var(--ink); border: 1px solid #3a3e46; border-radius: 5px; padding: 4px 10px; cursor: pointer; }
.gp-inv button:hover:not(:disabled) { border-color: var(--accent); }
.gp-inv button:disabled { opacity: 0.35; cursor: default; }
.gp-rec.ok { border-color: rgba(255,176,74,0.25); }
.gp-wsel { display: flex; flex-direction: column; gap: 6px; }
.gp-wsel button.cur { border-color: var(--accent); color: var(--accent); }
.gp-close { position: absolute; right: 16px; top: 12px; }
.gp-quick { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 340px; background: var(--panel-strong); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: none; z-index: 25; pointer-events: none; }
.gp-qtabs { display: flex; gap: 14px; align-items: baseline; margin-bottom: 8px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-dim); }
.gp-qtabs span.on { color: var(--accent); border-bottom: 2px solid var(--accent); }
.gp-qtabs small { margin-left: auto; text-transform: none; letter-spacing: 0; }
.gp-qrow { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: baseline; padding: 6px 8px; border-radius: 6px; font-size: 0.9rem; }
.gp-qrow b { color: var(--ink-dim); }
.gp-qrow small { color: var(--ink-dim); font-size: 0.75rem; }
.gp-qrow.sel { background: rgba(255,176,74,0.12); outline: 1px solid rgba(255,176,74,0.4); }
.gp-qhelp { margin-top: 8px; font-size: 0.72rem; color: var(--ink-dim); text-align: center; }
.gp-stats { font-size: 0.82rem; line-height: 1.7; color: var(--ink-dim); margin-top: 14px; }
`;

export interface WeaponView {
  id: string;
  name: string;
  ammo: string;
}

export interface GameplayUICallbacks {
  onUse(id: string): void;
  onCraft(r: Recipe): void;
  onEquip(index: number): void;
  onClose(): void;
  canCraftHere(r: Recipe): boolean;
}

export class GameplayUI {
  open = false;
  private el: Record<string, HTMLElement> = {};
  private inv: HTMLElement;
  private cb: GameplayUICallbacks;
  private faction: FactionId;
  private hurtT = 0;
  private hitT = 0;

  constructor(hud: HTMLElement, faction: FactionId, cb: GameplayUICallbacks) {
    this.cb = cb;
    this.faction = faction;
    if (!document.getElementById('gp-style')) {
      const s = document.createElement('style');
      s.id = 'gp-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const wrap = document.createElement('div');
    wrap.className = 'gp-layer';
    wrap.innerHTML = `
      <div class="gp-hurt"></div>
      <div class="gp-vitals">
        <div class="gp-lbl"><span>Santé</span><span class="gp-hpv"></span></div><div class="gp-bar gp-hp"><i></i></div>
        <div class="gp-lbl"><span>Satiété</span><span class="gp-foodv"></span></div><div class="gp-bar gp-food"><i></i></div>
      </div>
      <div class="gp-weapon"><b></b><small></small></div>
      <div class="gp-wind"><span class="txt"></span><span class="arrow"></span></div>
      <div class="gp-cross"></div>
      <div class="gp-draw"><i></i></div>
      <div class="gp-prompt"></div>`;
    hud.appendChild(wrap);
    this.inv = document.createElement('div');
    this.inv.className = 'gp-inv';
    hud.appendChild(this.inv);
    const q = (s: string) => wrap.querySelector(s) as HTMLElement;
    this.el = {
      hurt: q('.gp-hurt'),
      hp: q('.gp-hp i'),
      hpv: q('.gp-hpv'),
      food: q('.gp-food i'),
      foodv: q('.gp-foodv'),
      wName: q('.gp-weapon b'),
      wAmmo: q('.gp-weapon small'),
      windTxt: q('.gp-wind .txt'),
      windArrow: q('.gp-wind .arrow'),
      cross: q('.gp-cross'),
      draw: q('.gp-draw'),
      drawFill: q('.gp-draw i'),
      prompt: q('.gp-prompt'),
    };
    this.inv.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'use') this.cb.onUse(b.dataset.id!);
      else if (act === 'craft') {
        const r = RECIPES.find((x) => x.id === b.dataset.id);
        if (r) this.cb.onCraft(r);
      } else if (act === 'equip') this.cb.onEquip(Number(b.dataset.i));
      else if (act === 'close') this.cb.onClose();
    });
  }

  hurt(): void {
    this.hurtT = 0.5;
  }

  hitMarker(): void {
    this.hitT = 0.18;
  }

  update(
    dt: number,
    s: { hp: number; maxHp: number; food: number; weapon: WeaponView; windFrom: number; windKmh: number; camYawDeg: number; aiming: boolean; draw: number; prompt: string },
  ): void {
    const e = this.el;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    e.hurt.style.opacity = String(Math.min(1, this.hurtT * 2 + (s.hp < s.maxHp * 0.25 ? 0.35 : 0)));
    e.hp.style.width = `${(100 * s.hp) / s.maxHp}%`;
    e.hpv.textContent = String(Math.ceil(s.hp));
    e.food.style.width = `${s.food}%`;
    e.foodv.textContent = String(Math.ceil(s.food));
    e.wName.textContent = s.weapon.name;
    e.wAmmo.textContent = s.weapon.ammo;
    e.windTxt.textContent = `Vent ${s.windKmh} km/h`;
    // La flèche indique où le vent souffle, relativement à la caméra.
    e.windArrow.style.transform = `rotate(${s.windFrom + 180 - s.camYawDeg}deg)`;
    e.cross.classList.toggle('on', s.aiming);
    e.cross.classList.toggle('hit', this.hitT > 0);
    e.draw.style.display = s.draw > 0 ? 'block' : 'none';
    e.drawFill.style.width = `${Math.round(s.draw * 100)}%`;
    if (s.prompt) {
      e.prompt.style.display = 'block';
      if (e.prompt.textContent !== s.prompt) e.prompt.textContent = s.prompt;
    } else e.prompt.style.display = 'none';
  }

  /** (Re)dessine le panneau d'inventaire. */
  render(inv: Inventory, weapons: WeaponView[], current: number, stats: string): void {
    if (!this.open) return;
    const items = Object.entries(inv.items)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => (ITEMS[a]?.kind ?? '').localeCompare(ITEMS[b]?.kind ?? '') || a.localeCompare(b));
    const itemHtml = items.length
      ? items
          .map(([id, n]) => {
            const d = ITEMS[id];
            const usable = d && (d.kind === 'soin' || d.kind === 'nourriture' || id === 'feu_camp');
            return `<div class="gp-item"><div>${d?.name ?? id}<small>${d?.desc ?? ''}</small></div><span class="n">${UPGRADES.has(id) ? '✓' : n}</span>${usable ? `<button data-act="use" data-id="${id}">${id === 'feu_camp' ? 'Poser' : 'Utiliser'}</button>` : ''}</div>`;
          })
          .join('')
      : '<p style="color:var(--ink-dim)">Sac vide. Récoltez plantes, bois et pierres (E), chassez, fouillez les caisses.</p>';
    const recs = RECIPES.filter((r) => !r.faction || r.faction === this.faction);
    const recHtml = recs
      .map((r) => {
        const ok = inv.canCraft(r);
        const here = this.cb.canCraftHere(r);
        const needs = Object.entries(r.needs)
          .map(([k, n]) => `<span style="color:${inv.has(k, n) ? 'var(--ink)' : 'var(--danger)'}">${n} ${ITEMS[k]?.name ?? k}</span>`)
          .join(' · ');
        const st = r.station === 'feu' ? ' — près d’un feu' : r.station === 'etabli' ? ' — à un établi' : '';
        return `<div class="gp-rec ${ok && here ? 'ok' : ''}"><div>${r.qty > 1 ? r.qty + ' × ' : ''}${ITEMS[r.out]?.name ?? r.out}<small>${needs}${st}</small></div><button data-act="craft" data-id="${r.id}" ${ok && here ? '' : 'disabled'}>Fabriquer</button></div>`;
      })
      .join('');
    const wHtml = weapons
      .map((w, i) => `<button data-act="equip" data-i="${i}" class="${i === current ? 'cur' : ''}">${i + 1}. ${w.name} <small style="color:var(--ink-dim)">${w.ammo}</small></button>`)
      .join('');
    this.inv.innerHTML = `
      <button class="gp-close" data-act="close">Fermer (Tab)</button>
      <div class="col"><h3>Sac</h3>${itemHtml}</div>
      <div class="col"><h3>Fabrication</h3>${recHtml}</div>
      <div class="col"><h3>Équipement</h3><div class="gp-wsel">${wHtml}</div><div class="gp-stats">${stats}</div></div>`;
  }

  private quickEl: HTMLElement | null = null;
  private quickKey = '';

  /** Panneau rapide (touche A maintenue). */
  quick(open: boolean, mode: 'armes' | 'nourriture', entries: { label: string; detail: string }[], sel: number): void {
    if (!this.quickEl) {
      this.quickEl = document.createElement('div');
      this.quickEl.className = 'gp-quick';
      this.inv.parentElement!.appendChild(this.quickEl);
    }
    this.quickEl.style.display = open ? 'block' : 'none';
    if (!open) return;
    const key = mode + sel + entries.map((e) => e.label).join('|');
    if (key === this.quickKey) return;
    this.quickKey = key;
    const tabs = `<div class="gp-qtabs"><span class="${mode === 'armes' ? 'on' : ''}">Armes</span><span class="${mode === 'nourriture' ? 'on' : ''}">Nourriture et soins</span><small><kbd>T</kbd> changer</small></div>`;
    const list = entries.length
      ? entries.map((e, i) => `<div class="gp-qrow ${i === sel ? 'sel' : ''}"><b>${i + 1}</b><span>${e.label}</span><small>${e.detail}</small></div>`).join('')
      : '<div class="gp-qrow"><span>Rien à manger ni à soigner dans le sac.</span></div>';
    this.quickEl.innerHTML = tabs + list + '<div class="gp-qhelp">Molette ou 1–9 · clic : valider · relâcher A : fermer</div>';
  }

  setOpen(o: boolean): void {
    this.open = o;
    this.inv.classList.toggle('open', o);
  }

  dispose(): void {
    this.inv.remove();
    document.querySelector('.gp-layer')?.remove();
  }
}
