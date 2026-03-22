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

  // ── Directions ─────────────────────────────────────────────────────────────
  const UP = [-1, 0], DOWN = [1, 0], LEFT = [0, -1], RIGHT = [0, 1];
  function isOpposite(a, b) { return a[0] === -b[0] && a[1] === -b[1]; }
  const CORNERS = {
    [[-1,0]+','+[0,1]]:   '╰',  // UP + RIGHT
    [[-1,0]+','+[0,-1]]:  '╯',  // UP + LEFT
    [[1,0]+','+[0,1]]:    '╭',  // DOWN + RIGHT
    [[1,0]+','+[0,-1]]:   '╮',  // DOWN + LEFT
    [[0,-1]+','+[-1,0]]:  '╯',  // LEFT + UP
    [[0,-1]+','+[1,0]]:   '╮',  // LEFT + DOWN
    [[0,1]+','+[-1,0]]:   '╰',  // RIGHT + UP
    [[0,1]+','+[1,0]]:    '╭',  // RIGHT + DOWN
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let snake, direction, requestedDir, prevDir, grow;
  let score, lives, phase, maxLen, exitOpen, loopId;

  // ── Input ──────────────────────────────────────────────────────────────────
  const KEY_MAP = {
    ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
    w: UP, W: UP, s: DOWN, S: DOWN, a: LEFT, A: LEFT, d: RIGHT, D: RIGHT,
  };
  document.addEventListener('keydown', e => {
    const nd = KEY_MAP[e.key];
    if (nd && direction && !isOpposite(nd, direction)) { requestedDir = nd; e.preventDefault(); }
  });

  // ── Food ───────────────────────────────────────────────────────────────────
  function placeFood() {
    const empty = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++)
        if (lgrid[r][c] === G_EMPTY) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    setCell(r, c, G_FOOD, 'food', '*');
  }

  // ── Level init ─────────────────────────────────────────────────────────────
  function initLevel() {
    snake = [[START_R, START_C]];
    direction = UP;
    requestedDir = UP;
    prevDir = UP;
    grow = 5;
    exitOpen = false;
    setupBoard(phase);
    placeFood();
    drawStatus(score, lives, phase);
    setCell(START_R, START_C, G_SNAKE, 'head', '@');
  }

  // ── Body char ──────────────────────────────────────────────────────────────
  function bodyChar(pd, nd) {
    if (pd[0] === nd[0] && pd[1] === nd[1])
      return nd[1] === 0 ? '│' : '─';
    return CORNERS[pd.toString() + ',' + nd.toString()] || '─';
  }

  // ── Tick ───────────────────────────────────────────────────────────────────
  function tick() {
    // Apply direction (block 180° reversal)
    if (!isOpposite(requestedDir, direction)) {
      prevDir = direction;
      direction = requestedDir;
    }

    const [hr, hc] = snake[0];
    // Replace old head cell with correct body/corner character
    setCell(hr, hc, G_SNAKE, 'snake', bodyChar(prevDir, direction));

    // New head position
    const nr = hr + direction[0];
    const nc = hc + direction[1];
    const cell = lgrid[nr][nc];

    if (cell === G_EXIT) {
      score += phase * 10;
      lives += 1;
      phase += 1;
      SFX.levelup();
      clearLoop();
      setTimeout(() => { initLevel(); startLoop(); }, 600);
      return;
    }

    if (cell === G_WALL || cell === G_SNAKE) {
      SFX.death();
      lives -= 1;
      clearLoop();
      setTimeout(() => deathAnimation(() => {
        if (lives <= 0) showGameOver();
        else { initLevel(); startLoop(); }
      }), 50);
      return;
    }

    // Move: push new head
    snake.unshift([nr, nc]);
    setCell(nr, nc, G_SNAKE, 'head', '@');

    if (cell === G_FOOD) {
      score += 10;
      grow = 5;
      SFX.eat();
      placeFood();
    } else {
      // Normal move: erase tail unless growing
      if (grow >= 0) {
        grow--;
      } else {
        const [tr, tc] = snake.pop();
        clearCell(tr, tc);
      }
    }

    SFX.tick();
    drawStatus(score, lives, phase);

    // Open exit when max length reached
    if (!exitOpen && snake.length >= maxLen) {
      exitOpen = true;
      setCell(EXIT_R, EXIT_C_POS, G_EXIT, 'exit', 'O');
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────────
  function startLoop() { loopId = setInterval(tick, TICK_MS); }
  function clearLoop() { clearInterval(loopId); loopId = null; }

  // ── Death animation ────────────────────────────────────────────────────────
  function deathAnimation(cb) {
    const [hr, hc] = snake[0];
    let i = 0;
    const flash = setInterval(() => {
      cells[hr][hc].textContent = i % 2 === 0 ? '!' : '@';
      cells[hr][hc].className   = i % 2 === 0 ? 'food' : 'head';
      if (++i >= 8) {
        clearInterval(flash);
        const segs = [...snake].reverse();
        let j = 0;
        const unwind = setInterval(() => {
          if (j >= segs.length) { clearInterval(unwind); setTimeout(cb, 300); return; }
          const [r, c] = segs[j++];
          clearCell(r, c);
        }, 30);
      }
    }, 80);
  }

  // ── Overlay ─────────────────────────────────────────────────────────────────
  function showOverlay(html) {
    overlayEl.innerHTML = html;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('hidden');
  }

  // ── Title screen ─────────────────────────────────────────────────────────────
  function showTitle() {
    showOverlay(`
<h1>T H E &nbsp; S N A K E</h1>
<p>Original: Commodore Plus/4 &middot; Alexander JUNG</p>
<p class="dim">Port: JavaScript / CSS</p>
<p>&nbsp;</p>
<p>Press <b>any key</b> to start</p>
    `);
    function onKey() {
      document.removeEventListener('keydown', onKey);
      hideOverlay();
      showDifficulty();
    }
    document.addEventListener('keydown', onKey);
  }

  // ── Difficulty screen ─────────────────────────────────────────────────────────
  function showDifficulty() {
    showOverlay(`
<h1>SELECT DIFFICULTY</h1>
<p><b>1</b> &middot; Easy &nbsp;&nbsp; &mdash; max snake: 70</p>
<p><b>2</b> &middot; Medium &mdash; max snake: 90</p>
<p><b>3</b> &middot; Hard &nbsp;&nbsp; &mdash; max snake: 110</p>
<p>&nbsp;</p>
<p class="dim">Arrow keys / WASD to steer</p>
<p class="dim">Eat <b style="color:#ff0">*</b> to grow &middot; reach max length to open exit <b style="color:#0ff">O</b></p>
<p class="dim">Exit = bonus life + next level</p>
    `);
    function onKey(e) {
      const ml = e.key === '1' ? 70 : e.key === '2' ? 90 : e.key === '3' ? 110 : 0;
      if (!ml) return;
      document.removeEventListener('keydown', onKey);
      hideOverlay();
      maxLen = ml;
      score = 0; lives = 5; phase = 1;
      initLevel();
      startLoop();
    }
    document.addEventListener('keydown', onKey);
  }

  // ── Game over screen ──────────────────────────────────────────────────────────
  function showGameOver() {
    clearLoop();
    showOverlay(`
<h1>G A M E &nbsp; O V E R</h1>
<p>&nbsp;</p>
<p>  .--.</p>
<p>  |  |   R . I . P .</p>
<p>  |  |</p>
<p>  |  |   THE SNAKE</p>
<p>  '--'</p>
<p>&nbsp;</p>
<p>Final score: <b>${score}</b></p>
<p>&nbsp;</p>
<p>Press <b>any key</b> to play again</p>
    `);
    function onKey() {
      document.removeEventListener('keydown', onKey);
      hideOverlay();
      showDifficulty();
    }
    document.addEventListener('keydown', onKey);
  }

  // ── Start ─────────────────────────────────────────────────────────────────────
  hideOverlay();
  showTitle();

})();
