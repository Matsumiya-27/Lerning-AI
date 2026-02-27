// ===== デッキビルダー UI =====
import {
  CARD_TYPES, DECK_SIZE, MAX_COPIES,
  deckState, buildSampleDeck,
  getCardTypeCount, addCardToDeck, removeCardFromDeck,
  getCardStats,
} from './deck.js';

// ── 表示用定数（render.js と統一） ──
const EFFECT_JP = {
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
  draw1:        'カードを1枚引く',
};

const EFFECT_COLOR = {
  rush:         '#666666',
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
  draw1:        '#8060e0',
};

const RANK_BG     = { 1: '#1a2e4a', 2: '#1a3a38', 3: '#2e1a50' };
const RANK_BORDER = { 1: '#2a5090', 2: '#1a6060', 3: '#5020a0' };

// ── 固定スタッツ表示文字列 ──
function getDisplayStats(rank, effect) {
  const s = getCardStats(rank, effect);
  return `${s.l} / ${s.r}`;
}

function getTotalLabel(rank, effect) {
  const s = getCardStats(rank, effect);
  return String(s.l + s.r);
}

// ── カード要素の生成 ──
// onAdd: 左クリック・左スワイプ時、onRemove: 右クリック・右スワイプ時
function createCardEl(rank, effect, onAdd, onRemove, cardCategory = 'unit') {
  const isSpell = cardCategory === 'spell';
  const div = document.createElement('div');
  div.className = 'db-card';

  if (isSpell) {
    div.style.background = '#1e1040';
    div.style.border = '2px solid #5030a0';
  } else {
    div.style.background = RANK_BG[rank];
    div.style.border = `2px solid ${RANK_BORDER[rank]}`;
  }

  const rankLabel = document.createElement('div');
  rankLabel.className = 'db-card-rank';
  if (isSpell) {
    rankLabel.textContent = 'スペル';
    rankLabel.style.color = '#a080ff';
  } else {
    rankLabel.textContent = `RANK ${rank}`;
  }
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

  if (isSpell) {
    // スペルは発動条件のRankと「LA/RA なし」を表示
    const condDiv = document.createElement('div');
    condDiv.className = 'db-card-stats';
    condDiv.textContent = `発動:${rank}`;
    condDiv.style.color = '#ffdd88';
    div.appendChild(condDiv);
  } else {
    const statsDiv = document.createElement('div');
    statsDiv.className = 'db-card-stats';
    statsDiv.textContent = getDisplayStats(rank, effect);
    div.appendChild(statsDiv);

    const totalDiv = document.createElement('div');
    totalDiv.className = 'db-card-total';
    totalDiv.textContent = `合計 ${getTotalLabel(rank, effect)}`;
    div.appendChild(totalDiv);
  }

  // スワイプ検出用
  let swipeStartX = null;
  let swipeStartY = null;
  let swipeHandled = false;

  div.addEventListener('pointerdown', (e) => {
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeHandled = false;
    e.stopPropagation();
  });

  div.addEventListener('pointerup', (e) => {
    if (swipeStartX === null) return;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    // 水平方向30px以上、かつ水平成分が垂直成分より大きい場合はスワイプと判定
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      swipeHandled = true;
      if (dx < 0 && onAdd) onAdd();        // 左スワイプ＝追加
      else if (dx > 0 && onRemove) onRemove(); // 右スワイプ＝削除
    }
    swipeStartX = null;
  });

  // 左クリック＝追加
  div.addEventListener('click', () => {
    if (swipeHandled) { swipeHandled = false; return; }
    if (onAdd) onAdd();
  });

  // 右クリック＝削除
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (onRemove) onRemove();
  });

  return div;
}

// ── ソート状態 ──
let sortOrder = 'asc'; // 'asc' | 'desc'

// ── パネル描画 ──
function renderDeckPanel() {
  const grid   = document.getElementById('db-deck-grid');
  const header = document.getElementById('db-deck-header');
  if (!grid || !header) return;
  grid.innerHTML = '';

  const count = deckState.cards.length;
  const r1 = deckState.cards.filter((c) => c.rank === 1).length;
  const r2 = deckState.cards.filter((c) => c.rank === 2).length;
  const r3 = deckState.cards.filter((c) => c.rank === 3).length;
  header.innerHTML = `デッキ（${count} / ${DECK_SIZE}）<br><span class="db-rank-counts">R1: ${r1}枚　R2: ${r2}枚　R3: ${r3}枚</span>`;
  header.style.color = count === DECK_SIZE ? '#6de38c' : '#ffd24a';

  // ランク → effect の文字列順でソート
  const sorted = [...deckState.cards].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.effect ?? '') < (b.effect ?? '') ? -1 : 1;
  });

  sorted.forEach(({ rank, effect, cardCategory }) => {
    const onAdd = () => {
      if (getCardTypeCount(rank, effect) < MAX_COPIES && deckState.cards.length < DECK_SIZE) {
        addCardToDeck(rank, effect);
        refresh();
      }
    };
    const onRemove = () => {
      removeCardFromDeck(rank, effect);
      refresh();
    };
    const el = createCardEl(rank, effect, onAdd, onRemove, cardCategory ?? 'unit');
    el.title = '左クリック/左スワイプ：追加　右クリック/右スワイプ：削除';
    grid.appendChild(el);
  });
}

function renderCollectionPanel() {
  const grid = document.getElementById('db-collection-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // ソート順に応じてカードタイプ一覧を並び替え
  const types = [...CARD_TYPES].sort((a, b) => {
    const rankDiff = sortOrder === 'asc' ? a.rank - b.rank : b.rank - a.rank;
    if (rankDiff !== 0) return rankDiff;
    return (a.effect ?? '') < (b.effect ?? '') ? -1 : 1;
  });

  types.forEach(({ rank, effect, cardCategory }) => {
    const copiesInDeck = getCardTypeCount(rank, effect);
    const deckFull     = deckState.cards.length >= DECK_SIZE;
    const maxReached   = copiesInDeck >= MAX_COPIES;
    const canAdd       = !deckFull && !maxReached;
    const canRemove    = copiesInDeck > 0;

    const onAdd    = canAdd    ? () => { addCardToDeck(rank, effect);    refresh(); } : null;
    const onRemove = canRemove ? () => { removeCardFromDeck(rank, effect); refresh(); } : null;

    const el = createCardEl(rank, effect, onAdd, onRemove, cardCategory ?? 'unit');

    // コピー数バッジ（右下）
    const badge = document.createElement('div');
    badge.className = 'db-card-badge';
    badge.textContent = copiesInDeck;
    badge.style.color = copiesInDeck > 0 ? '#fff' : '#556';
    badge.style.borderColor = copiesInDeck >= MAX_COPIES ? '#e0a000' : '#3a5a90';
    el.appendChild(badge);

    // 追加も削除もできない場合は薄く表示
    if (!canAdd && !canRemove) {
      el.style.opacity = '0.35';
      el.style.cursor  = 'default';
    } else if (!canAdd) {
      el.style.opacity = '0.65';
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

// ソートボタンのハイライトを更新
function updateSortButtons() {
  const ascBtn  = document.getElementById('db-sort-asc');
  const descBtn = document.getElementById('db-sort-desc');
  if (!ascBtn || !descBtn) return;
  ascBtn.style.background  = sortOrder === 'asc'  ? '#2a4060' : '#192436';
  descBtn.style.background = sortOrder === 'desc' ? '#2a4060' : '#192436';
}

function refresh() {
  renderDeckPanel();
  renderCollectionPanel();
  renderCountBar();
  updateSortButtons();
}

// ── 外部 API ──

export function openDeckBuilder() {
  refresh();

  // ランダム構築ボタン
  const resetBtn = document.getElementById('db-reset-btn');
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', () => {
      deckState.cards = buildSampleDeck();
      refresh();
    });
  }

  // ソートボタン
  const sortAscBtn  = document.getElementById('db-sort-asc');
  const sortDescBtn = document.getElementById('db-sort-desc');
  if (sortAscBtn && !sortAscBtn.dataset.bound) {
    sortAscBtn.dataset.bound = '1';
    sortAscBtn.addEventListener('click', () => {
      sortOrder = 'asc';
      refresh();
    });
  }
  if (sortDescBtn && !sortDescBtn.dataset.bound) {
    sortDescBtn.dataset.bound = '1';
    sortDescBtn.addEventListener('click', () => {
      sortOrder = 'desc';
      refresh();
    });
  }
}
