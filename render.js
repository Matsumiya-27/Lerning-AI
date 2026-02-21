// ===== 描画 =====
import {
  CANVAS_WIDTH, CANVAS_HEIGHT, CARD_WIDTH, CARD_HEIGHT,
  DESTROY_ANIMATION_MS, COIN_TOSS_MS, COIN_RESULT_WOBBLE_MS,
  STARTING_HP, END_TURN_UI,
} from './constants.js';
import {
  ctx, gameState, slotCenters,
  getHandCards, getFieldCards, getCardById,
  getHpBadgePosition, getSummonSelectionButtons, getDiscardPromptButtons,
} from './state.js';
import {
  canUseEndTurnButton, getSelectedTributeCards, canConfirmSummonSelection,
  isOverrideSummonAvailable, getOverrideSummonSlots,
} from './cards.js';

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

  // 上書き召喚可能スロットをゴールドでハイライト（プレイヤーがドラッグ中のみ）
  const isDragging = gameState.cards.some((c) => c.ui.isDragging && c.owner === 'player');
  if (isDragging && isOverrideSummonAvailable('player')) {
    const overrideSlots = getOverrideSummonSlots('player');
    overrideSlots.forEach((slotId) => {
      const slot = slotCenters[slotId];
      ctx.strokeStyle = '#ffd470';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(slot.x - CARD_WIDTH / 2 - 4, slot.y - CARD_HEIGHT / 2 - 4, CARD_WIDTH + 8, CARD_HEIGHT + 8);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 212, 112, 0.10)';
      ctx.fillRect(slot.x - CARD_WIDTH / 2 - 4, slot.y - CARD_HEIGHT / 2 - 4, CARD_WIDTH + 8, CARD_HEIGHT + 8);
    });
  }
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

  const targetSlot = slotCenters[selection.targetSlotId];
  if (targetSlot) {
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(targetSlot.x - CARD_WIDTH / 2 - 8, targetSlot.y - CARD_HEIGHT / 2 - 8, CARD_WIDTH + 16, CARD_HEIGHT + 16);
    ctx.setLineDash([]);
  }

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

    // 効果バッジ（rush=緑・pierce=金・revenge=紫）
    if (card.effect) {
      const effectColor = { rush: '#2ca44e', pierce: '#c8a000', revenge: '#9040d0' };
      const effectLabel = { rush: 'RUSH', pierce: 'PIERCE', revenge: 'RVNG' };
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = effectColor[card.effect] || '#888';
      ctx.fillText(effectLabel[card.effect] || card.effect.toUpperCase(), left + 10, top + 31);
    }

    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#174f9b';
    ctx.fillText(String(card.combat.attackLeft), left + 10, centerY + 7);

    ctx.fillStyle = '#9b1f1f';
    const rightText = String(card.combat.attackRight);
    const rightWidth = ctx.measureText(rightText).width;
    ctx.fillText(rightText, left + width - 12 - rightWidth, centerY + 7);

    // ステータス表示はフィールドカードのみ（手札では非表示）
    if (card.zone === 'field') {
      ctx.font = '11px sans-serif';
      let actedText, actedColor;
      if (card.combat.hasActedThisTurn) {
        actedText = 'USED';
        actedColor = '#888888';
      } else if (card.combat.summonedThisTurn) {
        // 召喚酔い：直接攻撃不可
        actedText = 'ENTRY';
        actedColor = '#c8a020';
      } else {
        actedText = 'READY';
        actedColor = '#333333';
      }
      ctx.fillStyle = actedColor;
      ctx.fillText(actedText, left + 10, top + height - 12);
    }

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

function drawDiscardPrompt() {
  if (!gameState.discardPrompt.active) {
    return;
  }

  const handCount = getHandCards('player').length;
  const { discard, skip } = getDiscardPromptButtons();
  const dialogX = 250;
  const dialogY = 270;
  const dialogW = 460;
  const dialogH = 195;

  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = '#0f1828';
  ctx.strokeStyle = '#9fb4dc';
  ctx.lineWidth = 2;
  ctx.fillRect(dialogX, dialogY, dialogW, dialogH);
  ctx.strokeRect(dialogX, dialogY, dialogW, dialogH);

  ctx.fillStyle = '#eaf1ff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`手札が ${handCount} 枚あります`, CANVAS_WIDTH / 2, dialogY + 44);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#c8d6f0';
  ctx.fillText('ターン終了前に手札を全て破棄しますか？', CANVAS_WIDTH / 2, dialogY + 76);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#8898b8';
  ctx.fillText('破棄した場合、次のドローフェイズで4枚引き直せます', CANVAS_WIDTH / 2, dialogY + 104);

  // 全破棄ボタン
  ctx.fillStyle = '#4a2a33';
  ctx.strokeStyle = '#c18595';
  ctx.lineWidth = 2;
  ctx.fillRect(discard.x, discard.y, discard.width, discard.height);
  ctx.strokeRect(discard.x, discard.y, discard.width, discard.height);
  ctx.fillStyle = '#ffe5ea';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('全破棄', discard.x + discard.width / 2, discard.y + 27);

  // スキップボタン
  ctx.fillStyle = '#274a7f';
  ctx.strokeStyle = '#7db5ff';
  ctx.lineWidth = 2;
  ctx.fillRect(skip.x, skip.y, skip.width, skip.height);
  ctx.strokeRect(skip.x, skip.y, skip.width, skip.height);
  ctx.fillStyle = '#edf4ff';
  ctx.fillText('スキップ', skip.x + skip.width / 2, skip.y + 27);

  ctx.textAlign = 'left';
  ctx.restore();
}

export function draw(nowMs) {
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
  drawDiscardPrompt();

  if (nowMs < gameState.fx.koFlashUntilMs) {
    const remain = gameState.fx.koFlashUntilMs - nowMs;
    const alpha = Math.min(remain / 900, 1) * 0.55;
    ctx.fillStyle = `rgba(255,70,70,${alpha})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  ctx.restore();
}
