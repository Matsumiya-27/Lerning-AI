// ===== カード生成・召喚・戦闘 =====
import {
  STARTING_HAND, SHAKE_DURATION_MS, HIT_FLASH_MS,
  DESTROY_ANIMATION_MS, DIRECT_ATTACK_HIT_MS,
  CANVAS_WIDTH, CANVAS_HEIGHT,
} from './constants.js';
import {
  gameState, slotCenters, getHandCenter,
  getCardById, getCardAtSlot, getHandCards, getFieldCards,
  getSlotOccupant, hasEmptyFieldSlot, reflowHand,
  startMoveAnimation, markCardDestroyed, recomputeSlotOccupancy,
  triggerUsedCardFeedback, triggerScreenShake, addDamageText,
  triggerHpPulse, showBanner, getHpBadgePosition,
} from './state.js';

// ===== カードファクトリ =====

export function createCard({ id, owner, zone, rank, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight }) {
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
      summonedThisTurn: false,
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

export function randomRank() {
  const roll = Math.random();
  if (roll < 0.6) return 1;
  if (roll < 0.88) return 2;
  return 3;
}

export function getRankTotalPower(rank) {
  if (rank === 2) return 7;
  if (rank === 3) return 10;
  return 5;
}

export function randomAttackPair(totalPower) {
  const left = Math.floor(Math.random() * (totalPower - 1)) + 1;
  return {
    left,
    right: totalPower - left,
  };
}

export function drawRandomCardToHand(owner) {
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

export function buildInitialCards() {
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

// ===== 召喚・生贄ロジック =====

export function getSummonTributeOptions(owner, rank) {
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

export function chooseBestTributeOption(tributeOptions) {
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

export function applyTributeByIds(cardIds) {
  const nowMs = performance.now();
  cardIds.forEach((id) => {
    const tribute = getCardById(id);
    if (!tribute || tribute.zone !== 'field') {
      return;
    }
    markCardDestroyed(tribute, nowMs);
  });
}

export function getSummonCandidateSlots(owner, tributeIds) {
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

export function chooseBestTributeOptionForTarget(owner, tributeOptions, targetSlotId) {
  if (tributeOptions.length === 0) {
    return null;
  }

  const legalOptions = tributeOptions.filter((ids) => {
    const candidateSlots = getSummonCandidateSlots(owner, ids);
    return candidateSlots.includes(targetSlotId);
  });

  return chooseBestTributeOption(legalOptions);
}

export function canSummonCard(owner, card) {
  if (!card || card.zone !== 'hand' || card.owner !== owner) {
    return false;
  }

  if (card.rank === 1) {
    return hasEmptyFieldSlot();
  }

  const tributeOptions = getSummonTributeOptions(owner, card.rank);
  return tributeOptions.some((ids) => getSummonCandidateSlots(owner, ids).length > 0);
}

export function getSelectedTributeCards() {
  const ids = [...gameState.summonSelection.preselectedIds, ...gameState.summonSelection.selectedIds];
  return ids.map((id) => getCardById(id)).filter(Boolean);
}

export function canConfirmSummonSelection() {
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
    return selectedCards.length >= 2 || hasRank2;
  }
  return selectedCards.length >= 2 || hasRank2;
}

export function beginSummonSelection(card, targetSlotId, originalX, originalY) {
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

export function cancelSummonSelection() {
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

// 召喚実行の共通処理（オーバーレイ経由・直接経由どちらからも呼ぶ）
export function performSummon(card, targetSlot, tributeIds) {
  applyTributeByIds(tributeIds);
  startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
    card.zone = 'field';
    card.handIndex = null;
    card.fieldSlotIndex = targetSlot.id;
    card.combat.summonedThisTurn = true;
    targetSlot.occupiedByCardId = card.id;
    reflowHand(card.owner);
    gameState.interactionLock = false;
    gameState.summonSelection.active = false;
    gameState.summonSelection.preselectedIds = [];
    gameState.summonSelection.selectedIds = [];
  });
}

export function confirmSummonSelection() {
  const selection = gameState.summonSelection;
  const card = getCardById(selection.cardId);
  const targetSlot = slotCenters[selection.targetSlotId];
  if (!card || !targetSlot || !canConfirmSummonSelection()) {
    return;
  }

  const allTributeIds = [...selection.preselectedIds, ...selection.selectedIds];
  performSummon(card, targetSlot, allTributeIds);
}

export function showSummonCostErrorFeedback(card) {
  const nowMs = performance.now();
  card.ui.shakeUntilMs = nowMs + SHAKE_DURATION_MS;
  card.ui.crossUntilMs = nowMs + SHAKE_DURATION_MS;
  addDamageText(card.x, card.y - 70, `RANK ${card.rank} COST`, '#ffc4c4');
}

export function toggleSummonSelectionCard(cardId) {
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

// ===== ゲームルール判定 =====

export function hasAdjacentEnemyTarget(card) {
  if (card.zone !== 'field' || card.fieldSlotIndex === null) {
    return false;
  }
  const left = getCardAtSlot(card.fieldSlotIndex - 1);
  const right = getCardAtSlot(card.fieldSlotIndex + 1);
  return (left && left.owner !== card.owner) || (right && right.owner !== card.owner);
}

export function canDirectAttack(attackerOwner) {
  // 先攻1ターン目だけ直接攻撃不可
  if (gameState.turn.number === 1 && gameState.turn.currentPlayer === gameState.turn.firstPlayer) {
    return attackerOwner !== gameState.turn.firstPlayer;
  }
  return true;
}

export function canOwnerAct(owner) {
  const canSummon = getHandCards(owner).some((card) => canSummonCard(owner, card));
  const canAttack = getFieldCards(owner).some((card) => !card.combat.hasActedThisTurn && hasAdjacentEnemyTarget(card));
  const canDirect = getFieldCards(owner).some((card) => !card.combat.hasActedThisTurn && !card.combat.summonedThisTurn) && canDirectAttack(owner);
  return canSummon || canAttack || canDirect;
}

export function isPlayerMainTurn() {
  return gameState.turn.phase === 'main' && gameState.turn.currentPlayer === 'player';
}

export function canUseEndTurnButton() {
  return isPlayerMainTurn() && !gameState.interactionLock && !gameState.result.winner;
}

// ===== 戦闘解決 =====

export function resolveSwipeAttack(attacker, direction) {
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

export function finishGame(winner) {
  gameState.result.winner = winner;
  gameState.interactionLock = true;
  gameState.fx.koFlashUntilMs = performance.now() + 900;
  triggerScreenShake(14, 500);
  addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 'K.O.', '#ff4d4d');
  showBanner(`${winner.toUpperCase()} WIN`, 1800);
}

export function resolveDirectAttack(attacker) {
  const matchIdAtStart = gameState.matchId;
  if (gameState.turn.phase !== 'main' || gameState.interactionLock || gameState.result.winner) {
    return;
  }

  if (attacker.zone !== 'field' || attacker.owner !== gameState.turn.currentPlayer || attacker.fieldSlotIndex === null) {
    return;
  }

  if (attacker.combat.hasActedThisTurn || attacker.combat.summonedThisTurn || !canDirectAttack(attacker.owner)) {
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
