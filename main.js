const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
const CARD_WIDTH = 110;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.45);
const ANIMATION_DURATION_MS = 150;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const resetButton = document.getElementById('resetButton');

const slotCenters = [180, 330, 480, 630, 780].map((x, index) => ({
  id: index,
  x,
  y: 360,
  occupiedByCardId: null,
}));

const handCenters = [255, 405, 555, 705].map((x) => ({ x, y: 620 }));

let cards = [];
let dragState = null;

function buildInitialCards() {
  cards = handCenters.map((position, index) => ({
    id: index,
    zone: 'hand',
    handIndex: index,
    x: position.x,
    y: position.y,
    isDragging: false,
    animation: null,
    locked: false,
  }));
}

function resetGame() {
  slotCenters.forEach((slot) => {
    slot.occupiedByCardId = null;
  });
  dragState = null;
  buildInitialCards();
}

function startAnimation(card, toX, toY, onComplete) {
  card.animation = {
    fromX: card.x,
    fromY: card.y,
    toX,
    toY,
    startTime: performance.now(),
    durationMs: ANIMATION_DURATION_MS,
    onComplete,
  };
}

function updateAnimations(now) {
  cards.forEach((card) => {
    if (!card.animation) {
      return;
    }

    const { fromX, fromY, toX, toY, startTime, durationMs, onComplete } = card.animation;
    const t = Math.min((now - startTime) / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    card.x = fromX + (toX - fromX) * eased;
    card.y = fromY + (toY - fromY) * eased;

    if (t >= 1) {
      card.x = toX;
      card.y = toY;
      card.animation = null;
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  });
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

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function onPointerDown(event) {
  const point = getCanvasPoint(event);
  const draggableCards = cards.filter((card) => card.zone === 'hand' && !card.animation);

  for (let i = draggableCards.length - 1; i >= 0; i -= 1) {
    const card = draggableCards[i];
    if (!pointInCard(point.x, point.y, card)) {
      continue;
    }

    card.isDragging = true;
    dragState = {
      cardId: card.id,
      offsetX: point.x - card.x,
      offsetY: point.y - card.y,
      originalX: card.x,
      originalY: card.y,
    };
    canvas.setPointerCapture(event.pointerId);
    break;
  }
}

function onPointerMove(event) {
  if (!dragState) {
    return;
  }

  const card = cards.find((item) => item.id === dragState.cardId);
  if (!card || !card.isDragging) {
    return;
  }

  const point = getCanvasPoint(event);
  card.x = point.x - dragState.offsetX;
  card.y = point.y - dragState.offsetY;
}

function onPointerUp(event) {
  if (!dragState) {
    return;
  }

  const card = cards.find((item) => item.id === dragState.cardId);
  if (!card) {
    dragState = null;
    return;
  }

  card.isDragging = false;
  const point = getCanvasPoint(event);
  const targetSlot = slotCenters.find((slot) => pointInSlot(point.x, point.y, slot) && slot.occupiedByCardId === null);

  if (targetSlot) {
    startAnimation(card, targetSlot.x, targetSlot.y, () => {
      card.zone = 'field';
      card.locked = true;
      targetSlot.occupiedByCardId = card.id;
    });
  } else {
    startAnimation(card, dragState.originalX, dragState.originalY, () => {
      card.zone = 'hand';
    });
  }

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (_) {
    // no-op
  }
  dragState = null;
}

function drawTable() {
  ctx.fillStyle = '#1d2f4f';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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

  ctx.fillStyle = '#d6e0f4';
  ctx.font = '16px sans-serif';
  ctx.fillText('FIELD (max 5)', 20, 40);
  ctx.fillText('YOUR HAND (4)', 20, 690);
}

function drawCards() {
  const ordered = [...cards].sort((a, b) => (a.isDragging ? 1 : b.isDragging ? -1 : a.id - b.id));

  ordered.forEach((card) => {
    const left = card.x - CARD_WIDTH / 2;
    const top = card.y - CARD_HEIGHT / 2;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;

    ctx.fillRect(left, top, CARD_WIDTH, CARD_HEIGHT);
    ctx.strokeRect(left, top, CARD_WIDTH, CARD_HEIGHT);

    ctx.fillStyle = '#111111';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`CARD ${card.id + 1}`, left + 14, top + 28);

    ctx.font = '12px sans-serif';
    const zoneText = card.zone === 'field' ? 'FIELD' : 'HAND';
    ctx.fillText(zoneText, left + 14, top + CARD_HEIGHT - 14);
  });
}

function draw() {
  drawTable();
  drawCards();
}

function loop(now) {
  updateAnimations(now);
  draw();
  requestAnimationFrame(loop);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
resetButton.addEventListener('click', resetGame);

resetGame();
requestAnimationFrame(loop);
