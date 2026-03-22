(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────
  const ROWS        = 23;
  const COLS        = 40;
  const TICK_MS     = 100;
  const START_R     = 21;
  const START_C     = 20;
  const EXIT_R      = 0;
  const EXIT_C_POS  = 19;

  const G_EMPTY = 0;
  const G_WALL  = 1;
  const G_FOOD  = 2;
  const G_SNAKE = 3;
  const G_EXIT  = 4;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const statusEl  = document.getElementById('status');
  const gridEl    = document.getElementById('grid');
  const overlayEl = document.getElementById('overlay');

  // ── Build 920 grid cells ─────────────────────────────────────────────────────
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    cells[r] = [];
    for (let c = 0; c < COLS; c++) {
      const d = document.createElement('div');
      d.textContent = ' ';
      gridEl.appendChild(d);
      cells[r][c] = d;
    }
  }

  // ── Logical grid ─────────────────────────────────────────────────────────────
  const lgrid = Array.from({ length: ROWS }, () => new Uint8Array(COLS));

  // ── Cell helpers ─────────────────────────────────────────────────────────────
  function setCell(r, c, val, cls, ch) {
    const d = cells[r][c];
    lgrid[r][c]  = val;
    d.className  = cls;
    d.textContent = ch;
  }

  function clearCell(r, c) {
    setCell(r, c, G_EMPTY, '', ' ');
  }

  // ── Status bar ───────────────────────────────────────────────────────────────
  function drawStatus(score, lives, phase) {
    const raw = ' SCORE:' + String(score).padStart(5, '0') +
                '  LIVES:' + lives +
                '  LEVEL:' + String(phase).padStart(2, '0') +
                '  THE SNAKE ';
    statusEl.textContent = raw.padEnd(COLS, ' ').slice(0, COLS);
  }

})();
