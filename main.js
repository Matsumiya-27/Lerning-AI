// ===== エントリーポイント =====
import { canvas, resetButton, updateAnimations } from './state.js';
import { resetGame, updateTurnFlow } from './turn.js';
import { draw } from './render.js';
import { onPointerDown, onPointerMove, onPointerUp } from './input.js';
import { replaceLeftmostHandCard } from './cards.js';
import { initDeck } from './deck.js';
import { openDeckBuilder } from './deckbuilder.js';

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

const handEditButton = document.getElementById('handEditButton');
const handEditSelect = document.getElementById('handEditSelect');
handEditButton.addEventListener('click', () => {
  const parts = handEditSelect.value.split('-');
  const rank = parseInt(parts[0], 10);
  const effect = parts[1] === 'null' ? null : parts[1];
  const al = parseInt(parts[2], 10);
  const ar = parseInt(parts[3], 10);
  replaceLeftmostHandCard('player', rank, effect, al, ar);
});

// 対戦画面に遷移したタイミングでゲームをリセット開始
document.addEventListener('navigate-to-game', resetGame);

// デッキ編集画面に遷移したタイミングでデッキビルダーを開く
document.addEventListener('navigate-to-edit', openDeckBuilder);

// ===== 起動 =====

// デッキ初期化（サンプルデッキをセット）
initDeck();

requestAnimationFrame(loop);
