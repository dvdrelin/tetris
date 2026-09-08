import { Piece, PieceType } from './types';

const COLORS: Record<PieceType, number> = {
  [PieceType.I]: 1,
  [PieceType.O]: 2,
  [PieceType.T]: 3,
  [PieceType.S]: 4,
  [PieceType.Z]: 5,
  [PieceType.J]: 6,
  [PieceType.L]: 7,
};

export const PIECE_SHAPES: Record<PieceType, number[][][]> = {
  [PieceType.I]: [
    [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    [[0,1,0,0], [0,1,0,0], [0,1,0,0], [0,1,0,0]],
    [[0,0,0,0], [0,0,0,0], [1,1,1,1], [0,0,0,0]],
    [[0,0,0,1], [0,0,0,1], [0,0,0,1], [0,0,0,1]],
  ],
  [PieceType.O]: [
    [[1,1], [1,1]],
    [[1,1], [1,1]],
    [[1,1], [1,1]],
    [[1,1], [1,1]],
  ],
  [PieceType.T]: [
    [[0,1,0], [1,1,1], [0,0,0]],
    [[0,1,0], [0,1,1], [0,1,0]],
    [[0,0,0], [1,1,1], [0,1,0]],
    [[0,1,0], [1,1,0], [0,1,0]],
  ],
  [PieceType.S]: [
    [[0,1,1], [1,1,0], [0,0,0]],
    [[1,0], [1,1], [0,1]],
    [[0,1,1], [1,1,0], [0,0,0]],
    [[1,0], [1,1], [0,1]],
  ],
  [PieceType.Z]: [
    [[1,1,0], [0,1,1], [0,0,0]],
    [[0,1], [1,1], [1,0]],
    [[1,1,0], [0,1,1], [0,0,0]],
    [[0,1], [1,1], [1,0]],
  ],
  [PieceType.J]: [
    [[1,0,0], [1,1,1], [0,0,0]],
    [[0,1,1], [0,1,0], [0,1,0]],
    [[0,0,0], [1,1,1], [0,0,1]],
    [[0,1,0], [0,1,0], [1,1,0]],
  ],
  [PieceType.L]: [
    [[0,0,1], [1,1,1], [0,0,0]],
    [[0,1,0], [0,1,0], [0,1,1]],
    [[0,0,0], [1,1,1], [1,0,0]],
    [[1,1,0], [0,1,0], [0,1,0]],
  ],
};

// 7-bag randomizer for fair piece distribution
export class PieceFactory {
  private bag: PieceType[] = [];
  private shuffledBag: PieceType[] = [];

  constructor() {
    this.resetBag();
  }

  private resetBag(): void {
    const base: PieceType[] = [
      PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L
    ];
    this.shuffledBag = [...base];
    // Fisher-Yates shuffle
    for (let i = this.shuffledBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffledBag[i], this.shuffledBag[j]] = [this.shuffledBag[j], this.shuffledBag[i]];
    }
  }

  public nextPieceType(): PieceType {
    if (this.shuffledBag.length === 0) {
      this.resetBag();
    }
    return this.shuffledBag.pop()!;
  }
}

export class PieceFactoryProvider {
  private factory: PieceFactory;

  constructor() {
    this.factory = new PieceFactory();
  }

  public nextPieceType(): PieceType {
    return this.factory.nextPieceType();
  }

  public createPiece(type: PieceType): Piece {
    return buildPiece(type, PIECE_SHAPES[type][0]);
  }
}

// Builds a piece (shape + matching colors) for an arbitrary rotation.
export function buildPiece(type: PieceType, shape: number[][]): Piece {
  const colors: number[][] = [];
  for (let r = 0; r < shape.length; r++) {
    const row: number[] = [];
    for (let c = 0; c < shape[r].length; c++) {
      row.push(shape[r][c] ? COLORS[type] : 0);
    }
    colors.push(row);
  }
  return { type, shape, colors };
}
