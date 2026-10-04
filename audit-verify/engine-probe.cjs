// Runtime audit against the REAL compiled engine (frontend/src/shared/**).
const path = require('node:path');
const B = path.join(__dirname, 'build', 'shared');
const { GameEngine } = require(path.join(B, 'engine', 'game-engine.js'));
const { PIECE_SHAPES, buildPiece } = require(path.join(B, 'domain', 'pieces.js'));
const { PieceType, GameMode } = require(path.join(B, 'domain', 'types.js'));
const { CommandType } = require(path.join(B, 'cqrs', 'commands.js'));

const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const W = 10, H = 20;

function makeEngine(script) {
  let i = 0;
  const e = new GameEngine({});
  e.pieceFactory.nextPieceType = () => script[i++ % script.length];
  e.handleCommand({ type: CommandType.StartGame, payload: { mode: GameMode.Arcade } });
  return e;
}
function occupied(e) {
  const s = e.getGameState();
  const out = [];
  for (let r = 0; r < s.currentPiece.shape.length; r++)
    for (let c = 0; c < s.currentPiece.shape[r].length; c++)
      if (s.currentPiece.shape[r][c]) out.push(`${s.currentPos.y + r},${s.currentPos.x + c}`);
  return out;
}
function boardCells(e) {
  const s = e.getGameState();
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (s.board[y][x].locked) out.push(`${y},${x}`);
  return out;
}
const cw = (e) => e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } });
const ccw = (e) => e.handleCommand({ type: CommandType.RotatePiece, payload: { direction: 'ccw' } });

console.log('=== A. РЕАЛЬНЫЙ ДВИЖОК: спавн + 4 CW-поворота (число клеток текущей фигуры) ===');
for (const t of TYPES) {
  const e = makeEngine([PieceType[t]]);
  const seq = [occupied(e).length];
  const detail = [`spawn rot${e.getGameState().currentRotation.index} pos=(${e.getGameState().currentPos.x},${e.getGameState().currentPos.y}) cells=${seq[0]}`];
  for (let k = 0; k < 4; k++) {
    cw(e);
    const s = e.getGameState();
    seq.push(occupied(e).length);
    detail.push(`rot${s.currentRotation.index} pos=(${s.currentPos.x},${s.currentPos.y}) cells=${occupied(e).length} [${occupied(e).join(' ')}]`);
  }
  const uniq = new Set(seq);
  console.log(`${t}: ${seq.join(' -> ')}  ${uniq.size === 1 ? 'OK (всегда 4)' : '<<< ДЕФЕКТ: фигура меняет число клеток'}`);
  console.log('    ' + detail.join('\n    '));
}

console.log('\n=== B. CW против CCW: симметрия (после CW+CCW фигура должна вернуться) ===');
for (const t of TYPES) {
  const e = makeEngine([PieceType[t]]);
  const before = { pos: { ...e.getGameState().currentPos }, rot: e.getGameState().currentRotation.index, cells: occupied(e).length };
  cw(e); ccw(e);
  const after = { pos: { ...e.getGameState().currentPos }, rot: e.getGameState().currentRotation.index, cells: occupied(e).length };
  const same = before.rot === after.rot && before.pos.x === after.pos.x && before.pos.y === after.pos.y && before.cells === after.cells;
  console.log(`${t}: CW+CCW -> ${same ? 'OK' : `ДЕФЕКТ: pos (${before.pos.x},${before.pos.y}) rot${before.rot} cells${before.cells}  =>  (${after.pos.x},${after.pos.y}) rot${after.rot} cells${after.cells}`}`);
}

console.log('\n=== C. Поворот у стены (левая/правая граница) — хватает ли 5 kicks ===');
for (const t of TYPES) {
  const e = makeEngine([PieceType[t]]);
  for (let i = 0; i < 12; i++) e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'left' } });
  const p0 = { ...e.getGameState().currentPos };
  cw(e);
  const s1 = e.getGameState();
  const rotChanged = s1.currentRotation.index !== 0;
  console.log(`${t} left-wall: pos=(${p0.x},${p0.y}) -> rot=${s1.currentRotation.index} pos=(${s1.currentPos.x},${s1.currentPos.y}) cells=${occupied(e).length} ${rotChanged ? 'rotation applied' : 'ROTATION REJECTED'}`);
}

console.log('\n=== D. I-фигура: вертикальная постановка у правой стены (SRS требует kick {+2,0}) ===');
{
  const e = makeEngine([PieceType.I]);
  for (let i = 0; i < 12; i++) e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } });
  const p0 = { ...e.getGameState().currentPos };
  cw(e);
  const s = e.getGameState();
  console.log(`I right-wall: spawn pos=(${p0.x},${p0.y}) rot0; после CW: rot=${s.currentRotation.index} pos=(${s.currentPos.x},${s.currentPos.y}) cells=[${occupied(e).join(' ')}]`);
  // hard drop to floor, then try rotate to horizontal (SRS I floor kick)
  e.handleCommand({ type: CommandType.HardDrop });
  const e2 = makeEngine([PieceType.I]);
  for (let i = 0; i < 12; i++) e2.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } });
  cw(e2); cw(e2);
  const s2 = e2.getGameState();
  console.log(`I right-wall 2xCW: rot=${s2.currentRotation.index} pos=(${s2.currentPos.x},${s2.currentPos.y}) cells=[${occupied(e2).join(' ')}]`);
}

console.log('\n=== E. softDrop: перезапись уже зафиксированных клеток поля ===');
{
  const e = makeEngine([PieceType.O]);
  const s0 = e.getGameState();
  // Fill the landing row under the spawned O with a locked block by hand (эмуляция уже упавшей фигуры)
  e.boardManager.setCell(s0.currentPos.x, s0.currentPos.y + 3, 5, true);
  e.boardManager.setCell(s0.currentPos.x + 1, s0.currentPos.y + 3, 6, true);
  const before = boardCells(e);
  for (let i = 0; i < 6; i++) e.handleCommand({ type: CommandType.SoftDrop });
  const after = boardCells(e);
  console.log('locked-клетки ДО soft drop: ' + before.join(' '));
  console.log('locked-клетки ПОСЛЕ (piece placed): ' + after.join(' '));
  const lost = before.filter(c => !after.includes(c));
  console.log(lost.length ? `<<< ДЕФЕКТ: пропавшие клетки поля: ${lost.join(' ')}` : 'OK: клетки поля сохранены');
  console.log('score после soft drop = ' + e.getScore() + ' (softDrop начисляется даже при валидности? см. game-engine.ts:200-208)');
}

console.log('\n=== F. softDrop под землю: часть фигуры исчезает ===');
{
  const e = makeEngine([PieceType.I]);
  cw(e); // vertical I, rot1
  for (let i = 0; i < 30; i++) e.handleCommand({ type: CommandType.SoftDrop });
  const after = boardCells(e);
  console.log('locked-клетки после 30 soft drop вертикальной I: ' + after.join(' ') + ` (всего ${after.length})`);
}

console.log('\n=== G. Hardcore: отказ вращения = мгновенная смерть ===');
{
  const e = new GameEngine({});
  let i = 0;
  e.pieceFactory.nextPieceType = () => [PieceType.I, PieceType.O][i++ % 2];
  e.handleCommand({ type: CommandType.StartGame, payload: { hardcore: true } });
  console.log('mode = ' + e.getMode() + ' (Arcade=0, Hardcore=1)');
  for (let k = 0; k < 12; k++) e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } });
  cw(e);
  console.log('после поворота у стены: isGameOver=' + e.isGameOver());
}

console.log('\n=== H. Ghost (gameStore.getGhostY) против фактического приземления движка ===');
function ghostY(state) {
  const piece = state.currentPiece;
  let y = state.currentPos.y;
  while (true) {
    let canMoveDown = true;
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) continue;
        const boardX = state.currentPos.x + c;
        const boardY = y + r + 1;
        if (boardY >= state.boardHeight || boardX < 0 || boardX >= state.boardWidth) { canMoveDown = false; break; }
        if (state.board[boardY]?.[boardX]?.value !== 0) { canMoveDown = false; break; }
      }
    }
    if (!canMoveDown) break;
    y++;
  }
  return y;
}
for (const t of TYPES) {
  const e = makeEngine([PieceType[t]]);
  cw(e); // в нетипичной ориентации
  const s = e.getGameState();
  const gy = ghostY(s);
  // фактическое приземление движка: hard drop
  const e2 = makeEngine([PieceType[t]]);
  cw(e2);
  e2.handleCommand({ type: CommandType.HardDrop });
  const cells = boardCells(e2);
  const maxY = Math.max(...cells.map(c => +c.split(',')[0]));
  const shapeRows = e.getGameState().currentPiece.shape.length;
  const ghostTopRow = gy;
  const realTopRow = maxY - (shapeRows - 1);
  console.log(`${t} (rot${e.getGameState().currentRotation.index}, shapeRows=${shapeRows}): ghostY=${ghostTopRow} realTopRow=${realTopRow} ${ghostTopRow === realTopRow ? 'OK' : '<<< РАСХОЖДЕНИЕ'} | реальные клетки: ${cells.join(' ')}`);
}

console.log('\n=== I. Отверстие в поле: value vs locked (ghost использует value, движок — locked) ===');
{
  const e = makeEngine([PieceType.O]);
  const s = e.getGameState();
  e.boardManager.setCell(s.currentPos.x, 15, 0, true); // locked но value=0
  const st = e.getGameState();
  console.log('клетка (15,' + s.currentPos.x + '): locked=true value=0; ghost считает её пустой? ' + (st.board[15][s.currentPos.x].value === 0 ? 'ДА (bug-риск)' : 'нет'));
}
