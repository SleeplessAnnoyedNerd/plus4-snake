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

  // ── Obstacle data ────────────────────────────────────────────────────────────
  const OBSTACLES = (() => {
    const h = (or, c0, n) => Array.from({length: n}, (_, i) => [or - 2, c0 + i]);
    const v = (c, or0, n) => Array.from({length: n}, (_, i) => [or0 - 2 + i, c]);
    const d = (or, c, dr, dc, n) => Array.from({length: n}, (_, i) => [or - 2 + dr*i, c + dc*i]);
    return [
      h(13, 9, 22),
      [...h(13, 9, 22), ...v(20, 7, 7), ...v(19, 14, 6)],
      [...h(13, 9, 22), ...v(9, 7, 13), ...v(30, 7, 13)],
      [...h(13, 6, 28), ...v(20, 5, 15)],
      [...h(8, 4, 15), ...h(13, 9, 22), ...h(18, 21, 15)],
      [...h(8, 4, 12), ...h(8, 24, 12), ...h(18, 4, 12), ...h(18, 24, 12)],
      d(7, 13, 1, 1, 13),
      [...d(7, 5, 1, 1, 12), ...d(7, 34, 1, -1, 12)],
      [...d(5, 3, 1, 1, 10), ...d(5, 20, 1, -1, 10), ...d(12, 10, 1, 1, 10)],
    ];
  })();

  // ── Board drawing ─────────────────────────────────────────────────────────────
  function setupBoard(phase) {
    // Clear all cells
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        clearCell(r, c);

    // Outer walls (top, bottom, left, right)
    for (let c = 0; c < COLS; c++) {
      setCell(0, c, G_WALL, 'wall', '#');
      setCell(ROWS - 1, c, G_WALL, 'wall', '#');
    }
    for (let r = 1; r < ROWS - 1; r++) {
      setCell(r, 0, G_WALL, 'wall', '#');
      setCell(r, COLS - 1, G_WALL, 'wall', '#');
    }

    // Internal obstacles for phase > 1
    if (phase > 1) {
      const pg = (phase - 2) % OBSTACLES.length;
      for (const [r, c] of OBSTACLES[pg])
        if (r >= 1 && r <= ROWS - 2 && c >= 1 && c <= COLS - 2)
          setCell(r, c, G_WALL, 'wall', '#');
    }
  }

  // ── Audio ──────────────────────────────────────────────────────────────────────────
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, duration, type = 'square', vol = 0.15) {
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }
  const SFX = {
    tick:    () => playTone(800, 0.02, 'square', 0.05),
    eat:     () => playTone(400, 0.08, 'square', 0.2),
    death:   () => {
      playTone(200, 0.5, 'sawtooth', 0.3);
      setTimeout(() => playTone(150, 0.4, 'sawtooth', 0.2), 200);
    },
    levelup: () => {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => playTone(f, 0.12, 'square', 0.2), i * 120));
    },
  };

})();
