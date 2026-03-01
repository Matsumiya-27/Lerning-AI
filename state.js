// ===== 共有状態・ユーティリティ =====
import {
  STARTING_HP, COIN_TOSS_MS, TURN_BANNER_MS,
  MOVE_ANIMATION_MS, DESTROY_ANIMATION_MS, SHAKE_DURATION_MS,
} from './constants.js';

// ===== DOM =====
export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');
export const resetButton = document.getElementById('resetButton');
export const battleLogList = document.getElementById('battleLogList');

// ===== レイアウト =====
export const slotCenters = [140, 280, 420, 560, 700].map((x, index) => ({
  id: index,
  x,
  y: 360,
  occupiedByCardId: null,
}));

export function getHandCenter(owner, handIndex, handCount) {
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
export const gameState = {
  matchId: 0,
  cards: [],
  nextCardId: 0,
  interactionLock: false,
  // デバッグ用: true にすると両プレイヤーを手動操作できる（AIが動かなくなる）
  debugPvP: false,
  // プレイヤーのデッキ山（ゲーム開始時にデッキをシャッフルして積む。末尾から引く）
  playerDeckPile: [],
  // 敵のデッキ山（サンプルデッキをシャッフルして積む）
  enemyDeckPile: [],
  // 退場済み: 場を離れたカード・捨て札の要約（rank + cardCategory + attribute のみ保持）
  graveyard: { player: [], enemy: [] },
  // マナ: 退場済みカードのrank分を色別に積算（使用時に減算）
  mana: {
    player: { red: 0, blue: 0, green: 0, black: 0, white: 0, none: 0 },
    enemy:  { red: 0, blue: 0, green: 0, black: 0, white: 0, none: 0 },
  },
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
  battleLog: [],
  // offering効果: 召喚時に相手へ譲渡するか選択するオーバーレイ
  offeringChoice: {
    active: false,
    cardId: null,
  },
  // steal効果: 隣接する敵カードを2択で奪う選択オーバーレイ
  stealChoice: {
    active: false,
    cardId: null,  // steal カード自身
    leftId: null,  // 左候補の敵カードID
    rightId: null, // 右候補の敵カードID
  },
  discardPrompt: {
    active: false,
    owner: null, // 'player' | 'enemy'
  },
  // 循環効果: プレイヤーが手札を1枚選んでデッキ底に戻す待機状態
  cycleSelection: null, // null | { owner, processNext, matchId }
  // 選択廃棄: プレイヤーが手札からn枚選んで捨てる待機状態
  handDiscardSelection: null, // null | { count, owner, processNext, matchId, selectedIds: [] }
  // カード詳細オーバーレイ: 長押し中に表示するカード拡大表示
  cardDetailOverlay: null, // null | { cardId }
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

const MAX_BATTLE_LOG_ENTRIES = 28;

function renderBattleLog() {
  if (!battleLogList) {
    return;
  }
  battleLogList.innerHTML = '';
  gameState.battleLog.forEach((entry) => {
    const li = document.createElement('li');
    li.className = entry.owner;
    li.textContent = entry.text;
    battleLogList.appendChild(li);
  });
  battleLogList.scrollTop = battleLogList.scrollHeight;
}

export function clearBattleLog() {
  gameState.battleLog = [];
  renderBattleLog();
}

export function addBattleLogEntry(owner, text) {
  gameState.battleLog.push({ owner, text });
  if (gameState.battleLog.length > MAX_BATTLE_LOG_ENTRIES) {
    gameState.battleLog.splice(0, gameState.battleLog.length - MAX_BATTLE_LOG_ENTRIES);
  }
  renderBattleLog();
}

// ===== FX ヘルパー =====

export function showBanner(text, durationMs = TURN_BANNER_MS) {
  gameState.turn.bannerText = text;
  gameState.turn.bannerUntilMs = performance.now() + durationMs;
}

export function triggerScreenShake(power = 5, durationMs = 170) {
  const nowMs = performance.now();
  gameState.fx.screenShakeUntilMs = Math.max(gameState.fx.screenShakeUntilMs, nowMs + durationMs);
  gameState.fx.screenShakePower = Math.max(gameState.fx.screenShakePower, power);
}

export function addDamageText(x, y, text, color = '#ff6b6b') {
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

export function triggerHpPulse(owner, durationMs = 520) {
  const nowMs = performance.now();
  gameState.fx.hpPulse.owner = owner;
  gameState.fx.hpPulse.startMs = nowMs;
  gameState.fx.hpPulse.untilMs = nowMs + durationMs;
}

// ===== カードデータアクセス =====

export function recomputeSlotOccupancy() {
  slotCenters.forEach((slot) => {
    slot.occupiedByCardId = null;
  });
  gameState.cards.forEach((card) => {
    if (card.zone === 'field' && card.fieldSlotIndex !== null && !card.ui.pendingRemoval) {
      slotCenters[card.fieldSlotIndex].occupiedByCardId = card.id;
    }
  });
}

export function reflowHand(owner) {
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

export function getCardById(cardId) {
  return gameState.cards.find((card) => card.id === cardId && !card.ui.pendingRemoval) ?? null;
}

export function getCardAtSlot(slotIndex) {
  const slot = slotCenters[slotIndex];
  if (!slot || slot.occupiedByCardId === null) {
    return null;
  }
  return getCardById(slot.occupiedByCardId);
}

export function getHandCards(owner) {
  return gameState.cards.filter((card) => card.owner === owner && card.zone === 'hand' && !card.ui.pendingRemoval);
}

export function getFieldCards(owner) {
  return gameState.cards.filter((card) => card.owner === owner && card.zone === 'field' && !card.ui.pendingRemoval);
}

export function getSlotOccupant(slotId) {
  const slot = slotCenters[slotId];
  if (!slot || slot.occupiedByCardId === null) {
    return null;
  }
  return getCardById(slot.occupiedByCardId);
}

export function hasEmptyFieldSlot() {
  return slotCenters.some((slot) => slot.occupiedByCardId === null);
}

// ===== アニメーション =====

export function startMoveAnimation(card, toX, toY, onComplete) {
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

export function markCardDestroyed(card, nowMs) {
  card.ui.destroyStartMs = nowMs;
  card.ui.destroyUntilMs = nowMs + DESTROY_ANIMATION_MS;
  card.ui.pendingRemoval = true;

  // 退場済みに追加し、マナを積算（スペルはマナ0扱い）
  const rankVal  = (card.cardCategory === 'spell') ? 0 : (card.rank ?? 0);
  const colorKey = card.attribute ?? 'none';
  gameState.graveyard[card.owner].push({
    rank: card.rank ?? 0,
    cardCategory: card.cardCategory ?? 'unit',
    attribute: card.attribute ?? null,
  });
  gameState.mana[card.owner][colorKey] += rankVal;

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

// マナ合計を計算して返す（毎回計算・保持しない）
export function getManaTotal(owner) {
  return Object.values(gameState.mana[owner]).reduce((s, v) => s + v, 0);
}

// カードをデッキ返却として除去する（墓地・マナ積算なし）
export function markCardReturned(card, nowMs) {
  card.ui.destroyStartMs = nowMs;
  card.ui.destroyUntilMs = nowMs + DESTROY_ANIMATION_MS;
  card.ui.pendingRemoval = true;
  // 墓地・マナには追加しない
  if (card.fieldSlotIndex !== null) {
    const slot = slotCenters[card.fieldSlotIndex];
    if (slot && slot.occupiedByCardId === card.id) {
      slot.occupiedByCardId = null;
    }
  }
  if (card.zone === 'hand') reflowHand(card.owner);
  card.fieldSlotIndex = null;
}

// マナを消費する（同色優先、不足分は他色から補填）
export function useMana(owner, amount, attribute) {
  const m = gameState.mana[owner];
  const ck = attribute ?? 'none';
  const fromColor = Math.min(m[ck] ?? 0, amount);
  m[ck] -= fromColor;
  let rest = amount - fromColor;
  for (const k of ['red', 'blue', 'green', 'black', 'white', 'none']) {
    if (k === ck || rest <= 0) continue;
    const take = Math.min(m[k] ?? 0, rest);
    m[k] -= take;
    rest  -= take;
  }
}

export function triggerUsedCardFeedback(card, nowMs) {
  card.ui.shakeUntilMs = nowMs + SHAKE_DURATION_MS;
  card.ui.crossUntilMs = nowMs + SHAKE_DURATION_MS;
}

// ===== レイアウト定数関数 =====

export function getHpBadgePosition(owner) {
  if (owner === 'enemy') {
    return { x: 918, y: 76 };
  }
  return { x: 70, y: 644 };
}

export function getSummonSelectionButtons() {
  return {
    confirm: { x: 366, y: 590, width: 110, height: 44 },
    cancel: { x: 488, y: 590, width: 110, height: 44 },
  };
}

export function getOfferingChoiceButtons() {
  return {
    keep:  { x: 330, y: 378, width: 130, height: 44 },
    offer: { x: 500, y: 378, width: 130, height: 44 },
  };
}

export function getStealChoiceButtons() {
  return {
    left:  { x: 330, y: 400, width: 130, height: 44 },
    right: { x: 500, y: 400, width: 130, height: 44 },
  };
}

export function getDiscardPromptButtons() {
  return {
    discard: { x: 310, y: 390, width: 150, height: 44 },
    skip:    { x: 500, y: 390, width: 150, height: 44 },
  };
}

// ===== フレーム更新 =====

export function updateAnimations(nowMs) {
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
