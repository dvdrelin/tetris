// Independent verification of the FIXED engine against published SRS wall-kick tables.
// Reference tables below are transcribed in the classic TETRIS-WIKI form, where +y is UP.
// The engine uses +y DOWN, so the reference y is negated at comparison time.
const path = require('node:path');
const B = path.join(__dirname, 'build', 'shared');
const { GameEngine } = require(path.join(B, 'engine', 'game-engine.js'));
const { PIECE_SHAPES, buildPiece } = require(path.join(B, 'domain', 'pieces.js'));
const { PieceType, GameMode } = require(path.join(B, 'domain', 'types.js'));
const { CommandType } = require(path.join(B, 'cqrs', 'commands.js'));

const REF_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '0>3': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
};
const REF_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '3>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '3>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '0>3': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
};
const refTable = t => (t === PieceType.I ? REF_I : REF_JLSTZ);

// --- structural property of SRS: kicks(A->B) === -kicks(B->A) ---
let structBad = 0;
for (const [name, tbl] of [['JLSTZ', REF_JLSTZ], ['I', REF_I]]) {
  for (const key of Object.keys(tbl)) {
    const [a, b] = key.split('>');
    const rev = `${b}>${a}`;
    const ok = tbl[key].every((k, i) => -tbl[rev][i][0] === k[0] && -tbl[rev][i][1] === k[1]);
    if (!ok) { structBad++; console.log(`  ref-table asymmetry: ${name} ${key}`); }
  }
}
console.log(`=== 1. Структурная проверка эталонных таблиц (kicks(A->B) == -kicks(B->A)) ===`);
console.log(structBad === 0 ? '  OK: эталонные таблицы симметричны (16 пар)\n' : `  ОШИБОК: ${structBad}\n`);

// --- behavioural sweep over the real engine ---
const W = 10, H = 20;
const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
let checked = 0, diff = 0, refused = 0;
const perType = {};
const examples = [];

for (const tn of TYPES) {
  const type = PieceType[tn];
  perType[tn] = { checked: 0, diff: 0 };
  for (let startRot = 0; startRot < 4; startRot++) {
    for (let dir of [1, -1]) {
      const to = ((startRot + dir) % 4 + 4) % 4;
      const refKicks = refTable(type)[`${startRot}>${to}`].map(([x, y]) => ({ x, y: -y }));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const e = new GameEngine({});
          e.pieceFactory.nextPieceType = () => type;
          e.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
          const shape = PIECE_SHAPES[type][startRot];
          const piece = buildPiece(type, shape);
          if (!e.isValidPosition(piece, { x, y })) continue;
          e.currentPiece = piece;
          e.currentPos = { x, y };
          e.currentRotation = { index: startRot };
          e._isRunning = true; e._isGameOver = false; e._isPaused = false;

          // reference prediction using the engine's own collision predicate
          let pred = null;
          for (const k of refKicks) {
            const p = { x: x + k.x, y: y + k.y };
            if (e.isValidPosition(buildPiece(type, PIECE_SHAPES[type][to]), p)) { pred = { rot: to, pos: p }; break; }
          }

          e.handleCommand({ type: CommandType.RotatePiece, payload: { direction: dir === 1 ? 'cw' : 'ccw' } });
          const s = e.getGameState();
          const got = { rot: s.currentRotation.index, pos: s.currentPos };
          const moved = got.rot !== startRot || got.pos.x !== x || got.pos.y !== y;
          checked++; perType[tn].checked++;
          const same = pred
            ? (got.rot === pred.rot && got.pos.x === pred.pos.x && got.pos.y === pred.pos.y)
            : !moved;
          if (!same) {
            diff++; perType[tn].diff++;
            if (pred === null) refused++;
            if (examples.length < 6) {
              examples.push(`  ${tn} rot${startRot}${dir === 1 ? 'CW' : 'CCW'} at (x=${x},y=${y}): ` +
                `engine=${got.rot}@${got.pos.x},${got.pos.y}${moved ? '' : ' (refused)'} | ` +
                `SRS=${pred ? `${pred.rot}@${pred.pos.x},${pred.pos.y}` : 'refused'}`);
            }
          }
        }
      }
    }
  }
}

console.log('=== 2. Поведенческий свип реального движка против SRS (10x20, 4 вращения, CW+CCW) ===');
for (const tn of TYPES) console.log(`  ${tn}: проверено ${perType[tn].checked}, расхождений ${perType[tn].diff}`);
console.log(`  ИТОГО: проверено ${checked}, расхождений ${diff} (${(100 * diff / checked).toFixed(2)} %), из них отказов движка ${refused}`);
if (examples.length) { console.log('  примеры:'); console.log(examples.join('\n')); }
