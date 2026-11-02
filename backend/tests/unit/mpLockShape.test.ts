/**
 * Форма кадра `piece_lock` против геометрии поля. Урок 5QBH: guard вида «0 ≤ x ≤ 12» отвергал
 * легальную постановку (T r1 с origin x=-1 даёт клетки в столбцах 0..1) — и игрок получал
 * «анти-чит» за собственный корректный ход. Границы origin считаем от занятых клеток, а настоящую
 * геометрию (выход за поле, пересечения, опора, порядок колоды) проверяет реплей MatchState.
 */
import { sanitizeLock, originRange } from '../../src/servers/roomServer'

const ok = (payload: Record<string, unknown>) => sanitizeLock(payload as never).lock
const problem = (payload: Record<string, unknown>) => sanitizeLock(payload as never).problem

test('origin за левым краем легален, если занятые клетки остаются в поле', () => {
  // T r1 = [[0,1,0],[0,1,1],[0,1,0]]: занят столбец 1..2 коробки 3×3 → x=-1 даёт клетки 0..1.
  expect(originRange('T', 1)).toMatchObject({ minX: -1, maxX: 7 })
  expect(ok({ globalStep: 4, pieceType: 'T', x: -1, y: 17, rotation: 1, linesCleared: 1, nextType: 'Z', garbageRows: 1 }))
    .toMatchObject({ pieceType: 'T', x: -1, y: 17, rotation: 1 })

  // I r1 занимает столбец 2 коробки 4×4 → origin x=-2 легален (клетка в столбце 0).
  expect(originRange('I', 1)).toMatchObject({ minX: -2 })
  expect(ok({ globalStep: 1, pieceType: 'I', x: -2, y: 16, rotation: 1, linesCleared: 0 })).toMatchObject({ x: -2 })
})

test('origin, при котором клетка залезает за стену, отвергается — но с внятной подсказкой', () => {
  // T r3 = [[0,1,0],[1,1,0],[0,1,0]]: занят столбец 0..1 → x=-1 вылезает за левый край.
  const p = problem({ globalStep: 4, pieceType: 'T', x: -1, y: 17, rotation: 3, linesCleared: 0 })
  expect(p).toMatchObject({ field: 'x', value: '-1', step: 4 })
  expect(p?.hint).toContain('допустим 0..8')

  // I r0 — горизонталь из четырёх клеток: максимум origin x=6 (клетки 6..9).
  const q = problem({ globalStep: 2, pieceType: 'I', x: 7, y: 18, rotation: 0, linesCleared: 0 })
  expect(q).toMatchObject({ field: 'x', value: '7' })
  expect(q?.hint).toContain('допустим 0..6')
})

test('низ поля: фигура не может лежать ниже последних рядов', () => {
  // T r0 занимает строки 0..1 коробки → origin y максимум 18 (клетки 18..19 из 20 рядов).
  expect(originRange('T', 0)).toMatchObject({ maxY: 18 })
  const p = problem({ globalStep: 6, pieceType: 'T', x: 3, y: 19, rotation: 0, linesCleared: 0 })
  expect(p).toMatchObject({ field: 'y', value: '19' })
  expect(p?.hint).toContain('допустим')
})

test('мусор в остальных полях по-прежнему отсекается, и называется именно проблемное поле', () => {
  expect(problem({ globalStep: 0, pieceType: 'T', x: 3, y: 17, rotation: 0, linesCleared: 0 })).toMatchObject({ field: 'globalStep' })
  expect(problem({ globalStep: 1, pieceType: 'X', x: 3, y: 17, rotation: 0, linesCleared: 0 })).toMatchObject({ field: 'pieceType', value: 'X' })
  expect(problem({ globalStep: 1, pieceType: 'T', x: 3, y: 17, rotation: 7, linesCleared: 0 })).toMatchObject({ field: 'rotation', value: '7' })
  expect(problem({ globalStep: 1, pieceType: 'T', x: 3, y: 17, rotation: 0, linesCleared: 5 })).toMatchObject({ field: 'linesCleared', value: '5' })
  expect(problem({ globalStep: 1, pieceType: 'T', x: 3, y: 17, rotation: 0, linesCleared: 0, nextType: 'Q' })).toMatchObject({ field: 'nextType', value: 'Q' })
  expect(problem({ globalStep: 1, pieceType: 'T', x: 3, y: 17, rotation: 0, linesCleared: 0, garbageRows: -3 })).toMatchObject({ field: 'garbageRows', value: '-3' })
  expect(problem(undefined)).toMatchObject({ field: 'payload', value: 'нет поля' })
})

test('несколько рядов garbageRows и holdExtra проходят как есть', () => {
  expect(ok({ globalStep: 9, pieceType: 'S', x: 4, y: 16, rotation: 1, linesCleared: 2, nextType: 'O', garbageRows: 4, holdExtra: true }))
    .toMatchObject({ garbageRows: 4, holdExtra: true })
})
