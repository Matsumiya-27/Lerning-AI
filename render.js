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
  getGraveyardRankTotal,
  getOfferingChoiceButtons, getStealChoiceButtons,
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

    const isSpell = card.cardCategory === 'spell';

    // スペルと通常ユニットで背景色を変える
    ctx.fillStyle = isSpell ? '#1e1040' : '#ffffff';
    ctx.strokeStyle = ownerStroke;
    ctx.lineWidth = 3;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);

    if (nowMs < card.ui.hitFlashUntilMs) {
      ctx.fillStyle = 'rgba(255, 78, 78, 0.25)';
      ctx.fillRect(left, top, width, height);
    }

    if (isSpell) {
      // ── スペルカード表示 ──
      // 上部: 「スペル」ラベル
      ctx.fillStyle = '#a080ff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('スペル', centerX, top + 14);

      // 中央上: 発動条件 Rank
      ctx.fillStyle = '#ffdd88';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`発動:${card.rank}`, centerX, centerY - 8);

      // 効果テキスト
      const spellEffectJp = { draw1: 'カードを1枚引く' };
      ctx.fillStyle = '#ccccff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(spellEffectJp[card.effect] || card.effect || '─', centerX, centerY + 12);

      // 種族
      ctx.fillStyle = '#888899';
      ctx.font = '9px sans-serif';
      ctx.fillText(card.type || 'テスト', centerX, centerY + 30);

      ctx.textAlign = 'left';
    } else {
      // ── ユニットカード表示 ──
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(rankLabel, left + 10, top + 18);

      // 種族（ランクラベルの下に小さく表示）
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#555555';
      ctx.fillText(card.type || 'テスト', left + 10, top + 30);

      // 属性（右上に小さく）
      ctx.textAlign = 'right';
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#888888';
      ctx.fillText(card.attribute || '無', left + width - 6, top + 14);
      ctx.textAlign = 'left';

      ctx.font = 'bold 20px sans-serif';
      const leftDebuffed  = card.combat.baseAttackLeft  !== undefined && card.combat.attackLeft  < card.combat.baseAttackLeft;
      const rightDebuffed = card.combat.baseAttackRight !== undefined && card.combat.attackRight < card.combat.baseAttackRight;

      // エッジ系効果: フィールドのスロット1 or 3 にいる場合、端への攻撃値をブースト表示
      let displayLeft  = card.combat.attackLeft;
      let displayRight = card.combat.attackRight;
      let leftEdgeBoosted  = false;
      let rightEdgeBoosted = false;
      if (card.zone === 'field' && (card.effect === 'edge1' || card.effect === 'edge2' || card.effect === 'edgewin')) {
        const slot = card.fieldSlotIndex;
        if (slot === 1) {
          leftEdgeBoosted = true;
          if (card.effect === 'edgewin') displayLeft = Infinity;
          else if (card.effect === 'edge2') displayLeft = card.combat.attackLeft + 2;
          else displayLeft = card.combat.attackLeft + 1;
        }
        if (slot === 3) {
          rightEdgeBoosted = true;
          if (card.effect === 'edgewin') displayRight = Infinity;
          else if (card.effect === 'edge2') displayRight = card.combat.attackRight + 2;
          else displayRight = card.combat.attackRight + 1;
        }
      }

      const leftStr  = displayLeft  === Infinity ? '∞' : String(displayLeft);
      const rightStr = displayRight === Infinity ? '∞' : String(displayRight);

      ctx.fillStyle = leftEdgeBoosted ? '#00d4ff' : leftDebuffed ? '#e07020' : '#174f9b';
      ctx.fillText(leftStr, left + 10, centerY + 7);

      ctx.fillStyle = rightEdgeBoosted ? '#00d4ff' : rightDebuffed ? '#e07020' : '#9b1f1f';
      const rightTextWidth = ctx.measureText(rightStr).width;
      ctx.fillText(rightStr, left + width - 12 - rightTextWidth, centerY + 7);

      // 効果テキスト
      if (card.effect) {
        const effectColor = {
          rush: '#666666', pierce: '#c8a000', revenge: '#9040d0',
          strike2: '#e05020', strike3: '#ff2800',
          edge1: '#1a80d0', edge2: '#0050ff', edgewin: '#00b8e0',
          swap: '#c07800', doublecenter: '#b000b0',
          doubleblade: '#c04000', weakaura: '#20a080',
          offering: '#8060e0', steal: '#e0a000',
          deathcurse: '#702090', harakiri: '#cc0000',
        };
        const effectJp = {
          rush:         '調整中',
          pierce:       '超過ダメージ',
          revenge:      '撃破時に反撃',
          strike2:      '2回連続攻撃',
          strike3:      '3回連続攻撃',
          edge1:        '端への攻撃+1',
          edge2:        '端への攻撃+2',
          edgewin:      '端への攻撃必勝',
          swap:         '隣を入れ替え',
          doublecenter: '両隣を同時攻撃',
          doubleblade:  '諸刃の剣',
          weakaura:     '隣の敵を弱体化',
          offering:     '相手に贈与可',
          steal:        '隣の敵を奪取',
          deathcurse:   '破壊時に呪い',
          harakiri:     '全カード破壊',
        };
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = effectColor[card.effect] || '#888';
        ctx.textAlign = 'center';
        ctx.fillText(effectJp[card.effect] || card.effect, centerX, centerY + 44);
        ctx.textAlign = 'left';
      }

      // フィールドカードのみ: USED/READY ステータス
      if (card.zone === 'field') {
        ctx.font = '11px sans-serif';
        const actedText  = card.combat.hasActedThisTurn ? 'USED' : 'READY';
        const actedColor = card.combat.hasActedThisTurn ? '#888888' : '#333333';
        ctx.fillStyle = actedColor;
        ctx.fillText(actedText, left + 10, top + height - 12);
      }
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

function drawOfferingChoiceOverlay() {
  if (!gameState.offeringChoice.active) return;
  const { keep, offer } = getOfferingChoiceButtons();
  const cx = CANVAS_WIDTH / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = '#0f1828';
  ctx.strokeStyle = '#8060e0';
  ctx.lineWidth = 2;
  ctx.fillRect(260, 300, 440, 170);
  ctx.strokeRect(260, 300, 440, 170);

  ctx.fillStyle = '#eaf1ff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('OFFERING', cx, 334);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#c8d6f0';
  ctx.fillText('このカードを相手に譲渡しますか？', cx, 362);

  // KEEP ボタン
  ctx.fillStyle = '#274a7f';
  ctx.strokeStyle = '#7db5ff';
  ctx.lineWidth = 2;
  ctx.fillRect(keep.x, keep.y, keep.width, keep.height);
  ctx.strokeRect(keep.x, keep.y, keep.width, keep.height);
  ctx.fillStyle = '#edf4ff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('KEEP', keep.x + keep.width / 2, keep.y + 27);

  // OFFER ボタン
  ctx.fillStyle = '#4a2a33';
  ctx.strokeStyle = '#c18595';
  ctx.fillRect(offer.x, offer.y, offer.width, offer.height);
  ctx.strokeRect(offer.x, offer.y, offer.width, offer.height);
  ctx.fillStyle = '#ffe5ea';
  ctx.fillText('OFFER', offer.x + offer.width / 2, offer.y + 27);

  ctx.textAlign = 'left';
  ctx.restore();
}

function drawStealChoiceOverlay() {
  if (!gameState.stealChoice.active) return;
  const { left: lBtn, right: rBtn } = getStealChoiceButtons();
  const cx = CANVAS_WIDTH / 2;
  const { leftId, rightId } = gameState.stealChoice;
  const leftCard  = leftId  ? gameState.cards.find((c) => c.id === leftId)  : null;
  const rightCard = rightId ? gameState.cards.find((c) => c.id === rightId) : null;

  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = '#0f1828';
  ctx.strokeStyle = '#e0a000';
  ctx.lineWidth = 2;
  ctx.fillRect(240, 290, 480, 195);
  ctx.strokeRect(240, 290, 480, 195);

  ctx.fillStyle = '#fff4cc';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STEAL — 奪うカードを選択', cx, 324);

  // 左カード情報
  if (leftCard) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#d8e0f5';
    ctx.fillText(`← R${leftCard.rank}  ${leftCard.combat.attackLeft}/${leftCard.combat.attackRight}`, cx - 90, 358);
  }
  // 右カード情報
  if (rightCard) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#d8e0f5';
    ctx.fillText(`R${rightCard.rank}  ${rightCard.combat.attackLeft}/${rightCard.combat.attackRight} →`, cx + 90, 358);
  }

  // LEFT ボタン
  ctx.fillStyle = '#274a7f';
  ctx.strokeStyle = '#7db5ff';
  ctx.lineWidth = 2;
  ctx.fillRect(lBtn.x, lBtn.y, lBtn.width, lBtn.height);
  ctx.strokeRect(lBtn.x, lBtn.y, lBtn.width, lBtn.height);
  ctx.fillStyle = '#edf4ff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('← LEFT', lBtn.x + lBtn.width / 2, lBtn.y + 27);

  // RIGHT ボタン
  ctx.fillStyle = '#274a7f';
  ctx.strokeStyle = '#7db5ff';
  ctx.fillRect(rBtn.x, rBtn.y, rBtn.width, rBtn.height);
  ctx.strokeRect(rBtn.x, rBtn.y, rBtn.width, rBtn.height);
  ctx.fillStyle = '#edf4ff';
  ctx.fillText('RIGHT →', rBtn.x + rBtn.width / 2, rBtn.y + 27);

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

function drawGraveyardPile(owner) {
  const cx = 43;
  const cy = owner === 'player' ? 575 : 145;
  const w = 54;
  const h = 76;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rankTotal = getGraveyardRankTotal(owner);
  const count = (gameState.graveyard[owner] || []).length;

  ctx.save();

  // 枠線（常時）
  ctx.strokeStyle = owner === 'player' ? '#4da3ff' : '#ff7272';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  if (count > 0) {
    // カード背景
    ctx.fillStyle = owner === 'player' ? '#101e38' : '#301010';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = owner === 'player' ? '#4da3ff' : '#ff7272';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Rank合計（大きく中央）
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(String(rankTotal), cx, cy + 8);

    // 枚数（小さく下）
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`${count}枚`, cx, cy + 26);
  }

  // ラベル「墓地」
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#888888';
  ctx.textAlign = 'center';
  ctx.fillText('墓地', cx, y - 4);

  ctx.restore();
}

function drawGraveyards() {
  drawGraveyardPile('player');
  drawGraveyardPile('enemy');
}

function drawDeckCounts() {
  const playerCount = gameState.playerDeckPile.length;
  const enemyCount = gameState.enemyDeckPile ? gameState.enemyDeckPile.length : 0;

  const panelX = 794;
  const panelY = 648;
  const panelW = 152;
  const panelH = 54;

  // 背景パネル
  ctx.save();
  ctx.fillStyle = 'rgba(10, 18, 34, 0.72)';
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 7);
  ctx.fill();
  ctx.strokeStyle = '#3a5580';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ラベル
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#6a8ab0';
  ctx.fillText('デッキ残枚数', panelX + 8, panelY + 14);

  ctx.font = '13px sans-serif';
  // 敵デッキ
  ctx.fillStyle = enemyCount === 0 ? '#e05050' : '#c09090';
  ctx.fillText(`相手:`, panelX + 8, panelY + 33);
  ctx.fillStyle = enemyCount === 0 ? '#ff6060' : '#e0b0b0';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`${enemyCount}枚`, panelX + 46, panelY + 33);

  ctx.font = '13px sans-serif';
  // 自分デッキ
  ctx.fillStyle = playerCount === 0 ? '#e05050' : '#8090c0';
  ctx.fillText(`自分:`, panelX + 8, panelY + 50);
  ctx.fillStyle = playerCount === 0 ? '#ff6060' : '#a0c0e8';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`${playerCount}枚`, panelX + 46, panelY + 50);

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
  drawGraveyards();
  drawDeckCounts();
  drawCanvasEndTurnButton();
  drawCoinToss(nowMs);
  drawTurnBanner(nowMs);
  drawSummonSelectionOverlay();
  drawOfferingChoiceOverlay();
  drawStealChoiceOverlay();
  drawDiscardPrompt();

  if (nowMs < gameState.fx.koFlashUntilMs) {
    const remain = gameState.fx.koFlashUntilMs - nowMs;
    const alpha = Math.min(remain / 900, 1) * 0.55;
    ctx.fillStyle = `rgba(255,70,70,${alpha})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  ctx.restore();
}
