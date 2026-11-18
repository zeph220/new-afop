import './ui/ui.css';
import { Game } from './core/Game.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

function fatal(msg: string): void {
  ui.innerHTML = `<div class="screen visible" style="align-items:center;justify-content:center;flex-direction:column;padding:2rem;text-align:center">
    <div class="title" style="font-size:3rem">VEYRA</div>
    <p style="max-width:560px;line-height:1.5;color:#ddd6c9">${msg}</p></div>`;
}

try {
  const game = new Game(canvas, ui);
  (window as unknown as { veyra: Game }).veyra = game;
  game.start().catch((e) => {
    console.error(e);
    fatal(`Le chargement a échoué : ${String(e?.message ?? e)}`);
  });
} catch (e) {
  console.error(e);
  fatal(
    'Votre navigateur ne prend pas en charge WebGL2 ou l’accélération graphique est désactivée. ' +
      'Essayez un navigateur de bureau récent (Chrome, Edge, Firefox) avec l’accélération matérielle activée.',
  );
}
