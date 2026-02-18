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
const MAX_RANK = 3;
const MAX_FIELD_SLOTS = 5;
const TURN_BANNER_MS = 900;
const ENEMY_AUTO_END_MS = 850;
const ENEMY_ACTION_DELAY_MS = 540;
const COIN_TOSS_MS = 500;
const COIN_RESULT_WOBBLE_MS = 500;
const FIRST_PLAYER_BANNER_MS = 2000;
const FIRST_PLAYER_READY_DELAY_MS = 220;
const NO_ACTION_AUTO_END_DELAY_MS = 480;
const DIRECT_ATTACK_HIT_MS = 190;

const END_TURN_UI = {
  x: 878,
  y: 360,
  radius: 48,
};

// ===== DOM =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const resetButton = document.getElementById('resetButton');

// ===== レイアウト =====
const slotCenters = [140, 280, 420, 560, 700].map((x, index) => ({
  id: index,
  x,
  y: 360,
  occupiedByCardId: null,
}));

function getHandCenter(owner, handIndex, handCount) {
  const y = owner === 'player' ? 624 : 100;
  if (handCount <= 1) {
    return { x: 450, y };
  }

  // 手札は詰め気味で中央寄せ（枚数が減っても端に間延びしない）
  const centerX = 450;
  const gap = Math.min(104, Math.max(78, 620 / (handCount - 1)));
  const startX = centerX - ((handCount - 1) * gap) / 2;
  return {
    x: startX + handIndex * gap,
    y,
  };
}

// ===== 全体状態 =====
const gameState = {
  matchId: 0,
  cards: [],
  nextCardId: 0,
  interactionLock: false,
  activePointer: null,
  summonSelection: {
    active: false,
    cardId: null,
    targetSlotId: null,
    originX: 0,
    originY: 0,
    preselectedIds: [],
    selectedIds: [],
  },
  result: {
    winner: null,
  },
  fx: {
    screenShakeUntilMs: 0,
    screenShakePower: 0,
    damageTexts: [],
    hpPulse: {
      owner: null,
      startMs: 0,
      untilMs: 0,
    },
    koFlashUntilMs: 0,
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
      firstShownAtMs: 0,
      firstShownDone: false,
    },
    enemyAutoEndAtMs: 0,
    enemyNextActionAtMs: 0,
    mainPhaseStartedAtMs: 0,
  },
};

function createCard({ id, owner, zone, rank, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight }) {
  return {
    id,
    owner,
    zone,
    rank,
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

function randomRank() {
  const roll = Math.random();
  if (roll < 0.6) return 1;
  if (roll < 0.88) return 2;
  return 3;
}

function getRankTotalPower(rank) {
  if (rank === 2) return 7;
  if (rank === 3) return 10;
  return 5;
}

function randomAttackPair(totalPower) {
  const left = Math.floor(Math.random() * (totalPower - 1)) + 1;
  return {
    left,
    right: totalPower - left,
  };
}

function drawRandomCardToHand(owner) {
  const handCards = getHandCards(owner);
  const handIndex = handCards.length;
  const center = getHandCenter(owner, handIndex, handIndex + 1);
  const rank = randomRank();
  const pair = randomAttackPair(getRankTotalPower(rank));
  const card = createCard({
    id: gameState.nextCardId,
    owner,
    zone: 'hand',
    rank,
    handIndex,
    x: center.x,
    y: center.y,
    attackLeft: pair.left,
    attackRight: pair.right,
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

function triggerHpPulse(owner, durationMs = 520) {
  const nowMs = performance.now();
  gameState.fx.hpPulse.owner = owner;
  gameState.fx.hpPulse.startMs = nowMs;
  gameState.fx.hpPulse.untilMs = nowMs + durationMs;
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

function getSummonTributeOptions(owner, rank) {
  if (rank <= 1) {
    return [[]];
  }

  const ownField = getFieldCards(owner);
  const rankAny = ownField;
  const rank2 = ownField.filter((card) => card.rank === 2);
  const options = [];

  if (rank === 2) {
    rankAny.forEach((card) => {
      options.push([card.id]);
    });
    return options;
  }

  if (rank === 3) {
    rank2.forEach((card) => {
      options.push([card.id]);
    });

    for (let i = 0; i < rankAny.length; i += 1) {
      for (let j = i + 1; j < rankAny.length; j += 1) {
        options.push([rankAny[i].id, rankAny[j].id]);
      }
    }
  }

  return options;
}

function chooseBestTributeOption(tributeOptions) {
  if (tributeOptions.length === 0) {
    return null;
  }

  let best = tributeOptions[0];
  let bestLoss = Number.POSITIVE_INFINITY;

  tributeOptions.forEach((ids) => {
    const loss = ids.reduce((sum, id) => {
      const card = getCardById(id);
      return sum + (card ? getRankTotalPower(card.rank) : 1000);
    }, 0);
    if (loss < bestLoss) {
      bestLoss = loss;
      best = ids;
    }
  });

  return best;
}

function applyTributeByIds(cardIds) {
  const nowMs = performance.now();
  cardIds.forEach((id) => {
    const tribute = getCardById(id);
    if (!tribute || tribute.zone !== 'field') {
      return;
    }
    markCardDestroyed(tribute, nowMs);
  });
}

function getSummonCandidateSlots(owner, tributeIds) {
  const tributeSet = new Set(tributeIds);
  return slotCenters
    .filter((slot) => {
      if (slot.occupiedByCardId === null) {
        return true;
      }
      const occupying = getCardById(slot.occupiedByCardId);
      return !!occupying && occupying.owner === owner && tributeSet.has(occupying.id);
    })
    .map((slot) => slot.id);
}

function chooseBestTributeOptionForTarget(owner, tributeOptions, targetSlotId) {
  if (tributeOptions.length === 0) {
    return null;
  }

  const legalOptions = tributeOptions.filter((ids) => {
    const candidateSlots = getSummonCandidateSlots(owner, ids);
    return candidateSlots.includes(targetSlotId);
  });

  return chooseBestTributeOption(legalOptions);
}

function canSummonCard(owner, card) {
  if (!card || card.zone !== 'hand' || card.owner !== owner) {
    return false;
  }
  return getSummonTributeOptions(owner, card.rank).length > 0;
}

function getSlotOccupant(slotId) {
  const slot = slotCenters[slotId];
  if (!slot || slot.occupiedByCardId === null) {
    return null;
  }
  return getCardById(slot.occupiedByCardId);
}

function getSelectedTributeCards() {
  const ids = [...gameState.summonSelection.preselectedIds, ...gameState.summonSelection.selectedIds];
  return ids.map((id) => getCardById(id)).filter(Boolean);
}

function canConfirmSummonSelection() {
  const selection = gameState.summonSelection;
  if (!selection.active) {
    return false;
  }
  const card = getCardById(selection.cardId);
  if (!card) {
    return false;
  }

  const selectedCards = getSelectedTributeCards();
  if (card.rank === 1) {
    return true;
  }
  if (card.rank === 2) {
    return selectedCards.length >= 1;
  }

  const hasRank2 = selectedCards.some((c) => c.rank === 2);
  if (selection.preselectedIds.length > 0) {
    return selectedCards.length >= 2;
  }
  return selectedCards.length >= 2 || hasRank2;
}

function beginSummonSelection(card, targetSlotId, originalX, originalY) {
  const occupant = getSlotOccupant(targetSlotId);
  if (occupant && occupant.owner !== card.owner) {
    return false;
  }

  // 選択モード中は召喚カードを手札側に戻し、場カード確認を優先
  card.x = originalX;
  card.y = originalY;

  const preselectedIds = occupant ? [occupant.id] : [];
  gameState.summonSelection = {
    active: true,
    cardId: card.id,
    targetSlotId,
    originX: originalX,
    originY: originalY,
    preselectedIds,
    selectedIds: [],
  };
  gameState.interactionLock = true;
  return true;
}

function cancelSummonSelection() {
  const selection = gameState.summonSelection;
  const card = getCardById(selection.cardId);
  if (card) {
    card.zone = 'hand';
    card.x = selection.originX;
    card.y = selection.originY;
  }
  gameState.summonSelection.active = false;
  gameState.summonSelection.preselectedIds = [];
  gameState.summonSelection.selectedIds = [];
  gameState.interactionLock = false;
}

function confirmSummonSelection() {
  const selection = gameState.summonSelection;
  const card = getCardById(selection.cardId);
  const targetSlot = slotCenters[selection.targetSlotId];
  if (!card || !targetSlot || !canConfirmSummonSelection()) {
    return;
  }

  const allTributeIds = [...selection.preselectedIds, ...selection.selectedIds];
  applyTributeByIds(allTributeIds);

  startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
    card.zone = 'field';
    card.handIndex = null;
    card.fieldSlotIndex = targetSlot.id;
    targetSlot.occupiedByCardId = card.id;
    reflowHand(card.owner);
    gameState.interactionLock = false;
    gameState.summonSelection.active = false;
    gameState.summonSelection.preselectedIds = [];
    gameState.summonSelection.selectedIds = [];
  });
}

function showSummonCostErrorFeedback(card) {
  const nowMs = performance.now();
  card.ui.shakeUntilMs = nowMs + SHAKE_DURATION_MS;
  card.ui.crossUntilMs = nowMs + SHAKE_DURATION_MS;
  addDamageText(card.x, card.y - 70, `RANK ${card.rank} COST`, '#ffc4c4');
}

function toggleSummonSelectionCard(cardId) {
  const selection = gameState.summonSelection;
  if (!selection.active) {
    return;
  }
  if (selection.preselectedIds.includes(cardId)) {
    return;
  }

  const card = getCardById(cardId);
  const summonCard = getCardById(selection.cardId);
  if (!card || !summonCard || card.owner !== summonCard.owner || card.zone !== 'field') {
    return;
  }

  const idx = selection.selectedIds.indexOf(cardId);
  if (idx >= 0) {
    selection.selectedIds.splice(idx, 1);
    return;
  }

  const maxSelectable = summonCard.rank === 3 && selection.preselectedIds.length === 0 ? 2 : 1;
  if (selection.selectedIds.length >= maxSelectable) {
    selection.selectedIds.shift();
  }
  selection.selectedIds.push(cardId);
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
  const canSummon = getHandCards(owner).some((card) => canSummonCard(owner, card));
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

  const matchIdAtSchedule = gameState.matchId;
  setTimeout(() => {
    if (gameState.matchId !== matchIdAtSchedule) {
      return;
    }
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
  gameState.turn.coin.firstShownAtMs = 0;
  gameState.turn.coin.firstShownDone = false;
  gameState.interactionLock = true;
}

function resetGame() {
  gameState.matchId += 1;
  buildInitialCards();
  gameState.interactionLock = false;
  gameState.activePointer = null;
  gameState.summonSelection.active = false;
  gameState.summonSelection.cardId = null;
  gameState.summonSelection.targetSlotId = null;
  gameState.summonSelection.preselectedIds = [];
  gameState.summonSelection.selectedIds = [];
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
  gameState.turn.coin.firstShownAtMs = 0;
  gameState.turn.coin.firstShownDone = false;
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
  const matchIdAtStart = gameState.matchId;

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
    if (gameState.matchId !== matchIdAtStart) {
      return;
    }
    const removeAt = performance.now();
    destroyedCards.forEach((card) => {
      markCardDestroyed(card, removeAt);
    });

    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) {
        return;
      }
      gameState.interactionLock = false;
      recomputeSlotOccupancy();
        }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}

function finishGame(winner) {
  gameState.result.winner = winner;
  gameState.interactionLock = true;
  gameState.fx.koFlashUntilMs = performance.now() + 900;
  triggerScreenShake(14, 500);
  addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 'K.O.', '#ff4d4d');
  showBanner(`${winner.toUpperCase()} WIN`, 1800);
}

function resolveDirectAttack(attacker) {
  const matchIdAtStart = gameState.matchId;
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
    if (gameState.matchId !== matchIdAtStart) {
      return;
    }
    // 演出順: 中央ダメージ表示 -> HPマーカー拡大して減少を強調
    addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10, '-1', '#ff6767');
    triggerScreenShake(8, 210);
    const hpPos = getHpBadgePosition(targetOwner);
    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) {
        return;
      }
      triggerHpPulse(targetOwner, 560);
      gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - 1);
      addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
      if (gameState.hp[targetOwner] <= 0) {
        finishGame(attacker.owner);
        return;
      }
      gameState.interactionLock = false;
    }, 110);
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
  if (hand.length === 0) {
    return null;
  }

  let best = null;

  hand.forEach((card) => {
    const tributeOptions = getSummonTributeOptions('enemy', card.rank);
    if (tributeOptions.length === 0) {
      return;
    }
    const bestTribute = chooseBestTributeOption(tributeOptions);
    const tributeLoss = (bestTribute ?? []).reduce((sum, id) => {
      const tribute = getCardById(id);
      return sum + (tribute ? getRankTotalPower(tribute.rank) : 0);
    }, 0);

    const summonPower = getRankTotalPower(card.rank);
    if (card.rank >= 2 && tributeLoss >= summonPower) {
      return;
    }

    const candidateSlots = getSummonCandidateSlots('enemy', bestTribute ?? []);
    candidateSlots.forEach((slotIndex) => {
      const score = evaluateEnemyPlacement(card, slotIndex) + summonPower * 0.7 - tributeLoss * 1.4;
      if (!best || score > best.score) {
        best = { card, slotIndex, tributeIds: bestTribute ?? [], score };
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
    const { card, slotIndex, tributeIds } = summon;
    const targetSlot = slotCenters[slotIndex];
    const summonableSlots = getSummonCandidateSlots('enemy', tributeIds);
    if (!summonableSlots.includes(slotIndex)) {
      return false;
    }
    gameState.interactionLock = true;

    applyTributeByIds(tributeIds);

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

function getSummonSelectionButtons() {
  return {
    confirm: { x: 366, y: 590, width: 110, height: 44 },
    cancel: { x: 488, y: 590, width: 110, height: 44 },
  };
}

function getTopCardAtPoint(point, predicate) {
  const candidates = gameState.cards
    .filter((card) => !card.ui.pendingRemoval && predicate(card))
    .sort((a, b) => b.id - a.id);

  return candidates.find((card) => pointInCard(point.x, point.y, card)) ?? null;
}

function onPointerDown(event) {
  if (gameState.activePointer !== null) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event);

  if (gameState.summonSelection.active) {
    const { confirm, cancel } = getSummonSelectionButtons();
    if (pointInRect(point.x, point.y, cancel)) {
      cancelSummonSelection();
      return;
    }
    if (pointInRect(point.x, point.y, confirm)) {
      if (canConfirmSummonSelection()) {
        confirmSummonSelection();
      }
      return;
    }

    const selectable = getTopCardAtPoint(
      point,
      (card) => card.zone === 'field' && card.owner === 'player' && !card.ui.pendingRemoval,
    );
    if (selectable) {
      toggleSummonSelectionCard(selectable.id);
    }
    return;
  }

  if (gameState.interactionLock) {
    return;
  }

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

    const targetSlot = slotCenters.find((slot) => pointInSlot(card.x, card.y, slot));

    gameState.interactionLock = true;

    if (targetSlot) {
      if (targetSlot.occupiedByCardId !== null && card.rank === 1) {
        showSummonCostErrorFeedback(card);
        startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
          card.zone = 'hand';
          gameState.interactionLock = false;
        });
      } else if (card.rank === 1) {
        startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
          card.zone = 'field';
          card.handIndex = null;
          card.fieldSlotIndex = targetSlot.id;
          targetSlot.occupiedByCardId = card.id;
          reflowHand('player');
          gameState.interactionLock = false;
        });
      } else {
        const tributeOptions = getSummonTributeOptions('player', card.rank);
        const selected = chooseBestTributeOptionForTarget('player', tributeOptions, targetSlot.id);

        if (!selected) {
          showSummonCostErrorFeedback(card);
          startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
            card.zone = 'hand';
            gameState.interactionLock = false;
          });
        } else {
          beginSummonSelection(card, targetSlot.id, pointerState.originalX, pointerState.originalY);
        }
      }
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
  // 補助テキストは削減し、ターン情報はENDボタン側へ統合
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
  const nowMs = performance.now();
  let scale = 1;
  if (gameState.fx.hpPulse.owner === owner && nowMs < gameState.fx.hpPulse.untilMs) {
    const t = (nowMs - gameState.fx.hpPulse.startMs) / (gameState.fx.hpPulse.untilMs - gameState.fx.hpPulse.startMs);
    const pulse = Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI);
    scale = 1 + pulse * 0.32;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
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

function getHpBadgePosition(owner) {
  if (owner === 'enemy') {
    return { x: 918, y: 76 };
  }
  return { x: 70, y: 644 };
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

function drawSummonSelectionOverlay() {
  if (!gameState.summonSelection.active) {
    return;
  }

  const selection = gameState.summonSelection;
  const summonCard = getCardById(selection.cardId);
  if (!summonCard) {
    return;
  }

  const selected = new Set([...selection.preselectedIds, ...selection.selectedIds]);

  const previewX = 124;
  const previewY = 584;

  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.58)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 生贄候補の明示
  getFieldCards('player').forEach((card) => {
    const left = card.x - CARD_WIDTH / 2 - 5;
    const top = card.y - CARD_HEIGHT / 2 - 5;
    ctx.strokeStyle = selected.has(card.id) ? '#ffd470' : 'rgba(230,240,255,0.55)';
    ctx.lineWidth = selected.has(card.id) ? 4 : 2;
    ctx.strokeRect(left, top, CARD_WIDTH + 10, CARD_HEIGHT + 10);
  });

  // 召喚対象カードを別枠で表示して、場カード確認を邪魔しない
  ctx.fillStyle = 'rgba(15, 22, 35, 0.92)';
  ctx.strokeStyle = '#9fb4dc';
  ctx.lineWidth = 2;
  ctx.fillRect(26, 486, 196, 164);
  ctx.strokeRect(26, 486, 196, 164);

  const previewLeft = previewX - CARD_WIDTH / 2;
  const previewTop = previewY - CARD_HEIGHT / 2;
  const ownerStroke = summonCard.owner === 'player' ? '#4da3ff' : '#ff7272';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = ownerStroke;
  ctx.lineWidth = 3;
  ctx.fillRect(previewLeft, previewTop, CARD_WIDTH, CARD_HEIGHT);
  ctx.strokeRect(previewLeft, previewTop, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = '#101010';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`RANK ${summonCard.rank}`, previewLeft + 8, previewTop + 22);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(String(summonCard.combat.attackLeft), previewLeft + 12, previewY + 8);
  ctx.fillText(String(summonCard.combat.attackRight), previewLeft + CARD_WIDTH - 26, previewY + 8);

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#d5e4ff';
  ctx.fillText('SUMMON', 86, 506);

  const panelX = 250;
  const panelY = 522;
  const panelW = 460;
  const panelH = 122;
  ctx.fillStyle = 'rgba(18, 26, 41, 0.9)';
  ctx.strokeStyle = '#9fb4dc';
  ctx.lineWidth = 2;
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = '#eaf1ff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`RANK ${summonCard.rank} 召喚コストを選択`, panelX + 16, panelY + 28);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#d8e0f5';
  if (summonCard.rank === 2) {
    ctx.fillText('場のカードを1枚選択（出し先にカードがある場合は自動で選択済み）', panelX + 16, panelY + 50);
  } else {
    ctx.fillText('場のカード2枚、またはランク2を1枚選択（出し先カードは自動選択）', panelX + 16, panelY + 50);
  }

  const selectedCards = getSelectedTributeCards();
  const hasRank2 = selectedCards.some((c) => c.rank === 2);
  ctx.fillText(
    `選択中: ${selectedCards.length}枚${hasRank2 ? ' (Rank2含む)' : ''}`,
    panelX + 16,
    panelY + 72,
  );

  const { confirm, cancel } = getSummonSelectionButtons();
  const canConfirm = canConfirmSummonSelection();

  ctx.fillStyle = canConfirm ? '#274a7f' : '#2a3448';
  ctx.strokeStyle = canConfirm ? '#7db5ff' : '#627291';
  ctx.lineWidth = 2;
  ctx.fillRect(confirm.x, confirm.y, confirm.width, confirm.height);
  ctx.strokeRect(confirm.x, confirm.y, confirm.width, confirm.height);
  ctx.fillStyle = canConfirm ? '#edf4ff' : '#9eaac2';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Confirm', confirm.x + 22, confirm.y + 28);

  ctx.fillStyle = '#4a2a33';
  ctx.strokeStyle = '#c18595';
  ctx.fillRect(cancel.x, cancel.y, cancel.width, cancel.height);
  ctx.strokeRect(cancel.x, cancel.y, cancel.width, cancel.height);
  ctx.fillStyle = '#ffe5ea';
  ctx.fillText('Cancel', cancel.x + 28, cancel.y + 28);

  ctx.restore();
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
    const rankLabel = `RANK ${card.rank}`;

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
    ctx.fillText(rankLabel, left + 10, top + 18);

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
  const isEnemyMain = gameState.turn.phase === 'main' && gameState.turn.currentPlayer === 'enemy';
  const turnLine = `Turn ${gameState.turn.number}`;

  ctx.save();
  const fill = enabled ? '#1f304d' : (isEnemyMain ? '#4a2020' : '#232a38');
  const stroke = enabled ? '#6aa7ff' : (isEnemyMain ? '#ff8b8b' : '#55627a');

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

  ctx.fillStyle = enabled ? '#e8f1ff' : (isEnemyMain ? '#ffd7d7' : '#aeb8cc');
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (enabled) {
    ctx.fillText(turnLine, x, y - 11);
    ctx.fillText('End', x, y + 11);
  } else if (isEnemyMain) {
    ctx.fillText(turnLine, x, y - 11);
    ctx.fillText('Enemy', x, y + 11);
  } else {
    ctx.fillText(turnLine, x, y - 11);
    ctx.fillText('Wait', x, y + 11);
  }
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
  const launchY = 360;
  const landingY = 430;
  const peakHeight = 180;

  // 連続な放物線（ワープ感をなくす）
  let coinY = launchY + (landingY - launchY) * progress - peakHeight * 4 * progress * (1 - progress);

  // 一方向回転（減速）
  const eased = 1 - Math.pow(1 - progress, 2);
  let spin = eased * Math.PI * 6;
  let tiltY = 1;
  if (!gameState.turn.coin.active) {
    const wobbleRemain = Math.max(gameState.turn.coin.revealUntilMs - nowMs, 0);
    const wobbleRate = Math.min(Math.max(wobbleRemain / COIN_RESULT_WOBBLE_MS, 0), 1);
    const wobble = Math.sin(nowMs * 0.045) * wobbleRate;
    coinY = landingY + wobble * 5;
    spin = (gameState.turn.coin.resultFirstPlayer === 'player' ? 0 : Math.PI) + wobble * 0.12;
    tiltY = 1 + Math.abs(wobble) * 0.03;
  }

  const scaleX = Math.max(0.12, Math.abs(Math.cos(spin)));
  const radius = 44;

  // 影は地面固定で大きさ/濃さのみ変化（空中影を避ける）
  const heightRatio = Math.min(Math.max((landingY - coinY) / peakHeight, 0), 1);
  const shadowW = 44 - heightRatio * 18;
  const shadowH = 11 - heightRatio * 5;
  const shadowAlpha = 0.24 - heightRatio * 0.14;

  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(centerX, landingY + 48, shadowW, shadowH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(centerX, coinY);
  ctx.scale(Math.max(scaleX, 0.08), tiltY);

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

  if (gameState.turn.phase === 'coin_toss') {
    if (!gameState.turn.coin.active && !gameState.turn.coin.firstShownDone) {
      if (nowMs >= gameState.turn.coin.revealUntilMs) {
        const firstLabel = gameState.turn.firstPlayer === 'player' ? 'あなたの先攻' : '相手の先攻';
        showBanner(firstLabel, FIRST_PLAYER_BANNER_MS);
        gameState.turn.coin.firstShownAtMs = nowMs;
        gameState.turn.coin.firstShownDone = true;
      }
      return;
    }

    if (!gameState.turn.coin.active && gameState.turn.coin.firstShownDone) {
      if (nowMs >= gameState.turn.coin.firstShownAtMs + FIRST_PLAYER_BANNER_MS + FIRST_PLAYER_READY_DELAY_MS) {
        gameState.interactionLock = false;
        beginTurn(gameState.turn.firstPlayer, false);
      }
      return;
    }

    const elapsed = nowMs - gameState.turn.coin.startMs;
    if (elapsed >= gameState.turn.coin.durationMs) {
      gameState.turn.coin.active = false;
      gameState.turn.firstPlayer = gameState.turn.coin.resultFirstPlayer;
      gameState.turn.coin.revealUntilMs = nowMs + COIN_RESULT_WOBBLE_MS;
      gameState.turn.coin.firstShownDone = false;
      gameState.turn.coin.firstShownAtMs = 0;
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
  drawCards(nowMs);
  const enemyHpPos = getHpBadgePosition('enemy');
  const playerHpPos = getHpBadgePosition('player');
  drawHpBadge('enemy', enemyHpPos.x, enemyHpPos.y);
  drawHpBadge('player', playerHpPos.x, playerHpPos.y);
  drawDamageTexts(nowMs);
  drawHudLabels();
  drawCanvasEndTurnButton();
  drawCoinToss(nowMs);
  drawTurnBanner(nowMs);
  drawSummonSelectionOverlay();

  if (nowMs < gameState.fx.koFlashUntilMs) {
    const remain = gameState.fx.koFlashUntilMs - nowMs;
    const alpha = Math.min(remain / 900, 1) * 0.55;
    ctx.fillStyle = `rgba(255,70,70,${alpha})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
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
