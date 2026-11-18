// Entrées clavier / souris / manette, ramenées à des actions de jeu.
// Le clavier utilise les codes physiques (KeyW = Z sur AZERTY, W sur QWERTY).

export type Action = 'jump' | 'sprint' | 'crouch' | 'ability' | 'lamp' | 'interact' | 'pause' | 'help' | 'map' | 'call' | 'engine' | 'attack' | 'aim' | 'inventory' | 'weapon' | 'use' | 'quick' | 'quickMode';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  KeyC: 'crouch',
  KeyF: 'ability',
  KeyL: 'lamp',
  KeyE: 'interact',
  Escape: 'pause',
  KeyH: 'help',
  KeyM: 'map',
  KeyR: 'call',
  KeyV: 'engine',
  Mouse0: 'attack',
  Mouse2: 'aim',
  Tab: 'inventory',
  KeyI: 'inventory',
  KeyX: 'weapon',
  KeyG: 'use',
  KeyQ: 'quick', // touche A sur un clavier AZERTY
  KeyT: 'quickMode',
};

// Boutons de manette standard (mapping « standard » de l'API Gamepad).
const PADMAP: Partial<Record<Action, number[]>> = {
  jump: [0],
  crouch: [1],
  ability: [2],
  lamp: [3],
  sprint: [6, 10],
  interact: [5],
  call: [4],
  engine: [11],
  attack: [7],
  weapon: [12],
  inventory: [13],
  use: [14],
  pause: [9],
  help: [8],
};

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private padPrev = new Map<number, boolean>();
  private padNow = new Map<number, boolean>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  moveX = 0; // -1 gauche … 1 droite
  moveY = 0; // -1 arrière … 1 avant
  lookX = 0; // manette (rad/s normalisés)
  lookY = 0;
  usingPad = false;
  pointerLocked = false;
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping(e)) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      this.usingPad = false;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.keys.add('Mouse' + e.button);
      this.pressedKeys.add('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.pointerLocked) this.wheel += Math.sign(e.deltaY);
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** À appeler une fois par image, avant la logique de jeu. */
  poll(): void {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    let mx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    let my = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    this.lookX = 0;
    this.lookY = 0;
    this.padPrev = this.padNow;
    this.padNow = new Map();
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(pad.axes[0] ?? 0);
      const ly = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      if (lx || ly || rx || ry || pad.buttons.some((b) => b.pressed)) this.usingPad = true;
      if (lx || ly) {
        mx = lx;
        my = -ly;
      }
      this.lookX = rx;
      this.lookY = ry;
      pad.buttons.forEach((b, i) => this.padNow.set(i, b.pressed || b.value > 0.5));
      break;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;
  }

  /** Action maintenue. */
  held(a: Action): boolean {
    for (const [code, act] of Object.entries(KEYMAP)) if (act === a && this.keys.has(code)) return true;
    for (const b of PADMAP[a] ?? []) if (this.padNow.get(b)) return true;
    return false;
  }

  /** Action déclenchée pendant cette image. */
  pressed(a: Action): boolean {
    for (const code of this.pressedKeys) if (KEYMAP[code] === a) return true;
    for (const b of PADMAP[a] ?? []) if (this.padNow.get(b) && !this.padPrev.get(b)) return true;
    return false;
  }

  /** Consomme une action déclenchée (elle ne sera plus vue comme « pressée » cette image). */
  consume(a: Action): void {
    for (const code of [...this.pressedKeys]) if (KEYMAP[code] === a) this.pressedKeys.delete(code);
    for (const b of PADMAP[a] ?? []) this.padPrev.set(b, true);
  }

  /** Chiffre 1–9 pressé pendant cette image (rangée du haut ou pavé numérique), sinon 0. */
  digitPressed(): number {
    for (const c of this.pressedKeys) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(c);
      if (m) return Number(m[1]);
    }
    return 0;
  }

  /** Neutralise déplacements et visée (panneau ouvert). */
  freeze(): void {
    this.moveX = this.moveY = this.lookX = this.lookY = 0;
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }

  /** Fin d'image : remet à zéro les deltas. */
  endFrame(): void {
    this.pressedKeys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
