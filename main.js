// ========================================
// Canvas Card Game MVP (Stage: Turn Flow)
// ========================================
// 目的:
// - 先攻/後攻のランダム決定（コイントス演出）
// - ドロー -> メイン -> ターン終了の流れ
// - プレイヤーMainのみ手動操作、敵ターンは終了宣言のみ

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

const STARTING_HAND = 4;
const MIN_HAND_AFTER_DRAW = 4;
const MAX_HAND = 9;
const MAX_FIELD_SLOTS = 5;
const TURN_BANNER_MS = 900;
const ENEMY_AUTO_END_MS = 850;
const COIN_TOSS_MS = 1200;

const END_TURN_UI = {
  x: 850,
  y: 360,
  radius: 60,
};

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

function getHandCenter(owner, handIndex, handCount) {
  const y = owner === 'player' ? 620 : 100;
  if (handCount <= 1) {
    return { x: CANVAS_WIDTH / 2, y };
  }

  // 9枚手札でも収まるよう、左右余白を固定して均等配置する
  const minX = 120;
  const maxX = 840;
  const span = maxX - minX;
  const t = handIndex / (handCount - 1);
  return {
    x: minX + span * t,
    y,
  };
}

// ===== 全体状態 =====
const gameState = {
  cards: [],
  nextCardId: 0,
  interactionLock: false,
  activePointer: null,
  turn: {
    number: 1,
    firstPlayer: null,
    currentPlayer: null,
    phase: 'coin_toss', // coin_toss | draw | main
    bannerText: '',
    bannerUntilMs: 0,
    coin: {
      active: false,
      startMs: 0,
      durationMs: COIN_TOSS_MS,
      resultFirstPlayer: null,
    },
    enemyAutoEndAtMs: 0,
  },
};

function createCard({ id, owner, zone, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight }) {
  return {
    id,
    owner,
    zone,
    handIndex,
    fieldSlotIndex,
    x,
    y,
    combat: {
      attackLeft,
      attackRight,
      hasActedThisTurn: false,
    },
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

function randomAttackValue() {
  return Math.floor(Math.random() * 7) + 1;
}

function drawRandomCardToHand(owner) {
  const handCards = getHandCards(owner);
  const handIndex = handCards.length;
  const center = getHandCenter(owner, handIndex, handIndex + 1);
  const card = createCard({
    id: gameState.nextCardId,
    owner,
    zone: 'hand',
    handIndex,
    x: center.x,
    y: center.y,
    attackLeft: randomAttackValue(),
    attackRight: randomAttackValue(),
  });
  gameState.nextCardId += 1;
  gameState.cards.push(card);
}

function buildInitialCards() {
  gameState.cards = [];
  gameState.nextCardId = 0;
  slotCenters.forEach((slot) => {
    slot.occupiedByCardId = null;
  });

  for (let i = 0; i < STARTING_HAND; i += 1) {
    drawRandomCardToHand('player');
    drawRandomCardToHand('enemy');
  }
}

function showBanner(text, durationMs = TURN_BANNER_MS) {
  gameState.turn.bannerText = text;
  gameState.turn.bannerUntilMs = performance.now() + durationMs;
}

function recomputeSlotOccupancy() {
  slotCenters.forEach((slot) => {
    slot.occupiedByCardId = null;
  });
  gameState.cards.forEach((card) => {
    if (card.zone === 'field' && card.fieldSlotIndex !== null && !card.ui.pendingRemoval) {
      slotCenters[card.fieldSlotIndex].occupiedByCardId = card.id;
    }
  });
}

function reflowHand(owner) {
  const handCards = gameState.cards
    .filter((card) => card.owner === owner && card.zone === 'hand' && !card.ui.pendingRemoval)
    .sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));

  const handCount = handCards.length;
  handCards.forEach((card, index) => {
    const center = getHandCenter(owner, index, handCount);
    card.handIndex = index;
    card.x = center.x;
    card.y = center.y;
  });
}

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

function getHandCards(owner) {
  return gameState.cards.filter((card) => card.owner === owner && card.zone === 'hand' && !card.ui.pendingRemoval);
}

function getFieldCards(owner) {
  return gameState.cards.filter((card) => card.owner === owner && card.zone === 'field' && !card.ui.pendingRemoval);
}

function hasEmptyFieldSlot() {
  return slotCenters.some((slot) => slot.occupiedByCardId === null);
}

function hasAdjacentEnemyTarget(card) {
  if (card.zone !== 'field' || card.fieldSlotIndex === null) {
    return false;
  }
  const left = getCardAtSlot(card.fieldSlotIndex - 1);
  const right = getCardAtSlot(card.fieldSlotIndex + 1);
  return (left && left.owner !== card.owner) || (right && right.owner !== card.owner);
}

function canOwnerAct(owner) {
  const canSummon = getHandCards(owner).length > 0 && hasEmptyFieldSlot();
  const canAttack = getFieldCards(owner).some((card) => !card.combat.hasActedThisTurn && hasAdjacentEnemyTarget(card));
  return canSummon || canAttack;
}

function isPlayerMainTurn() {
  return gameState.turn.phase === 'main' && gameState.turn.currentPlayer === 'player';
}

function canUseEndTurnButton() {
  return isPlayerMainTurn() && !gameState.interactionLock;
}

function applyDrawPhase(owner) {
  const handCountAtStart = getHandCards(owner).length;
  const drawTarget = handCountAtStart >= MIN_HAND_AFTER_DRAW
    ? Math.min(handCountAtStart + 1, MAX_HAND)
    : Math.min(MIN_HAND_AFTER_DRAW, MAX_HAND);

  while (getHandCards(owner).length < drawTarget) {
    drawRandomCardToHand(owner);
  }
  reflowHand(owner);
}

function clearActedFlags(owner) {
  getFieldCards(owner).forEach((card) => {
    card.combat.hasActedThisTurn = false;
  });
}

function beginMainPhase(owner) {
  gameState.turn.phase = 'main';
  clearActedFlags(owner);

  if (owner === 'player') {
    gameState.turn.enemyAutoEndAtMs = 0;
    showBanner(`PLAYER TURN ${gameState.turn.number}`);
  } else {
    gameState.turn.enemyAutoEndAtMs = performance.now() + ENEMY_AUTO_END_MS;
    showBanner(`ENEMY TURN ${gameState.turn.number}`);
  }

}

function beginTurn(owner, isNewRound = false) {
  gameState.turn.currentPlayer = owner;
  gameState.turn.phase = 'draw';
  gameState.interactionLock = false;
  gameState.activePointer = null;

  if (isNewRound) {
    gameState.turn.number += 1;
  }

  applyDrawPhase(owner);
  beginMainPhase(owner);
}

function endCurrentTurn(reason = 'manual') {
  if (gameState.turn.phase !== 'main') {
    return;
  }

  // プレイヤー手動終了、敵自動終了、行動不能自動終了のいずれか
  if (reason === 'manual' && !isPlayerMainTurn()) {
    return;
  }

  gameState.interactionLock = true;

  const current = gameState.turn.currentPlayer;
  const next = current === 'player' ? 'enemy' : 'player';
  const isNewRound = next === gameState.turn.firstPlayer;

  showBanner(`${current.toUpperCase()} END`);

  setTimeout(() => {
    gameState.interactionLock = false;
    beginTurn(next, isNewRound);
  }, 220);
}

function startCoinToss() {
  const nowMs = performance.now();
  gameState.turn.phase = 'coin_toss';
  gameState.turn.coin.active = true;
  gameState.turn.coin.startMs = nowMs;
  gameState.turn.coin.resultFirstPlayer = Math.random() < 0.5 ? 'player' : 'enemy';
  gameState.interactionLock = true;
}

function resetGame() {
  buildInitialCards();
  gameState.interactionLock = false;
  gameState.activePointer = null;

  gameState.turn.number = 1;
  gameState.turn.firstPlayer = null;
  gameState.turn.currentPlayer = null;
  gameState.turn.phase = 'coin_toss';
  gameState.turn.bannerText = '';
  gameState.turn.bannerUntilMs = 0;
  gameState.turn.enemyAutoEndAtMs = 0;

  startCoinToss();
}

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

  if (card.fieldSlotIndex !== null) {
    const slot = slotCenters[card.fieldSlotIndex];
    if (slot && slot.occupiedByCardId === card.id) {
      slot.occupiedByCardId = null;
    }
  }

  if (card.zone === 'hand') {
    reflowHand(card.owner);
  }

  card.fieldSlotIndex = null;
}

function triggerUsedCardFeedback(card, nowMs) {
  card.ui.shakeUntilMs = nowMs + SHAKE_DURATION_MS;
  card.ui.crossUntilMs = nowMs + SHAKE_DURATION_MS;
}

function resolveSwipeAttack(attacker, direction) {
  const nowMs = performance.now();

  if (!isPlayerMainTurn() || gameState.interactionLock) {
    return;
  }

  if (attacker.zone !== 'field' || attacker.owner !== 'player' || attacker.fieldSlotIndex === null) {
    return;
  }

  if (attacker.combat.hasActedThisTurn) {
    triggerUsedCardFeedback(attacker, nowMs);
    return;
  }

  const targetSlotIndex = direction === 'left' ? attacker.fieldSlotIndex - 1 : attacker.fieldSlotIndex + 1;
  const defender = getCardAtSlot(targetSlotIndex);

  if (!defender || defender.owner === attacker.owner) {
    return;
  }

  gameState.interactionLock = true;
  attacker.combat.hasActedThisTurn = true;

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

  attacker.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
  defender.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;

  setTimeout(() => {
    const removeAt = performance.now();
    destroyedCards.forEach((card) => {
      markCardDestroyed(card, removeAt);
    });

    setTimeout(() => {
      gameState.interactionLock = false;
      recomputeSlotOccupancy();
        }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
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

  gameState.cards = gameState.cards.filter((card) => {
    if (!card.ui.pendingRemoval) {
      return true;
    }
    return nowMs < card.ui.destroyUntilMs;
  });
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

function pointInCircle(px, py, circle) {
  const dx = px - circle.x;
  const dy = py - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function getTopCardAtPoint(point, predicate) {
  const candidates = gameState.cards
    .filter((card) => !card.ui.pendingRemoval && predicate(card))
    .sort((a, b) => b.id - a.id);

  return candidates.find((card) => pointInCard(point.x, point.y, card)) ?? null;
}

function onPointerDown(event) {
  if (gameState.interactionLock || gameState.activePointer !== null) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event);

  // Canvas内のEnd Turnボタン（右中央）
  if (pointInCircle(point.x, point.y, END_TURN_UI) && canUseEndTurnButton()) {
    endCurrentTurn('manual');
    return;
  }

  if (!isPlayerMainTurn()) {
    return;
  }

  const handCard = getTopCardAtPoint(point, (card) => card.zone === 'hand' && card.owner === 'player' && !card.ui.animation);
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
        reflowHand('player');
        gameState.interactionLock = false;
            });
    } else {
      startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
        card.zone = 'hand';
        gameState.interactionLock = false;
            });
    }
  }

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

function drawTable() {
  ctx.fillStyle = '#1d2f4f';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 敵ターン中は全体に軽く赤系オーバーレイ
  if (gameState.turn.currentPlayer === 'enemy' && gameState.turn.phase === 'main') {
    ctx.fillStyle = 'rgba(138, 40, 40, 0.16)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

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
  ctx.fillStyle = '#d6e0f4';
  ctx.font = '16px sans-serif';
  ctx.fillText(`ENEMY HAND (${getHandCards('enemy').length}/${MAX_HAND})`, 20, 40);
  ctx.fillText('FIELD (max 5)', 20, 360 - CARD_HEIGHT / 2 - 20);
  ctx.fillText(`YOUR HAND (${getHandCards('player').length}/${MAX_HAND})`, 20, 690);

  ctx.fillStyle = '#b8c2d9';
  ctx.font = '13px sans-serif';
  ctx.fillText('Field cards: swipe left/right to attack adjacent enemy', 250, 40);

  if (gameState.turn.currentPlayer) {
    ctx.fillStyle = '#ecf2ff';
    ctx.font = 'bold 15px sans-serif';
    const turnText = `Turn ${gameState.turn.number} - ${gameState.turn.currentPlayer.toUpperCase()} (${gameState.turn.phase})`;
    ctx.fillText(turnText, 20, 78);
  }
}

function drawEnemyHandPlaceholders() {
  const enemyHands = getHandCards('enemy').sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));
  enemyHands.forEach((card) => {
    const left = card.x - CARD_WIDTH / 2;
    const top = card.y - CARD_HEIGHT / 2;
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
    // 敵手札は裏向き表示にする
    if (card.owner === 'enemy' && card.zone === 'hand') {
      return;
    }

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


function drawCanvasEndTurnButton() {
  const enabled = canUseEndTurnButton();
  const { x, y, radius } = END_TURN_UI;

  ctx.save();
  const fill = enabled ? '#1f304d' : '#232a38';
  const stroke = enabled ? '#6aa7ff' : '#55627a';

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 内側リングで押せるボタン感を強調
  ctx.strokeStyle = enabled ? '#96c4ff' : '#6b7488';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius - 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = enabled ? '#e8f1ff' : '#aeb8cc';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('END', x, y - 9);
  ctx.fillText('TURN', x, y + 12);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawCoinToss(nowMs) {
  if (!gameState.turn.coin.active) {
    return;
  }

  const elapsed = nowMs - gameState.turn.coin.startMs;
  const progress = Math.min(elapsed / gameState.turn.coin.durationMs, 1);

  const centerX = CANVAS_WIDTH / 2;
  const baseY = 300;
  const dropY = progress < 0.65 ? baseY - Math.sin(progress * Math.PI) * 40 : baseY + (progress - 0.65) * 120;

  const spin = progress * 10 * Math.PI;
  const scaleX = Math.abs(Math.cos(spin));
  const radius = 44;

  ctx.save();
  ctx.translate(centerX, dropY);
  ctx.scale(Math.max(scaleX, 0.08), 1);

  const showingWhite = Math.cos(spin) >= 0;
  ctx.fillStyle = showingWhite ? '#efefef' : '#1e1e1e';
  ctx.strokeStyle = '#c6c6c6';
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#f2f7ff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('COIN TOSS', centerX, 210);
  ctx.textAlign = 'left';
}

function drawTurnBanner(nowMs) {
  if (!gameState.turn.bannerText || nowMs > gameState.turn.bannerUntilMs) {
    return;
  }

  const remain = gameState.turn.bannerUntilMs - nowMs;
  const alpha = Math.min(remain / 260, 1) * 0.82;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(12, 18, 33, 0.55)';
  ctx.fillRect(120, 300, 720, 110);
  ctx.fillStyle = '#f0f4ff';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.turn.bannerText, CANVAS_WIDTH / 2, 370);
  ctx.textAlign = 'left';
  ctx.restore();
}

function updateTurnFlow(nowMs) {
  if (gameState.turn.phase === 'coin_toss' && gameState.turn.coin.active) {
    const elapsed = nowMs - gameState.turn.coin.startMs;
    if (elapsed >= gameState.turn.coin.durationMs) {
      gameState.turn.coin.active = false;
      gameState.turn.firstPlayer = gameState.turn.coin.resultFirstPlayer;
      gameState.interactionLock = false;
      beginTurn(gameState.turn.firstPlayer, false);
    }
    return;
  }

  if (gameState.turn.phase === 'main') {
    if (gameState.turn.currentPlayer === 'enemy' && nowMs >= gameState.turn.enemyAutoEndAtMs) {
      endCurrentTurn('enemy_auto');
      return;
    }

    if (gameState.turn.currentPlayer === 'player' && !gameState.interactionLock && !canOwnerAct('player')) {
      endCurrentTurn('no_actions');
    }
  }

}

function draw(nowMs) {
  drawTable();
  drawEnemyHandPlaceholders();
  drawCards(nowMs);
  drawHudLabels();
  drawCanvasEndTurnButton();
  drawCoinToss(nowMs);
  drawTurnBanner(nowMs);
}

function loop(nowMs) {
  updateAnimations(nowMs);
  recomputeSlotOccupancy();
  updateTurnFlow(nowMs);
  draw(nowMs);
  requestAnimationFrame(loop);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);


resetButton.addEventListener('click', resetGame);

resetGame();
requestAnimationFrame(loop);
