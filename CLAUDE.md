# CLAUDE.md — Canvas Card Game MVP

This file provides guidance for AI assistants working in this repository.

---

## Project Overview

A turn-based card game rendered entirely on an HTML5 Canvas, with no external
dependencies. The player competes against a simple AI opponent. The full game
specification lives in `SPEC.md`.

**Entry point:** `index.html` loads `main.js` as an ES module.
**Canvas size:** 960 × 720 (internal coordinates, 4:3 aspect ratio).
**Language:** Vanilla JavaScript (ES6+ modules) / HTML5 / CSS3.

---

## Repository Structure

```
Lerning-AI/
├── CLAUDE.md      ← this file
├── SPEC.md        ← authoritative game design specification
├── index.html     ← single-page HTML entry point + embedded CSS
├── main.js        ← entry point: event wiring + game loop (~25 lines)
├── constants.js   ← all tuning constants (no imports)
├── state.js       ← gameState, DOM refs, layout helpers, animation utilities
├── cards.js       ← card factory, summon/tribute logic, combat resolution
├── ai.js          ← enemy AI heuristics
├── turn.js        ← turn flow, coin toss, resetGame, updateTurnFlow
├── input.js       ← pointer event handlers (pointerdown/move/up)
└── render.js      ← all draw*() functions + draw() master call
```

No build step, no package manager, no test runner.
**Important:** ES modules require a local HTTP server — opening `index.html`
directly via `file://` will fail in Chrome (CORS). Use any static server:

```bash
npx serve .          # Node.js
python3 -m http.server 8080
```

Firefox supports `file://` with ES modules and can be used for quick checks.

---

## Module Dependency Graph

```
constants.js  (no imports)
     ↓
state.js      ← constants
     ↓
cards.js      ← constants, state
     ↓
ai.js         ← constants, state, cards
     ↓
turn.js       ← constants, state, cards, ai
     ↓
input.js      ← constants, state, cards, turn
render.js     ← constants, state, cards          (parallel to input.js)
     ↓
main.js       ← state, turn, render, input
```

There are no circular dependencies.

---

## Module Responsibilities

| File | Approx. lines | Purpose |
|------|--------------|---------|
| `constants.js` | ~35 | All tuning values – timings, sizes, limits |
| `state.js` | ~200 | `gameState`, DOM refs, `slotCenters`, FX helpers, animation, layout utils |
| `cards.js` | ~280 | Card factory, summon/tribute overlay, combat (`resolveSwipeAttack`, `resolveDirectAttack`) |
| `ai.js` | ~160 | Enemy summon + attack heuristics, `executeEnemyMainAction` |
| `turn.js` | ~130 | Draw phase, main phase, `endCurrentTurn`, coin toss, `resetGame`, `updateTurnFlow` |
| `input.js` | ~175 | `onPointerDown/Move/Up`, hit-testing helpers |
| `render.js` | ~350 | All `draw*()` functions, master `draw()` |
| `main.js` | ~25 | RAF loop, event binding, `resetGame()` kick-off |

---

## Game state keys (most important)

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
  id,              // unique integer
  owner,           // 'player' | 'enemy'
  zone,            // 'hand' | 'field' | 'destroyed'
  rank,            // 1 | 2 | 3
  handIndex,       // position in hand (null if on field)
  fieldSlotIndex,  // field slot 0-4 (null if in hand)
  x, y,           // current render position (canvas coords)
  combat: {
    attackLeft, attackRight,   // left+right == totalPower for rank
    hasActedThisTurn,          // bool – once-per-turn action
    summonedThisTurn,          // bool – direct attack forbidden
  },
  ui: { isDragging, animation, hitFlashUntilMs, pendingRemoval, … }
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
All magic numbers go in `constants.js`.
Do not scatter literal numbers throughout functions.

### Interaction lock
Before any animation that would conflict with input, set
`gameState.interactionLock = true`.
Clear it at the animation's completion callback.
Failing to clear the lock will freeze the game.

### One action per card per turn
The `combat.hasActedThisTurn` flag on each card must be checked before allowing
swipe attacks or direct attacks. It is cleared at the start of each main phase.

`combat.summonedThisTurn` prevents direct attacks on the turn a card is placed.

### Rendering order (draw() call sequence)
1. Table / background
2. Cards (sorted by z-index / dragging flag)
3. HP badges
4. Floating damage texts
5. In-canvas UI (END TURN button, coin toss, turn banner)
6. Tribute selection overlay (highest layer)
7. K.O. flash overlay
8. Screen shake (applied as canvas translate before everything)

Always add new visual elements at the correct layer; never paint over overlays.

### Animation pattern
Animations are stored on `card.ui.animation` (move) or as timestamps on the
card (hitFlash, shake). The main loop calls `updateAnimations(nowMs)` every
frame, then `draw()`. Do not use `setTimeout` for visual state changes — keep
everything in the RAF loop.

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
resetGame()
  └─ startCoinToss()           ← 500 ms toss + 500 ms wobble
       └─ updateTurnFlow()         ← RAF-driven; shows first-player banner 2 000 ms
            └─ beginTurn()
                 └─ applyDrawPhase()
                      └─ beginMainPhase()
                           ├─ [Player actions]
                           │    └─ endCurrentTurn()
                           └─ [Enemy AI — executeEnemyMainAction every ~540 ms]
                                └─ endCurrentTurn() (auto)
```

Draw phase rule: if hand < 4 → draw up to 4; if hand ≥ 4 → draw exactly 1
(except first player's very first turn skips the +1 draw).

---

## Enemy AI (`ai.js`)

1. **Attack phase** — iterates own field cards; if a favourable or equal-trade
   attack exists, performs it.
2. **Direct attack** — attempted when no profitable swipe exists and
   `canDirectAttack('enemy')` is true.
3. **Summon phase** — picks the best hand card that can legally be summoned,
   prefers higher-rank cards, avoids unprofitable tribute trades.
4. **Heuristic** — assigns placement scores based on adjacency and edge bonus.

The AI is driven by `updateTurnFlow` in the RAF loop via `enemyNextActionAtMs`
timestamps. No `setTimeout` is used for AI decisions.

---

## Development Workflow

### Running the game
1. Start a local HTTP server in the repo root (see top of this file).
2. Open `http://localhost:8080` (or whichever port) in a modern browser.
3. The Reset (Debug) button reinitialises `gameState` without reloading.

### Making changes
- Each concern lives in its own module; add new logic to the appropriate file.
- Constants that affect balance go in `constants.js`; do not hardcode values
  inside functions.
- When adding a new exported function, update the import line in every module
  that needs it.

### Debugging tips
- `console.log(gameState)` in the browser DevTools gives full state at any tick.
- The enemy hand is rendered face-up in the current build (debug mode).
- `gameState.interactionLock` stuck at `true` means an animation callback was
  missed — check completion handlers in `state.js` (`startMoveAnimation`).
- Module import errors appear in the browser console as `SyntaxError` or
  `TypeError: Failed to fetch`; check the file path spelling.

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
