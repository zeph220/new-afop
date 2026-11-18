// Ambiance sonore 100 % synthétisée (Web Audio API) : aucun fichier son externe.

interface Loop {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export interface AudioParams {
  wind: number;
  rain: number;
  night: number;
  altitude: number; // hauteur au-dessus du sol
  jetpack: number;
  active: boolean; // en jeu (sinon ambiance atténuée)
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private wind!: Loop;
  private rain!: Loop;
  private jet!: Loop;
  private jetHum!: { osc: OscillatorNode; gain: GainNode };
  private nextCall = 1;
  private volume = 0.7;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Doit être appelé depuis un geste utilisateur (politique d'autoplay des navigateurs). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 1;
    this.ambience.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.wind = this.loop('bandpass', 420, 0.6);
    this.rain = this.loop('highpass', 1400, 0.3);
    this.jet = this.loop('bandpass', 950, 0.9);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 62;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(this.master);
    osc.start();
    this.jetHum = { osc, gain: g };
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private loop(type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ambience);
    src.start();
    return { src, filter, gain };
  }

  update(dt: number, p: AudioParams): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
    const alt = Math.min(1, Math.max(0, p.altitude / 120));
    this.wind.gain.gain.setTargetAtTime((0.03 + p.wind * 0.16 + alt * 0.12) * (0.6 + 0.4 * gust), t, 0.3);
    this.wind.filter.frequency.setTargetAtTime(300 + gust * 500 + p.wind * 300, t, 0.5);
    this.rain.gain.gain.setTargetAtTime(p.rain * 0.22, t, 0.5);
    this.jet.gain.gain.setTargetAtTime(p.jetpack * 0.35, t, 0.05);
    this.jetHum.gain.gain.setTargetAtTime(p.jetpack * 0.12, t, 0.05);
    this.ambience.gain.setTargetAtTime(p.active ? 1 : 0.45, t, 0.4);

    // Faune : appels synthétiques (jour : trilles ; nuit : stridulations et appels graves).
    this.nextCall -= dt;
    if (this.nextCall <= 0) {
      const calm = 1 - p.rain * 0.8;
      if (Math.random() < 1 - p.night) {
        this.chirp(calm * (1 - alt * 0.6));
        this.nextCall = 0.4 + Math.random() * 2.2;
      } else {
        if (Math.random() < 0.75) this.insects(calm);
        else this.hoot(calm);
        this.nextCall = 0.5 + Math.random() * 2.5;
      }
    }
  }

  private panned(pan: number): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.ambience);
    return p;
  }

  private chirp(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panned(Math.random() * 2 - 1);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 2200;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const st = t + i * (0.07 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.1), st);
      o.frequency.exponentialRampToValueAtTime(base * (0.65 + Math.random() * 0.6), st + 0.06);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.025 * vol, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(g).connect(out);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  private insects(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panned(Math.random() * 2 - 1);
    const o = ctx.createOscillator();
    o.frequency.value = 3800 + Math.random() * 1800;
    const am = ctx.createOscillator();
    am.frequency.value = 22 + Math.random() * 25;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.5;
    const g = ctx.createGain();
    const dur = 0.4 + Math.random() * 0.9;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 * vol, t + 0.05);
    g.gain.setValueAtTime(0.012 * vol, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    am.connect(amGain).connect(g.gain);
    o.connect(g).connect(out);
    o.start(t);
    am.start(t);
    o.stop(t + dur);
    am.stop(t + dur);
  }

  private hoot(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panned(Math.random() * 2 - 1);
    const f0 = 170 + Math.random() * 120;
    for (let i = 0; i < 3; i++) {
      // l'« appel en trois temps » de la faune nocturne
      const st = t + i * 0.42;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * (i === 2 ? 0.8 : 1), st);
      o.frequency.linearRampToValueAtTime(f0 * (i === 2 ? 0.7 : 0.9), st + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.05 * vol, st + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.35);
      o.connect(g).connect(out);
      o.start(st);
      o.stop(st + 0.4);
    }
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, vol: number, delay = 0, freqEnd?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  step(strength: number, heavy: boolean): void {
    if (!this.ctx || strength <= 0) return;
    this.burst(0.09, 'lowpass', heavy ? 700 : 1100, 0.12 * strength);
    if (heavy) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 1700 + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.012 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.03);
    }
  }

  land(impact: number): void {
    this.burst(0.18, 'lowpass', 500, Math.min(0.35, impact * 0.03));
  }

  splash(): void {
    this.burst(0.5, 'bandpass', 900, 0.25, 0, 300);
  }

  thunder(delay: number, strength: number): void {
    this.burst(3.5, 'lowpass', 320, 0.6 * strength, delay, 60);
    this.burst(1.2, 'lowpass', 900, 0.25 * strength, delay, 120);
  }

  pulse(sylmar: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = sylmar ? 'sine' : 'sawtooth';
    o.frequency.setValueAtTime(sylmar ? 330 : 880, t);
    o.frequency.exponentialRampToValueAtTime(sylmar ? 660 : 220, t + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = sylmar ? 2000 : 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1);
  }

  // -------------------------------------------------------------------------------------------
  // Itération 2 : moteurs, cris des montures, battements d'ailes, chocs.

  private engines = new Map<string, { gain: GainNode; osc: OscillatorNode; lfo?: OscillatorNode; filter: BiquadFilterNode }>();

  /** Son moteur continu d'un véhicule (créé à la demande) ; power 0 = silence. */
  engine(kind: 'gyro' | 'marcheur' | 'chenille' | 'hydro', power: number, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !Number.isFinite(power) || !Number.isFinite(speed)) return;
    let e = this.engines.get(kind);
    if (!e) {
      const cfg = {
        gyro: { type: 'sawtooth' as OscillatorType, f: 70, filt: 'lowpass' as BiquadFilterType, ff: 900 },
        marcheur: { type: 'triangle' as OscillatorType, f: 52, filt: 'lowpass' as BiquadFilterType, ff: 400 },
        chenille: { type: 'sawtooth' as OscillatorType, f: 36, filt: 'lowpass' as BiquadFilterType, ff: 220 },
        hydro: { type: 'sawtooth' as OscillatorType, f: 105, filt: 'bandpass' as BiquadFilterType, ff: 700 },
      }[kind];
      const osc = ctx.createOscillator();
      osc.type = cfg.type;
      osc.frequency.value = cfg.f;
      const filter = ctx.createBiquadFilter();
      filter.type = cfg.filt;
      filter.frequency.value = cfg.ff;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.master);
      // Gyrocoptère : battement des pales (modulation d'amplitude au régime du rotor).
      let lfo: OscillatorNode | undefined;
      if (kind === 'gyro') {
        lfo = ctx.createOscillator();
        lfo.frequency.value = 14;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(gain.gain);
        lfo.start();
      }
      osc.start();
      e = { gain, osc, lfo, filter };
      this.engines.set(kind, e);
    }
    const t = ctx.currentTime;
    const base = { gyro: 0.1, marcheur: 0.08, chenille: 0.16, hydro: 0.07 }[kind];
    e.gain.gain.setTargetAtTime(power * base, t, 0.15);
    const f0 = { gyro: 70, marcheur: 52, chenille: 36, hydro: 105 }[kind];
    e.osc.frequency.setTargetAtTime(f0 * (0.7 + 0.6 * power) + Math.abs(speed) * 1.5, t, 0.2);
    if (e.lfo) e.lfo.frequency.setTargetAtTime(6 + 16 * power, t, 0.3);
  }

  stopEngines(): void {
    if (!this.ctx) return;
    for (const e of this.engines.values()) e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  /** Cri d'une monture (un temps de l'appel). `player` : réponse imitée par le joueur. */
  creatureCall(kind: 'skarel' | 'tormaq' | 'vexil', gain = 1, player = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = gain * (player ? 0.6 : 1);
    out.connect(this.master);
    const tone = (f0: number, f1: number, start: number, dur: number, type: OscillatorType, vol: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + start);
      o.frequency.exponentialRampToValueAtTime(f1, t + start + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(vol, t + start + Math.min(0.05, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g).connect(out);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
    };
    const k = player ? 0.8 : 1;
    if (kind === 'skarel') {
      tone(700 * k, 1150 * k, 0, 0.45, 'sine', 0.14);
      tone(1400 * k, 2200 * k, 0.02, 0.4, 'sine', 0.04);
    } else if (kind === 'tormaq') {
      tone(92 * k, 70 * k, 0, 0.6, 'sine', 0.3);
      tone(184 * k, 140 * k, 0, 0.55, 'triangle', 0.08);
    } else {
      for (let i = 0; i < 3; i++) tone(1900 * k, 1500 * k, i * 0.06, 0.04, 'square', 0.05);
    }
  }

  flap(): void {
    this.burst(0.45, 'lowpass', 600, 0.25, 0, 180);
  }

  clank(strength: number): void {
    this.burst(0.25, 'bandpass', 1800, Math.min(0.4, 0.08 + strength * 0.02));
    this.burst(0.4, 'lowpass', 300, Math.min(0.4, strength * 0.03));
  }

  walkerStep(): void {
    this.burst(0.3, 'lowpass', 140, 0.35);
    this.burst(0.25, 'highpass', 3200, 0.05, 0.05);
  }

  /** Bruitages de combat, de récolte et de faune (synthétisés). */
  sfx(kind: 'bowDraw' | 'bowShot' | 'hit' | 'thud' | 'swing' | 'pulse' | 'flare' | 'hurt' | 'pickup' | 'craft' | 'open' | 'chop' | 'growl' | 'bleat' | 'chirp' | 'squeal' | 'death' | 'empty', gain = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tone = (f0: number, f1: number, delay: number, dur: number, type: OscillatorType, g: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, t + delay);
      a.gain.exponentialRampToValueAtTime(g * gain, t + delay + Math.min(0.02, dur * 0.2));
      a.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(a).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.02);
    };
    switch (kind) {
      case 'bowDraw': this.burst(0.5, 'bandpass', 900, 0.03 * gain); break;
      case 'bowShot': tone(180, 90, 0, 0.18, 'triangle', 0.25); this.burst(0.12, 'highpass', 2500, 0.08 * gain); break;
      case 'hit': this.burst(0.12, 'lowpass', 900, 0.3 * gain); tone(240, 120, 0, 0.08, 'square', 0.05); break;
      case 'thud': this.burst(0.2, 'lowpass', 300, 0.25 * gain); break;
      case 'swing': this.burst(0.22, 'bandpass', 1400, 0.1 * gain); break;
      case 'pulse': tone(90, 900, 0, 0.25, 'sawtooth', 0.12); this.burst(0.3, 'highpass', 1800, 0.12 * gain); break;
      case 'flare': tone(400, 1400, 0, 0.5, 'sine', 0.06); this.burst(0.6, 'bandpass', 2400, 0.08 * gain); break;
      case 'hurt': tone(160, 70, 0, 0.25, 'sawtooth', 0.12); this.burst(0.15, 'lowpass', 500, 0.2 * gain); break;
      case 'pickup': tone(660, 990, 0, 0.09, 'sine', 0.08); tone(990, 1320, 0.07, 0.09, 'sine', 0.06); break;
      case 'craft': this.burst(0.15, 'bandpass', 1200, 0.12 * gain); this.burst(0.15, 'bandpass', 800, 0.12 * gain, 0.18); tone(520, 780, 0.35, 0.15, 'sine', 0.07); break;
      case 'open': this.burst(0.35, 'lowpass', 700, 0.15 * gain); tone(220, 180, 0.05, 0.3, 'triangle', 0.04); break;
      case 'chop': this.burst(0.1, 'bandpass', 600, 0.35 * gain); tone(300, 140, 0, 0.07, 'square', 0.05); break;
      case 'growl': tone(85, 60, 0, 0.9, 'sawtooth', 0.12); tone(170, 110, 0, 0.8, 'triangle', 0.05); break;
      case 'bleat': tone(420, 360, 0, 0.35, 'triangle', 0.1); tone(840, 700, 0, 0.3, 'sine', 0.03); break;
      case 'chirp': for (let i = 0; i < 3; i++) tone(2400, 3400, i * 0.08, 0.05, 'sine', 0.05); break;
      case 'squeal': tone(1200, 1800, 0, 0.2, 'square', 0.04); break;
      case 'death': tone(300, 70, 0, 0.7, 'triangle', 0.12); break;
      case 'empty': tone(1200, 1100, 0, 0.04, 'square', 0.04); break;
    }
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 760;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.07);
  }
}
