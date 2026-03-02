// ===== ターンフロー =====
import {
  ENEMY_ACTION_DELAY_MS, MIN_HAND_AFTER_DRAW, MAX_HAND,
  STARTING_HP, ENEMY_AUTO_END_MS,
  FIRST_PLAYER_BANNER_MS, FIRST_PLAYER_READY_DELAY_MS,
  NO_ACTION_AUTO_END_DELAY_MS, COIN_RESULT_WOBBLE_MS,
  DESTROY_ANIMATION_MS,
} from './constants.js';
import {
  gameState, slotCenters, showBanner,
  reflowHand, getHandCards, getFieldCards,
  markCardDestroyed, addBattleLogEntry, clearBattleLog,
} from './state.js';
import {
  drawRandomCardToHand, buildInitialCards,
  isPlayerMainTurn, canOwnerAct, finishGame,
  applyBoardEffects, checkStateBased,
} from './cards.js';
import { executeEnemyMainAction, aiShouldDiscardHand } from './ai.js';
import { shuffleDeck, buildSampleDeck } from './deck.js';

export function applyDrawPhase(owner) {
  const handCountAtStart = getHandCards(owner).length;
  const isOpeningTurnOfFirstPlayer = gameState.turn.number === 1 && owner === gameState.turn.firstPlayer;
  const drawTarget = handCountAtStart >= MIN_HAND_AFTER_DRAW
    ? (isOpeningTurnOfFirstPlayer
      ? Math.min(MIN_HAND_AFTER_DRAW, MAX_HAND)
      : Math.min(handCountAtStart + 1, MAX_HAND))
    : Math.min(MIN_HAND_AFTER_DRAW, MAX_HAND);

  // デッキ切れ判定: ドローが必要なのにデッキが空なら敗北
  if (handCountAtStart < drawTarget) {
    const deckPile = owner === 'player' ? gameState.playerDeckPile : gameState.enemyDeckPile;
    if (deckPile.length === 0) {
      finishGame(owner === 'player' ? 'enemy' : 'player');
      return;
    }
  }

  while (getHandCards(owner).length < drawTarget) {
    const countBefore = getHandCards(owner).length;
    drawRandomCardToHand(owner);
    if (getHandCards(owner).length === countBefore) break; // デッキ切れ（安全弁）
  }

  const drawnCount = getHandCards(owner).length - handCountAtStart;
  if (drawnCount > 0) {
    addBattleLogEntry(owner, `${owner === 'player' ? 'あなた' : '相手'}が ${drawnCount} 枚ドロー`);
  }
  reflowHand(owner);
}

export function clearActedFlags(owner) {
  // ターン開始時: 全フィールドカードの一時攻撃力減算をリセット
  gameState.cards.filter((c) => c.zone === 'field' && !c.ui.pendingRemoval).forEach((c) => {
    c.combat.tempAttackLeftReduction  = 0;
    c.combat.tempAttackRightReduction = 0;
  });
  applyBoardEffects();
  checkStateBased();

  getFieldCards(owner).forEach((card) => {
    card.combat.hasActedThisTurn = false;
    card.combat.summonedThisTurn = false;
  });
}

export function beginTurnHeader(owner) {
  // ターン開始ログとバナー表示は、ドロー演出より先に出して時系列を自然化する
  addBattleLogEntry('system', `TURN ${gameState.turn.number} / ${owner === 'player' ? 'PLAYER' : 'ENEMY'}`);

  if (owner === 'player') {
    showBanner(`PLAYER TURN ${gameState.turn.number}`);
  } else {
    showBanner(`ENEMY TURN ${gameState.turn.number}`);
  }
}

export function beginMainPhaseCore(owner) {
  // メイン行動開始はドロー後に実行し、デッキアウト時は到達しないよう責務を分離する
  const nowMs = performance.now();
  gameState.turn.phase = 'main';
  gameState.turn.mainPhaseStartedAtMs = nowMs;
  clearActedFlags(owner);

  if (owner === 'player') {
    gameState.turn.enemyAutoEndAtMs = 0;
    gameState.turn.enemyNextActionAtMs = 0;
  } else {
    gameState.turn.enemyAutoEndAtMs = 0;
    // PvPモード時はAIアクションをスケジュールしない
    gameState.turn.enemyNextActionAtMs = gameState.debugPvP ? 0 : nowMs + ENEMY_ACTION_DELAY_MS;
  }
}

export function beginMainPhase(owner) {
  // 既存呼び出しとの互換のため、従来の入口はヘッダー→メイン本体を順に委譲する
  beginTurnHeader(owner);
  beginMainPhaseCore(owner);
}

export function beginTurn(owner, isNewRound = false) {
  gameState.turn.currentPlayer = owner;
  gameState.turn.phase = 'draw';
  gameState.interactionLock = false;
  gameState.activePointer = null;

  if (isNewRound) {
    gameState.turn.number += 1;
  }

  // 表示を先に確定させることで、TURN表示→ドローの順序を保証する
  beginTurnHeader(owner);
  applyDrawPhase(owner);
  if (gameState.result.winner) return; // デッキアウト敗北
  beginMainPhaseCore(owner);
}

// ===== 全破棄 =====

export function applyDiscardAll(owner) {
  const nowMs = performance.now();
  getHandCards(owner).forEach((card) => markCardDestroyed(card, nowMs));
}

// ターン遷移本体（全破棄判定の後に呼ぶ）
function proceedEndTurn() {
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

// プレイヤーが全破棄ダイアログで選択したあとに呼ぶ
export function confirmDiscardPrompt(shouldDiscard) {
  if (!gameState.discardPrompt.active) {
    return;
  }
  const who = gameState.discardPrompt.owner; // 'player' or 'enemy' in PvP mode
  gameState.discardPrompt.active = false;
  gameState.discardPrompt.owner = null;

  if (shouldDiscard) {
    applyDiscardAll(who);
    // 破棄アニメ完了後にターン遷移
    const matchIdAtSchedule = gameState.matchId;
    setTimeout(() => {
      if (gameState.matchId !== matchIdAtSchedule) {
        return;
      }
      proceedEndTurn();
    }, DESTROY_ANIMATION_MS + 60);
  } else {
    proceedEndTurn();
  }
}

export function endCurrentTurn(reason = 'manual') {
  if (gameState.turn.phase !== 'main' || gameState.interactionLock || gameState.result.winner) {
    return;
  }

  // プレイヤー手動終了、敵自動終了、行動不能自動終了のいずれか
  // PvPモード時は敵ターンも手動終了を許可
  if (reason === 'manual' && !isPlayerMainTurn() && !gameState.debugPvP) {
    return;
  }

  const current = gameState.turn.currentPlayer;

  // 手札3枚以上の場合は全破棄の選択を行う
  if (getHandCards(current).length >= 3) {
    if (current === 'player' || gameState.debugPvP) {
      // プレイヤー（またはPvPモードの敵ターン）: ダイアログを表示して待機
      gameState.discardPrompt.active = true;
      gameState.discardPrompt.owner = current;
      return;
    } else {
      // 敵AI: ヒューリスティクスで判断
      if (aiShouldDiscardHand('enemy')) {
        applyDiscardAll('enemy');
        const matchIdAtSchedule = gameState.matchId;
        setTimeout(() => {
          if (gameState.matchId !== matchIdAtSchedule) {
            return;
          }
          proceedEndTurn();
        }, DESTROY_ANIMATION_MS + 60);
        return;
      }
    }
  }

  proceedEndTurn();
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
  clearBattleLog();
  addBattleLogEntry('system', '新しい対戦を開始しますわ。');
  // プレイヤーのデッキ山を再構築（シャッフルして積み直す）
  gameState.playerDeckPile = shuffleDeck();
  // 敵のデッキ山はサンプルデッキをシャッフルして使用
  const enemyDeck = buildSampleDeck();
  for (let i = enemyDeck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = enemyDeck[i]; enemyDeck[i] = enemyDeck[j]; enemyDeck[j] = tmp;
  }
  gameState.enemyDeckPile = enemyDeck;
  buildInitialCards();
  gameState.interactionLock = false;
  gameState.activePointer = null;
  gameState.summonSelection.active = false;
  gameState.summonSelection.cardId = null;
  gameState.summonSelection.targetSlotId = null;
  gameState.summonSelection.preselectedIds = [];
  gameState.summonSelection.selectedIds = [];
  gameState.discardPrompt.active = false;
  gameState.discardPrompt.owner = null;
  gameState.cycleSelection = null;
  gameState.handDiscardSelection = null;
  gameState.cardDetailOverlay = null;
  gameState.graveyard = { player: [], enemy: [] };
  gameState.mana = {
    player: { red: 0, blue: 0, green: 0, black: 0, white: 0, none: 0 },
    enemy:  { red: 0, blue: 0, green: 0, black: 0, white: 0, none: 0 },
  };
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

  // 全破棄ダイアログ中はターンフローを止める
  if (gameState.discardPrompt.active) {
    return;
  }

  // 選択廃棄オーバーレイ中はターンフローを止める
  if (gameState.handDiscardSelection) {
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
    // PvPモード時はAIを動かさない
    if (gameState.turn.currentPlayer === 'enemy' && !gameState.interactionLock && !gameState.debugPvP) {
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

    // 行動不能時の自動終了: PvPモードでは双方のターンで判定
    const isManualCurrentTurn = gameState.turn.currentPlayer === 'player' || gameState.debugPvP;
    if (
      isManualCurrentTurn
      && !gameState.interactionLock
      && nowMs - gameState.turn.mainPhaseStartedAtMs >= NO_ACTION_AUTO_END_DELAY_MS
      && !canOwnerAct(gameState.turn.currentPlayer)
    ) {
      endCurrentTurn('no_actions');
    }
  }
}
