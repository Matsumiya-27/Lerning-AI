// ===== ターンフロー =====
import {
  ENEMY_ACTION_DELAY_MS, MIN_HAND_AFTER_DRAW, MAX_HAND,
  STARTING_HP, ENEMY_AUTO_END_MS,
  FIRST_PLAYER_BANNER_MS, FIRST_PLAYER_READY_DELAY_MS,
  NO_ACTION_AUTO_END_DELAY_MS, COIN_RESULT_WOBBLE_MS,
} from './constants.js';
import {
  gameState, slotCenters, showBanner,
  reflowHand, getHandCards, getFieldCards,
} from './state.js';
import {
  drawRandomCardToHand, buildInitialCards,
  isPlayerMainTurn, canOwnerAct,
} from './cards.js';
import { executeEnemyMainAction } from './ai.js';

export function applyDrawPhase(owner) {
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

export function clearActedFlags(owner) {
  getFieldCards(owner).forEach((card) => {
    card.combat.hasActedThisTurn = false;
    card.combat.summonedThisTurn = false;
  });
}

export function beginMainPhase(owner) {
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

export function beginTurn(owner, isNewRound = false) {
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

export function endCurrentTurn(reason = 'manual') {
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

export function startCoinToss() {
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

export function resetGame() {
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

export function updateTurnFlow(nowMs) {
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
