// ===== デッキ管理 =====

export const DECK_SIZE = 30;
export const MAX_COPIES = 3;

// 全20種のカードタイプ定義（rank + effect の組み合わせ）
export const CARD_TYPES = [
  // ── RANK 1 ──
  { rank: 1, effect: null },
  { rank: 1, effect: 'rush' },
  { rank: 1, effect: 'edge1' },
  { rank: 1, effect: 'doubleblade' },
  { rank: 1, effect: 'weakaura' },
  { rank: 1, effect: 'offering' },
  // ── RANK 2 ──
  { rank: 2, effect: null },
  { rank: 2, effect: 'pierce' },
  { rank: 2, effect: 'strike2' },
  { rank: 2, effect: 'edge2' },
  { rank: 2, effect: 'swap' },
  { rank: 2, effect: 'doubleblade' },
  { rank: 2, effect: 'deathcurse' },
  // ── RANK 3 ──
  { rank: 3, effect: null },
  { rank: 3, effect: 'revenge' },
  { rank: 3, effect: 'strike3' },
  { rank: 3, effect: 'edgewin' },
  { rank: 3, effect: 'doublecenter' },
  { rank: 3, effect: 'steal' },
  { rank: 3, effect: 'harakiri' },
];

// デッキ状態（セッション永続・ゲームリセットをまたいで保持）
export const deckState = {
  cards: [], // { rank, effect }[] 最大 DECK_SIZE 枚
};

// ランク内でランダムに枚数を割り振るヘルパー
function fillRankRandom(types, total) {
  const counts = new Array(types.length).fill(0);
  let remaining = total;
  let attempts = 0;
  while (remaining > 0 && attempts < 100000) {
    const i = Math.floor(Math.random() * types.length);
    if (counts[i] < MAX_COPIES) {
      counts[i] += 1;
      remaining -= 1;
    }
    attempts += 1;
  }
  const result = [];
  types.forEach((type, i) => {
    for (let j = 0; j < counts[i]; j += 1) {
      result.push({ rank: type.rank, effect: type.effect });
    }
  });
  return result;
}

// サンプルデッキ生成（R1×15, R2×8, R3×7、各種ランダム配分）
export function buildSampleDeck() {
  const r1 = CARD_TYPES.filter((t) => t.rank === 1);
  const r2 = CARD_TYPES.filter((t) => t.rank === 2);
  const r3 = CARD_TYPES.filter((t) => t.rank === 3);
  return [
    ...fillRankRandom(r1, 15),
    ...fillRankRandom(r2, 8),
    ...fillRankRandom(r3, 7),
  ];
}

// デッキを初期化（起動時に1度だけ呼ぶ）
export function initDeck() {
  deckState.cards = buildSampleDeck();
}

// ─── デッキ操作 ───

export function getCardTypeCount(rank, effect) {
  return deckState.cards.filter((c) => c.rank === rank && c.effect === effect).length;
}

export function addCardToDeck(rank, effect) {
  if (deckState.cards.length >= DECK_SIZE) return false;
  if (getCardTypeCount(rank, effect) >= MAX_COPIES) return false;
  deckState.cards.push({ rank, effect });
  return true;
}

export function removeCardFromDeck(rank, effect) {
  for (let i = deckState.cards.length - 1; i >= 0; i -= 1) {
    if (deckState.cards[i].rank === rank && deckState.cards[i].effect === effect) {
      deckState.cards.splice(i, 1);
      return true;
    }
  }
  return false;
}

// ── 固定スタッツ定義 ──
// 同じ種類のカードは常に同じ左右攻撃力を持つ（ランダムなし）
export const FIXED_CARD_STATS = {
  null:         { 1: { l: 3, r: 3 }, 2: { l: 4, r: 4 }, 3: { l: 6, r: 6 } },
  rush:         { 1: { l: 2, r: 2 } },
  edge1:        { 1: { l: 3, r: 2 } },
  doubleblade:  { 1: { l: 2, r: 3 }, 2: { l: 3, r: 4 } },
  weakaura:     { 1: { l: 2, r: 2 } },
  offering:     { 1: { l: 3, r: 3 } },
  pierce:       { 2: { l: 3, r: 4 } },
  strike2:      { 2: { l: 3, r: 3 } },
  edge2:        { 2: { l: 4, r: 3 } },
  swap:         { 2: { l: 4, r: 3 } },
  deathcurse:   { 2: { l: 4, r: 3 } },
  revenge:      { 3: { l: 4, r: 6 } },
  strike3:      { 3: { l: 6, r: 4 } },
  edgewin:      { 3: { l: 6, r: 5 } },
  doublecenter: { 3: { l: 6, r: 5 } },
  steal:        { 3: { l: 4, r: 6 } },
  harakiri:     { 3: { l: 7, r: 7 } },
};

// rank と effect を受け取り { l, r } を返す
export function getCardStats(rank, effect) {
  const key = effect ?? 'null';
  const byRank = FIXED_CARD_STATS[key];
  if (!byRank) return { l: 3, r: 3 };
  const stats = byRank[rank];
  if (!stats) return { l: 3, r: 3 };
  return stats;
}

// デッキをシャッフルしたコピーを返す（deckState 自体は変更しない）
export function shuffleDeck() {
  const arr = [...deckState.cards];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
