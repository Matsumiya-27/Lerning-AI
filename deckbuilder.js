// ===== デッキビルダー UI =====
import {
  CARD_TYPES, DECK_SIZE, MAX_COPIES,
  deckState, buildSampleDeck,
  getCardTypeCount, addCardToDeck, removeCardFromDeck,
} from './deck.js';
import { EFFECT_RANK_TOTAL, PLAIN_RANK_TOTAL } from './constants.js';

// ── 表示用定数（render.js と統一） ──
const EFFECT_JP = {
  rush:         '召喚即攻撃可',
  pierce:       '超過ダメージ',
  revenge:      '撃破時に反撃',
  strike2:      '2回連続攻撃',
  strike3:      '3回連続攻撃',
  edge1:        '端で攻撃+1',
  edge2:        '端で攻撃+2',
  edgewin:      '端で必ず勝つ',
  swap:         '隣を入れ替え',
  doublecenter: '両隣を同時攻撃',
  doubleblade:  '諸刃の剣',
  weakaura:     '隣の敵を弱体化',
  offering:     '相手に贈与可',
  steal:        '隣の敵を奪取',
  deathcurse:   '破壊時に呪い',
  harakiri:     '全カード破壊',
};

const EFFECT_COLOR = {
  rush:         '#2ca44e',
  pierce:       '#c8a000',
  revenge:      '#9040d0',
  strike2:      '#e05020',
  strike3:      '#ff2800',
  edge1:        '#1a80d0',
  edge2:        '#0050ff',
  edgewin:      '#00b8e0',
  swap:         '#c07800',
  doublecenter: '#b000b0',
  doubleblade:  '#c04000',
  weakaura:     '#20a080',
  offering:     '#8060e0',
  steal:        '#e0a000',
  deathcurse:   '#702090',
  harakiri:     '#cc0000',
};

const RANK_BG     = { 1: '#1a2e4a', 2: '#1a3a38', 3: '#2e1a50' };
const RANK_BORDER = { 1: '#2a5090', 2: '#1a6060', 3: '#5020a0' };

// ── スタッツ表示文字列 ──
const REDUCED_EFFECTS = new Set(['rush', 'weakaura', 'pierce', 'strike2', 'revenge', 'strike3', 'steal']);
const SYMMETRIC_EFFECTS = new Set(['rush', 'weakaura', 'offering', 'strike2', 'harakiri']);

function getDisplayStats(rank, effect) {
  if (effect === 'harakiri') return '7 / 7';
  if (effect === null || effect === 'offering') {
    const h = PLAIN_RANK_TOTAL[rank] / 2;
    return `${h} / ${h}`;
  }
  if (SYMMETRIC_EFFECTS.has(effect)) {
    const h = EFFECT_RANK_TOTAL[rank] / 2;
    return `${h} / ${h}`;
  }
  // ランダム範囲
  if (rank === 1) return '2〜3 / 3〜2';
  if (rank === 2) return '3〜4 / 4〜3';
  if (REDUCED_EFFECTS.has(effect)) return '4〜6 / 6〜4';
  return '5〜6 / 6〜5';
}

function getTotalLabel(rank, effect) {
  if (effect === 'harakiri') return '14';
  if (effect === null || effect === 'offering') return String(PLAIN_RANK_TOTAL[rank]);
  if (REDUCED_EFFECTS.has(effect)) return String(EFFECT_RANK_TOTAL[rank]);
  const base = [0, 5, 7, 11][rank];
  return String(base);
}

// ── カード要素の生成 ──
function createCardEl(rank, effect, onClick) {
  const div = document.createElement('div');
  div.className = 'db-card';
  div.style.background = RANK_BG[rank];
  div.style.border = `2px solid ${RANK_BORDER[rank]}`;

  const rankLabel = document.createElement('div');
  rankLabel.className = 'db-card-rank';
  rankLabel.textContent = `RANK ${rank}`;
  div.appendChild(rankLabel);

  const effectLabel = document.createElement('div');
  effectLabel.className = 'db-card-effect';
  if (effect) {
    effectLabel.textContent = EFFECT_JP[effect] || effect;
    effectLabel.style.color = EFFECT_COLOR[effect] || '#aaa';
  } else {
    effectLabel.textContent = '─';
    effectLabel.style.color = '#5a7aaa';
  }
  div.appendChild(effectLabel);

  const statsDiv = document.createElement('div');
  statsDiv.className = 'db-card-stats';
  statsDiv.textContent = getDisplayStats(rank, effect);
  div.appendChild(statsDiv);

  const totalDiv = document.createElement('div');
  totalDiv.className = 'db-card-total';
  totalDiv.textContent = `合計 ${getTotalLabel(rank, effect)}`;
  div.appendChild(totalDiv);

  if (onClick) {
    div.addEventListener('click', onClick);
    div.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  return div;
}

// ── パネル描画 ──
function renderDeckPanel() {
  const grid   = document.getElementById('db-deck-grid');
  const header = document.getElementById('db-deck-header');
  if (!grid || !header) return;
  grid.innerHTML = '';

  const count = deckState.cards.length;
  header.textContent = `デッキ（${count} / ${DECK_SIZE}）`;
  header.style.color  = count === DECK_SIZE ? '#6de38c' : '#ffd24a';

  // ランク → effect の文字列順でソート
  const sorted = [...deckState.cards].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.effect ?? '') < (b.effect ?? '') ? -1 : 1;
  });

  sorted.forEach(({ rank, effect }) => {
    const el = createCardEl(rank, effect, () => {
      removeCardFromDeck(rank, effect);
      refresh();
    });
    el.title = 'クリックで取り除く';
    grid.appendChild(el);
  });
}

function renderCollectionPanel() {
  const grid = document.getElementById('db-collection-grid');
  if (!grid) return;
  grid.innerHTML = '';

  CARD_TYPES.forEach(({ rank, effect }) => {
    const copiesInDeck = getCardTypeCount(rank, effect);
    const deckFull     = deckState.cards.length >= DECK_SIZE;
    const maxReached   = copiesInDeck >= MAX_COPIES;
    const canAdd       = !deckFull && !maxReached;

    const el = createCardEl(rank, effect, canAdd ? () => {
      addCardToDeck(rank, effect);
      refresh();
    } : null);

    // コピー数バッジ（右下）
    const badge = document.createElement('div');
    badge.className = 'db-card-badge';
    badge.textContent = copiesInDeck;
    badge.style.color = copiesInDeck > 0 ? '#fff' : '#556';
    badge.style.borderColor = copiesInDeck >= MAX_COPIES ? '#e0a000' : '#3a5a90';
    el.appendChild(badge);

    if (!canAdd) {
      el.style.opacity = maxReached ? '0.38' : '0.65';
      el.style.cursor  = 'default';
    }

    grid.appendChild(el);
  });
}

function renderCountBar() {
  const label = document.getElementById('db-count-label');
  if (!label) return;
  const n = deckState.cards.length;
  label.textContent = `${n} / ${DECK_SIZE} 枚`;
  label.style.color = n === DECK_SIZE ? '#6de38c' : '#ffd24a';
}

function refresh() {
  renderDeckPanel();
  renderCollectionPanel();
  renderCountBar();
}

// ── 外部 API ──

export function openDeckBuilder() {
  refresh();

  // サンプルデッキに戻すボタン
  const resetBtn = document.getElementById('db-reset-btn');
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', () => {
      deckState.cards = buildSampleDeck();
      refresh();
    });
  }
}
