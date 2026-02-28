// ===== デッキ管理 =====

export const DECK_SIZE = 30;
export const MAX_COPIES = 3;

// 全カードタイプ定義（IDベース、la/ra直書き、effects/keywords配列）
// cardCategory が未指定のものはすべてユニット
export const CARD_TYPES = [
  // ── 無 ──
  { id: 1,  rank: 1, attribute: null, type: '無種族1', la: 3, ra: 3,
    effects: [], keywords: [] },
  { id: 2,  rank: 2, attribute: null, type: '無種族1', la: 5, ra: 5,
    effects: [], keywords: [] },
  { id: 3,  rank: 3, attribute: null, type: '無種族1', la: 7, ra: 7,
    effects: [], keywords: [] },

  // ── 赤 Rank1 ──
  { id: 4,  rank: 1, attribute: 'red', type: '赤種族1', la: 3, ra: 2,
    effects: [{ type: 'adjEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 5,  rank: 1, attribute: 'red', type: '赤種族1', la: 2, ra: 3,
    effects: [{ type: 'adjEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 6,  rank: 1, attribute: 'red', type: '赤種族1', la: 2, ra: 2,
    effects: [{ type: 'anyEnemy', l: 1, r: 1 }], keywords: [] },
  { id: 7,  rank: 1, attribute: 'red', type: '赤種族1', la: 2, ra: 2,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'playerDamage', amount: 1 } }], keywords: [] },
  { id: 8,  rank: 1, attribute: 'red', type: '赤種族1', la: 1, ra: 1,
    effects: [{ type: 'aoeExSelf', l: 1, r: 1 }], keywords: [] },
  { id: 9,  rank: 1, attribute: 'red', type: '赤種族1', la: 4, ra: 4,
    effects: [], keywords: ['sutemi'] },
  { id: 10, rank: 1, attribute: 'red', type: '赤種族1', la: 4, ra: 2,
    effects: [], keywords: [] },
  { id: 11, rank: 1, attribute: 'red', type: '赤種族1', la: 2, ra: 2,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'boostSelf', l: 1, r: 1 } }], keywords: [] },

  // ── 赤 Rank2 ──
  { id: 12, rank: 2, attribute: 'red', type: '赤種族1', la: 4, ra: 4,
    effects: [{ type: 'adjAll', l: 1, r: 1 }], keywords: [] },
  { id: 13, rank: 2, attribute: 'red', type: '赤種族1', la: 6, ra: 6,
    effects: [], keywords: ['sutemi'] },
  { id: 14, rank: 2, attribute: 'red', type: '赤種族1', la: 3, ra: 3,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'handReset', draw: 1 } }], keywords: [] },
  { id: 15, rank: 2, attribute: 'red', type: '赤種族1', la: 3, ra: 3,
    effects: [{ type: 'anyEnemy', l: 2, r: 2 }], keywords: [] },

  // ── 赤 Rank3 ──
  { id: 16, rank: 3, attribute: 'red', type: '赤種族1', la: 0, ra: 0,
    effects: [{ type: 'colorScale', color: 'red', daScale: [{ min: 4, da: 2 }, { min: 6, da: 3 }, { min: 9, da: 4 }] }], keywords: [] },
  { id: 17, rank: 3, attribute: 'red', type: '赤種族1', la: 9, ra: 9,
    effects: [], keywords: ['sutemi'] },

  // ── 青 Rank1 ──
  { id: 18, rank: 1, attribute: 'blue', type: '青種族1', la: 2, ra: 2, directAttack: 0,
    effects: [{ type: 'draw', count: 1 }], keywords: [] },
  { id: 19, rank: 1, attribute: 'blue', type: '青種族1', la: 2, ra: 2, directAttack: 0,
    effects: [{ type: 'cycle' }], keywords: ['shugo'] },
  { id: 20, rank: 1, attribute: 'blue', type: '青種族1', la: 1, ra: 1,
    effects: [{ type: 'draw', count: 1 }], keywords: ['no_tribute'] },
  { id: 21, rank: 1, attribute: 'blue', type: '青種族1', la: 2, ra: 3,
    effects: [{ type: 'cycle' }], keywords: [] },
  { id: 22, rank: 1, attribute: 'blue', type: '青種族1', la: 3, ra: 2,
    effects: [], keywords: ['shugo'] },
  { id: 23, rank: 1, attribute: 'blue', type: '青種族1', la: 2, ra: 3,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'draw', count: 1 } }], keywords: [] },
  { id: 24, rank: 1, attribute: 'blue', type: '青種族1', la: 1, ra: 1,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'recruit', tribe: '青種族1' } }], keywords: [] },
  { id: 25, rank: 1, attribute: 'blue', type: '青種族1', la: 2, ra: 2,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'boostSelf', l: 1, r: 1 } }], keywords: [] },
  { id: 26, rank: 1, attribute: 'blue', type: '青種族1', la: 3, ra: 3,
    effects: [{ type: 'manaGate', cost: 1, color: null, inner: { type: 'nullifySelf' } }], keywords: ['no_attack'] },

  // ── 青 Rank2 ──
  { id: 27, rank: 2, attribute: 'blue', type: '青種族1', la: 4, ra: 4,
    effects: [{ type: 'cycle' }], keywords: [] },
  { id: 28, rank: 2, attribute: 'blue', type: '青種族1', la: 4, ra: 3,
    effects: [{ type: 'draw', count: 1 }], keywords: [] },
  { id: 29, rank: 2, attribute: 'blue', type: '青種族1', la: 3, ra: 3,
    effects: [{ type: 'recruit', tribe: '青種族2' }], keywords: [] },
  { id: 30, rank: 2, attribute: 'blue', type: '青種族2', la: 5, ra: 4, directAttack: 2,
    effects: [{ type: 'manaGate', cost: 2, color: 'blue', inner: { type: 'enableAura', aura: 'nullify_adj' } }], keywords: [] },

  // ── 青 Rank3 ──
  { id: 31, rank: 3, attribute: 'blue', type: '青種族2', la: 7, ra: 6, directAttack: 3,
    effects: [{ type: 'manaGate', cost: 2, color: 'blue', inner: { type: 'enableAura', aura: 'nullify_own' } }], keywords: [] },

  // ── 緑 Rank1 ──
  { id: 32, rank: 1, attribute: 'green', type: '緑種族1', la: 2, ra: 2,
    effects: [], keywords: [] },
  { id: 33, rank: 1, attribute: 'green', type: '緑種族1', la: 1, ra: 2,
    effects: [], keywords: ['shugo'] },
  { id: 34, rank: 1, attribute: 'green', type: '緑種族1', la: 1, ra: 1,
    effects: [{ type: 'manaGate', cost: 3, color: null, inner: { type: 'recruit', tribe: '緑種族2' } }], keywords: [] },
  { id: 35, rank: 1, attribute: 'green', type: '緑種族1', la: 4, ra: 4,
    effects: [{ type: 'manaGate', cost: 4, color: null, inner: { type: 'nullifySelf' } }], keywords: ['no_attack'] },
  { id: 36, rank: 1, attribute: 'green', type: '緑種族1', la: 6, ra: 6,
    effects: [{ type: 'manaGate', cost: 6, color: null, inner: { type: 'nullifySelf' } }], keywords: ['no_attack', 'no_tribute'] },

  // ── 緑 Rank2 ──
  { id: 37, rank: 2, attribute: 'green', type: '緑種族1', la: 4, ra: 5,
    effects: [{ type: 'manaGate', cost: 2, color: null, inner: { type: 'cycle' } }], keywords: [] },
  { id: 38, rank: 2, attribute: 'green', type: '緑種族1', la: 4, ra: 4,
    effects: [{ type: 'manaGate', cost: 3, color: null, inner: { type: 'draw', count: 1 } }], keywords: [] },

  // ── 緑 Rank3 ──
  { id: 39, rank: 3, attribute: 'green', type: '緑種族1', la: 6, ra: 8, directAttack: 0,
    effects: [], keywords: [] },
  { id: 40, rank: 3, attribute: 'green', type: '緑種族1', la: 5, ra: 6,
    effects: [], keywords: ['dbl_tribute'] },
  { id: 41, rank: 3, attribute: 'green', type: '緑種族2', la: 6, ra: 7, directAttack: 2,
    effects: [], keywords: [] },
  { id: 42, rank: 3, attribute: 'green', type: '緑種族2', la: 7, ra: 7,
    effects: [], keywords: ['double_attack'] },
  { id: 43, rank: 3, attribute: 'green', type: '緑種族2', la: 6, ra: 7,
    effects: [{ type: 'draw', count: 1 }], keywords: [] },
  { id: 44, rank: 3, attribute: 'green', type: '緑種族2', la: 6, ra: 7,
    effects: [{ type: 'manaGate', cost: 1, color: null, inner: { type: 'recruit', tribe: '緑種族2' } }], keywords: [] },
  { id: 45, rank: 3, attribute: 'green', type: '緑種族2', la: 6, ra: 6, directAttack: 3,
    effects: [
      { type: 'manaGate', cost: 3, color: 'green', inner: { type: 'draw', count: 1 } },
      { type: 'manaGate', cost: 3, color: 'green', inner: { type: 'draw', count: 1 } },
      { type: 'manaGate', cost: 3, color: 'green', inner: { type: 'upgradeDa', value: 4, boostL: 3, boostR: 3 } },
    ], keywords: [] },
  { id: 46, rank: 3, attribute: 'green', type: '緑種族2', la: 5, ra: 5, directAttack: 2,
    effects: [{ type: 'manaGate', cost: 6, color: 'green', inner: { type: 'draw', count: 2 } }], keywords: [] },

  // ── 黒 Rank1 ──
  // 腐敗1: 場にある間、両隣のカードに-1/-1を付与
  { id: 47, rank: 1, attribute: 'black', type: '黒種族1', la: 3, ra: 3,
    effects: [], keywords: ['decay_1'] },

  // 豊穣2: 召喚時にデッキトップ2枚を退場済みへ送る
  { id: 48, rank: 1, attribute: 'black', type: '黒種族1', la: 2, ra: 2,
    effects: [{ type: 'bounty', count: 2 }], keywords: [] },

  // 連帯2: 場に同種族（黒種族1）が2体以上いれば1枚ドロー
  { id: 49, rank: 1, attribute: 'black', type: '黒種族1', la: 2, ra: 2,
    effects: [{ type: 'solidarity', count: 2, inner: { type: 'draw', count: 1 } }], keywords: [] },
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
