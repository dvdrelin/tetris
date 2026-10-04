import { PIECE_SHAPES, buildPiece } from '../../src/shared/domain/pieces';
import { PieceType } from '../../src/shared/domain/types';

// Canonical SRS rotation states (Tetris Wiki), kept in the same bounding boxes the
// engine uses: I = 4x4, O = 2x2, JLSTZ = 3x3. Any change to PIECE_SHAPES that breaks
// a rotation state must fail here — this is the regression guard for commit 9d43990.
const SRS: Record<PieceType, number[][][]> = {
  [PieceType.I]: [
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
    [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
  ],
  [PieceType.O]: [
    [[1, 1], [1, 1]], [[1, 1], [1, 1]], [[1, 1], [1, 1]], [[1, 1], [1, 1]],
  ],
  [PieceType.T]: [
    [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
  ],
  [PieceType.S]: [
    [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
    [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
  ],
  [PieceType.Z]: [
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
    [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
  ],
  [PieceType.J]: [
    [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
  ],
  [PieceType.L]: [
    [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
    [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
    [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
  ],
};

const TYPES = [PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L];
const BOX: Record<PieceType, number> = {
  [PieceType.I]: 4, [PieceType.O]: 2, [PieceType.T]: 3, [PieceType.S]: 3,
  [PieceType.Z]: 3, [PieceType.J]: 3, [PieceType.L]: 3,
};

const filled = (m: number[][]) => m.flat().filter(v => v === 1).length;
const rotate90cw = (m: number[][]) =>
  m[0].map((_, c) => m.map((row, r) => row[c]).reverse());

describe('PIECE_SHAPES geometry (SRS regression guard)', () => {
  test.each(TYPES)('piece %p has exactly 4 rotation states', (type) => {
    expect(PIECE_SHAPES[type]).toHaveLength(4);
  });

  test.each(TYPES)('piece %p matches canonical SRS in every rotation', (type) => {
    expect(PIECE_SHAPES[type]).toEqual(SRS[type]);
  });

  test.each(TYPES)('piece %p keeps exactly 4 filled cells in every rotation', (type) => {
    for (let r = 0; r < 4; r++) {
      expect(filled(PIECE_SHAPES[type][r])).toBe(4);
    }
  });

  test.each(TYPES)('piece %p keeps the %p x %p bounding box in every rotation', (type) => {
    const box = BOX[type];
    for (let r = 0; r < 4; r++) {
      const m = PIECE_SHAPES[type][r];
      expect(m).toHaveLength(box);
      for (const row of m) expect(row).toHaveLength(box);
    }
  });

  test.each(TYPES)('piece %p has no ragged rows', (type) => {
    for (let r = 0; r < 4; r++) {
      const widths = new Set(PIECE_SHAPES[type][r].map(row => row.length));
      expect(widths.size).toBe(1);
    }
  });

  test.each(TYPES)('piece %p rotation k+1 is a true 90 deg turn of rotation k', (type) => {
    for (let r = 0; r < 4; r++) {
      expect(rotate90cw(PIECE_SHAPES[type][r])).toEqual(PIECE_SHAPES[type][(r + 1) % 4]);
    }
  });

  test('JLSTZ use 3x3 boxes and I uses 4x4 (no 3x2 / 4x3 boxes anywhere)', () => {
    for (const type of TYPES) {
      for (let r = 0; r < 4; r++) {
        const m = PIECE_SHAPES[type][r];
        const cols = m[0].length;
        expect(cols).toBe(BOX[type]);
        expect(m.length).toBe(BOX[type]);
      }
    }
  });

  test('buildPiece produces a color matrix matching the shape (4 non-zero cells)', () => {
    for (const type of TYPES) {
      for (let r = 0; r < 4; r++) {
        const piece = buildPiece(type, PIECE_SHAPES[type][r]);
        expect(piece.colors).toHaveLength(PIECE_SHAPES[type][r].length);
        expect(piece.colors.flat().filter(v => v !== 0).length).toBe(4);
      }
    }
  });
});
