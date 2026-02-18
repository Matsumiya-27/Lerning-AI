// ========================================
// Canvas Card Game MVP (Stage: Turn Flow)
// ========================================
// 目的:
// - 先攻/後攻のランダム決定（コイントス演出）
// - ドロー -> メイン -> ターン終了の流れ
// - プレイヤーMainは手動操作、敵ターンは簡易AIで行動

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
const STARTING_HP = 10;
const MAX_FIELD_SLOTS = 5;
const TURN_BANNER_MS = 900;
const ENEMY_AUTO_END_MS = 850;
const ENEMY_ACTION_DELAY_MS = 540;
const COIN_TOSS_MS = 1200;
const COIN_RESULT_WOBBLE_MS = 2200;
const FIRST_PLAYER_BANNER_MS = 1200;
const NO_ACTION_AUTO_END_DELAY_MS = 480;
const DIRECT_ATTACK_HIT_MS = 190;

const END_TURN_UI = {
  x: 900,
  y: 360,
  radius: 48,
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
  result: {
    winner: null,
  },
  fx: {
    screenShakeUntilMs: 0,
    screenShakePower: 0,
    damageTexts: [],
  },
  hp: {
    player: STARTING_HP,
    enemy: STARTING_HP,
  },
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
      revealUntilMs: 0,
    },
    enemyAutoEndAtMs: 0,
    enemyNextActionAtMs: 0,
    mainPhaseStartedAtMs: 0,
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

  // 初期手札の座標を4枚レイアウトへ正規化
  reflowHand('player');
  reflowHand('enemy');
}

function showBanner(text, durationMs = TURN_BANNER_MS) {
  gameState.turn.bannerText = text;
  gameState.turn.bannerUntilMs = performance.now() + durationMs;
}

function triggerScreenShake(power = 5, durationMs = 170) {
  const nowMs = performance.now();
  gameState.fx.screenShakeUntilMs = Math.max(gameState.fx.screenShakeUntilMs, nowMs + durationMs);
  gameState.fx.screenShakePower = Math.max(gameState.fx.screenShakePower, power);
}

function addDamageText(x, y, text, color = '#ff6b6b') {
  const nowMs = performance.now();
  gameState.fx.damageTexts.push({
    x,
    y,
    text,
    color,
    startMs: nowMs,
    untilMs: nowMs + 760,
  });
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
  const canDirect = getFieldCards(owner).some((card) => !card.combat.hasActedThisTurn) && canDirectAttack(owner);
  return canSummon || canAttack || canDirect;
}

function isPlayerMainTurn() {
  return gameState.turn.phase === 'main' && gameState.turn.currentPlayer === 'player';
}

function canUseEndTurnButton() {
  return isPlayerMainTurn() && !gameState.interactionLock && !gameState.result.winner;
}

function canDirectAttack(attackerOwner) {
  // 先攻1ターン目だけ直接攻撃不可
  if (gameState.turn.number === 1 && gameState.turn.currentPlayer === gameState.turn.firstPlayer) {
    return attackerOwner !== gameState.turn.firstPlayer;
  }
  return true;
}

function applyDrawPhase(owner) {
  const handCountAtStart = getHandCards(owner).length;
  const isOpeningTurnOfFirstPlayer = gameState.turn.number === 1 && owner === gameState.turn.firstPlayer;
  const drawTarget = handCountAtStart >= MIN_HAND_AFTER_DRAW
    ? (isOpeningTurnOfFirstPlayer
      ? Math.min(MIN_HAND_AFTER_DRAW, MAX_HAND)
      : Math.min(handCountAtStart + 1, MAX_HAND))
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
  const nowMs = performance.now();
  gameState.turn.phase = 'main';
  gameState.turn.mainPhaseStartedAtMs = nowMs;
  clearActedFlags(owner);

  if (owner === 'player') {
    gameState.turn.enemyAutoEndAtMs = 0;
    gameState.turn.enemyNextActionAtMs = 0;
    showBanner(`PLAYER TURN ${gameState.turn.number}`);
  } else {
    gameState.turn.enemyAutoEndAtMs = 0;
    gameState.turn.enemyNextActionAtMs = nowMs + ENEMY_ACTION_DELAY_MS;
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
  if (gameState.turn.phase !== 'main' || gameState.interactionLock || gameState.result.winner) {
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
  gameState.turn.coin.revealUntilMs = 0;
  gameState.interactionLock = true;
}

function resetGame() {
  buildInitialCards();
  gameState.interactionLock = false;
  gameState.activePointer = null;
  gameState.result.winner = null;
  gameState.hp.player = STARTING_HP;
  gameState.hp.enemy = STARTING_HP;

  gameState.turn.number = 1;
  gameState.turn.firstPlayer = null;
  gameState.turn.currentPlayer = null;
  gameState.turn.phase = 'coin_toss';
  gameState.turn.bannerText = '';
  gameState.turn.bannerUntilMs = 0;
  gameState.turn.enemyAutoEndAtMs = 0;
  gameState.turn.enemyNextActionAtMs = 0;
  gameState.turn.mainPhaseStartedAtMs = 0;
  gameState.turn.coin.revealUntilMs = 0;
  gameState.fx.screenShakeUntilMs = 0;
  gameState.fx.screenShakePower = 0;
  gameState.fx.damageTexts = [];

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

  if (gameState.turn.phase !== 'main' || gameState.interactionLock) {
    return;
  }

  if (attacker.zone !== 'field' || attacker.owner !== gameState.turn.currentPlayer || attacker.fieldSlotIndex === null) {
    return;
  }

  if (attacker.combat.hasActedThisTurn) {
    if (attacker.owner === 'player') {
      triggerUsedCardFeedback(attacker, nowMs);
    }
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
  triggerScreenShake(6, 170);
  addDamageText(defender.x, defender.y - 80, 'HIT', '#ff8a8a');

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

function finishGame(winner) {
  gameState.result.winner = winner;
  gameState.interactionLock = true;
  showBanner(`${winner.toUpperCase()} WIN`, 1800);
}

function resolveDirectAttack(attacker) {
  if (gameState.turn.phase !== 'main' || gameState.interactionLock || gameState.result.winner) {
    return;
  }

  if (attacker.zone !== 'field' || attacker.owner !== gameState.turn.currentPlayer || attacker.fieldSlotIndex === null) {
    return;
  }

  if (attacker.combat.hasActedThisTurn || !canDirectAttack(attacker.owner)) {
    if (attacker.owner === 'player') {
      triggerUsedCardFeedback(attacker, performance.now());
    }
    return;
  }

  const targetOwner = attacker.owner === 'player' ? 'enemy' : 'player';
  attacker.combat.hasActedThisTurn = true;
  attacker.ui.hitFlashUntilMs = performance.now() + HIT_FLASH_MS;
  gameState.interactionLock = true;

  setTimeout(() => {
    gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - 1);
    triggerScreenShake(8, 210);
    const hpBadgeY = targetOwner === 'enemy' ? 90 : 630;
    addDamageText(860, hpBadgeY - 38, '-1', '#ff5252');
    addDamageText(860, hpBadgeY + 48, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
    if (gameState.hp[targetOwner] <= 0) {
      finishGame(attacker.owner);
      return;
    }
    gameState.interactionLock = false;
  }, DIRECT_ATTACK_HIT_MS);
}

function getEmptySlotIndices() {
  return slotCenters.filter((slot) => slot.occupiedByCardId === null).map((slot) => slot.id);
}

function evaluateEnemyPlacement(card, slotIndex) {
  const left = getCardAtSlot(slotIndex - 1);
  const right = getCardAtSlot(slotIndex + 1);

  let score = 0;

  // 生存しやすい向きを優先（相手から攻撃された時の耐久余裕）
  if (left && left.owner === 'player') {
    score += (card.combat.attackLeft - left.combat.attackRight) * 3;
    score += card.combat.attackLeft * 0.9;
  }
  if (right && right.owner === 'player') {
    score += (card.combat.attackRight - right.combat.attackLeft) * 3;
    score += card.combat.attackRight * 0.9;
  }

  // 端配置の向き補正（右端は左高火力、左端は右高火力を好む）
  if (slotIndex === 4) {
    score += (card.combat.attackLeft - card.combat.attackRight) * 1.2;
  }
  if (slotIndex === 0) {
    score += (card.combat.attackRight - card.combat.attackLeft) * 1.2;
  }

  // 隣接相手がいない場合は中央より端を少し優先
  if ((!left || left.owner !== 'player') && (!right || right.owner !== 'player')) {
    score += [1.2, 0.8, 0.5, 0.8, 1.2][slotIndex];
  }

  return score;
}

function chooseBestEnemySummon() {
  const hand = getHandCards('enemy');
  const emptySlots = getEmptySlotIndices();

  if (hand.length === 0 || emptySlots.length === 0) {
    return null;
  }

  let best = null;

  hand.forEach((card) => {
    emptySlots.forEach((slotIndex) => {
      const score = evaluateEnemyPlacement(card, slotIndex);
      if (!best || score > best.score) {
        best = { card, slotIndex, score };
      }
    });
  });

  return best;
}

function chooseBestEnemyAttack() {
  const attackers = getFieldCards('enemy').filter((card) => !card.combat.hasActedThisTurn);
  let best = null;

  attackers.forEach((attacker) => {
    if (attacker.fieldSlotIndex === null) {
      return;
    }

    ['left', 'right'].forEach((direction) => {
      const targetSlotIndex = direction === 'left' ? attacker.fieldSlotIndex - 1 : attacker.fieldSlotIndex + 1;
      const defender = getCardAtSlot(targetSlotIndex);

      if (!defender || defender.owner !== 'player') {
        return;
      }

      const attackerPower = direction === 'left' ? attacker.combat.attackLeft : attacker.combat.attackRight;
      const defenderPower = direction === 'left' ? defender.combat.attackRight : defender.combat.attackLeft;

      let score = 0;
      if (attackerPower > defenderPower) {
        score = 50 + (attackerPower - defenderPower) * 4;
      } else if (attackerPower === defenderPower) {
        // 相打ちも許容して盤面整理を進める
        score = 22 + Math.max(0, getHandCards('enemy').length - 4) * 2;
      } else {
        score = -40 - (defenderPower - attackerPower) * 4;
      }

      if (!best || score > best.score) {
        best = { attacker, direction, score };
      }
    });
  });

  // 不利攻撃は行わない
  if (best && best.score <= 0) {
    return null;
  }

  if (canDirectAttack('enemy')) {
    const directCandidate = attackers[0]
      ? { attacker: attackers[0], direction: 'direct', score: 12 + (STARTING_HP - gameState.hp.player) }
      : null;
    if (directCandidate && (!best || directCandidate.score > best.score)) {
      best = directCandidate;
    }
  }

  return best;
}

function executeEnemyMainAction(nowMs) {
  if (gameState.turn.currentPlayer !== 'enemy' || gameState.turn.phase !== 'main' || gameState.interactionLock) {
    return false;
  }

  const bestAttack = chooseBestEnemyAttack();
  if (bestAttack) {
    if (bestAttack.direction === 'direct') {
      resolveDirectAttack(bestAttack.attacker);
    } else {
      resolveSwipeAttack(bestAttack.attacker, bestAttack.direction);
    }
    gameState.turn.enemyNextActionAtMs = nowMs + ENEMY_ACTION_DELAY_MS;
    return true;
  }

  const summon = chooseBestEnemySummon();
  if (summon) {
    const { card, slotIndex } = summon;
    const targetSlot = slotCenters[slotIndex];
    gameState.interactionLock = true;

    startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
      card.zone = 'field';
      card.handIndex = null;
      card.fieldSlotIndex = slotIndex;
      targetSlot.occupiedByCardId = card.id;
      reflowHand('enemy');
      gameState.interactionLock = false;
    });

    gameState.turn.enemyNextActionAtMs = nowMs + ENEMY_ACTION_DELAY_MS;
    return true;
  }

  return false;
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

  gameState.fx.damageTexts = gameState.fx.damageTexts.filter((fx) => nowMs < fx.untilMs);
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
    const isVerticalSwipe = Math.abs(deltaY) >= SWIPE_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX);

    if (isHorizontalSwipe) {
      const direction = deltaX < 0 ? 'left' : 'right';
      resolveSwipeAttack(card, direction);
    } else if (isVerticalSwipe && deltaY < 0) {
      // 上方向スワイプで相手本体へ直接攻撃
      resolveDirectAttack(card);
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
  if (gameState.turn.currentPlayer) {
    ctx.fillStyle = '#ecf2ff';
    ctx.font = 'bold 15px sans-serif';
    const turnText = `Turn ${gameState.turn.number} - ${gameState.turn.currentPlayer.toUpperCase()} (${gameState.turn.phase})`;
    ctx.fillText(turnText, 20, 78);
  }
}

function getHpColor(hp) {
  const ratio = hp / STARTING_HP;
  if (ratio <= 0.3) {
    return { fill: '#7a1f1f', stroke: '#ff5959', text: '#ffd7d7' };
  }
  if (ratio <= 0.6) {
    return { fill: '#6f6220', stroke: '#ffd24a', text: '#fff2bf' };
  }
  return { fill: '#1f6d32', stroke: '#6de38c', text: '#dbffe6' };
}

function drawHpBadge(owner, x, y) {
  const hp = gameState.hp[owner];
  const { fill, stroke, text } = getHpColor(hp);

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(hp), x, y);

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = owner === 'enemy' ? '#ffd5d5' : '#d7e7ff';
  ctx.fillText(owner === 'enemy' ? 'ENEMY' : 'YOU', x, y + 49);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawDamageTexts(nowMs) {
  gameState.fx.damageTexts.forEach((fx) => {
    const t = (nowMs - fx.startMs) / (fx.untilMs - fx.startMs);
    const progress = Math.min(Math.max(t, 0), 1);
    const alpha = 1 - progress;
    const y = fx.y - progress * 26;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fx.color;
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fx.text, fx.x, y);
    ctx.textAlign = 'left';
    ctx.restore();
  });
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
  if (!gameState.turn.coin.active && nowMs > gameState.turn.coin.revealUntilMs) {
    return;
  }

  const elapsed = nowMs - gameState.turn.coin.startMs;
  const progress = Math.min(elapsed / gameState.turn.coin.durationMs, 1);

  const centerX = CANVAS_WIDTH / 2;
  const baseY = 300;
  let dropY = progress < 0.65 ? baseY - Math.sin(progress * Math.PI) * 40 : baseY + (progress - 0.65) * 120;

  let spin = progress * 10 * Math.PI;
  if (!gameState.turn.coin.active) {
    const wobbleRemain = Math.max(gameState.turn.coin.revealUntilMs - nowMs, 0);
    const wobbleRate = wobbleRemain / COIN_RESULT_WOBBLE_MS;
    dropY = baseY + Math.sin(nowMs * 0.05) * 6 * wobbleRate;
    spin = (gameState.turn.coin.resultFirstPlayer === 'player' ? 0 : Math.PI) + Math.sin(nowMs * 0.08) * 0.18 * wobbleRate;
  }

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
  if (gameState.result.winner) {
    return;
  }

  if (gameState.turn.phase === 'coin_toss' && gameState.turn.coin.active) {
    const elapsed = nowMs - gameState.turn.coin.startMs;
    if (elapsed >= gameState.turn.coin.durationMs) {
      gameState.turn.coin.active = false;
      gameState.turn.firstPlayer = gameState.turn.coin.resultFirstPlayer;
      gameState.turn.coin.revealUntilMs = nowMs + COIN_RESULT_WOBBLE_MS;
      gameState.interactionLock = false;
      beginTurn(gameState.turn.firstPlayer, false);
      const firstLabel = gameState.turn.firstPlayer === 'player' ? 'あなたの先攻' : '相手の先攻';
      showBanner(firstLabel, FIRST_PLAYER_BANNER_MS);
    }
    return;
  }

  if (gameState.turn.phase === 'main') {
    if (gameState.turn.currentPlayer === 'enemy' && !gameState.interactionLock) {
      if (nowMs >= gameState.turn.enemyNextActionAtMs) {
        const acted = executeEnemyMainAction(nowMs);
        if (!acted) {
          gameState.turn.enemyAutoEndAtMs = nowMs + ENEMY_AUTO_END_MS;
          gameState.turn.enemyNextActionAtMs = Number.POSITIVE_INFINITY;
        }
      }

      if (gameState.turn.enemyAutoEndAtMs > 0 && nowMs >= gameState.turn.enemyAutoEndAtMs) {
        endCurrentTurn('enemy_auto');
        return;
      }
    }

    if (
      gameState.turn.currentPlayer === 'player'
      && !gameState.interactionLock
      && nowMs - gameState.turn.mainPhaseStartedAtMs >= NO_ACTION_AUTO_END_DELAY_MS
      && !canOwnerAct('player')
    ) {
      endCurrentTurn('no_actions');
    }
  }

}

function draw(nowMs) {
  let shakeX = 0;
  let shakeY = 0;
  if (nowMs < gameState.fx.screenShakeUntilMs) {
    const power = gameState.fx.screenShakePower;
    shakeX = (Math.random() * 2 - 1) * power;
    shakeY = (Math.random() * 2 - 1) * power * 0.7;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawTable();
  drawEnemyHandPlaceholders();
  drawCards(nowMs);
  drawHpBadge('enemy', 860, 90);
  drawHpBadge('player', 860, 630);
  drawDamageTexts(nowMs);
  drawHudLabels();
  drawCanvasEndTurnButton();
  drawCoinToss(nowMs);
  drawTurnBanner(nowMs);
  ctx.restore();
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
