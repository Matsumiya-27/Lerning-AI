// ===== デッキビルダー UI =====
import {
  CARD_TYPES, DECK_SIZE, MAX_COPIES,
  deckState, buildSampleDeck,
  getCardTypeCount, addCardToDeck, removeCardFromDeck,
} from './deck.js';

// ── 属性カラーマップ（render.js と統一） ──
const ATTR_COLOR = {
  red:   '#c82020',
  blue:  '#2060c8',
  green: '#20a040',
  black: '#5a5a5a',
  white: '#c0b870',
  null:  '#5a6080',
};
const ATTR_BORDER = {
  red:   '#7a1010',
  blue:  '#103880',
  green: '#105020',
  black: '#181818',
  white: '#706840',
  null:  '#323650',
};
const ATTR_JP = {
  red: '赤', blue: '青', green: '緑', black: '黒', white: '白', null: '無',
};

// ── 効果テキスト自動生成 ──
function effectDisplayText(eff) {
  if (!eff) return '';
  switch (eff.type) {
    case 'adjEnemy':     return `隣接する敵1体に${eff.l}/${eff.r}`;
    case 'anyEnemy':     return `敵1体に${eff.l}/${eff.r}`;
    case 'aoeExSelf':    return `全体に${eff.l}/${eff.r}（自己除く）`;
    case 'adjAll':       return `両隣に${eff.l}/${eff.r}`;
    case 'manaGate':     return `[${eff.cost}マナ]${effectDisplayText(eff.inner)}`;
    case 'playerDamage': return `相手に${eff.amount}ダメージ`;
    case 'boostSelf':    return `自身+${eff.l}/+${eff.r}`;
    case 'handReset':    return `手札捨て+${eff.draw}ドロー`;
    case 'colorScale':   return `X/X(${ATTR_JP[eff.color] ?? eff.color}マナ=X)`;
    default: return eff.type;
  }
}

const KW_JP    = { sutoemi: '捨身' };
const KW_COLOR = { sutoemi: '#cc0000' };

// ── 固定スタッツ表示文字列（la/ra 直参照） ──
function getDisplayStats(cardType) {
  return `${cardType.la} / ${cardType.ra}`;
}

function getTotalLabel(cardType) {
  return String(cardType.la + cardType.ra);
}

// ── カード要素の生成 ──
// onAdd: 左クリック・左スワイプ時、onRemove: 右クリック・右スワイプ時
function createCardEl(cardType, onAdd, onRemove) {
  const { rank, attribute, la, ra, effects = [], keywords = [], cardCategory } = cardType;
  const isSpell = cardCategory === 'spell';
  const attrKey = attribute ?? 'null';

  const div = document.createElement('div');
  div.className = 'db-card';

  if (isSpell) {
    div.style.background = '#1e1040';
    div.style.border = '2px solid #5030a0';
  } else {
    // 属性の暗色枠 + 薄属性オーバーレイ
    const base = '#1a2030';
    div.style.background = base;
    div.style.border = `2px solid ${ATTR_BORDER[attrKey] ?? ATTR_BORDER.null}`;
    div.style.position = 'relative';
    div.style.overflow = 'hidden';
    // 属性色オーバーレイを ::before 風に疑似実装（inline style で）
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:absolute;inset:0;background:${ATTR_COLOR[attrKey] ?? ATTR_COLOR.null};opacity:0.14;pointer-events:none;`;
    div.appendChild(overlay);
  }

  const rankLabel = document.createElement('div');
  rankLabel.className = 'db-card-rank';
  if (isSpell) {
    rankLabel.textContent = 'スペル';
    rankLabel.style.color = '#a080ff';
  } else {
    rankLabel.textContent = `RANK ${rank}`;
    rankLabel.style.color = ATTR_COLOR[attrKey] ?? '#8aafdd';
  }
  div.appendChild(rankLabel);

  const effectLabel = document.createElement('div');
  effectLabel.className = 'db-card-effect';
  if (effects.length > 0) {
    effectLabel.textContent = effectDisplayText(effects[0]);
    effectLabel.style.color = ATTR_COLOR[attrKey] ?? '#aaa';
  } else if (keywords.length > 0) {
    effectLabel.textContent = keywords.map((k) => KW_JP[k] ?? k).join(' ');
    effectLabel.style.color = KW_COLOR[keywords[0]] ?? '#cc4444';
  } else {
    effectLabel.textContent = '─';
    effectLabel.style.color = '#5a7aaa';
  }
  div.appendChild(effectLabel);

  if (isSpell) {
    const condDiv = document.createElement('div');
    condDiv.className = 'db-card-stats';
    condDiv.textContent = `発動:${rank}`;
    condDiv.style.color = '#ffdd88';
    div.appendChild(condDiv);
  } else {
    const statsDiv = document.createElement('div');
    statsDiv.className = 'db-card-stats';
    statsDiv.textContent = getDisplayStats(cardType);
    div.appendChild(statsDiv);

    const totalDiv = document.createElement('div');
    totalDiv.className = 'db-card-total';
    totalDiv.textContent = `合計 ${getTotalLabel(cardType)}`;
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
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      swipeHandled = true;
      if (dx < 0 && onAdd) onAdd();
      else if (dx > 0 && onRemove) onRemove();
    }
    swipeStartX = null;
  });

  div.addEventListener('click', () => {
    if (swipeHandled) { swipeHandled = false; return; }
    if (onAdd) onAdd();
  });

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
  const r1 = deckState.cards.filter((c) => {
    const t = CARD_TYPES.find((ct) => ct.id === c.typeId);
    return t && t.rank === 1;
  }).length;
  const r2 = deckState.cards.filter((c) => {
    const t = CARD_TYPES.find((ct) => ct.id === c.typeId);
    return t && t.rank === 2;
  }).length;
  const r3 = deckState.cards.filter((c) => {
    const t = CARD_TYPES.find((ct) => ct.id === c.typeId);
    return t && t.rank === 3;
  }).length;
  header.innerHTML = `デッキ（${count} / ${DECK_SIZE}）<br><span class="db-rank-counts">R1: ${r1}枚　R2: ${r2}枚　R3: ${r3}枚</span>`;
  header.style.color = count === DECK_SIZE ? '#6de38c' : '#ffd24a';

  // ランク → id 順でソート
  const sorted = [...deckState.cards].sort((a, b) => {
    const ta = CARD_TYPES.find((ct) => ct.id === a.typeId);
    const tb = CARD_TYPES.find((ct) => ct.id === b.typeId);
    if (!ta || !tb) return 0;
    if (ta.rank !== tb.rank) return ta.rank - tb.rank;
    return ta.id - tb.id;
  });

  sorted.forEach(({ typeId }) => {
    const cardType = CARD_TYPES.find((ct) => ct.id === typeId);
    if (!cardType) return;
    const onAdd = () => {
      if (getCardTypeCount(typeId) < MAX_COPIES && deckState.cards.length < DECK_SIZE) {
        addCardToDeck(typeId);
        refresh();
      }
    };
    const onRemove = () => {
      removeCardFromDeck(typeId);
      refresh();
    };
    const el = createCardEl(cardType, onAdd, onRemove);
    el.title = '左クリック/左スワイプ：追加　右クリック/右スワイプ：削除';
    grid.appendChild(el);
  });
}

function renderCollectionPanel() {
  const grid = document.getElementById('db-collection-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // ソート順: ユニット先（スペルを後ろに）、同カテゴリ内は Rank 昇/降、同 Rank は id 順
  const types = [...CARD_TYPES].sort((a, b) => {
    const aSpell = a.cardCategory === 'spell';
    const bSpell = b.cardCategory === 'spell';
    if (aSpell !== bSpell) return aSpell ? 1 : -1;
    const rd = sortOrder === 'asc' ? a.rank - b.rank : b.rank - a.rank;
    return rd !== 0 ? rd : a.id - b.id;
  });

  types.forEach((cardType) => {
    const { id } = cardType;
    const copiesInDeck = getCardTypeCount(id);
    const deckFull     = deckState.cards.length >= DECK_SIZE;
    const maxReached   = copiesInDeck >= MAX_COPIES;
    const canAdd       = !deckFull && !maxReached;
    const canRemove    = copiesInDeck > 0;

    const onAdd    = canAdd    ? () => { addCardToDeck(id);    refresh(); } : null;
    const onRemove = canRemove ? () => { removeCardFromDeck(id); refresh(); } : null;

    const el = createCardEl(cardType, onAdd, onRemove);

    // コピー数バッジ（右下）
    const badge = document.createElement('div');
    badge.className = 'db-card-badge';
    badge.textContent = copiesInDeck;
    badge.style.color = copiesInDeck > 0 ? '#fff' : '#556';
    badge.style.borderColor = copiesInDeck >= MAX_COPIES ? '#e0a000' : '#3a5a90';
    el.appendChild(badge);

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
