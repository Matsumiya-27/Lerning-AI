// ========================================
// Canvas Card Game MVP (Stage: Swipe Combat)
// ========================================
// 目的:
// - 手札カードのドラッグ&ドロップ
// - 場カードの左右スワイプ攻撃
// - 1カード1回行動、解決中の全体入力ロック

// ===== 定数 =====
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
const CARD_WIDTH = 110;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.45);

const MOVE_ANIMATION_MS = 150;
const SWIPE_THRESHOLD = 50;
const SHAKE_DURATION_MS = 260;
const HIT_FLASH_MS = 120;
const DESTROY_ANIMATION_MS = 150;

// ===== DOM =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const resetButton = document.getElementById('resetButton');

// ===== レイアウト =====
const slotCenters = [180, 330, 480, 630, 780].map((x, index) => ({
  id: index,
  x,
  y: 360,
  occupiedByCardId: null,
}));

const playerHandCenters = [255, 405, 555, 705].map((x) => ({ x, y: 620 }));
const enemyHandCenters = [255, 405, 555, 705].map((x) => ({ x, y: 100 }));

// ===== 全体状態 =====
const gameState = {
  cards: [],
  interactionLock: false,
  activePointer: null,
};

// ========================================
// カード生成・初期化
// ========================================
function createCard({ id, owner, zone, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight }) {
  return {
    id,
    owner,
    zone,
    handIndex,
    fieldSlotIndex,
    x,
    y,
    // ルール用の状態
    combat: {
      attackLeft,
      attackRight,
      hasActedThisTurn: false,
    },
    // 見た目・入力用の状態
    ui: {
      isDragging: false,
      animation: null,
      shakeUntilMs: 0,
      crossUntilMs: 0,
      hitFlashUntilMs: 0,
      destroyStartMs: 0,
      destroyUntilMs: 0,
      pendingRemoval: false,
    },
  };
}

function buildInitialCards() {
  // 手札4枚（プレイヤー）
  const playerAttackValues = [
    [2, 5],
    [4, 3],
    [6, 2],
    [3, 4],
  ];

  // 攻撃挙動を確認しやすいよう、敵を最初から2枚だけ場に配置
  const enemyFieldSetup = [
    { slotIndex: 1, attackLeft: 3, attackRight: 4 },
    { slotIndex: 3, attackLeft: 5, attackRight: 2 },
  ];

  const playerCards = playerHandCenters.map((position, index) =>
    createCard({
      id: index,
      owner: 'player',
      zone: 'hand',
      handIndex: index,
      x: position.x,
      y: position.y,
      attackLeft: playerAttackValues[index][0],
      attackRight: playerAttackValues[index][1],
    }),
  );

  const enemyCards = enemyFieldSetup.map((enemy, index) => {
    const slot = slotCenters[enemy.slotIndex];
    return createCard({
      id: playerCards.length + index,
      owner: 'enemy',
      zone: 'field',
      fieldSlotIndex: enemy.slotIndex,
      x: slot.x,
      y: slot.y,
      attackLeft: enemy.attackLeft,
      attackRight: enemy.attackRight,
    });
  });

  gameState.cards = [...playerCards, ...enemyCards];

  // スロット占有情報をリセット後、敵配置を反映
  slotCenters.forEach((slot) => {
    slot.occupiedByCardId = null;
  });
  enemyCards.forEach((card) => {
    slotCenters[card.fieldSlotIndex].occupiedByCardId = card.id;
  });
}

function resetGame() {
  gameState.interactionLock = false;
  gameState.activePointer = null;
  buildInitialCards();
}

// ========================================
// 参照ヘルパー
// ========================================
function getCardById(cardId) {
  return gameState.cards.find((card) => card.id === cardId && !card.ui.pendingRemoval) ?? null;
}

function getCardAtSlot(slotIndex) {
  const slot = slotCenters[slotIndex];
  if (!slot || slot.occupiedByCardId === null) {
    return null;
  }
  return getCardById(slot.occupiedByCardId);
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function pointInCard(px, py, card) {
  const left = card.x - CARD_WIDTH / 2;
  const top = card.y - CARD_HEIGHT / 2;
  return px >= left && px <= left + CARD_WIDTH && py >= top && py <= top + CARD_HEIGHT;
}

function pointInSlot(px, py, slot) {
  const left = slot.x - CARD_WIDTH / 2;
  const top = slot.y - CARD_HEIGHT / 2;
  return px >= left && px <= left + CARD_WIDTH && py >= top && py <= top + CARD_HEIGHT;
}

function getTopCardAtPoint(point, predicate) {
  const candidates = gameState.cards
    .filter((card) => !card.ui.pendingRemoval && predicate(card))
    .sort((a, b) => b.id - a.id);

  return candidates.find((card) => pointInCard(point.x, point.y, card)) ?? null;
}

// ========================================
// アニメーション・演出
// ========================================
function startMoveAnimation(card, toX, toY, onComplete) {
  card.ui.animation = {
    type: 'move',
    fromX: card.x,
    fromY: card.y,
    toX,
    toY,
    startMs: performance.now(),
    durationMs: MOVE_ANIMATION_MS,
    onComplete,
  };
}

function markCardDestroyed(card, nowMs) {
  card.ui.destroyStartMs = nowMs;
  card.ui.destroyUntilMs = nowMs + DESTROY_ANIMATION_MS;
  card.ui.pendingRemoval = true;

  // 仕様: 消滅したカードのスロットは即空く
  if (card.fieldSlotIndex !== null) {
    const slot = slotCenters[card.fieldSlotIndex];
    if (slot && slot.occupiedByCardId === card.id) {
      slot.occupiedByCardId = null;
    }
  }
  card.fieldSlotIndex = null;
}

function triggerUsedCardFeedback(card, nowMs) {
  // 行動済みカードをスワイプした時の軽い揺れ + 赤い×表示
  card.ui.shakeUntilMs = nowMs + SHAKE_DURATION_MS;
  card.ui.crossUntilMs = nowMs + SHAKE_DURATION_MS;
}

function updateAnimations(nowMs) {
  gameState.cards.forEach((card) => {
    if (!card.ui.animation) {
      return;
    }

    const { fromX, fromY, toX, toY, startMs, durationMs, onComplete } = card.ui.animation;
    const t = Math.min((nowMs - startMs) / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    card.x = fromX + (toX - fromX) * eased;
    card.y = fromY + (toY - fromY) * eased;

    if (t >= 1) {
      card.x = toX;
      card.y = toY;
      card.ui.animation = null;
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  });

  // 破壊アニメ完了後にカードをリストから除外
  gameState.cards = gameState.cards.filter((card) => {
    if (!card.ui.pendingRemoval) {
      return true;
    }
    return nowMs < card.ui.destroyUntilMs;
  });
}

// ========================================
// 戦闘ロジック
// ========================================
function resolveSwipeAttack(attacker, direction) {
  const nowMs = performance.now();

  // 解決中ロック中は入力無効
  if (gameState.interactionLock) {
    return;
  }

  // プレイヤーの場カードのみ攻撃可能
  if (attacker.zone !== 'field' || attacker.owner !== 'player' || attacker.fieldSlotIndex === null) {
    return;
  }

  // 1カード1回制限
  if (attacker.combat.hasActedThisTurn) {
    triggerUsedCardFeedback(attacker, nowMs);
    return;
  }

  const targetSlotIndex = direction === 'left' ? attacker.fieldSlotIndex - 1 : attacker.fieldSlotIndex + 1;
  const defender = getCardAtSlot(targetSlotIndex);

  // 対象なし・同陣営は何も起きない
  if (!defender || defender.owner === attacker.owner) {
    return;
  }

  gameState.interactionLock = true;
  attacker.combat.hasActedThisTurn = true;

  // 方向別比較: 左なら attacker.left vs defender.right / 右なら attacker.right vs defender.left
  const attackerPower = direction === 'left' ? attacker.combat.attackLeft : attacker.combat.attackRight;
  const defenderPower = direction === 'left' ? defender.combat.attackRight : defender.combat.attackLeft;

  const destroyedCards = [];
  if (attackerPower > defenderPower) {
    destroyedCards.push(defender);
  } else if (attackerPower < defenderPower) {
    destroyedCards.push(attacker);
  } else {
    destroyedCards.push(attacker, defender);
  }

  // ヒット演出
  attacker.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
  defender.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;

  // ヒット演出後に破壊処理、その後ロック解除
  setTimeout(() => {
    const removeAt = performance.now();
    destroyedCards.forEach((card) => {
      markCardDestroyed(card, removeAt);
    });

    setTimeout(() => {
      gameState.interactionLock = false;
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}

// ========================================
// 入力処理
// ========================================
function onPointerDown(event) {
  if (gameState.interactionLock || gameState.activePointer !== null) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event);

  // 1) まず手札ドラッグを優先判定
  const handCard = getTopCardAtPoint(point, (card) => card.zone === 'hand' && !card.ui.animation);
  if (handCard) {
    handCard.ui.isDragging = true;
    gameState.activePointer = {
      kind: 'drag',
      pointerId: event.pointerId,
      cardId: handCard.id,
      offsetX: point.x - handCard.x,
      offsetY: point.y - handCard.y,
      originalX: handCard.x,
      originalY: handCard.y,
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  // 2) 次に場カードのスワイプ判定
  const fieldCard = getTopCardAtPoint(
    point,
    (card) => card.zone === 'field' && card.owner === 'player' && !card.ui.pendingRemoval,
  );

  if (!fieldCard) {
    return;
  }

  gameState.activePointer = {
    kind: 'swipe',
    pointerId: event.pointerId,
    cardId: fieldCard.id,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y,
  };
  canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!gameState.activePointer || gameState.activePointer.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const pointerState = gameState.activePointer;
  const card = getCardById(pointerState.cardId);
  if (!card) {
    return;
  }

  const point = getCanvasPoint(event);

  if (pointerState.kind === 'drag') {
    card.x = point.x - pointerState.offsetX;
    card.y = point.y - pointerState.offsetY;
    return;
  }

  pointerState.currentX = point.x;
  pointerState.currentY = point.y;
}

function onPointerUp(event) {
  if (!gameState.activePointer || gameState.activePointer.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const pointerState = gameState.activePointer;
  const card = getCardById(pointerState.cardId);

  // 手札ドラッグ終了
  if (card && pointerState.kind === 'drag') {
    card.ui.isDragging = false;

    const targetSlot = slotCenters.find(
      (slot) => pointInSlot(card.x, card.y, slot) && slot.occupiedByCardId === null,
    );

    gameState.interactionLock = true;
    if (targetSlot) {
      startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
        card.zone = 'field';
        card.handIndex = null;
        card.fieldSlotIndex = targetSlot.id;
        targetSlot.occupiedByCardId = card.id;
        gameState.interactionLock = false;
      });
    } else {
      startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
        card.zone = 'hand';
        gameState.interactionLock = false;
      });
    }
  }

  // スワイプ終了
  if (card && pointerState.kind === 'swipe') {
    const deltaX = pointerState.currentX - pointerState.startX;
    const deltaY = pointerState.currentY - pointerState.startY;
    const isHorizontalSwipe = Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);

    if (isHorizontalSwipe) {
      const direction = deltaX < 0 ? 'left' : 'right';
      resolveSwipeAttack(card, direction);
    }
  }

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (_) {
    // no-op
  }

  gameState.activePointer = null;
}

// ========================================
// 描画
// ========================================
function drawTable() {
  ctx.fillStyle = '#1d2f4f';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = '#13233e';
  ctx.fillRect(0, 500, CANVAS_WIDTH, 220);
  ctx.fillStyle = '#11203a';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 220);

  ctx.strokeStyle = '#9fb4dc';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  slotCenters.forEach((slot) => {
    ctx.strokeRect(slot.x - CARD_WIDTH / 2, slot.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT);
  });
  ctx.setLineDash([]);

}

function drawHudLabels() {
  // ラベルは最前面で描画し、他の要素に埋もれないようにする
  ctx.fillStyle = '#d6e0f4';
  ctx.font = '16px sans-serif';
  ctx.fillText('ENEMY HAND (4)', 20, 40);
  ctx.fillText('FIELD (max 5)', 20, 360 - CARD_HEIGHT / 2 - 20);
  ctx.fillText('YOUR HAND (4)', 20, 690);

  ctx.fillStyle = '#b8c2d9';
  ctx.font = '13px sans-serif';
  ctx.fillText('Field cards: swipe left/right to attack adjacent enemy', 250, 40);
}

function drawEnemyHandPlaceholders() {
  enemyHandCenters.forEach((pos) => {
    const left = pos.x - CARD_WIDTH / 2;
    const top = pos.y - CARD_HEIGHT / 2;
    ctx.fillStyle = '#344566';
    ctx.strokeStyle = '#6177a3';
    ctx.lineWidth = 2;
    ctx.fillRect(left, top, CARD_WIDTH, CARD_HEIGHT);
    ctx.strokeRect(left, top, CARD_WIDTH, CARD_HEIGHT);
  });
}

function drawCrossMark(centerX, centerY) {
  const left = centerX - CARD_WIDTH / 2;
  const right = centerX + CARD_WIDTH / 2;
  const top = centerY - CARD_HEIGHT / 2;
  const bottom = centerY + CARD_HEIGHT / 2;

  ctx.strokeStyle = '#ff4b4b';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(left + 8, top + 8);
  ctx.lineTo(right - 8, bottom - 8);
  ctx.moveTo(right - 8, top + 8);
  ctx.lineTo(left + 8, bottom - 8);
  ctx.stroke();
}

function drawCards(nowMs) {
  const orderedCards = [...gameState.cards].sort((a, b) => {
    if (a.ui.isDragging && !b.ui.isDragging) return 1;
    if (!a.ui.isDragging && b.ui.isDragging) return -1;
    return a.id - b.id;
  });

  orderedCards.forEach((card) => {
    const isShaking = nowMs < card.ui.shakeUntilMs;
    const shakeX = isShaking ? Math.sin(nowMs * 0.07) * 5 : 0;

    const isDestroying = card.ui.pendingRemoval;
    const destroyProgress = isDestroying
      ? Math.min((nowMs - card.ui.destroyStartMs) / DESTROY_ANIMATION_MS, 1)
      : 0;

    const alpha = isDestroying ? 1 - destroyProgress : 1;
    const scale = isDestroying ? 1 - destroyProgress * 0.18 : 1;

    const centerX = card.x + shakeX;
    const centerY = card.y;
    const width = CARD_WIDTH * scale;
    const height = CARD_HEIGHT * scale;
    const left = centerX - width / 2;
    const top = centerY - height / 2;

    const ownerStroke = card.owner === 'player' ? '#4da3ff' : '#ff7272';
    const ownerLabel = card.owner === 'player' ? 'PLAYER' : 'ENEMY';

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = ownerStroke;
    ctx.lineWidth = 3;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);

    if (nowMs < card.ui.hitFlashUntilMs) {
      ctx.fillStyle = 'rgba(255, 78, 78, 0.25)';
      ctx.fillRect(left, top, width, height);
    }

    ctx.fillStyle = '#111111';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(ownerLabel, left + 10, top + 18);

    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#174f9b';
    ctx.fillText(String(card.combat.attackLeft), left + 10, centerY + 7);

    ctx.fillStyle = '#9b1f1f';
    const rightText = String(card.combat.attackRight);
    const rightWidth = ctx.measureText(rightText).width;
    ctx.fillText(rightText, left + width - 12 - rightWidth, centerY + 7);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#333333';
    const actedText = card.combat.hasActedThisTurn ? 'USED' : 'READY';
    ctx.fillText(actedText, left + 10, top + height - 12);

    if (nowMs < card.ui.crossUntilMs) {
      drawCrossMark(centerX, centerY);
    }

    ctx.restore();
  });
}

function draw() {
  const nowMs = performance.now();
  drawTable();
  drawEnemyHandPlaceholders();
  drawCards(nowMs);
  drawHudLabels();
}

function loop(nowMs) {
  updateAnimations(nowMs);
  draw();
  requestAnimationFrame(loop);
}

// ========================================
// 起動
// ========================================
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
resetButton.addEventListener('click', resetGame);

resetGame();
requestAnimationFrame(loop);
