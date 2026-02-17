# Canvas Card Game MVP Spec

## 1. Screen
- Fixed canvas size: **960 x 720** (4:3).
- Layout:
  - Near side (bottom): player's hand (4 cards).
  - Middle: field slots (5 dashed slots, evenly spaced, horizontal).
  - Right side: debug reset button.

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

2. Initial hands
   - Both player and enemy receive 4 cards.
   - Since deck is not implemented yet, cards are generated randomly.

3. Turn phases
   - Draw phase: draw until hand size reaches 4.
   - Main phase: active side can take actions.
   - End turn: switch to the opponent.

4. Main phase behavior
   - Player turn: can place cards and swipe-attack as before.
   - Enemy turn (temporary): no AI actions yet; only turn-end declaration is processed.

5. End turn conditions
   - Player can end turn manually with the right-side End Turn button.
   - End Turn button is enabled only during player's Main phase.
   - If no playable action remains, the turn ends automatically.
