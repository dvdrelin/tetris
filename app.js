// ======================== NEON TETRIS ========================

// ====== CONSTANTS ======
const CELL_SIZE = 24;
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const BOARD_PIXELS_W = BOARD_WIDTH * CELL_SIZE;
const BOARD_PIXELS_H = BOARD_HEIGHT * CELL_SIZE;
const API_URL = 'https://tetris-api-dvdrelin.amvera.io';

// ====== API ======
async function saveScore(playerName, score, mode, level, lines) {
  try {
    const res = await fetch(`${API_URL}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, score, mode, level, linesCleared: lines })
    });
    if (res.ok) console.log('Score saved!');
  } catch (e) {
    console.warn('API save failed:', e);
  }
}

async function getLeaderboard(mode) {
  try {
    const res = await fetch(`${API_URL}/api/leaderboard?mode=${mode || 0}&limit=10`);
    const data = await res.json();
    return data.leaderboard || [];
  } catch (e) {
    console.warn('API leaderboard failed:', e);
    return [];
  }
}

// ====== PIECE DEFINITIONS ======
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const PIECE_COLORS = {
  I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7
};

const SHAPES = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,0,0,1],[0,0,0,1],[0,0,0,1],[0,0,0,1]]
  ],
  O: [
    [[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]]
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]]
  ],
  S: [
    [[0,0,1],[1,1,1],[1,0,0]],
    [[1,0],[1,1],[1,0]],
    [[0,0,1],[1,1,1],[0,0,1]],
    [[0,1],[1,1],[0,1]]
  ],
  Z: [
    [[1,0,0],[1,1,1],[0,0,1]],
    [[0,1],[1,1],[0,1]],
    [[1,0,1],[1,1,1],[0,0,0]],
    [[1,0],[1,1],[1,0]]
  ],
  J: [
    [[1,1,0],[0,0,1],[0,0,1]],
    [[1,0],[1,0],[1,1]],
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1],[0,1],[1,1]]
  ],
  L: [
    [[0,1,1],[0,0,1],[0,0,1]],
    [[1,1],[1,0],[1,0]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1],[0,1],[0,1]]
  ]
};

const CELL_STYLES = {
  0: { bg: '#1a1a2e', border: '#2a2a3e', glow: 'none', text: '#fff' },
  1: { bg: '#00f5ff', border: '#00d4ff', glow: '#00f5ff', text: '#fff' },
  2: { bg: '#ffe600', border: '#ffd700', glow: '#ffe600', text: '#333' },
  3: { bg: '#ff00ff', border: '#ff1493', glow: '#ff00ff', text: '#fff' },
  4: { bg: '#00ff88', border: '#00cc66', glow: '#00ff88', text: '#fff' },
  5: { bg: '#ff4444', border: '#cc0000', glow: '#ff4444', text: '#fff' },
  6: { bg: '#4444ff', border: '#0000cc', glow: '#4444ff', text: '#fff' },
  7: { bg: '#ff8800', border: '#cc6600', glow: '#ff8800', text: '#fff' }
};

const SCORING = { single: 100, double: 300, triple: 500, tetris: 800, softDrop: 10, hardDrop: 20, comboMult: 1.5 };

// ====== GAME ENGINE ======
class GameEngine {
  constructor() {
    this.reset();
    this._skipTick = false;
    this._lastActionTime = 0;
    this._ACTION_DELAY = 100; // prevent double-firing
  }

  reset() {
    this._skipTick = false;
    this._lastActionTime = 0;
    this.bag = [];
    this.board = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
    this.currentPiece = null;
    this.currentPos = { x: 0, y: 0 };
    this.rotation = 0;
    this.nextPiece = this.randomPiece();
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.combo = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.mode = 0; // 0=arcade, 1=hardcore
    this.particles = [];
    this.shuffleBag();
  }

  shuffleBag() {
    this.bag = [...PIECE_TYPES];
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
  }

  randomPiece() {
    if (this.bag.length === 0) this.shuffleBag();
    return this.bag.pop();
  }

  spawnPiece(type) {
    this.currentPiece = type;
    this.rotation = 0;
    const w = SHAPES[type][0].length;
    this.currentPos = { x: Math.floor((BOARD_WIDTH - w) / 2), y: 0 };
    if (!this.isValid(this.currentPos, 0)) {
      this.isGameOver = true;
      this.isRunning = false;
    }
  }

  isValid(pos, rot) {
    const shape = SHAPES[this.currentPiece][(rot || 0) % 4];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          const bx = pos.x + c;
          const by = pos.y + r;
          if (bx < 0 || bx >= BOARD_WIDTH || by >= BOARD_HEIGHT) return false;
          if (by >= 0 && this.board[by][bx] !== 0) return false;
        }
      }
    }
    return true;
  }

  startGame(mode) {
    this.mode = mode;
    this.reset();
    this.spawnPiece(this.nextPiece);
    this.isRunning = true;
    this.isPaused = false;
    this.isGameOver = false;
    this.nextPiece = this.randomPiece();
  }

  move(dx, dy) {
    const now = Date.now();
    if (now - this._lastActionTime < this._ACTION_DELAY) return;
    this._lastActionTime = now;
    if (!this.currentPiece || !this.isRunning || this.isPaused || this.isGameOver) return;
    const newPos = { x: this.currentPos.x + dx, y: this.currentPos.y + dy };
    if (this.isValid(newPos, this.rotation)) {
      this.currentPos = newPos;
      if (dy > 0) this.score += SCORING.softDrop;
    }
  }

  rotate(dir) {
    const now = Date.now();
    if (now - this._lastActionTime < this._ACTION_DELAY) return;
    this._lastActionTime = now;
    if (!this.currentPiece || !this.isRunning || this.isPaused || this.isGameOver) return;
    const newRot = ((this.rotation + dir) % 4 + 4) % 4;
    const kicks = [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
    for (const kick of kicks) {
      const test = { x: this.currentPos.x + kick.x, y: this.currentPos.y + kick.y };
      if (this.isValid(test, newRot)) {
        this.rotation = newRot;
        this.currentPos = test;
        return;
      }
    }
  }

  hardDrop() {
    const now = Date.now();
    if (now - this._lastActionTime < this._ACTION_DELAY) return;
    this._lastActionTime = now;
    if (!this.currentPiece || !this.isRunning || this.isPaused || this.isGameOver) return;
    let dist = 0;
    while (true) {
      const test = { x: this.currentPos.x, y: this.currentPos.y + dist + 1 };
      if (this.isValid(test, this.rotation)) dist++;
      else break;
    }
    this.currentPos.y += dist;
    this.score += SCORING.hardDrop * dist;
    this._skipTick = true;
    this.lockPiece();
  }

  lockPiece() {
    const shape = SHAPES[this.currentPiece][this.rotation];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          const bx = this.currentPos.x + c;
          const by = this.currentPos.y + r;
          if (by >= 0 && by < BOARD_HEIGHT && bx >= 0 && bx < BOARD_WIDTH) {
            this.board[by][bx] = PIECE_COLORS[this.currentPiece];
          }
        }
      }
    }

    // Clear lines
    let linesCleared = 0;
    const newBoard = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (this.board[y].every(c => c !== 0)) {
        linesCleared++;
      } else {
        newBoard.push([...this.board[y]]);
      }
    }
    for (let i = 0; i < linesCleared; i++) {
      newBoard.unshift(Array(BOARD_WIDTH).fill(0));
    }
    this.board = newBoard;

    if (linesCleared > 0) {
      this.combo++;
      this.lines += linesCleared;
      let points = 0;
      switch (linesCleared) {
        case 1: points = SCORING.single; break;
        case 2: points = SCORING.double; break;
        case 3: points = SCORING.triple; break;
        case 4: points = SCORING.tetris; break;
      }
      this.score += Math.floor(points * (1 + (this.combo - 1) * SCORING.comboMult));
      this.spawnParticles(linesCleared);
      if (this.onLineClear) this.onLineClear(linesCleared, this.combo);
    } else {
      this.combo = Math.max(0, this.combo - 0.5);
    }

    // Level up
    const newLevel = Math.floor(this.lines / 10) + 1;
    if (newLevel > this.level) this.level = newLevel;

    // Next piece
    this.spawnPiece(this.nextPiece);
    this.nextPiece = this.randomPiece();

    if (this.onStateChange) this.onStateChange();
  }

  spawnParticles(lines) {
    for (let i = 0; i < lines * 20; i++) {
      this.particles.push({
        x: Math.random() * BOARD_WIDTH,
        y: Math.random() * BOARD_HEIGHT,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        life: 1,
        maxLife: 1,
        color: `hsl(${Math.random() * 360}, 100%, 60%)`,
        size: 0.5 + Math.random() * 1
      });
    }
  }

  updateParticles(dt) {
    this.particles = this.particles.filter(p => {
      p.x += p.vx * dt * 3;
      p.y += p.vy * dt * 3;
      p.life -= dt * 2;
      return p.life > 0;
    });
  }

  getGhostY() {
    if (!this.currentPiece) return -1;
    const shape = SHAPES[this.currentPiece][this.rotation];
    let ghostY = this.currentPos.y;
    while (true) {
      let valid = true;
      const testY = ghostY + 1;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const bx = this.currentPos.x + c;
            const by = testY + r;
            if (by >= BOARD_HEIGHT || bx < 0 || bx >= BOARD_WIDTH) { valid = false; break; }
            if (by >= 0 && this.board[by]?.[bx] !== 0) { valid = false; break; }
          }
        }
        if (!valid) break;
      }
      if (valid) ghostY++;
      else break;
    }
    return ghostY;
  }

  getTickInterval() {
    const interval = Math.max(50, 800 - (this.level - 1) * 50);
    return interval;
  }

  tick() {
    if (this._skipTick) {
      this._skipTick = false;
      return;
    }
    if (!this.currentPiece || !this.isRunning || this.isPaused || this.isGameOver) return;
    const newPos = { x: this.currentPos.x, y: this.currentPos.y + 1 };
    if (this.isValid(newPos, this.rotation)) {
      this.currentPos = newPos;
    } else {
      this.lockPiece();
    }
    if (this.onStateChange) this.onStateChange();
  }

  togglePause() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    if (this.onStateChange) this.onStateChange();
  }

  getState() {
    return {
      board: this.board.map(r => [...r]),
      currentPiece: this.currentPiece,
      currentPos: { ...this.currentPos },
      rotation: this.rotation,
      nextPiece: this.nextPiece,
      score: this.score,
      level: this.level,
      lines: this.lines,
      combo: this.combo,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isGameOver: this.isGameOver,
      mode: this.mode,
      ghostY: this.getGhostY(),
      particles: [...this.particles]
    };
  }
}

// ====== UI ======
class UI {
  constructor(engine) {
    this.engine = engine;
    this.engine.onStateChange = () => this.render();
    this.engine.onLineClear = (lines, combo) => {
      this.showCombo(lines, combo);
    };
    this.state = this.engine.getState();
    this.selectedMode = 0;
    this.hoveredMode = null;
    this.showMenu = true;
    this.showPause = false;
    this.showGameOver = false;
    this.showLeaderboard = false;
    this.leaderData = [];
    this.playerName = '';
    this.saved = false;
  }

  init() {
    const app = document.getElementById('app');
    if (!app) return;

    // Create menu
    app.innerHTML = `
      <div id="menu" class="menu">
        <div class="menu-title">
          <h1 class="title">TETRIS</h1>
          <div class="title-line"></div>
        </div>
        <div class="mode-selector">
          <div class="mode-card" data-mode="0" id="arcade-card">
            <div class="mode-icon">🎮</div>
            <div class="mode-name">Аркадный</div>
            <div class="mode-desc">Быстрый темп, комбо-система, яркие эффекты</div>
          </div>
          <div class="mode-card" data-mode="1" id="hardcore-card">
            <div class="mode-icon">⚡</div>
            <div class="mode-name">Хардкор</div>
            <div class="mode-desc">Реальное время, максимальная сложность</div>
          </div>
        </div>
        <button class="start-btn" id="start-btn">ИГРАТЬ</button>
        <div class="controls">
          <div class="control-row"><span class="key">← →</span><span class="action">Движение</span></div>
          <div class="control-row"><span class="key">↑ / ↓</span><span class="action">Вращение / Сброс</span></div>
          <div class="control-row"><span class="key">SPACE</span><span class="action">Hard Drop</span></div>
          <div class="control-row"><span class="key">P</span><span class="action">Пауза</span></div>
        </div>
      </div>
      <div id="game" class="game hidden">
        <canvas id="board" width="${BOARD_PIXELS_W}" height="${BOARD_PIXELS_H}"></canvas>
        <div class="hud">
          <div class="hud-section">
            <div class="hud-title">СЧЁТ</div>
            <div class="hud-value" id="score">0</div>
          </div>
          <div class="hud-section">
            <div class="hud-title">УРОВЕНЬ</div>
            <div class="hud-value" id="level">1</div>
          </div>
          <div class="hud-section">
            <div class="hud-title">ЛИНИИ</div>
            <div class="hud-value" id="lines">0</div>
          </div>
          <div class="hud-section">
            <div class="hud-title">КОМБО</div>
            <div class="hud-value" id="combo">x0</div>
          </div>
          <div class="hud-section next-piece-section">
            <div class="hud-title">СЛЕДУЮЩИЙ</div>
            <canvas id="next-piece" width="80" height="80"></canvas>
          </div>
          <div class="hud-section controls-section">
            <div class="hud-title">УПРАВЛЕНИЕ</div>
            <div class="control-item"><span class="key">← →</span> Движение</div>
            <div class="control-item"><span class="key">↑</span> Вращение</div>
            <div class="control-item"><span class="key">↓</span> Soft Drop</div>
            <div class="control-item"><span class="key">SPACE</span> Hard Drop</div>
            <div class="control-item"><span class="key">P</span> Пауза</div>
          </div>
        </div>
      </div>
    `;

    // Menu events
    document.getElementById('arcade-card').addEventListener('mouseenter', () => { this.hoveredMode = 0 });
    document.getElementById('arcade-card').addEventListener('mouseleave', () => { this.hoveredMode = null });
    document.getElementById('hardcore-card').addEventListener('mouseenter', () => { this.hoveredMode = 1 });
    document.getElementById('hardcore-card').addEventListener('mouseleave', () => { this.hoveredMode = null });
    document.getElementById('arcade-card').addEventListener('click', () => { this.selectedMode = 0; this.updateModeCards() });
    document.getElementById('hardcore-card').addEventListener('click', () => { this.selectedMode = 1; this.updateModeCards() });

    const startBtn = document.getElementById('start-btn');
    startBtn.addEventListener('click', () => {
      this.startGame(this.selectedMode);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => this.handleKey(e));

    // Game canvas
    this.boardCanvas = document.getElementById('board');
    this.boardCtx = this.boardCanvas.getContext('2d');
    this.nextCanvas = document.getElementById('next-piece');
    this.nextCtx = this.nextCanvas?.getContext('2d');

    // Touch controls
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    this.boardCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    }, { passive: false });

    this.boardCanvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      const dt = Date.now() - touchStartTime;

      const state = this.engine.getState();
      if (state.isGameOver) {
        this.engine.startGame(this.engine.mode);
        return;
      }
      if (!state.isRunning || state.isPaused) return;

      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        // Tap - rotate
        this.engine.rotate(1);
      } else if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal swipe
        this.engine.move(dx > 0 ? 1 : -1, 0);
      } else {
        // Vertical swipe
        if (dy > 100) this.engine.hardDrop(); // Long swipe down = hard drop
        else if (dy > 50) this.engine.move(0, 1); // Short swipe down = soft drop
        else this.engine.move(0, -1); // Swipe up
      }
    }, { passive: false });

    // Keyboard
    document.addEventListener('keydown', (e) => this.handleKey(e));

    // Game loop
    this.lastTime = 0;
    this.tickAccumulator = 0;
    this.gameLoop = this.animate.bind(this);
    requestAnimationFrame(this.gameLoop);
  }

  updateModeCards() {
    const arcadeCard = document.getElementById('arcade-card');
    const hardcoreCard = document.getElementById('hardcore-card');
    if (this.selectedMode === 0) {
      arcadeCard.style.borderColor = '#00f5ff';
      arcadeCard.style.boxShadow = '0 0 30px rgba(0,245,255,0.3)';
      hardcoreCard.style.borderColor = '#2a2a3e';
      hardcoreCard.style.boxShadow = 'none';
    } else {
      hardcoreCard.style.borderColor = '#00f5ff';
      hardcoreCard.style.boxShadow = '0 0 30px rgba(0,245,255,0.3)';
      arcadeCard.style.borderColor = '#2a2a3e';
      arcadeCard.style.boxShadow = 'none';
    }
  }

  startGame(mode) {
    this.engine.startGame(mode);
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    this.state = this.engine.getState();
    this.render();
  }

  showMainMenu() {
    document.getElementById('game').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
  }

  handleKey(e) {
    const state = this.engine.getState();
    if (state.isGameOver && e.key === 'Enter') {
      this.engine.startGame(this.engine.mode);
      return;
    }

    if (state.isGameOver && e.key === 's' && !this.saved) {
      e.preventDefault();
      this.saveScore();
      return;
    }

    if (!state.isRunning || state.isPaused) return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'a': e.preventDefault(); this.engine.move(-1, 0); break;
      case 'ArrowRight':
      case 'd': e.preventDefault(); this.engine.move(1, 0); break;
      case 'ArrowDown':
      case 's': e.preventDefault(); this.engine.move(0, 1); break;
      case ' ': e.preventDefault(); this.engine.hardDrop(); break;
      case 'x': case 'z': case 'c': case 'w': case 'ArrowUp': e.preventDefault(); this.engine.rotate(1); break;
      case 'q': case 'Q': e.preventDefault(); this.engine.rotate(-1); break;
      case 'p': case 'P': case 'Escape': e.preventDefault(); this.engine.togglePause(); break;
    }
  }

  animate(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    const state = this.engine.getState();

    // Auto-tick
    if (state.isRunning && !state.isPaused && !state.isGameOver) {
      this.tickAccumulator += dt * 1000;
      if (this.tickAccumulator >= this.engine.getTickInterval()) {
        this.tickAccumulator = 0;
        if (!this.engine._skipTick) {
          this.engine._skipTick = false;
          this.engine.tick();
        }
      }
    }

    // Update particles
    this.engine.updateParticles(dt);

    // Render
    this.render();

    requestAnimationFrame(this.gameLoop);
  }

  render() {
    const state = this.engine.getState();
    this.state = state;

    // Update HUD
    const scoreEl = document.getElementById('score');
    if (scoreEl) {
      scoreEl.textContent = this.formatNumber(state.score);
      scoreEl.style.color = state.score > 10000 ? '#ff00ff' : '#00f5ff';
    }
    const levelEl = document.getElementById('level');
    if (levelEl) levelEl.textContent = state.level;
    const linesEl = document.getElementById('lines');
    if (linesEl) linesEl.textContent = state.lines;
    const comboEl = document.getElementById('combo');
    if (comboEl) {
      comboEl.textContent = 'x' + Math.floor(state.combo);
      comboEl.style.color = state.combo > 1 ? '#ffe600' : '#888';
    }

    // Draw board
    const ctx = this.boardCtx;
    if (!ctx) return;

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }

    // Placed cells
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const val = state.board[y]?.[x];
        if (val > 0) {
          const s = CELL_STYLES[val];
          ctx.fillStyle = s.bg;
          ctx.shadowColor = s.glow;
          ctx.shadowBlur = 5;
          ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2);
        }
      }
    }

    // Ghost piece
    if (state.currentPiece && state.ghostY >= 0) {
      const shape = SHAPES[state.currentPiece][state.rotation];
      ctx.globalAlpha = 0.3;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const x = (state.currentPos.x + c) * CELL_SIZE;
            const y = (state.ghostY + r) * CELL_SIZE;
            const s = CELL_STYLES[PIECE_COLORS[state.currentPiece]];
            ctx.strokeStyle = s.bg;
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Current piece
    if (state.currentPiece) {
      const shape = SHAPES[state.currentPiece][state.rotation];
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const x = (state.currentPos.x + c) * CELL_SIZE;
            const y = (state.currentPos.y + r) * CELL_SIZE;
            const color = PIECE_COLORS[state.currentPiece];
            const s = CELL_STYLES[color];
            ctx.fillStyle = s.bg;
            ctx.shadowColor = s.glow;
            ctx.shadowBlur = 8;
            ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
        }
      }
    }

    // Particles
    state.particles?.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x * CELL_SIZE, p.y * CELL_SIZE, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Overlays
    if (state.isPaused) {
      ctx.fillStyle = 'rgba(10,10,26,0.8)';
      ctx.fillRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);
      ctx.fillStyle = '#00f5ff';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ПАУЗА', this.boardCanvas.width / 2, this.boardCanvas.height / 2);
      ctx.font = '16px monospace';
      ctx.fillStyle = '#888';
      ctx.fillText('Нажмите P для продолжения', this.boardCanvas.width / 2, this.boardCanvas.height / 2 + 40);
    }

    if (state.isGameOver) {
      ctx.fillStyle = 'rgba(10,10,26,0.9)';
      ctx.fillRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', this.boardCanvas.width / 2, this.boardCanvas.height / 2 - 20);
      ctx.fillStyle = '#00f5ff';
      ctx.font = '20px monospace';
      ctx.fillText('Счёт: ' + state.score, this.boardCanvas.width / 2, this.boardCanvas.height / 2 + 20);
      ctx.fillStyle = '#888';
      ctx.font = '16px monospace';
      ctx.fillText('Нажмите ENTER для рестарта', this.boardCanvas.width / 2, this.boardCanvas.height / 2 + 50);

      // Save score button
      ctx.fillStyle = '#00f5ff';
      ctx.font = '14px monospace';
      ctx.fillText('Нажмите S для сохранения рекорда', this.boardCanvas.width / 2, this.boardCanvas.height / 2 + 80);
    }

    // Next piece
    if (this.nextCtx && state.nextPiece) {
      const shape = SHAPES[state.nextPiece][0];
      const cellSize = 18;
      const w = shape[0].length * cellSize + 4;
      const h = shape.length * cellSize + 4;
      this.nextCanvas.width = w;
      this.nextCanvas.height = h;
      this.nextCtx.fillStyle = '#1a1a2e';
      this.nextCtx.fillRect(0, 0, w, h);
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c]) {
            const x = c * cellSize + 2;
            const y = r * cellSize + 2;
            const color = PIECE_COLORS[state.nextPiece];
            const s = CELL_STYLES[color];
            this.nextCtx.fillStyle = s.bg;
            this.nextCtx.shadowColor = s.glow;
            this.nextCtx.shadowBlur = 5;
            this.nextCtx.fillRect(x, y, cellSize - 2, cellSize - 2);
            this.nextCtx.shadowBlur = 0;
            this.nextCtx.fillStyle = 'rgba(255,255,255,0.2)';
            this.nextCtx.fillRect(x + 1, y + 1, cellSize - 3, (cellSize - 3) / 2);
          }
        }
      }
    }
  }

  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  showCombo(lines, combo) {
    const flash = document.createElement('div');
    flash.className = 'combo-flash';
    const name = lines === 4 ? 'TETRIS' : lines === 3 ? 'TRIPLE' : lines === 2 ? 'DOUBLE' : 'SINGLE';
    flash.textContent = `COMBO x${Math.floor(combo)}! ${name}`;
    flash.style.cssText = `
      position: fixed; top: 30%; left: 50%; transform: translate(-50%, -50%);
      font-size: 48px; font-weight: 900; color: #ffe600;
      text-shadow: 0 0 20px #ffe600, 0 0 40px #ff00ff;
      z-index: 100; pointer-events: none;
      animation: comboFlash 1s ease-out forwards;
    `;
    document.getElementById('app').appendChild(flash);
    setTimeout(() => flash.remove(), 1000);
  }

  saveScore() {
    const state = this.engine.getState();
    const name = prompt('Введите ваше имя:') || 'Player';
    // Save to API + localStorage fallback
    saveScore(name, state.score, state.mode, state.level, state.lines)
      .catch(() => {}); // fallback to localStorage
    const scores = JSON.parse(localStorage.getItem('neon-tetris-scores') || '[]');
    scores.push({ name, score: state.score, level: state.level, lines: state.lines, mode: state.mode, date: new Date().toISOString() });
    scores.sort((a, b) => b.score - a.score);
    localStorage.setItem('neon-tetris-scores', JSON.stringify(scores.slice(0, 50)));
    this.saved = true;
    const overlay = document.querySelector('#board').parentElement;
    const saved = document.createElement('div');
    saved.style.cssText = `
      position: absolute; top: 70%; left: 50%; transform: translate(-50%, -50%);
      font-size: 20px; color: #00ff88; text-shadow: 0 0 10px #00ff88;
      z-index: 100; pointer-events: none;
    `;
    saved.textContent = 'РЕКОРД СОХРАНЁН!';
    overlay.appendChild(saved);
    setTimeout(() => saved.remove(), 2000);
  }
}

// ====== LEADERBOARD ======
function getLeaderboard(mode) {
  return JSON.parse(localStorage.getItem('neon-tetris-scores') || '[]')
    .filter(s => mode === undefined || s.mode === mode)
    .slice(0, 10);
}

function showLeaderboard() {
  const overlay = document.getElementById('leaderboard-overlay');
  if (overlay) {
    overlay.classList.toggle('hidden');
    return;
  }

  const lb = document.createElement('div');
  lb.id = 'leaderboard-overlay';
  lb.className = 'hidden';
  lb.innerHTML = `
    <div class="lb-container">
      <h2>🏆 РЕКОРДЫ</h2>
      <div class="lb-tabs">
        <button class="lb-tab active" data-mode="all">Все</button>
        <button class="lb-tab" data-mode="0">Аркадный</button>
        <button class="lb-tab" data-mode="1">Хардкор</button>
      </div>
      <div class="lb-list" id="lb-list"></div>
      <button class="lb-close" id="lb-close">✕</button>
    </div>
  `;
  lb.classList.add('hidden');
  document.getElementById('app').appendChild(lb);

  const list = document.getElementById('lb-list');
  function renderList(mode) {
    const scores = getLeaderboard(mode);
    list.innerHTML = scores.length === 0
      ? '<div class="lb-empty">Пока нет рекордов</div>'
      : scores.map((s, i) => `
          <div class="lb-entry">
            <span class="lb-rank">#${i + 1}</span>
            <span class="lb-name">${s.name}</span>
            <span class="lb-score">${s.score}</span>
          </div>
        `).join('');
  }
  renderList('all');

  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      renderList(mode === 'all' ? undefined : parseInt(mode));
    });
  });

  document.getElementById('lb-close').addEventListener('click', () => {
    lb.classList.add('hidden');
    lb.remove();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Add leaderboard button to menu
  const menu = document.getElementById('menu');
  if (menu) {
    const lbBtn = document.createElement('button');
    lbBtn.className = 'lb-btn';
    lbBtn.textContent = '🏆 Рекорды';
    lbBtn.addEventListener('click', showLeaderboard);
    menu.appendChild(lbBtn);
  }

  try {
    const engine = new GameEngine();
    const ui = new UI(engine);
    ui.init();

    // Background particles
    const bgCanvas = document.createElement('canvas');
    bgCanvas.id = 'bg-canvas';
    document.body.prepend(bgCanvas);
    const bgCtx = bgCanvas.getContext('2d');
    const bgParticles = [];
    for (let i = 0; i < 50; i++) {
      bgParticles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 1 + Math.random() * 2,
        color: `hsla(${Math.random() * 360}, 80%, 60%, 0.3)`,
      });
    }
    function animateBg() {
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      bgParticles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
        if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
        bgCtx.fillStyle = p.color;
        bgCtx.beginPath();
        bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        bgCtx.fill();
      });
      requestAnimationFrame(animateBg);
    }
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    animateBg();
    window.addEventListener('resize', () => {
      bgCanvas.width = window.innerWidth;
      bgCanvas.height = window.innerHeight;
    });
  } catch (e) {
    console.error('Error initializing game:', e);
    console.error('Stack:', e.stack);
    document.getElementById('app').innerHTML = `<div style="color:red;padding:20px;">
      <h2>Ошибка:</h2><pre>${e.message}</pre><pre>${e.stack}</pre>
    </div>`;
  }
});
