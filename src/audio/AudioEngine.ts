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
