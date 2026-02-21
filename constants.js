// ===== 定数 =====
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 720;
export const CARD_WIDTH = 110;
export const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.45);

export const MOVE_ANIMATION_MS = 150;
export const SWIPE_THRESHOLD = 50;
export const SHAKE_DURATION_MS = 260;
export const HIT_FLASH_MS = 120;
export const DESTROY_ANIMATION_MS = 150;

export const STARTING_HAND = 4;
export const MIN_HAND_AFTER_DRAW = 4;
export const MAX_HAND = 9;
export const STARTING_HP = 10;
export const MAX_RANK = 3;
export const MAX_FIELD_SLOTS = 5;
export const TURN_BANNER_MS = 900;
export const ENEMY_AUTO_END_MS = 850;
export const ENEMY_ACTION_DELAY_MS = 540;
export const COIN_TOSS_MS = 500;
export const COIN_RESULT_WOBBLE_MS = 500;
export const FIRST_PLAYER_BANNER_MS = 2000;
export const FIRST_PLAYER_READY_DELAY_MS = 220;
export const NO_ACTION_AUTO_END_DELAY_MS = 480;
export const DIRECT_ATTACK_HIT_MS = 190;

export const END_TURN_UI = {
  x: 878,
  y: 360,
  radius: 48,
};

// ランクごとの片側攻撃値の最大値（合計値 - 最大値 が最小値になる）
// R1: 2-3, R2: 3-4, R3: 4-6
export const RANK_ATTACK_MAX = { 1: 3, 2: 4, 3: 6 };

// 効果カードの合計攻撃力（標準より1低い。効果がその分を補う）
// R1 rush: 4, R2 pierce: 6, R3 revenge: 9
export const EFFECT_RANK_TOTAL = { 1: 4, 2: 6, 3: 9 };
