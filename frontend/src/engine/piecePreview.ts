import { CELL_COLORS } from '../stores/gameStore'
import { PieceType } from '../shared/domain/types'

const PREVIEW_SHAPES: Record<PieceType, number[][]> = {
  [PieceType.I]: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
  [PieceType.O]: [[1,1], [1,1]],
  [PieceType.T]: [[0,1,0], [1,1,1], [0,0,0]],
  [PieceType.S]: [[0,1,1], [1,1,0], [0,0,0]],
  [PieceType.Z]: [[1,1,0], [0,1,1], [0,0,0]],
  [PieceType.J]: [[1,0,0], [1,1,1], [0,0,0]],
  [PieceType.L]: [[0,0,1], [1,1,1], [0,0,0]],
}

export function renderPiecePreview(canvas: HTMLCanvasElement | null, pieceType: string): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const shape = PREVIEW_SHAPES[pieceType as PieceType] || PREVIEW_SHAPES[PieceType.I]
  const cellSize = 18

  canvas.width = shape[0].length * cellSize + 4
  canvas.height = shape.length * cellSize + 4

  // Clear
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Draw piece
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const x = c * cellSize + 2
        const y = r * cellSize + 2
        const color = CELL_COLORS[pieceType as unknown as number] || CELL_COLORS[1]

        ctx.fillStyle = color.backgroundColor
        ctx.shadowColor = color.boxShadow
        ctx.shadowBlur = 5
        ctx.fillRect(x, y, cellSize - 2, cellSize - 2)
        ctx.shadowBlur = 0

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.fillRect(x + 1, y + 1, cellSize - 3, (cellSize - 3) / 2)
      }
    }
  }
}
