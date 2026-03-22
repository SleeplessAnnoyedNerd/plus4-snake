# Snake — Port Report

**Original:** Commodore Plus/4 BASIC 3.5, by Alexander JUNG
**Port:** Python 3, `curses`, Linux terminal
**Output file:** `snake.py`

---

## 1. Summary

A faithful terminal port of a Commodore Plus/4 Snake game. The game logic, data
structures, level system, and growth mechanics were reverse-engineered from the
BASIC source and translated to Python. One original bug was intentionally fixed.

---

## 2. Design Decisions

| Aspect | Decision | Reason |
|---|---|---|
| Terminal library | `curses` (stdlib) | No install needed; handles input, positioning, colors |
| Sound | Skipped; death flashes head | Terminal has no equivalent of TED chip audio |
| Input | Arrow keys + WASD | Arrow keys more natural; WASD for comfort |
| `pe=pe` bug | **Fixed** | Original: tail never advances; snake stays at max size permanently. Clearly a typo for `pe=pe+1` |
| Intro/outro | Simple ASCII screens | Commodore PETSCII art is untranslatable to ASCII |
| Field size | 40×23 (original geometry) | Faithful to original; fits in any 80×26 terminal |
| Snake body chars | Unicode box-drawing (`─ │ ╰ ╯ ╭ ╮`) | Readable on any modern Linux terminal |

---

## 3. Coordinate System

The original Plus/4 uses raw screen memory addresses:

```
screen_address = 3072 + row * 40 + col   (row 0..24, col 0..39)
```

The game board occupies rows 2–24 (row 0–1 are above the play area). This port
maps to an internal grid with:

```
internal_row = orig_row - 2
```

Resulting in a 23×40 grid where row 0 = top wall, row 22 = bottom wall, and
rows 1–21 are the play area interior.

---

## 4. Data Structures

### Snake

The original uses a **circular buffer** of screen addresses (`po()`, size `di+1`).
This port uses a `collections.deque` of `(row, col)` pairs:

- `snake[0]` = head
- `snake[-1]` = tail
- `appendleft(new_head)` on each move
- `pop()` to erase tail

### Game state grid

A separate `ROWS × COLS` Python list tracks cell types (`EMPTY`, `WALL`, `FOOD`,
`SNAKE`, `EXIT`). This avoids reading characters back from the curses window,
which is unreliable for multi-byte unicode characters.

---

## 5. Key Mechanics

### Growth

Each time food is eaten, a grow counter is set to 5. While `grow >= 0`, the
tail is not erased (snake grows). Counter decrements each tick.

- Food eating tick: tail not erased → +1 segment
- Counter ticks (5→4→3→2→1→0): 6 more ticks → +6 segments
- **Total: 7 segments per food item**

This matches the original behavior exactly (original: `l=5`, `IF l>=0 THEN l=l-1: GOTO 1270`).

### Exit hole

The original opens the exit when the circular buffer wraps (`pa == pe`), i.e.
when the snake fills its entire buffer. This port opens the exit when
`len(snake) >= max_len`. The exit is placed at internal position (0, 19) — the
same hardcoded location as the original.

### Direction / corner characters

The original draws a corner character at the old head position when the direction
changes. This port does the same: on each tick, before advancing the head, the
current head cell is redrawn with either a straight body char or the appropriate
corner from:

```python
CORNERS = {
    (UP,   RIGHT): '╰',  (UP,   LEFT):  '╯',
    (DOWN, RIGHT): '╭',  (DOWN, LEFT):  '╮',
    (LEFT,  UP):   '╯',  (LEFT,  DOWN): '╮',
    (RIGHT, UP):   '╰',  (RIGHT, DOWN): '╭',
}
```

180° reversals are blocked — same as the original.

### Scoring

| Event | Points |
|---|---|
| Food eaten | +10 |
| Exit taken | +`phase × 10` |

### Difficulty

| Selection | Max snake length |
|---|---|
| 1 – Easy | 70 segments |
| 2 – Medium | 90 segments |
| 3 – Hard | 110 segments |

---

## 6. Level Obstacles

The original encodes internal wall segments as 7-character strings
(`"SSSDDCC"` = start offset, step, count), POKEd directly to screen memory.

Phases 2–4 are decoded **faithfully** from the original BASIC DATA strings:

| Phase | pg | Segments | Layout |
|---|---|---|---|
| 2 | 0 | `hbar(row 13, cols 9–30)` | Single horizontal bar |
| 3 | 1 | horizontal bar + 2 short verticals | Bar with two pillars |
| 4 | 2 | horizontal bar + 2 tall verticals | Bar with tall flanking walls |

Phases 5–10 are **approximations** — the original DATA lines were not available,
only their prose descriptions:

| Phase | pg | Layout |
|---|---|---|
| 5 | 3 | Cross (horizontal + vertical) |
| 6 | 4 | Three staggered horizontal bars |
| 7 | 5 | Four short horizontal bars (two pairs) |
| 8 | 6 | Single diagonal NW→SE (from original `2934112` DATA string) |
| 9 | 7 | Two crossing diagonals |
| 10 | 8 | Three diagonals |

Phases above 10 cycle randomly through all 9 obstacle sets (same logic as
original: `pg = RND(1)*10 + 1 - 2`).

---

## 7. Bugs in the Original (and how this port handles them)

| # | Original bug | This port |
|---|---|---|
| 1 | **`pe=pe` no-op (line 1450):** tail pointer never advances; snake permanently stays at max size after first reaching it | **Fixed:** tail pops normally from the deque |
| 2 | **Negative array index:** when `ph>10`, `pg = INT(RND(1)*10+1)-2` can yield `-1`, causing `hi$(-1,t)` — illegal array access | Fixed: `pg = (phase-2) % len(OBSTACLES)` |
| 3 | **`l=5` resets on food placement, not eating:** minor timing quirk — in practice irrelevant since placement is triggered by eating | Same behavior preserved |
| 4 | **Hardcoded exit position:** `POKE 3171,96` always opens at row 2, col 19 regardless of obstacles | Same hardcoded position (0, 19 in internal coords) |

---

## 8. What Was Not Ported

- **Intro animation:** Used Plus/4 ESC-sequence scroll commands and PETSCII
  control codes — not translatable. Replaced with ASCII title box.
- **Game-over coffin graphic:** Dense PETSCII art using Commodore graphics
  characters. Replaced with ASCII tombstone box.
- **Scrolling ticker:** Machine code IRQ handler scrolled the top row at
  hardware interrupt rate. Replaced with a static status bar.
- **Sound:** TED chip-specific (`SOUND`, `VOL`). Replaced with a head flash on
  death, and nothing for movement ticks and level-up jingle.
- **Typewriter instruction effect:** The rules screen animated each character
  with sound. Not reproduced.

---

## 9. Running

```bash
source venv/bin/activate
python snake.py
```

Requires: Python 3, `curses` (stdlib), a terminal of at least 40×25 characters,
UTF-8 locale for box-drawing characters.
