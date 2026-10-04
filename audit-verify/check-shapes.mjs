// Independent geometry audit of PIECE_SHAPES + rotation simulation.
// Reads the real source file, extracts the literal, validates it.
import { readFileSync } from 'node:fs';

const src = readFileSync('frontend/src/shared/domain/pieces.ts', 'utf8');
const start = src.indexOf('export const PIECE_SHAPES');
const brace = src.indexOf('{', start);
// find matching closing brace
let depth = 0, end = -1;
for (let i = brace; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
let literal = src.slice(brace, end + 1);
literal = literal.replace(/\[PieceType\.(\w+)\]/g, '"$1"');
const SHAPES = eval('(' + literal + ')'); // literal is pure data

const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const cellsOf = (m) => {
  const out = [];
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m[r].length; c++)
      if (m[r][c]) out.push([r, c]);
  return out;
};
const norm = (cells) => {
  const minR = Math.min(...cells.map(c => c[0]));
  const minC = Math.min(...cells.map(c => c[1]));
  return cells.map(([r, c]) => `${r - minR},${c - minC}`).sort().join(' | ');
};
const rot90cw = (cells) => {
  // (r,c) -> (c, maxR - r)
  const maxR = Math.max(...cells.map(c => c[0]));
  return cells.map(([r, c]) => [c, maxR - r]);
};
const centroid = (cells) => {
  const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
  return [rs.reduce((a, b) => a + b, 0) / rs.length, cs.reduce((a, b) => a + b, 0) / cs.length];
};

console.log('=== 1. ФАКТИЧЕСКИЕ МАТРИЦЫ (pieces.ts) ===');
const report = [];
for (const t of TYPES) {
  for (let k = 0; k < 4; k++) {
    const m = SHAPES[t][k];
    const cells = cellsOf(m);
    const rowLens = m.map(r => r.length);
    const ragged = new Set(rowLens).size > 1;
    const prev = SHAPES[t][(k + 3) % 4];
    const isTrueRot = norm(rot90cw(cellsOf(prev))) === norm(cells);
    report.push({
      piece: t, rot: k,
      matrix: m.map(r => r.join(',')).join(' / '),
      cells: cells.length,
      size: `${m.length}x${rowLens.join('/')}`,
      ragged,
      trueRot90: isTrueRot,
      centroid: centroid(cells).map(n => n.toFixed(2)).join(','),
    });
  }
}
for (const r of report) {
  console.log(
    `${r.piece} rot${r.rot} | cells=${r.cells} | size=${r.size} | ragged=${r.ragged ? 'YES' : 'no'} | 90deg-of-prev=${r.trueRot90 ? 'yes' : 'NO'} | centroid=(${r.centroid}) | ${r.matrix}`
  );
}

console.log('\n=== 2. СРАВНЕНИЕ С ЭТАЛОНОМ SRS (канонические нормализованные формы) ===');
// Canonical SRS tetromino cells (row,col) inside their bounding box, rotation 0, then derived by 90 CW.
const CANON = {
  I: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T: [[0, 1], [1, 0], [1, 1], [1, 2]],
  S: [[0, 1], [0, 2], [1, 0], [1, 1]],
  Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
  J: [[0, 0], [1, 0], [1, 1], [1, 2]],
  L: [[0, 2], [1, 0], [1, 1], [1, 2]],
};
for (const t of TYPES) {
  const srs = [];
  let cur = CANON[t];
  for (let k = 0; k < 4; k++) { srs.push(norm(cur)); cur = rot90cw(cur); }
  for (let k = 0; k < 4; k++) {
    const got = norm(cellsOf(SHAPES[t][k]));
    const ok = got === srs[k];
    console.log(`${t} rot${k}: SRS=${srs[k]}  CODE=${got}  ${ok ? 'OK' : 'MISMATCH'}`);
  }
}

console.log('\n=== 3. СИМУЛЯЦИЯ 4 CW-ПОВОРОТОВ НА ПУСТОМ ПОЛЕ 10x20 (kicks из game-engine.ts) ===');
const KICKS = [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
const W = 10, H = 20;
const isValid = (m, x, y) => {
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m[r].length; c++)
      if (m[r][c]) {
        const bx = x + c, by = y + r;
        if (bx < 0 || bx >= W || by < 0 || by >= H) return false;
      }
  return true;
};
for (const t of TYPES) {
  let rot = 0;
  let shape = SHAPES[t][0];
  let x = Math.floor((W - shape[0].length) / 2), y = 0;
  const occupied = (m, px, py) => cellsOf(m).map(([r, c]) => `${py + r},${px + c}`).sort().join(' ');
  let line = `${t}: spawn x=${x} y=${y} [${occupied(shape, x, y)}]`;
  for (let i = 1; i <= 4; i++) {
    const newRot = ((rot + 1) % 4 + 4) % 4;
    const ns = SHAPES[t][newRot];
    let placed = false;
    for (const k of KICKS) {
      if (isValid(ns, x + k.x, y + k.y)) { x += k.x; y += k.y; rot = newRot; shape = ns; placed = true; break; }
    }
    line += `\n   rot${rot} after CW#${i}: ${placed ? 'ok' : 'REJECTED'} pos=(${x},${y}) [${occupied(shape, x, y)}]`;
  }
  console.log(line);
}

console.log('\n=== 4. СМЕЩЕНИЕ ЦЕНТРА МАСС ПРИ ПОВОРОТЕ (прыжок фигуры) ===');
for (const t of TYPES) {
  const shifts = [];
  for (let k = 0; k < 4; k++) {
    const a = centroid(cellsOf(SHAPES[t][k]));
    const b = centroid(cellsOf(SHAPES[t][(k + 1) % 4]));
    shifts.push(`rot${k}->rot${(k + 1) % 4}: dx=${(b[1] - a[1]).toFixed(2)} dy=${(b[0] - a[0]).toFixed(2)}`);
  }
  console.log(`${t}: ${shifts.join(' | ')}`);
}
