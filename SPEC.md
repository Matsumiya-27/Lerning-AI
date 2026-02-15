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
