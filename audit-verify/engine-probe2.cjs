const path = require('node:path');
const B = path.join(__dirname, 'build', 'shared');
const { GameEngine } = require(path.join(B, 'engine', 'game-engine.js'));
const { PieceType } = require(path.join(B, 'domain', 'types.js'));
const { CommandType } = require(path.join(B, 'cqrs', 'commands.js'));

function dump(e, rows) {
  const b = e.getGameState().board;
  return rows.map(y => Array.from({ length: 10 }, (_, x) => `${b[y][x].value}${b[y][x].locked ? 'L' : '-'}`).join(' ')).join('\n');
}

console.log('=== PROBE 1: softDrop в столкновение -> placePiece в НЕВАЛИДНОЙ позиции, перезапись чужих блоков ===');
{
  const e = new GameEngine({});
  e.pieceFactory.nextPieceType = () => PieceType.O;
  e.handleCommand({ type: CommandType.StartGame, payload: {} });
  const p = e.getGameState().currentPos; // O at (4,0), rows 0..1
  // имитация уже упавшей фигуры Z (value=5) на rows 2..3
  e.boardManager.setCell(4, 2, 5, true);
  e.boardManager.setCell(5, 2, 5, true);
  e.boardManager.setCell(3, 3, 5, true);
  e.boardManager.setCell(4, 3, 5, true);
  console.log('ДО (5 = цвет Z, L = locked):');
  console.log(dump(e, [0, 1, 2, 3, 4]));
  e.handleCommand({ type: CommandType.SoftDrop }); // y=1 -> rows 1..2 -> row2 collides
  e.handleCommand({ type: CommandType.SoftDrop }); // placePiece at invalid y
  console.log('ПОСЛЕ 2x SoftDrop (2 = цвет O):');
  console.log(dump(e, [0, 1, 2, 3, 4]));
  const s = e.getGameState();
  const overwritten = [[4, 2], [5, 2]].filter(([x, y]) => s.board[y][x].value === 2);
  console.log(overwritten.length ? `<<< ДЕФЕКТ: клетки Z (value=5) перезаписаны цветом O (value=2): ${overwritten.map(c => c.join(',')).join(' ')}` : 'OK');
  console.log('score = ' + e.getScore() + ' (SoftDrop начисляет 10 очков и при невалидном движении)');
}

console.log('\n=== PROBE 2: вращение под потолком (I у верхней границы) ===');
{
  const e = new GameEngine({});
  e.pieceFactory.nextPieceType = () => PieceType.I;
  e.handleCommand({ type: CommandType.StartGame, payload: {} });
  const s0 = e.getGameState();
  console.log(`спавн I rot0 pos=(${s0.currentPos.x},${s0.currentPos.y}) занимает row 1`);
  e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } });
  const s1 = e.getGameState();
  console.log(`после CW: rot=${s1.currentRotation.index} pos=(${s1.currentPos.x},${s1.currentPos.y})`);
  // теперь вертикальная I занимает rows 0..3; попробуем вернуться в горизонталь rot2 (row 2)
  e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } });
  const s2 = e.getGameState();
  console.log(`после 2xCW: rot=${s2.currentRotation.index} pos=(${s2.currentPos.x},${s2.currentPos.y})`);
}

console.log('\n=== PROBE 3: hardcore death не сбрасывает _isRunning (состояние движка неконсистентно) ===');
{
  const e = new GameEngine({});
  let i = 0;
  e.pieceFactory.nextPieceType = () => (i++ % 2 === 0 ? PieceType.O : PieceType.I);
  e.handleCommand({ type: CommandType.StartGame, payload: { hardcore: true } });
  for (let k = 0; k < 12; k++) e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'right' } });
  console.log('после столкновения со стеной: isGameOver=' + e.isGameOver() + ' isRunning=' + e.isRunning());
  const before = e.getScore();
  e.handleCommand({ type: CommandType.Tick });
  e.handleCommand({ type: CommandType.SoftDrop });
  e.handleCommand({ type: CommandType.HardDrop });
  console.log(`Tick/SoftDrop/HardDrop после Game Over выполнены: score ${before} -> ${e.getScore()} (гард только в UI: gameStore.handleKey)`);
}

console.log('\n=== PROBE 4: O-фигура «вращается» (4 одинаковые матрицы) — индекс меняется, форма нет ===');
{
  const e = new GameEngine({});
  e.pieceFactory.nextPieceType = () => PieceType.O;
  e.handleCommand({ type: CommandType.StartGame, payload: {} });
  for (let k = 0; k < 4; k++) {
    e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } });
    const s = e.getGameState();
    console.log(`rot${s.currentRotation.index} pos=(${s.currentPos.x},${s.currentPos.y}) cells=${s.currentPiece.shape.flat().join('')}`);
  }
}

console.log('\n=== PROBE 5: T-фигура — потеря клетки при повороте (визуальный баг) ===');
{
  const e = new GameEngine({});
  e.pieceFactory.nextPieceType = () => PieceType.T;
  e.handleCommand({ type: CommandType.StartGame, payload: {} });
  for (let k = 0; k < 4; k++) {
    const s = e.getGameState();
    console.log(`rot${s.currentRotation.index}: shape=[${s.currentPiece.shape.map(r => r.join(',')).join(' | ')}] filled=${s.currentPiece.shape.flat().reduce((a, b) => a + b, 0)}`);
    e.handleCommand({ type: CommandType.MovePiece, payload: { direction: 'rotateCW' } });
  }
}
