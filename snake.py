#!/usr/bin/env python3
"""Snake — curses port of the Commodore Plus/4 game by Alexander JUNG.

Original: Commodore Plus/4 BASIC 3.5, Alexander JUNG
Port: Python 3, curses terminal display
"""

import curses
import random
import time
from collections import deque

# ── Directions ────────────────────────────────────────────────────────────────

UP    = (-1,  0)
DOWN  = ( 1,  0)
LEFT  = ( 0, -1)
RIGHT = ( 0,  1)
OPPOSITE = {UP: DOWN, DOWN: UP, LEFT: RIGHT, RIGHT: LEFT}

# ── Grid geometry ─────────────────────────────────────────────────────────────
# Row 0 = top wall, rows 1..ROWS-2 = interior, row ROWS-1 = bottom wall.
# Col 0 = left wall, cols 1..COLS-2 = interior, col COLS-1 = right wall.
# Mapping from original Plus/4 screen coords: internal_row = orig_row - 2.

ROWS = 23   # 0..22
COLS = 40   # 0..39
TICK = 0.10  # seconds per game tick

# Snake starting position (orig row 23, col 20)
START_R, START_C = 21, 20

# Exit hole in top wall (orig row 2, col 19)
EXIT_R, EXIT_C = 0, 19

# ── Cell types ────────────────────────────────────────────────────────────────

EMPTY = 0
WALL  = 1
FOOD  = 2
SNAKE = 3
EXIT  = 4

# ── Display characters ────────────────────────────────────────────────────────

CH_WALL  = '#'
CH_FOOD  = '*'
CH_EXIT  = 'O'
CH_HEAD  = '@'
CH_HBODY = '\u2500'  # ─
CH_VBODY = '\u2502'  # │
CORNERS = {
    (UP,    RIGHT): '\u2570',  # ╰  bottom-right
    (UP,    LEFT):  '\u256f',  # ╯  bottom-left
    (DOWN,  RIGHT): '\u256d',  # ╭  top-right
    (DOWN,  LEFT):  '\u256e',  # ╮  top-left
    (LEFT,  UP):    '\u256f',  # ╯
    (LEFT,  DOWN):  '\u256e',  # ╮
    (RIGHT, UP):    '\u2570',  # ╰
    (RIGHT, DOWN):  '\u256d',  # ╭
}

# ── Color pairs ───────────────────────────────────────────────────────────────

CP_WALL   = 1
CP_SNAKE  = 2
CP_HEAD   = 3
CP_FOOD   = 4
CP_EXIT   = 5
CP_STATUS = 6


def _init_colors():
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(CP_WALL,   curses.COLOR_WHITE,  -1)
    curses.init_pair(CP_SNAKE,  curses.COLOR_GREEN,  -1)
    curses.init_pair(CP_HEAD,   curses.COLOR_GREEN,  -1)
    curses.init_pair(CP_FOOD,   curses.COLOR_YELLOW, -1)
    curses.init_pair(CP_EXIT,   curses.COLOR_CYAN,   -1)
    curses.init_pair(CP_STATUS, curses.COLOR_BLACK,  curses.COLOR_WHITE)


# ── Obstacle data ─────────────────────────────────────────────────────────────
# 9 entries for phases 2–10 (index = phase - 2, wraps when phase > 10).
# Coordinates use internal grid (orig_row - 2).
# Phases 2–4 are decoded faithfully from the original BASIC DATA strings.
# Phases 5–10 are approximations matching the described patterns.

def _build_obstacles():
  def h(or_, c0, n):        return [(or_ - 2, c) for c in range(c0, c0 + n)]
  def v(c, or0, n):         return [(or0 - 2 + i, c) for i in range(n)]
  def d(or_, c, dr, dc, n): return [(or_ - 2 + dr*i, c + dc*i) for i in range(n)]
  return [
    h(13, 9, 22),                                                      # ph 2
    h(13, 9, 22) + v(20, 7, 7) + v(19, 14, 6),                        # ph 3
    h(13, 9, 22) + v(9, 7, 13) + v(30, 7, 13),                        # ph 4
    h(13, 6, 28) + v(20, 5, 15),                                       # ph 5
    h(8, 4, 15) + h(13, 9, 22) + h(18, 21, 15),                       # ph 6
    h(8, 4, 12) + h(8, 24, 12) + h(18, 4, 12) + h(18, 24, 12),       # ph 7
    d(7, 13, 1, 1, 13),                                                # ph 8
    d(7, 5, 1, 1, 12) + d(7, 34, 1, -1, 12),                          # ph 9
    d(5, 3, 1, 1, 10) + d(5, 20, 1, -1, 10) + d(12, 10, 1, 1, 10),   # ph 10
  ]

OBSTACLES = _build_obstacles()


# ── Game class ────────────────────────────────────────────────────────────────

class Game:

  def __init__(self, win, max_len):
    self.win = win
    self.max_len = max_len
    self.score = 0
    self.lives = 5
    self.phase = 1
    self.grid = [[EMPTY] * COLS for _ in range(ROWS)]

    h, w = win.getmaxyx()
    # +1 row for status bar above the grid
    self.oy = max(0, (h - ROWS - 1) // 2)
    self.ox = max(0, (w - COLS) // 2)

  # ── Low-level draw helpers ──────────────────────────────────────────────────

  def _put(self, r, c, ch, cp=0):
    """Write ch at internal grid position (r, c)."""
    try:
      self.win.addstr(self.oy + 1 + r, self.ox + c, ch, curses.color_pair(cp))
    except curses.error:
      pass

  def _put_cell(self, r, c, ctype):
    """Update grid array and redraw a non-snake cell."""
    self.grid[r][c] = ctype
    if ctype == EMPTY:
      self._put(r, c, ' ')
    elif ctype == WALL:
      self._put(r, c, CH_WALL, CP_WALL)
    elif ctype == FOOD:
      self._put(r, c, CH_FOOD, CP_FOOD)
    elif ctype == EXIT:
      self._put(r, c, CH_EXIT, CP_EXIT)

  # ── Status bar ──────────────────────────────────────────────────────────────

  def _draw_status(self):
    bar = (f" SCORE:{self.score:5d}  LIVES:{self.lives}"
           f"  LEVEL:{self.phase:2d}  THE SNAKE ")
    bar = bar[:COLS].ljust(COLS)
    try:
      self.win.addstr(self.oy, self.ox, bar, curses.color_pair(CP_STATUS))
    except curses.error:
      pass

  # ── Board setup ─────────────────────────────────────────────────────────────

  def _setup_board(self):
    """Draw fresh game board for current phase. Resets grid and display."""
    for r in range(ROWS):
      for c in range(COLS):
        self.grid[r][c] = EMPTY

    # Outer walls
    for c in range(COLS):
      self._put_cell(0, c, WALL)
      self._put_cell(ROWS - 1, c, WALL)
    for r in range(1, ROWS - 1):
      self._put_cell(r, 0, WALL)
      self._put_cell(r, COLS - 1, WALL)
      for c in range(1, COLS - 1):
        self._put(r, c, ' ')

    # Internal obstacles
    if self.phase > 1:
      pg = (self.phase - 2) % len(OBSTACLES)
      for (r, c) in OBSTACLES[pg]:
        if 1 <= r <= ROWS - 2 and 1 <= c <= COLS - 2:
          self._put_cell(r, c, WALL)

    self._draw_status()
    self.win.refresh()

  # ── Food placement ──────────────────────────────────────────────────────────

  def _place_food(self):
    """Place food at a random empty interior cell."""
    for _ in range(2000):
      r = random.randint(1, ROWS - 2)
      c = random.randint(1, COLS - 2)
      if self.grid[r][c] == EMPTY:
        self._put_cell(r, c, FOOD)
        return
    # Fallback: sequential scan
    for r in range(1, ROWS - 1):
      for c in range(1, COLS - 1):
        if self.grid[r][c] == EMPTY:
          self._put_cell(r, c, FOOD)
          return

  # ── Snake helpers ───────────────────────────────────────────────────────────

  def _draw_body(self, r, c, ch):
    self.grid[r][c] = SNAKE
    self._put(r, c, ch, CP_SNAKE)

  def _draw_head(self, r, c):
    self.grid[r][c] = SNAKE
    self._put(r, c, CH_HEAD, CP_HEAD)

  def _erase(self, r, c):
    self.grid[r][c] = EMPTY
    self._put(r, c, ' ')

  # ── Main game level ─────────────────────────────────────────────────────────

  def run_level(self):
    """
    Run until snake dies or exits the level.
    Returns: 'levelup' | 'died' | 'gameover' | 'quit'
    """
    self._setup_board()

    snake = deque([(START_R, START_C)])
    self._draw_head(START_R, START_C)

    direction = UP
    requested = UP
    # grow counter: while >= 0, tail is not erased (snake grows).
    # Starts at 5 → 6 ticks of growth at game start.
    # Each food eaten resets it to 5 → 6 more ticks + 1 at eating = 7 total per food.
    grow = 5
    exit_open = False

    self._place_food()
    self.win.refresh()

    self.win.nodelay(True)
    self.win.keypad(True)

    _key_map = {
      curses.KEY_UP:    UP,    curses.KEY_DOWN:  DOWN,
      curses.KEY_LEFT:  LEFT,  curses.KEY_RIGHT: RIGHT,
      ord('w'): UP,    ord('W'): UP,
      ord('s'): DOWN,  ord('S'): DOWN,
      ord('a'): LEFT,  ord('A'): LEFT,
      ord('d'): RIGHT, ord('D'): RIGHT,
    }

    deadline = time.monotonic() + TICK

    while True:
      now = time.monotonic()

      # Collect input until next tick deadline
      if now < deadline:
        key = self.win.getch()
        if key != -1:
          nd = _key_map.get(key)
          if nd is not None:
            requested = nd
          elif key == ord('q'):
            return 'quit'
        time.sleep(0.005)
        continue

      # ── Game tick ───────────────────────────────────────────────────────────
      deadline = now + TICK

      # Block 180° reversal
      new_dir = requested if requested != OPPOSITE[direction] else direction

      head_r, head_c = snake[0]

      # Replace current head cell with body/corner character
      if new_dir == direction:
        body_ch = CH_VBODY if direction[1] == 0 else CH_HBODY
      else:
        body_ch = CORNERS.get((direction, new_dir), CH_HBODY)
      self._draw_body(head_r, head_c, body_ch)

      direction = new_dir
      new_r = head_r + direction[0]
      new_c = head_c + direction[1]
      cell = self.grid[new_r][new_c]

      if cell == EXIT:
        # Passed through exit hole → bonus life, next level
        self._draw_head(new_r, new_c)
        self.win.refresh()
        self.score += self.phase * 10
        self.lives += 1
        self.phase += 1
        self._draw_status()
        self.win.refresh()
        time.sleep(0.5)
        return 'levelup'

      elif cell == FOOD:
        # Eat food: grow + score, place new food
        self.score += 10
        grow = 5
        snake.appendleft((new_r, new_c))
        self._draw_head(new_r, new_c)
        self._place_food()
        self._draw_status()

      elif cell == EMPTY:
        # Normal movement
        snake.appendleft((new_r, new_c))
        self._draw_head(new_r, new_c)
        if grow >= 0:
          grow -= 1        # growing phase: skip tail erase
        else:
          tail = snake.pop()
          self._erase(*tail)

        # Open exit when snake reaches maximum length
        if not exit_open and len(snake) >= self.max_len:
          exit_open = True
          self.grid[EXIT_R][EXIT_C] = EXIT
          self._put(EXIT_R, EXIT_C, CH_EXIT, CP_EXIT)

      else:
        # WALL or SNAKE → death
        self._draw_head(new_r, new_c)
        self.win.refresh()
        self._death_animation(snake)
        self.lives -= 1
        return 'gameover' if self.lives <= 0 else 'died'

      self.win.refresh()

  # ── Death animation ─────────────────────────────────────────────────────────

  def _death_animation(self, snake):
    head_r, head_c = snake[0]
    for i in range(8):
      ch = '!' if i % 2 == 0 else CH_HEAD
      cp = CP_FOOD if i % 2 == 0 else CP_SNAKE
      self._put(head_r, head_c, ch, cp)
      self.win.refresh()
      time.sleep(0.08)

    # Unwind from tail to head
    for r, c in reversed(list(snake)):
      self._erase(r, c)
      self.win.refresh()
      time.sleep(0.03)

    time.sleep(0.4)

  # ── Game over screen ─────────────────────────────────────────────────────────

  def game_over(self):
    self.win.clear()
    h, w = self.win.getmaxyx()
    lines = [
      '',
      '  +-------------------------------+',
      '  |                               |',
      '  |     ~~ G A M E  O V E R ~~   |',
      '  |                               |',
      '  |     .--.                      |',
      '  |     |  |   R . I . P .        |',
      '  |     |  |                      |',
      '  |     |  |   THE SNAKE          |',
      '  |     |  |                      |',
      "  |     '--'                      |",
      '  |                               |',
      f'  |     Final score: {self.score:6d}      |',
      '  |                               |',
      '  |     Press any key ...         |',
      '  |                               |',
      '  +-------------------------------+',
      '',
    ]
    sy = max(0, (h - len(lines)) // 2)
    for i, line in enumerate(lines):
      if sy + i < h - 1:
        try:
          self.win.addstr(sy + i, 0, line[:w - 1], curses.color_pair(CP_WALL))
        except curses.error:
          pass
    self.win.refresh()
    self.win.nodelay(False)
    self.win.getch()


# ── Title / difficulty screens ────────────────────────────────────────────────

def _show_lines(win, lines):
  win.clear()
  h, w = win.getmaxyx()
  sy = max(0, (h - len(lines)) // 2)
  for i, line in enumerate(lines):
    if sy + i < h - 1:
      try:
        win.addstr(sy + i, 0, line[:w - 1], curses.color_pair(CP_WALL))
      except curses.error:
        pass
  win.refresh()


def title_screen(win):
  _show_lines(win, [
    '',
    '  +==================================+',
    '  |                                  |',
    '  |        T H E   S N A K E        |',
    '  |                                  |',
    '  |   Original: Commodore Plus/4     |',
    '  |             by Alexander JUNG    |',
    '  |                                  |',
    '  |   Port: Python 3 / curses        |',
    '  |                                  |',
    '  |        Press any key ...         |',
    '  |                                  |',
    '  +==================================+',
    '',
  ])
  win.nodelay(False)
  win.getch()


def difficulty_screen(win):
  _show_lines(win, [
    '',
    '  Select difficulty:',
    '',
    '    1 - Easy    (max snake: 70 segments)',
    '    2 - Medium  (max snake: 90 segments)',
    '    3 - Hard    (max snake: 110 segments)',
    '',
    '  Controls:',
    '    Arrow keys or WASD to steer',
    '    Q to quit at any time',
    '',
    '  Rules:',
    '    Eat apples (*) to grow.',
    '    Reach max size to open the exit (O).',
    '    Exit = bonus life + next level.',
    "    Don't hit walls, obstacles, or yourself!",
    '',
  ])
  win.nodelay(False)
  while True:
    key = win.getch()
    if key == ord('1'): return 70
    if key == ord('2'): return 90
    if key == ord('3'): return 110


# ── Entry point ───────────────────────────────────────────────────────────────

def main(stdscr):
  curses.curs_set(0)
  if curses.has_colors():
    _init_colors()

  h, w = stdscr.getmaxyx()
  if h < ROWS + 2 or w < COLS:
    msg = (f'Terminal must be at least {COLS}x{ROWS + 2} '
           f'(got {w}x{h}). Resize and restart.')
    try:
      stdscr.addstr(0, 0, msg)
    except curses.error:
      pass
    stdscr.refresh()
    stdscr.nodelay(False)
    stdscr.getch()
    return

  while True:
    title_screen(stdscr)
    max_len = difficulty_screen(stdscr)
    game = Game(stdscr, max_len)

    while True:
      result = game.run_level()
      if result == 'quit':
        return
      if result == 'gameover':
        game.game_over()
        break
      # 'levelup' or 'died': loop → run_level resets board and restarts


if __name__ == '__main__':
  curses.wrapper(main)
