// Machine à états du jeu : chargement → menu → choix de camp → jeu ⇄ pause.

export type GameState = 'boot' | 'menu' | 'factionSelect' | 'playing' | 'paused';

const TRANSITIONS: Record<GameState, GameState[]> = {
  boot: ['menu'],
  menu: ['factionSelect', 'playing'],
  factionSelect: ['menu', 'playing'],
  playing: ['paused', 'menu'],
  paused: ['playing', 'menu'],
};

export type StateListener = (to: GameState, from: GameState) => void;

export class StateMachine {
  private current: GameState = 'boot';
  private listeners: StateListener[] = [];

  get state(): GameState {
    return this.current;
  }

  can(to: GameState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  go(to: GameState): boolean {
    if (to === this.current) return true;
    if (!this.can(to)) return false;
    const from = this.current;
    this.current = to;
    for (const l of this.listeners) l(to, from);
    return true;
  }

  on(l: StateListener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}
