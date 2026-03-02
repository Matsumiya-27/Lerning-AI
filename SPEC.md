# Canvas Card Game MVP Spec

## 1. Screen
- Internal game coordinate size: **960 x 720** (4:3).
- Display is responsive: the canvas is scaled to fit the viewport while preserving the 4:3 aspect ratio.
- Layout:
  - Near side (bottom): player's hand (4 cards).
  - Middle: field slots (5 dashed slots, evenly spaced, horizontal).
  - Right side: debug reset button (outside canvas).
  - Turn control: a **circular** `END TURN` button rendered inside canvas (right-center).

## 2. Visual
- Cards are simple white rectangles.
- Card aspect ratio is approximately **1.45:1** (height:width).

## 3. Behavior (Confirmed)
1. Initial state
   - Player has 4 cards in hand.
   - Field has 5 empty slots.

2. Drag and drop to field slot
   - Only hand cards are draggable.
   - If dropped onto a valid empty slot, the card transitions to that slot center with a short snap animation (not instant teleport).

3. No replacement
   - Cards placed on the field cannot be moved again.
   - Occupied slots cannot accept another card.

4. Drop outside slots
   - If release happens outside valid slots, the card quickly animates back to its original hand position.

5. No field-to-hand return
   - Cards on the field cannot return to hand.

6. Debug reset
   - Right-side reset button restores the initial state immediately (4 cards in hand, field empty).

## 4. Additional agreed points
- Slot detection rule: center-point based detection is acceptable.
- Quick return/snap animation target duration: around **120–180ms**.

## 5. Combat System (New Stage)
1. Card parameters
   - Each card has directional attack values: `attackValue.left` and `attackValue.right`.
   - Values are generated in a bounded pair so that `left + right = 5` (swing is controlled).

2. Swipe attack on field
   - Player field cards can perform attacks by horizontal swipe.
   - Left swipe attacks the adjacent card in the left slot.
   - Right swipe attacks the adjacent card in the right slot.
   - Swipe threshold: `|deltaX| >= 50` and `|deltaX| > |deltaY|`.

3. Target and comparison
   - Only adjacent **enemy** field cards are valid targets.
   - If no valid adjacent enemy exists, no battle is resolved.
   - Left swipe compares `attacker.left` vs `defender.right`.
   - Right swipe compares `attacker.right` vs `defender.left`.

4. Battle result
   - Higher value survives; lower value is destroyed.
   - Equal values destroy both cards.
   - Destroyed card slots are freed immediately.

5. Action limits and lock
   - One card can attack once (`hasActedThisTurn`).
   - Swiping an already-acted card shows light shake and a temporary red X mark.
   - Any card interaction is disabled while an action result/animation is resolving.
   - One swipe triggers only one resolution.

6. Visual feedback
   - Player/enemy cards are color-accented.
   - Hit flash occurs before destruction.
   - Destroyed cards fade/shrink out quickly.

## 6. Turn Flow System (Prototype)
1. Turn order setup
   - Randomly determine first/second player at game start.
   - Coin-toss style animation is displayed before the first turn starts.
   - After toss result, coin performs a pseudo-3D wobble reveal (~500ms).
   - First-player banner is shown after wobble settles; game start waits until this reveal sequence finishes (banner is kept longer for readability).

2. Initial hands
   - Both player and enemy receive 4 cards at game start.
   - Player hand is compact-centered so remaining cards do not leave a large isolated gap when cards are used.
   - Since deck is not implemented yet, cards are generated randomly.
   - Hand capacity is up to **9** cards.

3. Turn phases
   - Draw phase: if hand is below 4, draw up to 4; if hand is 4 or more, draw 1 card (up to 9 max).
   - Exception: on the first player's very first turn, the extra +1 draw (when already 4+) is disabled.
   - Main phase: active side can take actions.
   - End turn: switch to the opponent.

4. Main phase behavior
   - Player turn: can place cards and swipe-attack as before.
   - Enemy turn (prototype AI): chooses actions automatically (attack if favorable/equal-trade; otherwise summon).
   - Enemy placement preference: aims to keep enemy cards alive and orient higher attack values toward adjacent player cards (edge-oriented heuristic included).

5. End turn conditions
   - Player can end turn manually with the in-canvas circular `END TURN` button (right-center).
   - End Turn button is enabled only during player's Main phase.
   - If no playable action remains, the turn ends automatically.

## 7. Direct Attack & HP Rule (Prototype)
1. Both players have HP.
   - Starting HP: 10.
2. Direct attack
   - A field card can spend its action to attack opponent HP directly.
   - On success, opponent HP is reduced by 1.
   - Direct attack shares the same once-per-turn action usage (`hasActedThisTurn`).
3. First turn restriction
   - The first player cannot perform direct attack on turn 1.
4. Win condition
   - If a side's HP reaches 0, the opponent wins immediately.


## 8. Presentation Update (Prototype)
1. HUD labels cleanup
   - Removed textual area labels such as EnemyHand / Field / YourHand helper captions.
   - Turn information is integrated into the in-canvas END TURN button (player: Turn + End, enemy: Turn + Enemy).
2. HP visualization
   - HP is shown as prominent circular badges (enemy: top-right edge, player: bottom-left edge), avoiding overlap with cards.
   - HP color changes by remaining ratio: green -> yellow -> red.
3. Attack feedback
   - On direct damage: center damage text -> HP badge briefly enlarges while HP decreases -> badge returns to normal.
   - Added screen shake and HP remaining pop text.
4. KO feedback
   - HP 0 triggers stronger finish feedback (larger shake + KO flash + KO text).


## 9. Rank System (Prototype)
1. Card rank
   - Cards have rank 1 / 2 / 3.
   - Card top-left label displays rank (e.g. `RANK 2`) instead of owner text.
2. Summon rules
   - Rank 1: can be summoned without tribute.
   - Rank 2: requires discarding 1 own field card (any rank).
   - Rank 3: requires discarding either 2 own field cards (any rank), or 1 own Rank 2 field card.
3. Generated power by rank
   - Rank 1 total power: 5 (`left + right = 5`).
   - Rank 2 total power: 7 (`left + right = 7`).
   - Rank 3 total power: 10 (`left + right = 10`).
4. AI summon compliance
   - Enemy summon also obeys rank tribute rules and only uses legal summonable slots.
   - Tribute summon can still be performed even when field starts full, as long as tribute cards free a legal slot.
   - Enemy avoids low-value tribute summons where tribute loss is equal to or higher than the summoned card value.

5. Tribute selection UX
   - After choosing summon destination, a tribute selection overlay opens for Rank 2/3 summons only when tribute payment is actually possible.
   - If tribute cards are insufficient, overlay does not open and summon is rejected with immediate error feedback.
   - Background is dimmed and field cards are highlighted for selection.
   - Summon target card is shown in a separate preview frame so field cards remain easy to inspect.
   - Player can Confirm or Cancel.
   - If destination already has own card, that card is preselected as tribute; additional required cards can be selected by click.

6. Debug visibility
   - Enemy hand cards are rendered face-up temporarily for debugging.

## 10. 対象選択とバトルログ拡張（2026-03 更新）
1. 単体対象効果の選択方式
   - 「敵1体に」「隣接する敵1体に」など、**候補が複数存在する単体対象効果**はプレイヤーが対象を選択して解決する。
   - 選択中は暗転オーバーレイを表示し、対象候補カードをハイライトする。
   - 候補が1体しかいない場合は自動でその対象を選ぶ。
   - 敵AI側の同種効果は従来どおり自動選択（左攻撃値が低い順）で処理する。

2. バトルログの記録範囲
   - 召喚時は「召喚宣言」「召喚成立」「効果処理テキスト」を順に記録する。
   - 生贄・破壊・上書きなどでカードが場/手札を離れるイベントを記録する。
   - 効果によるドロー、デッキ下への返却、豊穣による退場送りなど、効果由来のゾーン移動を記録する。
   - ログ上限は既存仕様のまま、古いログから順にローテーションする。

3. 敵AIの召喚後ディレイ
   - 行動スケジューリング基準を「行動開始時刻」ではなく「召喚処理完了時刻」に統一する。
   - 召喚系アクション（通常召喚・上書き召喚）は、`cards.js` 側で `interactionLock` 解放直前に後続ディレイを設定する。
   - 召喚後ディレイは `ENEMY_POST_SUMMON_DELAY_MS`（初期値 350ms）で調整可能とし、攻撃系ディレイ `ENEMY_ACTION_DELAY_MS` とは独立させる。
