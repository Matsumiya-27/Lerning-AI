// ===== カード生成・召喚・戦闘 =====
import {
  STARTING_HAND, SHAKE_DURATION_MS, HIT_FLASH_MS,
  DESTROY_ANIMATION_MS, DIRECT_ATTACK_HIT_MS,
  CANVAS_WIDTH, CANVAS_HEIGHT,
  MAX_FIELD_SLOTS,
} from './constants.js';
import { getCardStats } from './deck.js';
import {
  gameState, slotCenters, getHandCenter,
  getCardById, getCardAtSlot, getHandCards, getFieldCards,
  getSlotOccupant, hasEmptyFieldSlot, reflowHand,
  startMoveAnimation, markCardDestroyed, recomputeSlotOccupancy,
  triggerUsedCardFeedback, triggerScreenShake, addDamageText,
  triggerHpPulse, showBanner, getHpBadgePosition,
} from './state.js';

// ===== カードファクトリ =====

export function createCard({ id, owner, zone, rank, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight, effect = null }) {
  return {
    id,
    owner,
    zone,
    rank,
    effect,  // 'rush' | 'pierce' | 'revenge' | null
    handIndex,
    fieldSlotIndex,
    x,
    y,
    combat: {
      attackLeft,
      attackRight,
      baseAttackLeft: attackLeft,   // 永続デバフで変化する基本値
      baseAttackRight: attackRight,
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

// ランクごとの効果リスト
const RANK_EFFECTS = {
  1: ['rush', 'edge1', 'doubleblade', 'weakaura', 'offering'],
  2: ['pierce', 'strike2', 'edge2', 'swap', 'doubleblade', 'deathcurse'],
  3: ['revenge', 'strike3', 'edgewin', 'doublecenter', 'steal', 'harakiri'],
};

// 合計攻撃力を -1 する効果（カードの価値を効果で補う）
const REDUCED_TOTAL_EFFECTS = new Set(['rush', 'weakaura', 'pierce', 'strike2', 'revenge', 'strike3', 'steal']);

// 常に左右対称の固定値になる効果（total/2 ずつ）
const SYMMETRIC_EFFECTS = new Set(['rush', 'weakaura', 'offering', 'strike2', 'harakiri']);

// ランクに対応する効果をランダムに決定（30%の確率で付与）
function randomEffectForRank(rank) {
  if (Math.random() > 0.30) return null;
  const pool = RANK_EFFECTS[rank];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function randomRank() {
  const roll = Math.random();
  if (roll < 0.6) return 1;
  if (roll < 0.88) return 2;
  return 3;
}

export function getRankTotalPower(rank) {
  if (rank === 2) return 7;
  if (rank === 3) return 11;
  return 5;
}

export function randomAttackPair(totalPower, maxSide) {
  // 片側の値域: [totalPower - maxSide, maxSide]
  const minSide = totalPower - maxSide;
  const left = Math.floor(Math.random() * (maxSide - minSide + 1)) + minSide;
  return {
    left,
    right: totalPower - left,
  };
}

export function drawRandomCardToHand(owner) {
  const handCards = getHandCards(owner);
  const handIndex = handCards.length;
  const center = getHandCenter(owner, handIndex, handIndex + 1);

  let rank;
  let effect;

  if (owner === 'player') {
    // プレイヤー: デッキ山から引く。切れていれば何もしない
    if (gameState.playerDeckPile.length === 0) return;
    const drawn = gameState.playerDeckPile.pop();
    rank = drawn.rank;
    effect = drawn.effect;
  } else {
    // 敵: ランダム生成
    rank = randomRank();
    effect = randomEffectForRank(rank);
  }

  // ── 固定スタッツ参照（同種カードは常に同じ左右値）──
  const stats = getCardStats(rank, effect);
  const pair = { left: stats.l, right: stats.r };

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
    effect,
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

  // 上書き召喚: RANK1/2は相手のRANK1カード上に生贄コストなしで出せる
  if ((card.rank === 1 || card.rank === 2) && getOverrideSummonSlots(owner).length > 0) {
    return true;
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
  const matchIdAtStart = gameState.matchId;
  applyTributeByIds(tributeIds);
  startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
    card.zone = 'field';
    card.handIndex = null;
    card.fieldSlotIndex = targetSlot.id;
    // rush: 召喚酔いなし（直接攻撃を同ターンに使用可能）
    const hasRush = card.effect === 'rush';
    card.combat.summonedThisTurn = !hasRush;
    targetSlot.occupiedByCardId = card.id;
    reflowHand(card.owner);
    gameState.summonSelection.active = false;
    gameState.summonSelection.preselectedIds = [];
    gameState.summonSelection.selectedIds = [];
    applyBoardEffects();

    // swap効果
    if (card.effect === 'swap') {
      performSwapEffect(card);
      gameState.interactionLock = false;
      return;
    }
    // doublecenter効果
    if (card.effect === 'doublecenter' && card.fieldSlotIndex === 2) {
      performDoubleCenterAttack(card, matchIdAtStart);
      return;
    }
    // offering効果: プレイヤー召喚時のみ選択UI
    if (card.effect === 'offering' && card.owner === 'player') {
      performOfferingEffect(card);
      return;
    }
    // steal効果: 隣接敵カードを奪う
    if (card.effect === 'steal') {
      performStealEffect(card, matchIdAtStart);
      return;
    }
    // harakiri効果: 自陣全カード破壊（自身含む）
    if (card.effect === 'harakiri') {
      performHarakiriEffect(card, matchIdAtStart);
      return;
    }

    gameState.interactionLock = false;
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

// ===== 上書き召喚 =====

// 全5スロットが相手のカードで埋まっている（空きスロットなし）場合のみ上書き召喚が可能
export function isOverrideSummonAvailable(owner) {
  return !hasEmptyFieldSlot() && getFieldCards(owner).length === 0;
}

// 上書き可能な相手のRANK1スロットIDを返す
export function getOverrideSummonSlots(owner) {
  if (!isOverrideSummonAvailable(owner)) {
    return [];
  }
  const opponent = owner === 'player' ? 'enemy' : 'player';
  return getFieldCards(opponent)
    .filter((c) => c.rank === 1)
    .map((c) => c.fieldSlotIndex);
}

// 上書き召喚実行: 相手のRANK1を破棄してその場所に自分のカードを置く（生贄コストなし）
export function performOverrideSummon(card, targetSlot) {
  const nowMs = performance.now();
  const matchIdAtStart = gameState.matchId;
  gameState.interactionLock = true;

  const occupant = getCardById(targetSlot.occupiedByCardId);
  if (occupant) {
    markCardDestroyed(occupant, nowMs);
    addDamageText(targetSlot.x, targetSlot.y - 60, 'OVERRIDE!', '#ffd470');
    triggerScreenShake(4, 120);
  }

  // 破棄アニメ後にカードを移動（同スロットに重なる見た目を避ける）
  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) {
      return;
    }
    startMoveAnimation(card, targetSlot.x, targetSlot.y, () => {
      card.zone = 'field';
      card.handIndex = null;
      card.fieldSlotIndex = targetSlot.id;
      // rush: 召喚酔いなし
      const hasRush = card.effect === 'rush';
      card.combat.summonedThisTurn = !hasRush;
      targetSlot.occupiedByCardId = card.id;
      reflowHand(card.owner);
      applyBoardEffects();

      if (card.effect === 'swap') {
        performSwapEffect(card);
        gameState.interactionLock = false;
        return;
      }
      if (card.effect === 'doublecenter' && card.fieldSlotIndex === 2) {
        performDoubleCenterAttack(card, matchIdAtStart);
        return;
      }
      if (card.effect === 'offering' && card.owner === 'player') {
        performOfferingEffect(card);
        return;
      }
      if (card.effect === 'steal') {
        performStealEffect(card, matchIdAtStart);
        return;
      }
      if (card.effect === 'harakiri') {
        performHarakiriEffect(card, matchIdAtStart);
        return;
      }

      gameState.interactionLock = false;
    });
  }, DESTROY_ANIMATION_MS);
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

  let attackerPower = direction === 'left' ? attacker.combat.attackLeft : attacker.combat.attackRight;
  const defenderPower = direction === 'left' ? defender.combat.attackRight : defender.combat.attackLeft;

  // 端ボーナス（edge1/edge2）: 端スロットのカードへ攻撃するとき攻撃力上昇
  const isTargetEdge = targetSlotIndex === 0 || targetSlotIndex === MAX_FIELD_SLOTS - 1;
  if (isTargetEdge) {
    if (attacker.effect === 'edge1') attackerPower += 1;
    if (attacker.effect === 'edge2') attackerPower += 2;
  }

  // edgewin: 端スロットへの攻撃は必ず勝利（同点含む）
  const attackerForceWin = attacker.effect === 'edgewin' && isTargetEdge;

  const destroyedCards = [];
  if (attackerForceWin || attackerPower > defenderPower) {
    destroyedCards.push(defender);
  } else if (attackerPower < defenderPower) {
    destroyedCards.push(attacker);
  } else {
    destroyedCards.push(attacker, defender);
  }

  const attackerLost = destroyedCards.includes(attacker);
  const defenderLost = destroyedCards.includes(defender);

  // 効果ダメージリストを構築
  const effectDamageList = []; // { targetOwner, amount, label, color }

  // pierce: 自カードが生き残った（勝利）場合のみ、相手プレイヤーに1ダメージ（同点破棄は勝利ではないため対象外）
  if (!attackerLost && defenderLost && attacker.effect === 'pierce') {
    effectDamageList.push({ targetOwner: defender.owner, amount: 1, label: 'PIERCE -1', color: '#ffe050' });
  } else if (!defenderLost && attackerLost && defender.effect === 'pierce') {
    effectDamageList.push({ targetOwner: attacker.owner, amount: 1, label: 'PIERCE -1', color: '#ffe050' });
  }

  // revenge: 戦闘で破壊されたカードが持つ効果。相手プレイヤーに2ダメージ（同点も含む）
  if (attackerLost && attacker.effect === 'revenge') {
    effectDamageList.push({ targetOwner: defender.owner, amount: 2, label: 'REVENGE -2', color: '#e060ff' });
  }
  if (defenderLost && defender.effect === 'revenge') {
    effectDamageList.push({ targetOwner: attacker.owner, amount: 2, label: 'REVENGE -2', color: '#e060ff' });
  }

  // deathcurse: 戦闘で破壊されたとき、勝利したカードの基本攻撃力を永続 -2（引き分けは対象外）
  if (defenderLost && !attackerLost && defender.effect === 'deathcurse') {
    attacker.combat.baseAttackLeft  = Math.max(0, attacker.combat.baseAttackLeft  - 2);
    attacker.combat.baseAttackRight = Math.max(0, attacker.combat.baseAttackRight - 2);
    addDamageText(attacker.x, attacker.y - 60, 'CURSE! -2', '#a020e0');
    triggerScreenShake(4, 130);
  }
  if (attackerLost && !defenderLost && attacker.effect === 'deathcurse') {
    defender.combat.baseAttackLeft  = Math.max(0, defender.combat.baseAttackLeft  - 2);
    defender.combat.baseAttackRight = Math.max(0, defender.combat.baseAttackRight - 2);
    addDamageText(defender.x, defender.y - 60, 'CURSE! -2', '#a020e0');
    triggerScreenShake(4, 130);
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

    // 効果発動テキスト表示
    if (effectDamageList.length > 0) {
      effectDamageList.forEach((e, i) => {
        addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20 + i * 34, e.label, e.color);
      });
      triggerScreenShake(5, 150);
    }

    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) {
        return;
      }
      let gameEnded = false;
      effectDamageList.forEach(({ targetOwner, amount }) => {
        if (gameEnded) return;
        gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - amount);
        triggerHpPulse(targetOwner, 560);
        const hpPos = getHpBadgePosition(targetOwner);
        addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
        if (gameState.hp[targetOwner] <= 0) {
          finishGame(targetOwner === 'player' ? 'enemy' : 'player');
          gameEnded = true;
        }
      });
      if (!gameEnded) {
        gameState.interactionLock = false;
      }
      recomputeSlotOccupancy();
      applyBoardEffects();
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}

// ===== offering / steal / harakiri =====

// offering効果: プレイヤーが「KEEP」か「OFFER（相手へ譲渡）」を選ぶオーバーレイを起動
function performOfferingEffect(card) {
  gameState.offeringChoice.active = true;
  gameState.offeringChoice.cardId = card.id;
  // interactionLock は confirmOfferingChoice で解除
}

// offering 選択結果を受けて実行（input.js から呼ぶ）
export function confirmOfferingChoice(giveToOpponent) {
  const card = getCardById(gameState.offeringChoice.cardId);
  gameState.offeringChoice.active = false;
  gameState.offeringChoice.cardId = null;
  if (card && giveToOpponent) {
    card.owner = card.owner === 'player' ? 'enemy' : 'player';
    applyBoardEffects();
  }
  gameState.interactionLock = false;
}

// steal効果: 隣接する敵カードの所有権を得る（2択の場合は選択UI を起動）
function performStealEffect(card) {
  const slotIdx = card.fieldSlotIndex;
  const opponent = card.owner === 'player' ? 'enemy' : 'player';

  const leftCand  = slotIdx > 0                   ? getCardAtSlot(slotIdx - 1) : null;
  const rightCand = slotIdx < MAX_FIELD_SLOTS - 1  ? getCardAtSlot(slotIdx + 1) : null;

  const leftTarget  = leftCand  && leftCand.owner  === opponent ? leftCand  : null;
  const rightTarget = rightCand && rightCand.owner === opponent ? rightCand : null;

  if (!leftTarget && !rightTarget) {
    gameState.interactionLock = false;
    return;
  }

  if (leftTarget && rightTarget) {
    if (card.owner === 'player') {
      // プレイヤー: 選択 UI を起動
      gameState.stealChoice.active = true;
      gameState.stealChoice.cardId = card.id;
      gameState.stealChoice.leftId  = leftTarget.id;
      gameState.stealChoice.rightId = rightTarget.id;
      return; // 選択後に confirmStealChoice がロック解除
    }
    // AI: 合計攻撃力が高い方を優先
    const leftPow  = leftTarget.combat.baseAttackLeft  + leftTarget.combat.baseAttackRight;
    const rightPow = rightTarget.combat.baseAttackLeft + rightTarget.combat.baseAttackRight;
    stealCard(leftPow >= rightPow ? leftTarget : rightTarget, card.owner);
  } else {
    stealCard(leftTarget ?? rightTarget, card.owner);
  }

  applyBoardEffects();
  gameState.interactionLock = false;
}

// 所有権変更の共通処理
function stealCard(target, newOwner) {
  target.owner = newOwner;
  addDamageText(target.x, target.y - 60, 'STOLEN!', '#ffd700');
  triggerScreenShake(5, 140);
}

// steal 選択結果を受けて実行（input.js から呼ぶ）
export function confirmStealChoice(targetCardId) {
  const target = getCardById(targetCardId);
  const stealCardObj = getCardById(gameState.stealChoice.cardId);
  gameState.stealChoice.active = false;
  gameState.stealChoice.cardId = null;
  gameState.stealChoice.leftId  = null;
  gameState.stealChoice.rightId = null;
  if (target && stealCardObj) {
    stealCard(target, stealCardObj.owner);
    applyBoardEffects();
  }
  gameState.interactionLock = false;
}

// harakiri効果: 召喚ターンに全フィールドカード（自陣・敵陣含む）と自陣手札を破壊
function performHarakiriEffect(card, matchIdAtStart) {
  const owner = card.owner;
  const opponent = owner === 'player' ? 'enemy' : 'player';
  const nowMs = performance.now();

  addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20, 'HARAKIRI!', '#ff4040');
  triggerScreenShake(12, 350);

  // フィールドカード（自陣・敵陣・自身含む全て）: アニメーション付き破棄
  [...getFieldCards(owner), ...getFieldCards(opponent)].forEach((c) => markCardDestroyed(c, nowMs));

  // 自陣手札カード: 破棄
  getHandCards(owner).forEach((c) => markCardDestroyed(c, nowMs));

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) return;
    recomputeSlotOccupancy();
    applyBoardEffects();
    gameState.interactionLock = false;
  }, DESTROY_ANIMATION_MS + 60);
}

// ===== デバッグユーティリティ =====

// プレイヤー手札の左端カードを指定スペックに書き換える（デバッグ用）
export function replaceLeftmostHandCard(owner, rank, effect, attackLeft, attackRight) {
  const handCards = getHandCards(owner).sort((a, b) => (a.handIndex ?? 0) - (b.handIndex ?? 0));
  if (handCards.length === 0) return;
  const target = handCards[0];
  target.rank = rank;
  target.effect = effect;
  target.combat.attackLeft = attackLeft;
  target.combat.attackRight = attackRight;
  target.combat.baseAttackLeft = attackLeft;
  target.combat.baseAttackRight = attackRight;
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
  // strike2/strike3: 直接攻撃ダメージを増加
  // doubleblade: 通常ダメージ、ただし自分にも同量ダメージ
  const directDamage = attacker.effect === 'strike3' ? 3
    : attacker.effect === 'strike2' ? 2
    : 1;
  const selfDamage = attacker.effect === 'doubleblade' ? directDamage : 0;

  attacker.combat.hasActedThisTurn = true;
  attacker.ui.hitFlashUntilMs = performance.now() + HIT_FLASH_MS;
  gameState.interactionLock = true;

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) {
      return;
    }
    // 演出順: 中央ダメージ表示 -> HPマーカー拡大して減少を強調
    addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10, `-${directDamage}`, '#ff6767');
    triggerScreenShake(8, 210);
    const hpPos = getHpBadgePosition(targetOwner);
    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) {
        return;
      }
      triggerHpPulse(targetOwner, 560);
      gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - directDamage);
      addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
      if (gameState.hp[targetOwner] <= 0) {
        finishGame(attacker.owner);
        return;
      }
      // doubleblade: 自分にも同量のダメージ
      if (selfDamage > 0) {
        const selfOwner = attacker.owner;
        gameState.hp[selfOwner] = Math.max(0, gameState.hp[selfOwner] - selfDamage);
        triggerHpPulse(selfOwner, 560);
        const selfHpPos = getHpBadgePosition(selfOwner);
        addDamageText(selfHpPos.x, selfHpPos.y + 56, `HP ${gameState.hp[selfOwner]}`, '#ffe6a7');
        addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24, `RECOIL -${selfDamage}`, '#ff9060');
        if (gameState.hp[selfOwner] <= 0) {
          finishGame(selfOwner === 'player' ? 'enemy' : 'player');
          return;
        }
      }
      gameState.interactionLock = false;
    }, 110);
  }, DIRECT_ATTACK_HIT_MS);
}

// ===== ボード効果の再計算 =====

// 全フィールドカードの有効攻撃力をベース値にリセットし、永続オーラ効果を再適用する。
// weakaura 破壊後・召喚後・所有権変更後などボード状態が変わるたびに呼ぶ。
export function applyBoardEffects() {
  const fieldCards = gameState.cards.filter((c) => c.zone === 'field' && !c.ui.pendingRemoval);

  // まず全カードをベース値にリセット
  fieldCards.forEach((c) => {
    c.combat.attackLeft  = c.combat.baseAttackLeft;
    c.combat.attackRight = c.combat.baseAttackRight;
  });

  // weakaura: 場にあるあいだ、隣接カードの左右攻撃力を -1（最小 0）
  fieldCards.filter((c) => c.effect === 'weakaura').forEach((aura) => {
    const idx = aura.fieldSlotIndex;
    if (idx === null) return;
    [-1, 1].forEach((delta) => {
      const neighbor = getCardAtSlot(idx + delta);
      if (neighbor) {
        neighbor.combat.attackLeft  = Math.max(0, neighbor.combat.attackLeft  - 1);
        neighbor.combat.attackRight = Math.max(0, neighbor.combat.attackRight - 1);
      }
    });
  });
}

// ===== 召喚時効果 =====

// swap効果: 召喚カードの左右スロットのカードを入れ替える（片方のみでも移動）
function performSwapEffect(summonCard) {
  const slotIdx = summonCard.fieldSlotIndex;
  if (slotIdx === null) return;

  const leftCard  = slotIdx > 0                   ? getCardAtSlot(slotIdx - 1) : null;
  const rightCard = slotIdx < MAX_FIELD_SLOTS - 1  ? getCardAtSlot(slotIdx + 1) : null;
  if (!leftCard && !rightCard) return;

  if (leftCard && rightCard) {
    // 両隣にカードあり → 入れ替え
    const lSlot = slotCenters[slotIdx - 1];
    const rSlot = slotCenters[slotIdx + 1];
    leftCard.fieldSlotIndex  = slotIdx + 1;
    rightCard.fieldSlotIndex = slotIdx - 1;
    lSlot.occupiedByCardId = rightCard.id;
    rSlot.occupiedByCardId = leftCard.id;
    startMoveAnimation(leftCard,  rSlot.x, rSlot.y, null);
    startMoveAnimation(rightCard, lSlot.x, lSlot.y, null);
  } else if (leftCard) {
    // 左のみ → 右の空スロットへ移動（右端に空きスロットがなければ何もしない）
    if (slotIdx + 1 >= MAX_FIELD_SLOTS) return;
    const lSlot = slotCenters[slotIdx - 1];
    const rSlot = slotCenters[slotIdx + 1];
    leftCard.fieldSlotIndex = slotIdx + 1;
    lSlot.occupiedByCardId = null;
    rSlot.occupiedByCardId = leftCard.id;
    startMoveAnimation(leftCard, rSlot.x, rSlot.y, null);
  } else {
    // 右のみ → 左の空スロットへ移動（左端に空きスロットがなければ何もしない）
    if (slotIdx - 1 < 0) return;
    const lSlot = slotCenters[slotIdx - 1];
    const rSlot = slotCenters[slotIdx + 1];
    rightCard.fieldSlotIndex = slotIdx - 1;
    lSlot.occupiedByCardId = rightCard.id;
    rSlot.occupiedByCardId = null;
    startMoveAnimation(rightCard, lSlot.x, lSlot.y, null);
  }
}

// doublecenter効果: 中央（スロット2）配置時に左右へ同時攻撃を行う
function performDoubleCenterAttack(card, matchIdAtStart) {
  const leftEnemy  = (() => { const c = getCardAtSlot(1); return c && c.owner !== card.owner ? c : null; })();
  const rightEnemy = (() => { const c = getCardAtSlot(3); return c && c.owner !== card.owner ? c : null; })();

  if (!leftEnemy && !rightEnemy) {
    // 攻撃対象なし: 行動消費なしでロック解除
    gameState.interactionLock = false;
    return;
  }

  const nowMs = performance.now();
  const destroyed = new Set();
  let selfLost = false;
  const revengeList = []; // revenge効果を持つ破壊されたカード由来のダメージ

  // 左への攻撃解決
  if (leftEnemy) {
    const myPow = card.combat.attackLeft;
    const enPow = leftEnemy.combat.attackRight;
    leftEnemy.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    if (myPow > enPow)      { destroyed.add(leftEnemy); }
    else if (myPow < enPow) { selfLost = true; }
    else                    { destroyed.add(leftEnemy); selfLost = true; }
  }

  // 右への攻撃解決（自分がすでに負けていても両面同時判定）
  if (rightEnemy) {
    const myPow = card.combat.attackRight;
    const enPow = rightEnemy.combat.attackLeft;
    rightEnemy.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    if (myPow > enPow)      { destroyed.add(rightEnemy); }
    else if (myPow < enPow) { selfLost = true; }
    else                    { destroyed.add(rightEnemy); selfLost = true; }
  }

  if (selfLost) {
    destroyed.add(card);
    card.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
  }

  card.combat.hasActedThisTurn = true;
  triggerScreenShake(9, 220);
  addDamageText(card.x, card.y - 80, 'DOUBLE HIT!', '#ff8a8a');

  // revenge効果: 破壊された敵カードがrevengeを持つなら card.owner へ2ダメージ
  destroyed.forEach((c) => {
    if (c.id !== card.id && c.effect === 'revenge') {
      revengeList.push({ targetOwner: card.owner, amount: 2 });
    }
  });

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) return;
    const removeAt = performance.now();
    destroyed.forEach((c) => markCardDestroyed(c, removeAt));

    if (revengeList.length > 0) {
      revengeList.forEach((e, i) => {
        addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20 + i * 34, `REVENGE -${e.amount}`, '#e060ff');
      });
      triggerScreenShake(5, 150);
    }

    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) return;
      let gameEnded = false;
      revengeList.forEach(({ targetOwner, amount }) => {
        if (gameEnded) return;
        gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - amount);
        triggerHpPulse(targetOwner, 560);
        const hpPos = getHpBadgePosition(targetOwner);
        addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
        if (gameState.hp[targetOwner] <= 0) {
          finishGame(targetOwner === 'player' ? 'enemy' : 'player');
          gameEnded = true;
        }
      });
      if (!gameEnded) {
        gameState.interactionLock = false;
      }
      recomputeSlotOccupancy();
      applyBoardEffects();
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}
