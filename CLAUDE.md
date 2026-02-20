# CLAUDE.md — Canvas Card Game MVP

This file provides guidance for AI assistants working in this repository.

---

## Project Overview

A turn-based card game rendered entirely on an HTML5 Canvas, with no external
dependencies. The player competes against a simple AI opponent. The full game
specification lives in `SPEC.md`.

**Entry point:** `index.html` loads `main.js`.
**Canvas size:** 960 × 720 (internal coordinates, 4:3 aspect ratio).
**Language:** Vanilla JavaScript (ES6+) / HTML5 / CSS3.

---

## Repository Structure

```
Lerning-AI/
├── CLAUDE.md      ← this file
├── SPEC.md        ← authoritative game design specification
├── index.html     ← single-page HTML entry point + embedded CSS
└── main.js        ← complete game engine (~1 800 lines)
```

No build step, no package manager, no test runner. Open `index.html` directly
in a browser to run the game.

---

## main.js Architecture

The file is a single flat module. All game state is held in the global
`gameState` object. Code is organised into labelled sections:

| Region | Approx. lines | Purpose |
|--------|--------------|---------|
| Constants (`定数`) | 9–41 | Tuning values – timings, sizes, limits |
| DOM references | 43–54 | Canvas, context, reset button |
| Layout helpers | 56–70 | `slotCenters`, `getHandCenter()` |
| Global state | 72–126 | `gameState` object (cards, HP, FX, turn info) |
| Card factory | 128–320 | `createCard()`, rank/power generation |
| Tribute/summon logic | 344–493 | Overlay UX, legality checks |
| Turn flow | 604–656 | Draw phase, main phase, end turn |
| Animation helpers | 689–721 | `startMoveAnimation()`, `markCardDestroyed()` |
| Combat resolution | 726–848 | `resolveSwipeAttack()`, direct attack |
| Enemy AI | 882–1013 | Summon + attack heuristics |
| Input handlers | 1093–1275 | Pointer down / move / up |
| Rendering | 1277–1729 | All `draw*()` functions |
| Game loop | 1827–1844 | RAF loop, `updateAnimations()`, `draw()` |

### Game state keys (most important)

```js
gameState.cards           // flat array of all card objects
gameState.interactionLock // bool – disables input during animations
gameState.summonSelection // tribute overlay state
gameState.turn            // { currentOwner, number, phase }
gameState.hp              // { player, enemy }
gameState.fx              // screen shake, damage texts, HP pulse
```

### Card object shape

```js
{
  id,           // unique integer
  owner,        // 'player' | 'enemy'
  zone,         // 'hand' | 'field' | 'destroyed'
  rank,         // 1 | 2 | 3
  attackValue,  // { left, right }  (left+right == totalPower for rank)
  slotId,       // field slot 0-4 (null if in hand)
  handIndex,    // position in hand (null if on field)
  x, y,        // current render position (canvas coords)
  targetX, targetY,     // animation destination
  hasActedThisTurn,     // bool – once-per-turn action
  // animation flags: moveProgress, opacity, scale, hitFlash, …
}
```

### Field layout

Five slots at y = 360, x = 140, 280, 420, 560, 700 (IDs 0–4, left to right).

Slot ID parity:
- Enemy cards occupy the **same five slots** as player cards (different rows
  are simulated by `owner` only — visually they are above/below center).
- Adjacency for combat is purely slot-ID-based (|slotA − slotB| === 1).

---

## Key Conventions

### Immutable constants
All magic numbers go in the constants block at the top of `main.js`.
Do not scatter literal numbers throughout functions.

### Interaction lock
Before any animation that would conflict with input, set
`gameState.interactionLock = true`.
Clear it at the animation's completion callback.
Failing to clear the lock will freeze the game.

### One action per card per turn
The `hasActedThisTurn` flag on each card must be checked before allowing swipe
attacks or direct attacks. It is cleared at the start of each main phase.

### Rendering order (draw() call sequence)
1. Table / background
2. Field slots (dashed borders)
3. Cards (sorted by z-index / dragging flag)
4. HP badges
5. Floating damage texts
6. In-canvas UI (END TURN button, turn banner)
7. Tribute selection overlay (highest layer)
8. Screen shake (applied as canvas translate before clearing)

Always add new visual elements at the correct layer; never paint over overlays.

### Animation pattern
Animations are stored as objects in `gameState.fx.*` arrays or on the card
object itself (e.g. `card.moveProgress`). The main loop calls
`updateAnimations(nowMs)` every frame, then `draw()`. Do not use `setTimeout`
for visual state changes — keep everything in the RAF loop.

---

## Game Rules Summary (implementation reference)

| Rule | Value |
|------|-------|
| Starting HP | 10 |
| Starting hand | 4 cards each |
| Hand maximum | 9 cards |
| Field slots | 5 per side |
| Rank distribution | 60% R1 / 28% R2 / 12% R3 |
| R1 total power | 5 (left + right = 5) |
| R2 total power | 7 |
| R3 total power | 10 |
| Tribute cost R2 | 1 own field card |
| Tribute cost R3 | 2 own field cards OR 1 own R2 field card |
| Swipe threshold | ≥ 50 px horizontal, > vertical delta |
| Battle resolution | Higher wins; equal → both destroyed |
| Direct attack | −1 HP; shares `hasActedThisTurn` |
| First-player turn 1 | Direct attack forbidden |

---

## Turn Flow

```
startGame()
  └─ startCoinToss()           ← 500 ms toss + 500 ms wobble
       └─ showFirstPlayerBanner()   ← 2 000 ms display
            └─ applyDrawPhase()
                 └─ beginMainPhase()
                      ├─ [Player actions]
                      │    └─ endCurrentTurn()
                      └─ [Enemy AI turn — ~540 ms delay per action]
                           └─ endCurrentTurn()
```

Draw phase rule: if hand < 4 → draw up to 4; if hand ≥ 4 → draw exactly 1
(except first player's very first turn skips the +1 draw).

---

## Enemy AI

Located around lines 882–1013.

1. **Attack phase** — iterates own field cards; if a favourable or equal-trade
   attack exists, performs it.
2. **Summon phase** — picks the best hand card that can legally be summoned,
   prefers higher-rank cards, avoids unprofitable tribute trades.
3. **Heuristic** — assigns higher-value attack directions toward the edge of the
   field to avoid future wasted attacks.

The AI uses `setTimeout` chains (~540 ms apart) to simulate deliberation.
Auto-end fires ~850 ms after the AI has exhausted its options.

---

## Development Workflow

### Running the game
1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
2. No server required — plain `file://` protocol works.
3. The Reset (Debug) button reinitialises `gameState` without reloading the page.

### Making changes
- Edit `main.js` directly; reload the browser to test.
- Keep the single-file structure; do not split into modules without
  a compelling reason (the project has no bundler).
- Constants that affect balance go in the constants block; do not hardcode
  tuning values inside functions.

### Debugging tips
- `console.log(gameState)` in the browser DevTools gives full state at any tick.
- The enemy hand is rendered face-up in the current build (debug mode; see
  `SPEC.md` §9 item 6).
- `gameState.interactionLock` stuck at `true` means an animation callback was
  missed — check completion handlers.

### Git branching
- Feature branches follow the pattern `claude/<slug>` or `codex/<slug>`.
- Merge into `master` via pull request.
- Commit messages should be concise and imperative ("fix: …", "feat: …").

---

## Localization Notes

The codebase is bilingual:

- Code comments are often in Japanese (e.g. `// 目的:`, `// 手札は詰め気味で中央寄せ`).
- In-canvas UI text is in English.
- The HTML note below the canvas is in Japanese.

When adding new comments, match the language already used in the surrounding
block. Do not convert existing Japanese comments to English.

---

## Out-of-Scope Items (current MVP stage)

The following are **not yet implemented** and should not be assumed to exist:

- Persistent deck / deck-building
- Network multiplayer
- Sound effects
- Card artwork (cards are plain rectangles)
- Save/load
- Settings screen
- Mobile-optimised controls beyond pointer-event compatibility
