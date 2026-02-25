// ===== 敵AI =====
import { STARTING_HP, ENEMY_ACTION_DELAY_MS } from './constants.js';
import {
  gameState, slotCenters,
  getCardById, getCardAtSlot, getHandCards, getFieldCards,
} from './state.js';
import {
  getRankTotalPower, getSummonTributeOptions, chooseBestTributeOption,
  getSummonCandidateSlots, canDirectAttack,
  resolveSwipeAttack, resolveDirectAttack,
  isOverrideSummonAvailable, getOverrideSummonSlots, performOverrideSummon,
  performSummon,
} from './cards.js';

export function getEmptySlotIndices() {
  return slotCenters.filter((slot) => slot.occupiedByCardId === null).map((slot) => slot.id);
}

export function evaluateEnemyPlacement(card, slotIndex) {
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

export function chooseBestEnemySummon() {
  const hand = getHandCards('enemy');
  if (hand.length === 0) {
    return null;
  }

  let best = null;

  // 上書き召喚の評価（自場が空で相手のRANK1が存在する場合）
  if (isOverrideSummonAvailable('enemy')) {
    const overrideSlots = getOverrideSummonSlots('enemy');
    hand.filter((c) => c.rank === 1 || c.rank === 2).forEach((card) => {
      overrideSlots.forEach((slotIndex) => {
        // 上書き召喚は生贄コスト0なので高スコア
        const score = getRankTotalPower(card.rank) * 2.2;
        if (!best || score > best.score) {
          best = { card, slotIndex, tributeIds: [], score, isOverride: true };
        }
      });
    });
  }

  // 通常召喚の評価
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
        best = { card, slotIndex, tributeIds: bestTribute ?? [], score, isOverride: false };
      }
    });
  });

  return best;
}

export function chooseBestEnemyAttack() {
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
    const directAttacker = attackers.find((card) => !card.combat.summonedThisTurn);
    const directCandidate = directAttacker
      ? { attacker: directAttacker, direction: 'direct', score: 12 + (STARTING_HP - gameState.hp.player) }
      : null;
    if (directCandidate && (!best || directCandidate.score > best.score)) {
      best = directCandidate;
    }
  }

  return best;
}

export function executeEnemyMainAction(nowMs) {
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
    const { card, slotIndex, tributeIds, isOverride } = summon;
    const targetSlot = slotCenters[slotIndex];

    if (isOverride) {
      // 上書き召喚: performOverrideSummon に委譲
      performOverrideSummon(card, targetSlot);
      gameState.turn.enemyNextActionAtMs = nowMs + ENEMY_ACTION_DELAY_MS;
      return true;
    }

    const summonableSlots = getSummonCandidateSlots('enemy', tributeIds);
    if (!summonableSlots.includes(slotIndex)) {
      return false;
    }
    gameState.interactionLock = true;
    // performSummon が tribute 適用・アニメ・召喚時効果発動・lock 解除をすべて担当
    performSummon(card, targetSlot, tributeIds);

    gameState.turn.enemyNextActionAtMs = nowMs + ENEMY_ACTION_DELAY_MS;
    return true;
  }

  return false;
}

// ターン終了時に手札を全破棄すべきかどうかのAI判断
export function aiShouldDiscardHand(owner) {
  // 手札6枚以上は多すぎるので破棄して次ターンに引き直す
  return getHandCards(owner).length >= 6;
}
