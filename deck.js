// ===== デッキ管理 =====

export const DECK_SIZE = 30;
export const MAX_COPIES = 3;

// 全カードタイプ定義（IDベース、la/ra直書き、effects/keywords配列）
// cardCategory が未指定のものはすべてユニット
export const CARD_TYPES = [
  // ── 無 ──
  { id: 1,  rank: 1, attribute: null, la: 3, ra: 3,
    effects: [], keywords: [] },
  { id: 2,  rank: 2, attribute: null, la: 5, ra: 5,
    effects: [], keywords: [] },
  { id: 3,  rank: 3, attribute: null, la: 7, ra: 7,
    effects: [], keywords: [] },

  // ── 赤 Rank1 ──
  { id: 4,  rank: 1, attribute: 'red', la: 3, ra: 2,
    effects: [{ type: 'adjEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 5,  rank: 1, attribute: 'red', la: 2, ra: 3,
    effects: [{ type: 'adjEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 6,  rank: 1, attribute: 'red', la: 2, ra: 2,
    effects: [{ type: 'anyEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 7,  rank: 1, attribute: 'red', la: 2, ra: 2,
    effects: [{ type: 'manaGate', cost: 2, inner: { type: 'playerDamage', amount: 1 } }], keywords: [] },
  { id: 8,  rank: 1, attribute: 'red', la: 1, ra: 1,
    effects: [{ type: 'aoeExSelf', l: 1, r: 1 }], keywords: [] },
  { id: 9,  rank: 1, attribute: 'red', la: 4, ra: 4,
    effects: [], keywords: ['sutoemi'] },
  { id: 10, rank: 1, attribute: 'red', la: 4, ra: 2,
    effects: [], keywords: [] },
  { id: 11, rank: 1, attribute: 'red', la: 2, ra: 2,
    effects: [{ type: 'manaGate', cost: 2, inner: { type: 'boostSelf', l: 1, r: 1 } }], keywords: [] },

  // ── 赤 Rank2 ──
  { id: 12, rank: 2, attribute: 'red', la: 4, ra: 4,
    effects: [{ type: 'adjAll', l: 1, r: 1 }], keywords: [] },
  { id: 13, rank: 2, attribute: 'red', la: 6, ra: 6,
    effects: [], keywords: ['sutoemi'] },
  { id: 14, rank: 2, attribute: 'red', la: 3, ra: 3,
    effects: [{ type: 'manaGate', cost: 2, inner: { type: 'handReset', draw: 1 } }], keywords: [] },
  { id: 15, rank: 2, attribute: 'red', la: 3, ra: 3,
    effects: [{ type: 'anyEnemy', l: 2, r: 2 }], keywords: [] },

  // ── 赤 Rank3 ──
  { id: 16, rank: 3, attribute: 'red', la: 0, ra: 0,
    effects: [{ type: 'colorScale', color: 'red', daScale: [{ min: 4, da: 2 }, { min: 6, da: 3 }, { min: 9, da: 4 }] }], keywords: [] },
  { id: 17, rank: 3, attribute: 'red', la: 9, ra: 9,
    effects: [], keywords: ['sutoemi'] },
];

// デッキ状態（セッション永続・ゲームリセットをまたいで保持）
export const deckState = {
  cards: [], // { typeId }[] 最大 DECK_SIZE 枚
};

// ── カードタイプ取得 ──

export function getCardType(typeId) {
  return CARD_TYPES.find((t) => t.id === typeId) ?? null;
}

// ── デッキ操作 ──

export function getCardTypeCount(typeId) {
  return deckState.cards.filter((c) => c.typeId === typeId).length;
}

export function addCardToDeck(typeId) {
  if (deckState.cards.length >= DECK_SIZE) return false;
  if (getCardTypeCount(typeId) >= MAX_COPIES) return false;
  deckState.cards.push({ typeId });
  return true;
}

export function removeCardFromDeck(typeId) {
  for (let i = deckState.cards.length - 1; i >= 0; i -= 1) {
    if (deckState.cards[i].typeId === typeId) {
      deckState.cards.splice(i, 1);
      return true;
    }
  }
  return false;
}

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
      result.push({ typeId: type.id });
    }
  });
  return result;
}

// サンプルデッキ生成: R1×15 + R2×8 + R3×7 = 30
export function buildSampleDeck() {
  const units = CARD_TYPES.filter((t) => t.cardCategory !== 'spell');
  const r1 = units.filter((t) => t.rank === 1);
  const r2 = units.filter((t) => t.rank === 2);
  const r3 = units.filter((t) => t.rank === 3);
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
