import { PieceFactory, PieceFactoryProvider, PIECE_SHAPES, buildPiece } from '../../src/shared/domain/pieces';
import { PieceType } from '../../src/shared/domain/types';

describe('PieceFactory', () => {
  test('should return 7 different pieces before repeating', () => {
    const factory = new PieceFactory();
    const types: PieceType[] = [];
    for (let i = 0; i < 7; i++) {
      types.push(factory.nextPieceType());
    }
    // All 7 types should be present
    const unique = [...new Set(types)];
    expect(unique.length).toBe(7);
    const expected = [PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L];
    for (const et of expected) {
      expect(types).toContain(et);
    }
  });

  test('should reset bag after using all 7 pieces', () => {
    const factory = new PieceFactory();
    // Use all 7
    for (let i = 0; i < 7; i++) {
      factory.nextPieceType();
    }
    // Next should return a piece (reset bag)
    const piece = factory.nextPieceType();
    expect(piece).toBeDefined();
  });

  test('should not return null or undefined', () => {
    const factory = new PieceFactory();
    for (let i = 0; i < 100; i++) {
      const piece = factory.nextPieceType();
      expect(piece).toBeDefined();
      expect(piece).not.toBeNull();
    }
  });

  test('should only return valid piece types', () => {
    const factory = new PieceFactory();
    const validTypes = [PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L];
    for (let i = 0; i < 100; i++) {
      const piece = factory.nextPieceType();
      expect(validTypes).toContain(piece);
    }
  });
});

describe('PieceFactoryProvider', () => {
  test('should create piece of correct type', () => {
    const provider = new PieceFactoryProvider();
    const piece = provider.createPiece(PieceType.I);
    expect(piece.type).toBe(PieceType.I);
    expect(piece.shape).toBeDefined();
    expect(piece.colors).toBeDefined();
  });

  test('should return next piece type', () => {
    const provider = new PieceFactoryProvider();
    const type = provider.nextPieceType();
    expect(type).toBeDefined();
  });
});

describe('PIECE_SHAPES', () => {
  test('I piece should have 4 rotations', () => {
    expect(PIECE_SHAPES[PieceType.I].length).toBe(4);
  });

  test('O piece should have 4 rotations (all identical)', () => {
    expect(PIECE_SHAPES[PieceType.O].length).toBe(4);
    const first = PIECE_SHAPES[PieceType.O][0];
    for (let i = 1; i < 4; i++) {
      expect(PIECE_SHAPES[PieceType.O][i]).toEqual(first);
    }
  });

  test('T piece should have 4 rotations', () => {
    expect(PIECE_SHAPES[PieceType.T].length).toBe(4);
  });

  test('all pieces should have at least one filled cell in each rotation', () => {
    for (const type of [PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L]) {
      for (let r = 0; r < PIECE_SHAPES[type].length; r++) {
        // Each rotation must have at least one filled cell
        const rotation = PIECE_SHAPES[type][r];
        const filled = rotation.flat().some((v: number) => v === 1);
        expect(filled).toBe(true);
      }
    }
  });
});

describe('buildPiece', () => {
  test('should build piece with correct colors', () => {
    const shape = [[1, 1], [1, 1]];
    const piece = buildPiece(PieceType.I, shape);
    expect(piece.type).toBe(PieceType.I);
    expect(piece.shape).toEqual(shape);
    expect(piece.colors).toHaveLength(2);
    expect(piece.colors[0]).toEqual([1, 1]);
  });

  test('should build piece with 0 where shape is empty', () => {
    const shape = [[0, 1], [1, 0]];
    const piece = buildPiece(PieceType.T, shape);
    expect(piece.colors).toHaveLength(2);
    // T color is 3
    expect(piece.colors[0]).toEqual([0, 3]);
    expect(piece.colors[1]).toEqual([3, 0]);
  });
});
