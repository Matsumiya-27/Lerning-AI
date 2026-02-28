// ===== カード生成・召喚・戦闘 =====
import {
  STARTING_HAND, SHAKE_DURATION_MS, HIT_FLASH_MS,
  DESTROY_ANIMATION_MS, DIRECT_ATTACK_HIT_MS,
  CANVAS_WIDTH, CANVAS_HEIGHT,
  MAX_FIELD_SLOTS,
} from './constants.js';
import { getCardType } from './deck.js';
import {
  gameState, slotCenters, getHandCenter,
  getCardById, getCardAtSlot, getHandCards, getFieldCards,
  getSlotOccupant, hasEmptyFieldSlot, reflowHand,
  startMoveAnimation, markCardDestroyed, markCardReturned, recomputeSlotOccupancy,
  triggerUsedCardFeedback, triggerScreenShake, addDamageText,
  triggerHpPulse, showBanner, getHpBadgePosition,
  getManaTotal, useMana,
} from './state.js';

// ===== カードファクトリ =====

export function createCard({ id, owner, zone, rank, handIndex = null, fieldSlotIndex = null, x, y, attackLeft, attackRight, effect = null, attribute = null, type = 'テスト', cardCategory = 'unit', effects = [], keywords = [], directAttack = 1, typeId = null }) {
  return {
    id,
    owner,
    zone,
    rank,
    effect,
    attribute,    // 属性: null=無 / 'red'/'blue'/'green'/'black'/'white'
    type,         // 種族: '赤種族1' など
    cardCategory, // 'unit' | 'spell'
    effects,      // 召喚時効果リスト [{type, ...params}]
    keywords,     // キーワード能力リスト ['sutemi', ...]
    typeId,       // デッキ返却時に使用
    handIndex,
    fieldSlotIndex,
    x,
    y,
    combat: {
      attackLeft,
      attackRight,
      baseAttackLeft: attackLeft,
      baseAttackRight: attackRight,
      hasActedThisTurn: false,
      summonedThisTurn: false,
      tempAttackLeftReduction: 0,
      tempAttackRightReduction: 0,
      directAttack,     // DA値（直接攻撃ダメージ）
      baseDirectAttack: directAttack, // ベースDA（手札プレビュー用）
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
      effectsNullified: false, // 永続無効化アーラフラグ
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

  const pile = owner === 'player' ? gameState.playerDeckPile : gameState.enemyDeckPile;
  if (pile.length === 0) return;
  const drawn = pile.pop();

  // typeId ベースのデッキパイル
  const typeEntry = getCardType(drawn.typeId);
  if (!typeEntry) return;

  const card = createCard({
    id: gameState.nextCardId,
    owner,
    zone: 'hand',
    rank: typeEntry.rank,
    handIndex,
    x: center.x,
    y: center.y,
    attackLeft: typeEntry.la,
    attackRight: typeEntry.ra,
    effect: null,
    cardCategory: typeEntry.cardCategory ?? 'unit',
    attribute: typeEntry.attribute ?? null,
    type: typeEntry.type ?? 'テスト',
    effects: typeEntry.effects ?? [],
    keywords: typeEntry.keywords ?? [],
    directAttack: typeEntry.directAttack ?? 1,
    typeId: drawn.typeId,
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

export function getSummonTributeOptions(owner, rank, card = null) {
  // solidarity_free_N: 同種族が N-1 体以上いれば生贄なし召喚可
  if (card && !card.ui?.effectsNullified) {
    const freeKw = card.keywords?.find((kw) => kw.startsWith('solidarity_free_'));
    if (freeKw) {
      const needed = parseInt(freeKw.split('_').pop(), 10);
      const sameOnField = getFieldCards(owner).filter(
        (c) => c.type === card.type && !c.ui.pendingRemoval,
      ).length;
      if (sameOnField >= needed - 1) return [[]];
    }
  }

  if (rank <= 1) {
    return [[]];
  }

  // no_tribute カードは生贄候補から除外（effectsNullified なら除外しない）
  const ownField = getFieldCards(owner).filter(
    (c) => !(c.keywords?.includes('no_tribute') && !c.ui.effectsNullified),
  );
  const rank2 = ownField.filter((card) => card.rank === 2);
  const options = [];

  if (rank === 2) {
    ownField.forEach((card) => {
      options.push([card.id]);
    });
    return options;
  }

  if (rank === 3) {
    rank2.forEach((card) => {
      options.push([card.id]);
    });

    for (let i = 0; i < ownField.length; i += 1) {
      for (let j = i + 1; j < ownField.length; j += 1) {
        options.push([ownField[i].id, ownField[j].id]);
      }
    }

    // dbl_tribute: 1枚で Rank3 の2体分生贄コストを満たせる
    ownField.filter((c) => c.keywords?.includes('dbl_tribute') && !c.ui.effectsNullified)
      .forEach((c) => options.push([c.id]));
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

  const tributeOptions = getSummonTributeOptions(owner, card.rank, card);
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

  // solidarity_free_N: 条件を満たせば生贄なしでも確認可
  if (!card.ui.effectsNullified) {
    const freeKw = card.keywords?.find((kw) => kw.startsWith('solidarity_free_'));
    if (freeKw) {
      const needed = parseInt(freeKw.split('_').pop(), 10);
      const sameOnField = getFieldCards(card.owner).filter(
        (c) => c.type === card.type && !c.ui.pendingRemoval,
      ).length;
      if (sameOnField >= needed - 1) return true;
    }
  }

  if (card.rank === 2) {
    return selectedCards.length >= 1;
  }

  const hasRank2 = selectedCards.some((c) => c.rank === 2);
  const hasDblTribute = selectedCards.some(
    (c) => c.keywords?.includes('dbl_tribute') && !c.ui.effectsNullified,
  );
  return selectedCards.length >= 2 || hasRank2 || hasDblTribute;
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
    card.combat.summonedThisTurn = false; // 召喚ターンの直接攻撃制限なし
    targetSlot.occupiedByCardId = card.id;
    reflowHand(card.owner);
    gameState.summonSelection.active = false;
    gameState.summonSelection.preselectedIds = [];
    gameState.summonSelection.selectedIds = [];
    applyBoardEffects();
    // checkStateBased はここでは呼ばない（colorScale X/X カード保護）

    // swap効果
    if (card.effect === 'swap') {
      performSwapEffect(card);
      checkStateBased();
      gameState.interactionLock = false;
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

    // effects 配列による新効果ディスパッチ
    if (card.effects && card.effects.length > 0) {
      dispatchSummonEffects(card, card.owner, matchIdAtStart);
      return; // interactionLock 解除は dispatcher 内で行う
    }

    // 効果なし: 状況起因処理を呼んでロック解除
    checkStateBased();
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
      card.combat.summonedThisTurn = false; // 召喚ターンの直接攻撃制限なし
      targetSlot.occupiedByCardId = card.id;
      reflowHand(card.owner);
      applyBoardEffects();
      // checkStateBased はここでは呼ばない（colorScale X/X カード保護）

      if (card.effect === 'swap') {
        performSwapEffect(card);
        checkStateBased();
        gameState.interactionLock = false;
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

      if (card.effects && card.effects.length > 0) {
        dispatchSummonEffects(card, card.owner, matchIdAtStart);
        return;
      }

      checkStateBased();
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

// 守護キーワード: 隣接する相手カードがshugoを持つ場合、直接攻撃不可
export function hasAdjacentGuard(card) {
  const slotIdx = card.fieldSlotIndex;
  if (slotIdx === null) return false;
  const opponent = card.owner === 'player' ? 'enemy' : 'player';
  return [-1, 1].some((d) => {
    const c = getCardAtSlot(slotIdx + d);
    return c && c.owner === opponent && c.keywords?.includes('shugo') && !c.ui.effectsNullified;
  });
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
  const canAttack = getFieldCards(owner).some(
    (card) => !card.combat.hasActedThisTurn
      && hasAdjacentEnemyTarget(card)
      && !(card.keywords?.includes('no_attack') && !card.ui.effectsNullified),
  );
  const canDirect = canDirectAttack(owner) && getFieldCards(owner).some(
    (card) => !card.combat.hasActedThisTurn
      && !(card.keywords?.includes('no_attack') && !card.ui.effectsNullified)
      && !hasAdjacentGuard(card),
  );
  return canSummon || canAttack || canDirect;
}

export function isPlayerMainTurn() {
  return gameState.turn.phase === 'main' && gameState.turn.currentPlayer === 'player';
}

// PvPデバッグモード時は敵ターンも手動操作可能
export function isManualTurn() {
  return gameState.turn.phase === 'main' &&
    (gameState.turn.currentPlayer === 'player' || gameState.debugPvP);
}

export function canUseEndTurnButton() {
  return isManualTurn() && !gameState.interactionLock && !gameState.result.winner;
}

// ===== 戦闘ヘルパー =====

// on_death_damage_N キーワードの N を返す（なければ 0）
function getDeathDamage(card) {
  if (!card || card.ui.effectsNullified) return 0;
  const kw = card.keywords?.find((k) => k.startsWith('on_death_damage_'));
  return kw ? (parseInt(kw.split('_').pop(), 10) || 0) : 0;
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

  // no_attack キーワード: 攻撃不能（effectsNullified なら通常通り）
  if (attacker.keywords?.includes('no_attack') && !attacker.ui.effectsNullified) {
    if (attacker.owner === 'player') triggerUsedCardFeedback(attacker, nowMs);
    return;
  }

  // double_attack キーワード: 両隣の敵を同時攻撃
  if (attacker.keywords?.includes('double_attack') && !attacker.ui.effectsNullified) {
    const opponent = attacker.owner === 'player' ? 'enemy' : 'player';
    const hasTarget = getFieldCards(opponent).some(
      (e) => Math.abs((e.fieldSlotIndex ?? -99) - attacker.fieldSlotIndex) === 1,
    );
    if (!hasTarget) return;
    gameState.interactionLock = true;
    attacker.combat.hasActedThisTurn = true;
    performDoubleAdjacentAttack(attacker, matchIdAtStart);
    return;
  }

  // doublecenter 中央攻撃: スワイプ方向によらず両隣を同時攻撃
  if (attacker.effect === 'doublecenter' && attacker.fieldSlotIndex === 2) {
    const le = getCardAtSlot(1);
    const re = getCardAtSlot(3);
    const hasTarget = (le && le.owner !== attacker.owner) || (re && re.owner !== attacker.owner);
    if (!hasTarget) return;
    gameState.interactionLock = true;
    attacker.combat.hasActedThisTurn = true;
    performDoubleCenterAttack(attacker, matchIdAtStart);
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

  // 生き残ったカードへの一時攻撃力減算（そのターン中のみ）
  // 攻撃側が負けた（defender が生存）: defender の攻撃に使った方向を攻撃側の攻撃力分だけ減算
  if (attackerLost && !defenderLost) {
    if (direction === 'left') {
      // attacker が左スワイプ: attacker.attackLeft vs defender.attackRight
      defender.combat.tempAttackRightReduction += attackerPower;
    } else {
      // attacker が右スワイプ: attacker.attackRight vs defender.attackLeft
      defender.combat.tempAttackLeftReduction += attackerPower;
    }
  }

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

  // on_death_damage_N キーワード: 戦闘破壊時に相手プレイヤーへNダメージ
  const attDeathDmg = getDeathDamage(attacker);
  if (attackerLost && attDeathDmg > 0) {
    effectDamageList.push({ targetOwner: defender.owner, amount: attDeathDmg, label: `DEATH -${attDeathDmg}`, color: '#a040ff' });
  }
  const defDeathDmg = getDeathDamage(defender);
  if (defenderLost && defDeathDmg > 0) {
    effectDamageList.push({ targetOwner: attacker.owner, amount: defDeathDmg, label: `DEATH -${defDeathDmg}`, color: '#a040ff' });
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

      // 捨身キーワード: 戦闘後、生存しているカードでも自壊
      [attacker, defender].forEach((c) => {
        if (c && c.keywords && c.keywords.includes('sutemi') && !c.ui.effectsNullified && !c.ui.pendingRemoval) {
          markCardDestroyed(c, performance.now());
        }
      });

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
      checkStateBased();
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
    checkStateBased();
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
  checkStateBased();
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
    checkStateBased();
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
    checkStateBased();
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

// ===== スペル発動 =====

export function canActivateSpell(card, owner) {
  if (card.cardCategory !== 'spell') return false;
  if (getManaTotal(owner) < card.rank) return false;
  // 敵を対象とするスペルは敵フィールドにカードが必要
  const opponent = owner === 'player' ? 'enemy' : 'player';
  if ((card.effect === 'singleHit10' || card.effect === 'aoeHit33')
      && getFieldCards(opponent).length === 0) return false;
  return true;
}

export function activateSpellEffect(card, owner) {
  gameState.interactionLock = true;
  const matchIdAtStart = gameState.matchId;
  const nowMs = performance.now();

  // 使用済みスペルをまず墓地へ送る
  markCardDestroyed(card, nowMs);

  const opponent = owner === 'player' ? 'enemy' : 'player';

  if (card.effect === 'draw1') {
    drawRandomCardToHand(owner);
    reflowHand(owner);
    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) return;
      gameState.interactionLock = false;
    }, DESTROY_ANIMATION_MS + 30);
    return;
  }

  if (card.effect === 'singleHit10') {
    // 敵1体に1/0の特殊攻撃: LA が最も低い敵（破壊しやすい）を自動選択
    const enemies = getFieldCards(opponent);
    const target = enemies.sort((a, b) => a.combat.attackLeft - b.combat.attackLeft)[0] ?? null;
    if (target) {
      performSpecialAttack([target], 1, 0, matchIdAtStart);
    } else {
      setTimeout(() => {
        if (gameState.matchId !== matchIdAtStart) return;
        gameState.interactionLock = false;
      }, DESTROY_ANIMATION_MS + 30);
    }
    return;
  }

  if (card.effect === 'aoeHit33') {
    // 敵全体に3/3の特殊攻撃
    const enemies = getFieldCards(opponent);
    if (enemies.length > 0) {
      performSpecialAttack(enemies, 3, 3, matchIdAtStart);
    } else {
      setTimeout(() => {
        if (gameState.matchId !== matchIdAtStart) return;
        gameState.interactionLock = false;
      }, DESTROY_ANIMATION_MS + 30);
    }
    return;
  }

  if (card.effect === 'fieldHit1010') {
    // 場全体（双方）に10/10の特殊攻撃
    const allField = [...getFieldCards('player'), ...getFieldCards('enemy')];
    if (allField.length > 0) {
      performSpecialAttack(allField, 10, 10, matchIdAtStart);
    } else {
      setTimeout(() => {
        if (gameState.matchId !== matchIdAtStart) return;
        gameState.interactionLock = false;
      }, DESTROY_ANIMATION_MS + 30);
    }
    return;
  }

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) return;
    gameState.interactionLock = false;
  }, DESTROY_ANIMATION_MS + 30);
}

// ===== 特殊攻撃 =====

// targets: 攻撃対象カードの配列。deltaLeft/deltaRight: LA/RAから減算する値（>= 0）
// 位置・隣接無関係、反撃なし。ターン内限定の一時ダメージとして処理、0以下で状況起因処理。
// onComplete: 完了コールバック（省略時は interactionLock を解除）
function performSpecialAttack(targets, deltaLeft, deltaRight, matchIdAtStart, onComplete = null) {
  if (targets.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  const nowMs = performance.now();

  targets.forEach((target) => {
    target.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    // 一時攻撃力減算（ターン中のみ）
    target.combat.tempAttackLeftReduction  += deltaLeft;
    target.combat.tempAttackRightReduction += deltaRight;
  });

  addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20, `SPELL -${deltaLeft}/${deltaRight}`, '#c080ff');
  triggerScreenShake(7, 200);

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) return;
    applyBoardEffects();
    checkStateBased();
    setTimeout(() => {
      if (gameState.matchId !== matchIdAtStart) return;
      recomputeSlotOccupancy();
      applyBoardEffects();
      if (onComplete) onComplete();
      else gameState.interactionLock = false;
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}

// ===== 状況起因処理 =====

// LA または RA が 0 以下のフィールドカードを即破壊する
export function checkStateBased() {
  const nowMs = performance.now();
  let any = false;
  gameState.cards
    .filter((c) => c.zone === 'field' && !c.ui.pendingRemoval
                && (c.combat.attackLeft <= 0 || c.combat.attackRight <= 0))
    .forEach((c) => { markCardDestroyed(c, nowMs); any = true; });
  if (any) recomputeSlotOccupancy();
}

// ===== 召喚時効果ディスパッチャ =====

function dispatchSummonEffects(card, owner, matchIdAtStart) {
  // effectsNullified: 効果テキストが無効化されている場合はスキップ
  if (card.ui.effectsNullified) {
    checkStateBased();
    gameState.interactionLock = false;
    return;
  }

  const effects = card.effects ? [...card.effects] : [];
  if (effects.length === 0) {
    checkStateBased();
    gameState.interactionLock = false;
    return;
  }

  // 効果を順次処理（非同期効果は processNext コールバックで連鎖）
  let idx = 0;

  function processNext() {
    if (gameState.matchId !== matchIdAtStart) return;
    if (idx >= effects.length) {
      applyBoardEffects();
      checkStateBased();
      gameState.interactionLock = false;
      return;
    }
    const eff = effects[idx];
    idx += 1;

    switch (eff.type) {
      case 'adjEnemy': {
        // 隣接する敵1体に eff.l / eff.r のダメージ（順序保証: processNext をコールバックとして渡す）
        const slotIdx = card.fieldSlotIndex;
        if (slotIdx === null) { processNext(); return; }
        const opponent = owner === 'player' ? 'enemy' : 'player';
        const candidates = [];
        [-1, 1].forEach((d) => {
          const c = getCardAtSlot(slotIdx + d);
          if (c && c.owner === opponent) candidates.push(c);
        });
        if (candidates.length === 0) { processNext(); return; }
        performSpecialAttack(candidates, eff.l, eff.r, matchIdAtStart, processNext);
        return;
      }
      case 'anyEnemy': {
        // 敵フィールドの LA 最小の1体に eff.l / eff.r のダメージ
        const opponent = owner === 'player' ? 'enemy' : 'player';
        const enemies = getFieldCards(opponent);
        if (enemies.length === 0) { processNext(); return; }
        const target = enemies.slice().sort((a, b) => a.combat.attackLeft - b.combat.attackLeft)[0];
        performSpecialAttack([target], eff.l, eff.r, matchIdAtStart, processNext);
        return;
      }
      case 'aoeExSelf': {
        // 自身以外の全フィールドカードに eff.l / eff.r のダメージ
        const targets = gameState.cards.filter(
          (c) => c.zone === 'field' && !c.ui.pendingRemoval && c.id !== card.id,
        );
        if (targets.length === 0) { processNext(); return; }
        performSpecialAttack(targets, eff.l, eff.r, matchIdAtStart, processNext);
        return;
      }
      case 'adjAll': {
        // 両隣のカード（オーナー問わず）に eff.l / eff.r のダメージ
        const slotIdx = card.fieldSlotIndex;
        if (slotIdx === null) { processNext(); return; }
        const targets = [];
        [-1, 1].forEach((d) => {
          const c = getCardAtSlot(slotIdx + d);
          if (c) targets.push(c);
        });
        if (targets.length === 0) { processNext(); return; }
        performSpecialAttack(targets, eff.l, eff.r, matchIdAtStart, processNext);
        return;
      }
      case 'manaGate': {
        // マナが cost 以上なら inner 効果を発動してマナを消費
        // color: null = any mana、文字列 = 色指定
        const color = eff.color ?? null;
        const canPay = color
          ? (gameState.mana[owner][color] ?? 0) >= eff.cost
          : getManaTotal(owner) >= eff.cost;
        if (canPay) {
          useMana(owner, eff.cost, color);
          // inner を次の位置に差し込んで処理
          effects.splice(idx, 0, eff.inner);
        }
        processNext();
        return;
      }
      case 'playerDamage': {
        // 相手プレイヤーに amount ダメージ
        const targetOwner = owner === 'player' ? 'enemy' : 'player';
        addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20, `-${eff.amount}`, '#ff6767');
        triggerScreenShake(6, 180);
        const hpPos = getHpBadgePosition(targetOwner);
        gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - eff.amount);
        triggerHpPulse(targetOwner, 560);
        addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
        if (gameState.hp[targetOwner] <= 0) {
          finishGame(owner);
          return;
        }
        processNext();
        return;
      }
      case 'boostSelf': {
        // 自身の baseAttack を永続強化
        card.combat.baseAttackLeft  += eff.l;
        card.combat.baseAttackRight += eff.r;
        addDamageText(card.x, card.y - 60, `+${eff.l}/+${eff.r}`, '#88ffaa');
        applyBoardEffects();
        checkStateBased();
        processNext();
        return;
      }
      case 'handReset': {
        // 自分の手札を全破棄してから draw 枚ドロー
        const nowMs = performance.now();
        getHandCards(owner).forEach((c) => markCardDestroyed(c, nowMs));
        setTimeout(() => {
          if (gameState.matchId !== matchIdAtStart) return;
          for (let i = 0; i < eff.draw; i += 1) {
            drawRandomCardToHand(owner);
          }
          reflowHand(owner);
          applyHandCardPreviews();
          processNext();
        }, DESTROY_ANIMATION_MS + 30);
        return;
      }
      case 'colorScale': {
        // X = owner の color マナ量。X=0 → 自壊。else LA/RA = X、DA = daScale で計算
        const colorMana = gameState.mana[owner][eff.color] ?? 0;
        if (colorMana === 0) {
          const nowMs = performance.now();
          markCardDestroyed(card, nowMs);
          recomputeSlotOccupancy();
          applyBoardEffects();
          checkStateBased();
          gameState.interactionLock = false;
          return;
        }
        card.combat.baseAttackLeft  = colorMana;
        card.combat.baseAttackRight = colorMana;
        // DA スケール計算
        let da = 1;
        if (eff.daScale) {
          for (const step of eff.daScale) {
            if (colorMana >= step.min) da = step.da;
          }
        }
        card.combat.directAttack = da;
        card.combat.baseDirectAttack = da;
        addDamageText(card.x, card.y - 60, `X=${colorMana}`, '#ffcc44');
        applyBoardEffects();
        checkStateBased();
        processNext();
        return;
      }
      case 'draw': {
        // カードを count 枚ドロー
        for (let i = 0; i < eff.count; i += 1) {
          drawRandomCardToHand(owner);
        }
        reflowHand(owner);
        applyHandCardPreviews();
        processNext();
        return;
      }
      case 'cycle': {
        // 1枚ドローした後、手札1枚をデッキ底に返却（プレイヤーは選択式、AIは自動）
        drawRandomCardToHand(owner);
        reflowHand(owner);
        applyHandCardPreviews();

        if (owner === 'player') {
          // プレイヤー: 選択オーバーレイを表示して待機
          gameState.cycleSelection = { owner: 'player', processNext, matchId: matchIdAtStart };
          // interactionLock は選択完了後に processNext で引き継ぐ
          return;
        }

        // 敵AI: 最低ランク、次いで最低合計攻撃力のカードを返却
        const aiHand = getHandCards(owner);
        if (aiHand.length > 0) {
          const returnCard = aiHand.reduce((a, b) => {
            if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
            const aP = a.combat.baseAttackLeft + a.combat.baseAttackRight;
            const bP = b.combat.baseAttackLeft + b.combat.baseAttackRight;
            return aP <= bP ? a : b;
          });
          returnCardToDeckBottom(returnCard, owner);
          reflowHand(owner);
        }
        processNext();
        return;
      }
      case 'recruit': {
        // デッキからランダムな指定種族カードを手札に加える
        const pile = owner === 'player' ? gameState.playerDeckPile : gameState.enemyDeckPile;
        const matchIndices = [];
        pile.forEach((entry, i) => {
          const t = getCardType(entry.typeId);
          if (t && t.type === eff.tribe) matchIndices.push(i);
        });
        if (matchIndices.length > 0) {
          const pickIdx = matchIndices[Math.floor(Math.random() * matchIndices.length)];
          const [entry] = pile.splice(pickIdx, 1);
          drawSpecificCardToHand(owner, entry.typeId);
          reflowHand(owner);
          applyHandCardPreviews();
        }
        processNext();
        return;
      }
      case 'upgradeDa': {
        // DA 値と攻撃力をアップグレード
        const current = card.combat.directAttack ?? 1;
        if (eff.value > current) {
          card.combat.directAttack = eff.value;
          card.combat.baseDirectAttack = eff.value;
        }
        if (eff.boostL) {
          card.combat.baseAttackLeft  += eff.boostL;
          card.combat.attackLeft      += eff.boostL;
        }
        if (eff.boostR) {
          card.combat.baseAttackRight += eff.boostR;
          card.combat.attackRight     += eff.boostR;
        }
        const label = `DA${eff.value}${eff.boostL ? ` +${eff.boostL}/${eff.boostR}` : ''}`;
        addDamageText(card.x, card.y - 60, label, '#ffcc44');
        applyBoardEffects();
        processNext();
        return;
      }
      case 'nullifySelf': {
        // 自身のテキスト効果（effects 配列・旧 effect 文字列）を永続無効化
        // キーワード能力は対象外
        card.effects = [];
        if (card.effect) card.effect = null;
        // ローカル処理キューの残りを全削除
        effects.splice(idx, effects.length - idx);
        addDamageText(card.x, card.y - 60, '効果解除', '#88ddff');
        checkStateBased();
        gameState.interactionLock = false;
        return;
      }
      case 'enableAura': {
        // アーラキーワードを追加して applyBoardEffects で永続有効化
        if (!card.keywords.includes(eff.aura)) {
          card.keywords.push(eff.aura);
        }
        applyBoardEffects();
        checkStateBased();
        processNext();
        return;
      }
      case 'handDiscard': {
        // 手札からn枚を選んで捨てる（プレイヤーは選択式、AIは先頭n枚を自動廃棄）
        const handCards = getHandCards(owner);
        const count = Math.min(eff.count, handCards.length);
        if (count === 0) { processNext(); return; }

        if (owner !== 'player') {
          // 敵AI: 先頭n枚を廃棄（ランク昇順で選ぶ）
          const sorted = handCards.slice().sort((a, b) => a.rank - b.rank);
          const nowMs = performance.now();
          sorted.slice(0, count).forEach((c) => markCardDestroyed(c, nowMs));
          setTimeout(() => {
            if (gameState.matchId !== matchIdAtStart) return;
            reflowHand(owner);
            processNext();
          }, DESTROY_ANIMATION_MS + 30);
          return;
        }

        // プレイヤー: 選択オーバーレイを表示して待機
        gameState.handDiscardSelection = {
          count,
          owner,
          processNext,
          matchId: matchIdAtStart,
          selectedIds: [],
        };
        return;
      }
      case 'bounty': {
        // デッキの一番上からn枚を可能な限り退場済みへ送る（マナも積算）
        const pile = owner === 'player' ? gameState.playerDeckPile : gameState.enemyDeckPile;
        const toMill = Math.min(eff.count, pile.length);
        for (let i = 0; i < toMill; i += 1) {
          const entry = pile.pop(); // deckPile 末尾 = デッキトップ
          if (entry) {
            const ct = getCardType(entry.typeId);
            const rankVal  = ct ? (ct.rank ?? 1) : 1;
            const colorKey = ct ? (ct.attribute ?? 'none') : 'none';
            gameState.graveyard[owner].push({
              rank: rankVal,
              cardCategory: 'unit',
              attribute: ct?.attribute ?? null,
            });
            gameState.mana[owner][colorKey] += rankVal;
          }
        }
        addDamageText(card.x, card.y - 60, `豊穣${toMill}`, '#ccffaa');
        processNext();
        return;
      }
      case 'solidarity': {
        // 場の自分の同じ種族のカード枚数（自身含む）がcount以上なら inner 効果を発動
        const tribe = card.type;
        const sameCount = getFieldCards(owner).filter(
          (c) => c.type === tribe && !c.ui.pendingRemoval,
        ).length;
        if (sameCount >= eff.count) {
          // 条件達成: inner 効果を次の位置に差し込む
          effects.splice(idx, 0, eff.inner);
        }
        processNext();
        return;
      }
      case 'boostAllOwn': {
        // 自分の全フィールドカードの基本攻撃力を永続 +l/+r
        getFieldCards(owner).forEach((c) => {
          c.combat.baseAttackLeft  += eff.l;
          c.combat.baseAttackRight += eff.r;
        });
        addDamageText(card.x, card.y - 60, `全体+${eff.l}/+${eff.r}`, '#88ffaa');
        applyBoardEffects();
        checkStateBased();
        processNext();
        return;
      }
      case 'tribeCountDamage': {
        // 自分の場の指定種族の枚数分だけ相手プレイヤーにダメージ
        const n = getFieldCards(owner).filter((c) => c.type === eff.tribe).length;
        if (n > 0) {
          const targetOwner = owner === 'player' ? 'enemy' : 'player';
          gameState.hp[targetOwner] = Math.max(0, gameState.hp[targetOwner] - n);
          triggerHpPulse(targetOwner, 560);
          addDamageText(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20, `-${n}`, '#ffffd0');
          triggerScreenShake(6, 180);
          const hpPos = getHpBadgePosition(targetOwner);
          addDamageText(hpPos.x, hpPos.y + 56, `HP ${gameState.hp[targetOwner]}`, '#ffe6a7');
          if (gameState.hp[targetOwner] <= 0) {
            finishGame(owner);
            return;
          }
        }
        processNext();
        return;
      }
      default:
        processNext();
        return;
    }
  }

  processNext();
}

// デッキから特定 typeId のカードを手札に加える（recruit 等で使用）
function drawSpecificCardToHand(owner, typeId) {
  const typeEntry = getCardType(typeId);
  if (!typeEntry) return;
  const handCards = getHandCards(owner);
  const handIndex = handCards.length;
  const center = getHandCenter(owner, handIndex, handIndex + 1);
  const card = createCard({
    id: gameState.nextCardId,
    owner,
    zone: 'hand',
    rank: typeEntry.rank,
    handIndex,
    x: center.x,
    y: center.y,
    attackLeft: typeEntry.la,
    attackRight: typeEntry.ra,
    effect: null,
    cardCategory: typeEntry.cardCategory ?? 'unit',
    attribute: typeEntry.attribute ?? null,
    type: typeEntry.type ?? 'テスト',
    effects: typeEntry.effects ?? [],
    keywords: typeEntry.keywords ?? [],
    directAttack: typeEntry.directAttack ?? 1,
    typeId,
  });
  gameState.nextCardId += 1;
  gameState.cards.push(card);
}

// カードをデッキ底に返却する（循環効果用、墓地・マナ積算なし）
export function returnCardToDeckBottom(card, owner) {
  const pile = owner === 'player' ? gameState.playerDeckPile : gameState.enemyDeckPile;
  if (card.typeId) pile.unshift({ typeId: card.typeId });
  markCardReturned(card, performance.now());
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

  if (attacker.combat.hasActedThisTurn || !canDirectAttack(attacker.owner)) {
    if (attacker.owner === 'player') {
      triggerUsedCardFeedback(attacker, performance.now());
    }
    return;
  }

  // no_attack キーワード: 直接攻撃も不可（effectsNullified なら通常通り）
  if (attacker.keywords?.includes('no_attack') && !attacker.ui.effectsNullified) {
    if (attacker.owner === 'player') triggerUsedCardFeedback(attacker, performance.now());
    return;
  }

  // shugo（守護）: 隣接する相手カードがいる場合、直接攻撃不可
  if (hasAdjacentGuard(attacker)) {
    if (attacker.owner === 'player') triggerUsedCardFeedback(attacker, performance.now());
    return;
  }

  const targetOwner = attacker.owner === 'player' ? 'enemy' : 'player';
  // doubleblade: 通常ダメージ、ただし自分にも同量ダメージ
  // effectsNullified 時は DA を強制 1 にする
  const directDamage = attacker.ui.effectsNullified ? 1 : (attacker.combat.directAttack ?? 1);

  // DA:0 カード: 直接攻撃不可
  if (directDamage <= 0) {
    if (attacker.owner === 'player') triggerUsedCardFeedback(attacker, performance.now());
    return;
  }

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
      // 捨身キーワード: 直接攻撃後に自壊
      if (attacker.keywords && attacker.keywords.includes('sutemi') && !attacker.ui.effectsNullified && !attacker.ui.pendingRemoval) {
        markCardDestroyed(attacker, performance.now());
        recomputeSlotOccupancy();
        applyBoardEffects();
        checkStateBased();
        gameState.interactionLock = false;
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

  // Step1: 全フィールドカードをベース値にリセット + effectsNullified リセット
  fieldCards.forEach((c) => {
    c.combat.attackLeft  = c.combat.baseAttackLeft;
    c.combat.attackRight = c.combat.baseAttackRight;
    c.ui.effectsNullified = false;
  });

  // Step2: weakaura: 場にあるあいだ、隣接カードの左右攻撃力を -1（最小 0）
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

  // Step2.5: 腐敗キーワード: 両隣のカードに -N/-N を付与（永続オーラ）
  // decay_immunity を持つオーナーの自陣カードは腐敗の影響を受けない
  fieldCards.filter((c) => !c.ui.effectsNullified && c.keywords?.some((kw) => kw.startsWith('decay_') && kw !== 'decay_immunity')).forEach((aura) => {
    const idx = aura.fieldSlotIndex;
    if (idx === null) return;
    const decayKw = aura.keywords.find((kw) => kw.startsWith('decay_') && kw !== 'decay_immunity');
    const power = parseInt(decayKw.split('_')[1], 10) || 1;
    [-1, 1].forEach((delta) => {
      const neighbor = getCardAtSlot(idx + delta);
      if (neighbor) {
        // decay_immunity: 隣のオーナーが腐敗耐性を持つなら適用しない
        const ownerHasImmunity = fieldCards.some(
          (c) => c.owner === neighbor.owner && c.keywords?.includes('decay_immunity'),
        );
        if (!ownerHasImmunity) {
          neighbor.combat.attackLeft  = Math.max(0, neighbor.combat.attackLeft  - power);
          neighbor.combat.attackRight = Math.max(0, neighbor.combat.attackRight - power);
        }
      }
    });
  });

  // Step2.6: field_equalize: 自陣の各カードのLA/RAをmax値に揃える
  fieldCards.filter((c) => c.keywords?.includes('field_equalize') && !c.ui.effectsNullified).forEach((aura) => {
    fieldCards.filter((c) => c.owner === aura.owner).forEach((c) => {
      const mx = Math.max(c.combat.attackLeft, c.combat.attackRight);
      c.combat.attackLeft  = mx;
      c.combat.attackRight = mx;
    });
  });

  // Step3: 一時攻撃力減算（戦闘で与えたダメージ分、ターン中のみ）
  fieldCards.forEach((c) => {
    if (c.combat.tempAttackLeftReduction > 0) {
      c.combat.attackLeft  = Math.max(0, c.combat.attackLeft  - c.combat.tempAttackLeftReduction);
    }
    if (c.combat.tempAttackRightReduction > 0) {
      c.combat.attackRight = Math.max(0, c.combat.attackRight - c.combat.tempAttackRightReduction);
    }
  });

  // Step4: 永続無効化アーラ
  // nullify_adj: 隣接するカード（同オーナー問わず）の effectsNullified を true に
  // ただし nullify_adj/nullify_own を持つカード自身は免疫
  fieldCards.filter((c) => c.keywords?.includes('nullify_adj')).forEach((aura) => {
    const idx = aura.fieldSlotIndex;
    if (idx === null) return;
    [-1, 1].forEach((d) => {
      const neighbor = getCardAtSlot(idx + d);
      if (neighbor
        && !neighbor.keywords?.includes('nullify_adj')
        && !neighbor.keywords?.includes('nullify_own')) {
        neighbor.ui.effectsNullified = true;
      }
    });
  });

  // nullify_own: 同じオーナーの他の全フィールドカードを nullify
  fieldCards.filter((c) => c.keywords?.includes('nullify_own')).forEach((aura) => {
    fieldCards.forEach((c) => {
      if (c.id !== aura.id && c.owner === aura.owner
        && !c.keywords?.includes('nullify_adj')
        && !c.keywords?.includes('nullify_own')) {
        c.ui.effectsNullified = true;
      }
    });
  });

  // Step5: 手札カードの表示プレビュー更新
  applyHandCardPreviews();
}

// 手札カードの攻撃力をベース値にリセットする。
// 仕様変更: 召喚後の能力値プレビューは手札中に表示しない。
function applyHandCardPreviews() {
  gameState.cards.filter((c) => c.zone === 'hand' && !c.ui.pendingRemoval).forEach((card) => {
    card.combat.attackLeft   = card.combat.baseAttackLeft;
    card.combat.attackRight  = card.combat.baseAttackRight;
    card.combat.directAttack = card.combat.baseDirectAttack;
  });
}

function _applyHandPreview(card, eff, owner, manaTotal) {
  switch (eff.type) {
    case 'colorScale': {
      const count = gameState.mana[owner][eff.color] ?? 0;
      card.combat.attackLeft  = count;
      card.combat.attackRight = count;
      break;
    }
    case 'manaGate': {
      const color = eff.color ?? null;
      const canPay = color
        ? (gameState.mana[owner][color] ?? 0) >= eff.cost
        : manaTotal >= eff.cost;
      if (canPay) _applyHandPreview(card, eff.inner, owner, manaTotal);
      break;
    }
    case 'boostSelf': {
      card.combat.attackLeft  += eff.l ?? 0;
      card.combat.attackRight += eff.r ?? 0;
      break;
    }
    case 'upgradeDa': {
      const current = card.combat.directAttack ?? 1;
      if (eff.value > current) card.combat.directAttack = eff.value;
      break;
    }
    default:
      break;
  }
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

// double_attack キーワード: 現在位置に基づいて両隣の敵を同時攻撃する
function performDoubleAdjacentAttack(card, matchIdAtStart) {
  const slot = card.fieldSlotIndex;
  const leftEnemy  = (() => { const c = getCardAtSlot(slot - 1); return c && c.owner !== card.owner ? c : null; })();
  const rightEnemy = (() => { const c = getCardAtSlot(slot + 1); return c && c.owner !== card.owner ? c : null; })();

  if (!leftEnemy && !rightEnemy) {
    gameState.interactionLock = false;
    return;
  }

  const nowMs = performance.now();
  const destroyed = new Set();
  let selfLost = false;
  const revengeList = [];

  if (leftEnemy) {
    const myPow = card.combat.attackLeft;
    const enPow = leftEnemy.combat.attackRight;
    leftEnemy.ui.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    if (myPow > enPow)      { destroyed.add(leftEnemy); }
    else if (myPow < enPow) { selfLost = true; }
    else                    { destroyed.add(leftEnemy); selfLost = true; }
  }

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

  destroyed.forEach((c) => {
    if (c.id !== card.id && c.effect === 'revenge') {
      revengeList.push({ targetOwner: card.owner, amount: 2 });
    }
    // on_death_damage_N キーワード
    const ddmg = getDeathDamage(c);
    if (ddmg > 0) {
      revengeList.push({ targetOwner: c.owner === 'player' ? 'enemy' : 'player', amount: ddmg });
    }
  });

  setTimeout(() => {
    if (gameState.matchId !== matchIdAtStart) return;
    const removeAt = performance.now();
    destroyed.forEach((c) => markCardDestroyed(c, removeAt));

    // 捨身キーワード: 生存した場合も自壊
    [card, leftEnemy, rightEnemy].forEach((c) => {
      if (c && c.keywords?.includes('sutemi') && !c.ui.effectsNullified && !c.ui.pendingRemoval) {
        markCardDestroyed(c, removeAt);
      }
    });

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
      checkStateBased();
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
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

  // revenge効果 / on_death_damage_N: 破壊されたカードのデス効果を収集
  destroyed.forEach((c) => {
    if (c.id !== card.id && c.effect === 'revenge') {
      revengeList.push({ targetOwner: card.owner, amount: 2 });
    }
    const ddmg = getDeathDamage(c);
    if (ddmg > 0) {
      revengeList.push({ targetOwner: c.owner === 'player' ? 'enemy' : 'player', amount: ddmg });
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
      checkStateBased();
    }, DESTROY_ANIMATION_MS);
  }, HIT_FLASH_MS);
}
