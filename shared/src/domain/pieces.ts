import { Piece, PieceType } from './types';

// Piece type -> board color index (1..7; 0 is the empty cell). Exported so the HUD previews use
// the same mapping as the board instead of guessing it.
export const PIECE_COLOR_INDEX: Record<PieceType, number> = {
  [PieceType.I]: 1,
  [PieceType.O]: 2,
  [PieceType.T]: 3,
  [PieceType.S]: 4,
  [PieceType.Z]: 5,
  [PieceType.J]: 6,
  [PieceType.L]: 7,
};

// Canonical SRS rotation states.
// Rule: every piece keeps its bounding box in all 4 rotations (I = 4x4, O = 2x2,
// JLSTZ = 3x3) and every rotation is a true 90° turn of the previous one.
export const PIECE_SHAPES: Record<PieceType, number[][][]> = {
  [PieceType.I]: [
    [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    [[0,0,1,0], [0,0,1,0], [0,0,1,0], [0,0,1,0]],
    [[0,0,0,0], [0,0,0,0], [1,1,1,1], [0,0,0,0]],
    [[0,1,0,0], [0,1,0,0], [0,1,0,0], [0,1,0,0]],
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
    [[0,1,0], [0,1,1], [0,0,1]],
    [[0,0,0], [0,1,1], [1,1,0]],
    [[1,0,0], [1,1,0], [0,1,0]],
  ],
  [PieceType.Z]: [
    [[1,1,0], [0,1,1], [0,0,0]],
    [[0,0,1], [0,1,1], [0,1,0]],
    [[0,0,0], [1,1,0], [0,1,1]],
    [[0,1,0], [1,1,0], [1,0,0]],
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

// Piece source: a () => number in [0, 1). Single-player keeps Math.random (unpredictable on
// purpose); multiplayer injects a seeded PRNG so the client and the server draw identical
// sequences (MP block A, GDD §2.1).
export type PieceRng = () => number;

// mulberry32: small, fast, deterministic PRNG seeded from a uint32 (GDD §2.2 seed format).
// Not cryptographic — it never makes the seed public-facing, the server draws it with
// crypto.randomInt and only distributes it to session participants.
export function mulberry32(seed: number): PieceRng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 7-bag randomizer for fair piece distribution
export class PieceFactory {
  private shuffledBag: PieceType[] = [];
  private readonly rng: PieceRng;

  constructor(rng: PieceRng = Math.random) {
    this.rng = rng;
    this.resetBag();
  }

  private resetBag(): void {
    const base: PieceType[] = [
      PieceType.I, PieceType.O, PieceType.T, PieceType.S, PieceType.Z, PieceType.J, PieceType.L
    ];
    this.shuffledBag = [...base];
    // Fisher-Yates shuffle (rng-driven so the sequence is reproducible under a seed)
    for (let i = this.shuffledBag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
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

  constructor(options?: { seed?: number; rng?: PieceRng }) {
    const rng =
      options?.rng ??
      (options?.seed !== undefined ? mulberry32(options.seed) : Math.random);
    this.factory = new PieceFactory(rng);
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
      row.push(shape[r][c] ? PIECE_COLOR_INDEX[type] : 0);
    }
    colors.push(row);
  }
  return { type, shape, colors };
}
