# Snake — Annotated Source Analysis

**Platform:** Commodore Plus/4 (and C16)
**Language:** Commodore BASIC 3.5 (Plus/4 extended BASIC)
**Author:** Alexander JUNG
**Interface language:** German

---

## 1. Platform-Specific Foundations

### Memory Map (Plus/4)

| Address (decimal) | Address (hex) | Purpose |
|---|---|---|
| 819–871 | $0333–$0367 | Machine code loaded from DATA (IRQ handlers + scroller) |
| 2048 | $0800 | Color RAM base |
| 3072 | $0C00 | Screen RAM base (40×25 = 1000 bytes) |
| 65282 | $FF02 | TED register: current foreground color |
| 239 | $00EF | Keyboard buffer count (POKE 239,0 clears buffer) |
| $0314–$0315 | — | IRQ vector (indirect jump, same layout as C64) |
| $D8 | — | Zero-page byte used as frame-counter by the scroll routine |

**Screen address formula:**
```
screen_address = 3072 + row * 40 + col   (row 0..24, col 0..39)
color_address  = screen_address - 1024   (= $0800 base)
```

### Direction Encoding

Direction is stored as a signed **screen-address delta**:

| Key | Value | Meaning |
|---|---|---|
| "5" | −40 | Up (one row back = −40 bytes) |
| "6" | +1 | Right |
| "r" | +40 | Down |
| "d" | −1 | Left |

> **Note:** The game instructions say "Joystick Port 1", but the code reads with `GET a$` (keyboard). On Plus/4, joystick directions can be read via `PEEK($FF08)`. This code uses keyboard keys instead — either the instructions are inaccurate, or this was reworked after the instructions were written.

### Screen Character Codes Used

These are **screen codes** (not PETSCII), specific to the Plus/4 character set:

| Screen code | Role |
|---|---|
| 32 | Empty space (collision test: `PEEK(po)<>32`) |
| 81 | Food item ("apple") |
| 96 | Exit hole in top wall (triggers bonus life) |
| 102 | Written to **color RAM** of the neck segment (body color marker) |
| 160 | Reverse space (solid block, used in status bar) |
| 163 | Obstacle wall block (internal walls from level DATA) |
| 192 | Horizontal snake body segment |
| 215 | Snake head (default, overwritten with corner chars on turn) |
| 221 | Vertical snake body segment |
| 237 | Corner: turning with specific sign combination |
| 238 | Corner: turning with specific sign combination |
| 240 | Corner: turning right-hand |
| 253 | Corner: turning left-hand |

---

## 2. Variable Reference

| Variable | Type | Meaning |
|---|---|---|
| `kn` | flag | 0 = first run (show intro), 1 = returning from game-over |
| `di` | int | Max snake length (= max circular buffer size); set by difficulty: 70/90/110 |
| `po` | int | Screen address of snake head |
| `po(0..di)` | int array | Circular buffer of all snake segment screen addresses |
| `pa` | int | Head index into `po()` buffer |
| `pe` | int | Tail index into `po()` buffer |
| `r` | int | **Requested** direction (−40/−1/+1/+40) |
| `v` | int | **Previous** direction (used to block 180° reversal and draw corner chars) |
| `l` | int | Grow counter: starts at 5, counts down; while ≥0 snake grows (tail not erased) |
| `sp` | flag | Set to 1 once snake reaches max size; alters tail-erase logic |
| `ph` | int | Phase/level number (increases each time exit is taken) |
| `pu` | int | Points/score |
| `wo` | int | Lives remaining (starts at 5) |
| `hi$(8,5)` | string array | Level obstacle DATA (9 levels × up to 6 segments each) |
| `pg` | int | Level index into `hi$` (= `ph-2`, clamped/randomised above phase 10) |
| `w1,w2,w3` | int | Decoded obstacle: start offset, step, count |
| `s1,s2` | int | Sound frequency and duration for level-exit jingle |
| `q2,qq,q1` | float | Death animation counters |

---

## 3. Annotated Source Listing

### Program Entry (lines 1130–1230)

```basic
1130 IF kn=0 THEN GOSUB 2340          ' First run: show intro animation
1135 IF kn=1 THEN PRINT"{clr}...":    ' After game-over: clear screen, colors
         COLOR0,1:COLOR4,1:GOSUB 2450 ' then show rules/difficulty select

1170 COLOR0,3,3:COLOR1,8,7:COLOR4,6,3 ' Set background/border/aux colors
1180 DIM po(di),hi$(8,5)              ' Alloc snake buffer + level data array
     VOL 8:pu=0:ph=1:wo=5             ' Max volume, reset score/phase/lives
     RESTORE 2610                     ' Point DATA pointer to level segments
1190 FOR t1=0 TO 8                    ' Read level obstacle data into hi$()
       FOR t2=0 TO 5
         READ hi$(t1,t2)
         IF hi$(t1,t2)="-1" THEN t2=6 ' "-1" = sentinel; skip remaining slots
       NEXT t2,t1
1200 pu=-10                           ' Score offset: first food placement adds 10
1210 FOR t=819 TO 871                 ' Load machine code into RAM at $0333-$0367
       READ a$:POKE t,DEC(a$)         ' DEC() converts hex string to integer
     NEXT
1220 GOSUB 1780                       ' Draw game board + status bar
1230 GOSUB 1970                       ' Place first food item
     po=4012:pa=0:pe=0                ' Head at row 23 col 20 (center-bottom)
     l=5:r=-40:v=r                    ' Grow counter=5, initial direction=UP
     po(0)=po:sp=0:POKE 239,0         ' Init buffer, clear keyboard queue
```

---

### Main Game Loop (lines 1270–1460)

```basic
1270 POKE po,215                      ' Draw head character at current position
     POKE po-1024,PEEK(65282)         ' Copy current foreground color to color RAM
     SOUND 3,1000,2                   ' Tick sound (movement)

1280 v=r:GET a$                       ' Save last direction; poll keyboard (non-blocking)

' --- Input handling ---
1290 IF a$="5" THEN r=-40             ' Up
1300 IF a$="6" THEN r=1               ' Right
1310 IF a$="r" THEN r=40             ' Down
1320 IF a$="d" THEN r=-1             ' Left

' --- Draw body segment with correct shape at OLD head position ---
1330 IF ABS(r)>20 THEN POKE po,221   ' Moving vertically: draw │
     ELSE POKE po,192                 ' Moving horizontally: draw ─

1340 IF r=v THEN 1410                 ' Same direction: no corner needed → move
1350 IF r=-v THEN 1560               ' Opposite direction: 180° turn = INSTANT DEATH

' Corner character selection based on sign of r vs v:
1360 IF SGN(r)<>SGN(v) THEN 1390
1370   IF r>v THEN POKE po,238        ' Corner type A
       ELSE POKE po,237               ' Corner type B
1380   GOTO 1400
1390   IF SGN(r)=1 THEN POKE po,240  ' Corner type C
       ELSE POKE po,253               ' Corner type D
1400 v=r

' --- Advance head ---
1410 po=po+r                          ' Move head in chosen direction
     pa=pa+1:IF pa>di THEN pa=0       ' Advance head index, wrap at di

' --- Check if head caught tail (snake at max length) ---
1420 IF pa=pe THEN                    ' Head index lapped tail index
       POKE 3171,96                   ' Create exit hole in top wall (row 2, col 19)
       POKE po(pe),32                 ' Erase old tail from screen
       pe=pa+1:sp=1                   ' Advance tail index; set "at max size" flag
       IF pe>di THEN pe=0

' --- Store head, color neck, check collision ---
1430 po(pa)=po                        ' Record new head position in circular buffer
     POKE po-1024-v,102               ' Color the neck segment (prev head's color RAM)
     IF PEEK(po)<>32 THEN 1500        ' Collision! (not empty space)

' --- Tail management: grow vs. erase ---
1440 IF l>=0 AND sp=0 THEN            ' Still in grow phase:
       l=l-1:GOTO 1270                '   count down, skip tail erase → snake grows

1450 POKE po(pe),32                   ' Erase tail segment
     pe=pe                            ' ⚠ BUG: should be pe=pe+1 to advance tail index!
1460 GOTO 1270
```

> **Bug on line 1450:** `pe=pe` is a no-op. The tail pointer is never advanced after the
> initial `pa==pe` catch-up event on line 1420. In practice this means:
> - The snake grows until the buffer is full (pa catches pe)
> - At that point pe jumps to pa+1, and line 1450 always erases the same fixed cell
> - The snake then remains at maximum length (di+1) permanently
> - Subsequent pa==pe events just recreate the exit hole and re-erase that same cell
>
> The effect is that the snake **never shrinks** — it grows to full size and stays there.
> Whether intentional or not, this makes survival harder as levels progress.

---

### Collision Resolution (lines 1500–1560)

```basic
1500 hi=PEEK(po)                      ' What did we hit?
1510 IF hi=81 THEN                    ' Hit food (screen code 81):
       SOUND 3,400,6                  '   crunch sound
       GOSUB 1970                     '   place new food, update score display
       GOTO 1270                      '   continue playing (no grow here; l handles it)
1520 IF hi=96 THEN 1700               ' Hit exit hole → bonus life + level up
     ' (fall through to death)
1560 ...                              ' Any other collision = wall or self = DEATH
```

---

### Death Sequence (lines 1560–1660)

```basic
1560 POKE po,215                      ' Draw head at crash position
     SOUND 3,800,3000                 ' Long death buzz

1570 FOR t=89 TO 0 STEP -1            ' Fade out:
1580   VOL t/10                       '   decrease volume
       POKE po-1024,RND(1)*256        '   flash random colors on head
1590 NEXT:SOUND 3,0,0

' --- Animate snake disappearing (segment by segment) ---
1600 IF pa<pe THEN qq=di-pe+pa        ' Calculate current snake length
     ELSE qq=pa-pe
1610 qq=qq+.00001                     ' Avoid divide-by-zero
     FOR q1=0 TO qq
       FOR t=1 TO 10:NEXT             ' Short busy-wait delay per segment
1620   SOUND 3,900,2:VOL 8
       COLOR4,6,7-q2:COLOR0,3,7-q2   ' Cycle colors
       q2=INT(q2+7.9/qq)              ' Interpolate q2 0→7 over qq steps
1630   POKE po(pe),32:pe=pe+1         ' Erase each segment tail-to-head
       IF pe>di THEN pe=0
1640 NEXT
     FOR t=1 TO 100:NEXT              ' Brief pause
     COLOR0,3,3:COLOR4,6,3            ' Restore colors

1650 wo=wo-1:IF wo=0 THEN 2090        ' Lose a life; if lives=0 → game over screen
1660 GOTO 1220                        ' Restart level (same phase)
```

---

### Level Exit Bonus (lines 1700–1740)

Triggered when snake passes through the exit hole in the top wall (screen code 96):

```basic
1700 pu=pu+ph*10:wo=wo+1:ph=ph+1     ' Score += level*10; gain a life; advance level
1710 POKE po,215:POKE po-1024,247    ' Draw head with special color
     RESTORE 2830:VOL 8
1720 FOR t=1 TO 19:READ s1,s2        ' Play level-up jingle (19 notes from DATA 2830)
1730   COLOR0,3,INT(t/2.4)
       COLOR4,6,INT(t/2.4)
       SOUND 1,s1,s2:SOUND 1,1020,1
1740 NEXT:COLOR0,3,3:COLOR4,6,3
     GOTO 1220                        ' Restart with new level layout
```

---

### Board Drawing Subroutine (lines 1780–1930)

```basic
1780 SYS 819                          ' Restore normal KERNAL IRQ (see §5)
     PRINT"{clr}{gry3}{rvon}the   snake    *    the   snake    *    ";
                                      ' Fill top row with scrolling ticker text
1790 PRINT USING "...";pu;            ' Score display
1800 PRINT USING "...";wo;            ' Lives display
1810 PRINT USING "...";ph;            ' Level display
     POKE 3151,160:POKE 2127,119      ' Hardcode specific status bar chars
     SYS 830                          ' Install scroll-ticker IRQ (see §5)

1820 CHAR,0,2,"#"×40                  ' Top wall (row 2)
1830 FOR t=3 TO 23                    ' Left and right walls (rows 3–23)
       CHAR,0,t,"#":PRINT TAB(39)"#"
     NEXT
1840 CHAR,0,24,"#"×40 + exit gap      ' Bottom wall (row 24) with one-char gap hack

     ' --- Place internal obstacles for current level ---
1850 pg=ph:IF pg>10 THEN pg=INT(RND(1)*10+1)
                                      ' ⚠ if ph>10: pg can become -1 (array underflow bug)
1860 pg=pg-2:IF ph=1 THEN 1930        ' Phase 1: no obstacles
1870 FOR t=0 TO 5
       IF hi$(pg,t)="-1" THEN 1930    ' Sentinel: stop reading this level's segments
1880   w1=VAL(LEFT$(hi$(pg,t),3))     ' Start offset (3 digits)
1890   w2=VAL(MID$(hi$(pg,t),4,2))    ' Step / direction (2 digits)
1900   w3=VAL(RIGHT$(hi$(pg,t),2))    ' Segment count (2 digits)
1910   FOR w=w1 TO w1+w2*w3 STEP w2
1920     POKE w+3072,163              ' Draw obstacle block at screen address
       NEXT w,t
1930 RETURN
```

---

### Food Placement Subroutine (lines 1970–2000)

```basic
1970 l=RND(1)*840+3192                ' Random screen address in play area
                                      ' 3192 = 3072 + 3*40 = row 3, col 0
                                      ' 840 = 21 rows * 40 cols
1980 IF PEEK(l)<>32 THEN 1970         ' Retry if cell not empty
1990 POKE l,81                        ' Draw food character (screen code 81)
     POKE l-1024,90                   ' Set food color (TED color 90)
     l=5:pu=pu+10                     ' Reset l (grow counter!); add 10 points
2000 SYS 819:PRINT USING "...";pu;:SYS 830  ' Update score in status bar
     RETURN
```

> **Note:** `l=5` on line 1990 resets the grow counter every time food is eaten.
> This means **each food item causes the snake to grow by 6 segments** (l counts 5→4→3→2→1→0
> before the tail starts erasing again). This is the primary growth mechanic.

---

### "Press Any Key" Helper (lines 2040–2050)

```basic
2040 CHAR,8,15,"press any key !"
     POKE 239,0:GETKEY s$             ' Clear buffer; wait for keypress (blocking)
2050 CHAR,8,15,"                "     ' Erase the prompt
     RETURN
```

---

### Game Over Screen (lines 2090–2300)

Lines 2090–2240 draw an elaborate **coffin/funeral scene** using Commodore graphic
characters (CBM-V, CBM-C, etc.) and color commands, displayed after all lives are lost.

```basic
2090 SCNCLR:COLOR0,4,0:COLOR4,4,0    ' Clear screen; set colors to dark
     SYS 819                          ' Restore normal IRQ
2100–2240: [funeral graphic using CBM petscii art — brown coffin, flowers, tombstone]

2250 RESTORE 2900                     ' Point DATA to game-over music
2260 FOR t=22 TO 1 STEP -1
2270   READ a,b:SOUND 1,a,b:SOUND 1,1020,1
     NEXT                             ' Play funeral march (22 notes)

2280 PRINT"{home}"CHR$(27)"p""press any key to start !!   "
2290 PRINT USING "...";pu             ' Show final score
2300 SYS 830:POKE 239,0:GETKEY s$    ' Install scroll IRQ; wait for key
     SYS 819:CLR:kn=1:GOTO 1130      ' Restore IRQ; clear vars; restart game
```

---

### Intro Animation Subroutine (lines 2340–2410)

```basic
2340 COLOR0,1:COLOR4,1                ' Minimal colors
2350 RESTORE 3010                     ' Point DATA to title screen strings
2360 FOR t=1 TO 8:READ a$             ' Read 8 screen-command strings
       PRINT CHR$(27) a$              ' Print each via ESC-sequence (Plus/4 extended)
2370   FOR tt=1 TO 100:NEXT tt,t      ' Pacing delay
2380 FOR t=1 TO 25                    ' Scroll effect: 25 iterations of
       PRINT CHR$(27)"w{home}"        '   window-scroll command + cursor home
2390   FOR tt=1 TO 100:NEXT tt,t
2400 FOR t=1 TO 500:NEXT              ' Final pause
2410 CHAR 1,0,24,CHR$(14)             ' Restore charset
     RESTORE 3120                     ' Point DATA to game instructions
```

---

### Rules Display & Difficulty Selection (lines 2450–2570)

```basic
2450 PRINT "Sind die Spielregeln bekannt ?  (Y/N)"  ' "Do you know the rules?"
     POKE 239,0
2460 GET an$
     IF an$="y" THEN RESTORE 3240:an=7:GOTO 2480  ' Known: skip to short text (7 lines)
2470 an=19:IF an$<>"n" THEN 2460                   ' Unknown: show all 19 lines

2480 FOR t=1 TO an:VOL 8
2490   READ an$:an$=" "+an$                         ' Read next instruction line
       FOR tt=1 TO LEN(an$)
2500     PRINT CHR$(20) MID$(an$,tt,1); "{CBM-@}";  ' Typewriter effect with backspace trick
         SOUND 3,1000,2
2510     FOR t1=1 TO 3:NEXT t1
       NEXT tt
2520   PRINT CHR$(20):PRINT
       FOR t1=1 TO 500:NEXT t1
       POKE 239,0
2530   GET la$:la=VAL(la$)
       IF la>3 OR la<1 THEN 2530                    ' Loop until valid 1/2/3

2540 di=50+20*la                                    ' Difficulty → max snake length:
                                                    '   1=Easy:70, 2=Medium:90, 3=Hard:110
2550 FOR t=1 TO 25:PRINT CHR$(27)"w{home}"          ' Clear screen with scroll
2560   FOR tt=1 TO 100:NEXT tt,t
     PRINT CHR$(142)                                ' Switch to uppercase charset
2570 RETURN
```

---

## 4. DATA Sections

### Level Obstacle Data (lines 2610–2690)

Each string encodes one wall segment using a compact 7-character format:

```
"SSSDDCC"
  ^^^   Start offset from screen base (3-digit decimal, added to 3072)
     ^^  Step between POKEs (2-digit decimal: 01=horizontal, 40=vertical, 39/41=diagonal)
       ^^ Segment count (2-digit decimal)

POKE pattern: FOR w=start TO start+step*count STEP step: POKE w+3072,163
```

**Decoded level segments:**

| `hi$` index | Level (ph) | Segment | Decoded | Description |
|---|---|---|---|---|
| 0,0 | 2 | `5290121` | Row 13, col 9, +1×21 | Horizontal center bar |
| 1,0 | 3 | `5290121` | same | Horizontal center bar |
| 1,1 | 3 | `3004006` | Row 7, col 20, +40×6 | Vertical right-center |
| 1,2 | 3 | `579405` | Row 14, col 19, +40×5 | Short vertical |
| 2,0 | 4 | `5290121` | Horizontal center bar | |
| 2,1 | 4 | `2894012` | Row 7, col 9, +40×12 | Long left vertical |
| 2,2 | 4 | `3104012` | Row 7, col 30, +40×12 | Long right vertical |
| 3,0–5 | 5 | 6 segments | Cross pattern + 2 bars | Complex cross |
| 4,0–4 | 6 | 5 segments | Multiple horizontal bars | 3-bar maze |
| 5,0–5 | 7 | 6 segments | 3+3 horizontal pairs | Paired bars |
| 6,0 | 8 | `2934112` | Row 7, col 13, +41×12 | **Diagonal** (↘) |
| 7,0–1 | 9 | diagonal + more | | More diagonals |
| 8,0–2 | 10 | 3 diagonals | | Dense diagonal layout |

> **Diagonal walls** (step 39 = −1 col +1 row, step 41 = +1 col +1 row) appear from
> level 8 onwards, creating a more complex obstacle environment.

> **Bug:** When `ph>10`, `pg = INT(RND(1)*10+1) - 2` can yield `pg=-1`, causing
> `hi$(-1,t)` — an out-of-bounds array access that would generate a
> "?ILLEGAL QUANTITY ERROR" in BASIC. This path is rarely hit in practice.

---

### Machine Code (lines 2730–2790)

Loaded into RAM at addresses $0333–$0367 (819–871). Two entry points:

#### `SYS 819` ($0333) — Restore normal KERNAL IRQ

```asm
$0333  LDA #$0E
$0335  STA $0314        ; IRQ vector low  = $0E
$0338  LDA #$CE
$033A  STA $0315        ; IRQ vector high = $CE → jump target: $CE0E (KERNAL IRQ)
$033D  RTS
```

#### `SYS 830` ($033E) — Install scrolling ticker IRQ

```asm
$033E  LDA #$49
$0340  STA $0314        ; IRQ vector low  = $49
$0343  LDA #$03
$0345  STA $0315        ; IRQ vector high = $03 → jump target: $0349
$0348  RTS
```

#### Custom IRQ handler at $0349

```asm
$0349  CLC
$034A  LDA $D8          ; load frame-counter byte from zero page
$034C  ADC #$10         ; increment by 16
$034E  STA $D8          ; store back
$0350  BCC $0365        ; if no overflow (< every 16 frames): skip scroll → fast path

; --- Scroll top screen row left by 1 character ---
$0352  LDX $0C00        ; save char from top-left (pos 0)
$0355  LDY #$00
$0357  LDA $0C01,Y      ; load char at pos Y+1
$035A  STA $0C00,Y      ; store at pos Y   (shift left)
$035D  INY
$035E  CPY #$28         ; done all 40 columns?  ($28 = 40)
$0360  BNE $0357
$0362  STX $0C27        ; wrap: put old pos-0 char into pos 39 (= $0C27-$0C00)

$0365  JMP $CE0E        ; continue with normal KERNAL IRQ handler
```

**Effect:** Scrolls the top screen row (the title ticker) **right-to-left** once every
16 IRQ frames (~0.32 s at 50 Hz). The title text `"the   snake    *    the   snake    *    "`
is chosen to loop seamlessly. This runs silently in the background during gameplay.

---

### Sound Data

#### Level-exit jingle (DATA 2830–2890) — 19 note pairs (freq, duration)
Ascending melody. Used at `GOSUB 1700` on `SOUND 1`.

#### Game-over / funeral march (DATA 2900–2970) — 22 note pairs
Slow, descending dirge. Used in game-over screen on `SOUND 1`.

---

### Title Screen DATA (lines 3010–3080)

Eight strings prefixed with `"x"` (clear) or `"w"` (scroll), each containing PETSCII
control codes and Commodore graphic characters to construct the animated title screen.

---

### Instructions / Rules Text (lines 3120–3300)

**Full instructions (German, lines 3130–3230):**

> *Spielanleitung (Game instructions):*
> - Steer your snake with the joystick (Port 1)!
> - Eat as many apples as you can!
> - You grow constantly. (No reason to panic.)
> - After some time an exit appears in the upper wall.
> - If you leave the playing field through it, you receive one extra life.
> - The difficulty increases with each phase.
> - The wall is inedible.
> - So are you yourself.
> - Each mistake causes the snake to die and lose a life.
> - When all lives are used up, you can attend your own funeral.

**Short version (lines 3240–3300):** Shown to players who already know the rules.
Starts with a separator line, credits Alexander JUNG, then jumps straight to
difficulty selection.

---

## 5. Program Flow Diagram

```
START
  │
  ├─ kn=0 ──→ GOSUB 2340 (intro animation)
  │
  ├─ kn=1 ──→ GOSUB 2450 (rules + difficulty → sets di)
  │
  ├─ init: score=0, lives=5, phase=1, grow=5
  ├─ load machine code into $0333
  ├─ GOSUB 1780 (draw board + install scroll ticker)
  ├─ GOSUB 1970 (place first food)
  │
  └─ MAIN LOOP (1270–1460):
       ┌─ draw head, tick sound
       ├─ poll keyboard → update direction r
       ├─ draw body/corner char at old head
       ├─ check for 180° turn → DEATH
       ├─ advance head: po += r, pa++
       ├─ if pa==pe: open exit hole, erase tail, sp=1
       ├─ store pos, color neck
       │
       ├─ PEEK(po)==32 (empty) ──→ grow/erase tail logic ──→ loop
       │
       ├─ PEEK(po)==81 (food) ──→ place new food, l=5 ──→ loop
       │
       ├─ PEEK(po)==96 (exit) ──→ score+, life+, phase++
       │                           play jingle ──→ restart board
       │
       └─ anything else (wall/self):
            DEATH SEQUENCE (1560–1660):
              - fade sound + flash colors
              - animate snake disappearing segment by segment
              - wo--
              ├─ wo==0 ──→ GAME OVER (2090): coffin graphic + music
              │              "press any key" → kn=1 → GOTO 1130
              └─ wo>0  ──→ GOTO 1220 (restart same phase)
```

---

## 6. Porting Guide

### What to replace / abstract

| Original mechanism | Portable equivalent |
|---|---|
| `POKE addr, char` for screen | `draw_char(row, col, char_id)` |
| `POKE addr-1024, color` for color RAM | `set_color(row, col, color)` |
| Screen address arithmetic (`3072 + row*40 + col`) | `(row, col)` coordinate pair |
| Direction as ±1/±40 delta | `enum Direction {UP, DOWN, LEFT, RIGHT}` |
| `GET a$` (non-blocking keyboard) | `poll_input()` returning optional direction |
| `SOUND n, freq, dur` (TED chip) | `play_tone(channel, freq_hz, duration_ms)` |
| `VOL n` | `set_volume(0..8)` |
| `COLOR 0,lum,col` etc. | `set_palette(slot, r, g, b)` |
| Machine code scroll ticker | Software: shift string left each frame tick |
| `SYS 819` / `SYS 830` | No equivalent needed; just update ticker text directly |
| `CHAR,col,row,string` (Plus/4 BASIC) | `draw_string(col, row, string)` |
| Busy-wait `FOR t=1 TO n:NEXT` | `sleep_ms(n * factor)` |
| `RND(1)` | `random_float(0..1)` |
| `DEC("a9")` (hex string to int) | Not needed: machine code is embedded |

### Snake data structure

The original uses a **circular buffer** of screen addresses.
For a port, use a ring buffer (or deque) of `(row, col)` pairs:

```python
# Equivalent data model
snake = deque()          # front = head, back = tail
MAX_LEN = 70/90/110      # difficulty-based

# Each game tick:
snake.appendleft(new_head)
if len(snake) > grow_target:
    snake.pop()          # erase tail
```

### Timing

The original has **no explicit game-speed timer**: speed is governed by BASIC interpreter
throughput (~1 MHz 6502 with BASIC overhead). For a port, use a fixed tick rate:

- **Suggested starting point:** 8–12 ticks/second for normal play
- The `SOUND 3,1000,2` on line 1270 provides a subtle pacing click; in a port, a
  short `sleep(tick_ms)` achieves the same effect
- Death animation delay: `t=1 TO 10` loop → ~50–100 ms per segment at modern speeds

### Growth mechanic

Each time food is eaten: `l = 5` (line 1990).
While `l >= 0`: tail is **not** erased, `l` decrements each step.
→ **6 extra segments per food item** (l goes 5→4→3→2→1→0, six steps without tail erase).

### Level system

```python
def get_level_obstacles(phase):
    pg = phase - 2
    if phase > 10:
        pg = random.randint(1, 10) - 2  # Note: can be -1 (original bug)
    if phase == 1 or pg < 0:
        return []
    return OBSTACLE_DATA[pg]            # list of (start, step, count) tuples

def draw_obstacles(segments):
    for (start, step, count) in segments:
        for i in range(count + 1):
            row, col = divmod(start + step * i, 40)
            draw_char(row, col, WALL_BLOCK)
```

### Scoring

| Event | Points |
|---|---|
| Food eaten | +10 (applied at placement time) |
| Exit taken | +`phase × 10` |

### Corner character selection logic (for graphical ports)

```
if new_dir == old_dir:          # straight segment
    use STRAIGHT char (─ or │)
elif new_dir == -old_dir:       # 180° turn
    DEATH (should not reach drawing code)
elif SGN(new) == SGN(old):
    if new > old: CORNER_A else CORNER_B
else:
    if SGN(new) == 1: CORNER_C else CORNER_D
```

For a terminal port, Unicode box-drawing characters work well:
`─ │ ┘ └ ┐ ┌` (or `╴ ╷ ╰ ╯ ╮ ╭` for rounded style).

---

## 7. Known Bugs and Quirks

1. **`pe=pe` no-op (line 1450):** Tail pointer never advances during normal play.
   The snake grows to max length and stays there. Likely a typo for `pe=pe+1`.

2. **Negative array index (line 1850):** When `ph>10`, `pg` can become `-1`, causing
   `hi$(-1,t)` — an illegal array access in BASIC. Rarely triggered.

3. **`l=5` resets on food placement (line 1990), not on eating:** The grow counter is
   reset when food is *placed*, before the food is eaten. Combined with the `pe=pe` bug,
   the actual grow-and-shrink cycle is partially non-functional.

4. **Exit character placement (line 1420):** `POKE 3171,96` is hardcoded to
   screen address 3171 (row 2, col 19). It always opens at the same spot regardless of
   level layout. If a wall obstacle happens to cover that cell, it will be overwritten.

5. **`pe=pe` in death animation (line 1630):** Here `pe=pe+1` IS used correctly —
   so the death animation properly unwinds the snake body. Only line 1450 has the no-op.
