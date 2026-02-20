// ===== エントリーポイント =====
import { canvas, resetButton, updateAnimations } from './state.js';
import { resetGame, updateTurnFlow } from './turn.js';
import { draw } from './render.js';
import { onPointerDown, onPointerMove, onPointerUp } from './input.js';

// ===== ゲームループ =====

function loop(nowMs) {
  updateAnimations(nowMs);
  updateTurnFlow(nowMs);
  draw(nowMs);
  requestAnimationFrame(loop);
}

// ===== イベント =====

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);

resetButton.addEventListener('click', resetGame);

// ===== 起動 =====

resetGame();
requestAnimationFrame(loop);
