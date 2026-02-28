// ===== 入力ハンドラ =====
import { CARD_WIDTH, CARD_HEIGHT, SWIPE_THRESHOLD, END_TURN_UI, DESTROY_ANIMATION_MS } from './constants.js';
import {
  canvas, gameState, slotCenters,
  getCardById, getFieldCards, getSlotOccupant,
  startMoveAnimation, reflowHand, markCardDestroyed, getSummonSelectionButtons,
  getDiscardPromptButtons, getOfferingChoiceButtons, getStealChoiceButtons,
} from './state.js';
import {
  cancelSummonSelection, canConfirmSummonSelection, confirmSummonSelection,
  toggleSummonSelectionCard, canUseEndTurnButton, isManualTurn,
  showSummonCostErrorFeedback, performSummon, beginSummonSelection,
  resolveSwipeAttack, resolveDirectAttack,
  getSummonTributeOptions, chooseBestTributeOptionForTarget,
  getOverrideSummonSlots, performOverrideSummon, isOverrideSummonAvailable,
  confirmOfferingChoice, confirmStealChoice,
  canActivateSpell, activateSpellEffect,
  returnCardToDeckBottom,
} from './cards.js';
import { endCurrentTurn, confirmDiscardPrompt } from './turn.js';

// ===== ヒットテスト =====

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

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
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

// ===== ポインターイベント =====

export function onPointerDown(event) {
  if (gameState.activePointer !== null) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event);

  // 循環効果: 手札1枚を選んでデッキ底に返す
  if (gameState.cycleSelection) {
    const sel = gameState.cycleSelection;
    if (gameState.matchId !== sel.matchId) {
      gameState.cycleSelection = null;
      return;
    }
    const hit = gameState.cards.find(
      (c) => c.owner === 'player' && c.zone === 'hand' && !c.ui.pendingRemoval
        && pointInCard(point.x, point.y, c),
    );
    if (hit) {
      gameState.cycleSelection = null;
      returnCardToDeckBottom(hit, 'player');
      reflowHand('player');
      sel.processNext();
    }
    return; // cycleSelection 中は他の操作を受け付けない
  }

  // 選択廃棄: 手札からn枚選んで捨てる
  if (gameState.handDiscardSelection) {
    const sel = gameState.handDiscardSelection;
    if (gameState.matchId !== sel.matchId) {
      gameState.handDiscardSelection = null;
      return;
    }
    const hit = gameState.cards.find(
      (c) => c.owner === 'player' && c.zone === 'hand' && !c.ui.pendingRemoval
        && pointInCard(point.x, point.y, c),
    );
    if (hit) {
      const idx = sel.selectedIds.indexOf(hit.id);
      if (idx >= 0) {
        sel.selectedIds.splice(idx, 1); // 選択解除
      } else if (sel.selectedIds.length < sel.count) {
        sel.selectedIds.push(hit.id);   // 選択追加
      }
      // n枚選択完了で自動確定
      if (sel.selectedIds.length === sel.count) {
        gameState.handDiscardSelection = null;
        const nowMs = performance.now();
        sel.selectedIds.forEach((id) => {
          const c = gameState.cards.find((card) => card.id === id);
          if (c) markCardDestroyed(c, nowMs);
        });
        const { processNext, matchId: mid, owner } = sel;
        setTimeout(() => {
          if (gameState.matchId !== mid) return;
          reflowHand(owner);
          processNext();
        }, DESTROY_ANIMATION_MS + 30);
      }
    }
    return; // handDiscardSelection 中は他の操作を受け付けない
  }

  // offering 選択オーバーレイ
  if (gameState.offeringChoice.active) {
    const { keep, offer } = getOfferingChoiceButtons();
    if (pointInRect(point.x, point.y, keep)) {
      confirmOfferingChoice(false);
    } else if (pointInRect(point.x, point.y, offer)) {
      confirmOfferingChoice(true);
    }
    return;
  }

  // steal 選択オーバーレイ
  if (gameState.stealChoice.active) {
    const { left: lBtn, right: rBtn } = getStealChoiceButtons();
    const { leftId, rightId } = gameState.stealChoice;
    if (leftId && pointInRect(point.x, point.y, lBtn)) {
      confirmStealChoice(leftId);
    } else if (rightId && pointInRect(point.x, point.y, rBtn)) {
      confirmStealChoice(rightId);
    }
    return;
  }

  // 全破棄ダイアログが表示中はボタンのみ受け付ける
  if (gameState.discardPrompt.active) {
    const { discard, skip } = getDiscardPromptButtons();
    if (pointInRect(point.x, point.y, discard)) {
      confirmDiscardPrompt(true);
    } else if (pointInRect(point.x, point.y, skip)) {
      confirmDiscardPrompt(false);
    }
    return;
  }

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

    const activeOwner = gameState.turn.currentPlayer;
    const selectable = getTopCardAtPoint(
      point,
      (card) => card.zone === 'field' && card.owner === activeOwner && !card.ui.pendingRemoval,
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

  if (!isManualTurn()) {
    return;
  }

  const activeOwner = gameState.turn.currentPlayer;

  const handCard = getTopCardAtPoint(point, (card) => card.zone === 'hand' && card.owner === activeOwner && !card.ui.animation);
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
    (card) => card.zone === 'field' && card.owner === activeOwner && !card.ui.pendingRemoval,
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

export function onPointerMove(event) {
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

export function onPointerUp(event) {
  if (!gameState.activePointer || gameState.activePointer.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const pointerState = gameState.activePointer;
  const card = getCardById(pointerState.cardId);

  if (card && pointerState.kind === 'drag') {
    card.ui.isDragging = false;

    const targetSlot = slotCenters.find((slot) => pointInSlot(card.x, card.y, slot));
    // 操作中のオーナー（PvPモードでは敵ターンに敵カードを操作する）
    const owner    = card.owner;
    const opponent = owner === 'player' ? 'enemy' : 'player';

    gameState.interactionLock = true;

    // スペルカード: フィールドエリア（y < 500）へドロップで発動判定
    if (card.cardCategory === 'spell') {
      if (card.y < 500 && canActivateSpell(card, owner)) {
        activateSpellEffect(card, owner);
      } else {
        startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
          card.zone = 'hand';
          gameState.interactionLock = false;
        });
      }
    } else if (targetSlot) {
      const occupant = targetSlot.occupiedByCardId !== null ? getCardById(targetSlot.occupiedByCardId) : null;
      const isOpponentR1 = occupant && occupant.owner === opponent && occupant.rank === 1;

      // 上書き召喚: 自場が空 + ドロップ先が相手RANK1 + 自カードがRANK1/2
      if (isOverrideSummonAvailable(owner) && isOpponentR1 && (card.rank === 1 || card.rank === 2)) {
        performOverrideSummon(card, targetSlot);
      } else if (targetSlot.occupiedByCardId !== null && card.rank === 1) {
        // RANK1は占有スロットに出せない（上書き条件を満たさない場合）
        showSummonCostErrorFeedback(card);
        startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
          card.zone = 'hand';
          gameState.interactionLock = false;
        });
      } else if (card.rank === 1) {
        // performSummon 経由で召喚酔い・rush・その他効果を正しく処理する
        performSummon(card, targetSlot, []);
      } else {
        const tributeOptions = getSummonTributeOptions(owner, card.rank, card);
        const selected = chooseBestTributeOptionForTarget(owner, tributeOptions, targetSlot.id);

        if (!selected) {
          showSummonCostErrorFeedback(card);
          startMoveAnimation(card, pointerState.originalX, pointerState.originalY, () => {
            card.zone = 'hand';
            gameState.interactionLock = false;
          });
        } else if (card.rank === 2) {
          // Rank2は生贄1体のみ。選択が明確なら暗転確認オーバーレイをスキップ
          const ownerFieldCards = getFieldCards(owner);
          if (occupant && occupant.owner === owner) {
            // ドロップ先が自軍カード → 即座に召喚
            performSummon(card, targetSlot, [occupant.id]);
          } else if (ownerFieldCards.length === 1) {
            // 場のカードが1枚のみ → 選択の余地なし、即座に召喚
            performSummon(card, targetSlot, [ownerFieldCards[0].id]);
          } else {
            // 場のカードが複数 → 選択オーバーレイ表示
            beginSummonSelection(card, targetSlot.id, pointerState.originalX, pointerState.originalY);
          }
        } else if (card.rank === 3) {
          // Rank3: ドロップ先に自軍Rank2がいれば即座に1体生贄で召喚
          if (occupant && occupant.owner === owner && occupant.rank === 2) {
            performSummon(card, targetSlot, [occupant.id]);
          } else {
            beginSummonSelection(card, targetSlot.id, pointerState.originalX, pointerState.originalY);
          }
        } else {
          beginSummonSelection(card, targetSlot.id, pointerState.originalX, pointerState.originalY);
        }
      }
    } else {
      // スロット外にドロップ → 手札に戻す（ユニットのみ。スペルは上で処理済み）
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
