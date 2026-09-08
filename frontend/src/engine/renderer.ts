import { GameStateDTO, CELL_COLORS } from '../stores/gameStore'

const CELL_SIZE = 24

export interface RenderState {
  board: number[][]
  currentPiece: { type: string; shape: number[][]; colors: number[][] } | null
  currentPos: { x: number; y: number } | null
  ghostY: number
  isPaused: boolean
  isGameOver: boolean
  score: number
}

export function render(ctx: CanvasRenderingContext2D, state: RenderState, width: number, height: number): void {
  const board = state.board
  const currentPiece = state.currentPiece
  const currentPos = state.currentPos
  const ghostY = state.ghostY

  // Clear
  ctx.fillStyle = '#0a0a1a'
  ctx.fillRect(0, 0, width, height)

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 1
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 10; x++) {
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE - 1, CELL_SIZE - 1)
    }
  }

  // Placed cells
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 10; x++) {
      const val = board[y]?.[x]
      if (val) {
        const style = getCellStyle(val)
        ctx.fillStyle = style.backgroundColor
        ctx.shadowColor = style.boxShadow
        ctx.shadowBlur = 5
        ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2)
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2)
      }
    }
  }

  // Ghost piece
  if (currentPiece && ghostY >= 0) {
    ctx.globalAlpha = 0.3
    for (let r = 0; r < currentPiece.shape.length; r++) {
      for (let c = 0; c < currentPiece.shape[r].length; c++) {
        if (currentPiece.shape[r][c]) {
          const x = (currentPos!.x + c) * CELL_SIZE
          const y = (ghostY + r) * CELL_SIZE
          const color = getCellStyle(currentPiece.colors[r][c])
          ctx.strokeStyle = color.backgroundColor
          ctx.lineWidth = 2
          ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  // Current piece
  if (currentPiece) {
    for (let r = 0; r < currentPiece.shape.length; r++) {
      for (let c = 0; c < currentPiece.shape[r].length; c++) {
        if (currentPiece.shape[r][c]) {
          const x = (currentPos!.x + c) * CELL_SIZE
          const y = (currentPos!.y + r) * CELL_SIZE
          const cellColor = currentPiece.colors[r][c]
          const cellStyle = getCellStyle(cellColor)

          ctx.fillStyle = cellStyle.backgroundColor
          ctx.shadowColor = cellStyle.boxShadow
          ctx.shadowBlur = 8
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
          ctx.shadowBlur = 0

          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
          ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, (CELL_SIZE - 4) / 2)

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
          ctx.lineWidth = 1
          ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
        }
      }
    }
  }

  // Pause overlay
  if (state.isPaused) {
    ctx.fillStyle = 'rgba(10, 10, 26, 0.8)'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#00f5ff'
    ctx.font = 'bold 36px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('ПАУЗА', width / 2, height / 2)
    ctx.font = '16px monospace'
    ctx.fillStyle = '#888'
    ctx.fillText('Нажмите P для продолжения', width / 2, height / 2 + 40)
  }

  // Game over overlay
  if (state.isGameOver) {
    ctx.fillStyle = 'rgba(10, 10, 26, 0.9)'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#ff00ff'
    ctx.font = 'bold 32px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('GAME OVER', width / 2, height / 2 - 20)
    ctx.fillStyle = '#00f5ff'
    ctx.font = '20px monospace'
    ctx.fillText(`Счёт: ${state.score}`, width / 2, height / 2 + 20)
    ctx.fillStyle = '#888'
    ctx.font = '16px monospace'
    ctx.fillText('Нажмите ENTER для рестарта', width / 2, height / 2 + 50)
  }
}

function getCellStyle(value: number): { backgroundColor: string; boxShadow: string; borderColor: string; color: string } {
  return CELL_COLORS[value] || CELL_COLORS[0]
}
