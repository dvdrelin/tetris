# Фаза 2: Архитектурное ревью + Тесты

**Версия:** v1.4
**Статус:** ✅ Завершено (все тесты: 51 frontend + 9 backend + 13 E2E = 73 тест, все прошли)

---

## To-Do List

| # | Задача | Статус |
|---|--------|--------|
| 2.1 | SRP рефакторинг: вынести renderer.ts | ✅ |
| 2.2 | SRP рефакторинг: вынести piecePreview.ts | ✅ |
| 2.3 | Unit-тесты frontend (jest) | ✅ |
| 2.4 | Unit-тесты backend (jest) | ✅ (9 тестов, scoreService testable) |
| 2.5 | E2E тесты (playwright) | ✅ (9 тестов, 2.2s) |
| 2.6 | Исправлен isValidPosition (y<0) | ✅ |
| 2.7 | Build проходит | ✅ |
| 2.8 | Исправлен render loop (бесконечная рекурсия) | ✅ |
| 2.9 | Unit-тесты renderer (8 тестов) | ✅ |
| 2.10 | E2E: console error interception | ✅ |
| 2.11 | E2E: keyboard controls (move, rotate, pause) | ✅ |

---

## SRP Рефакторинг

### 2.1. GameBoard.vue → renderer.ts

**`frontend/src/engine/renderer.ts`** — чистая функция `render(ctx, state, width, height)`
**`frontend/src/engine/piecePreview.ts`** — функция `renderPiecePreview(canvas, pieceType)`

### 2.2. gameStore.ts — исправлен

- `onGameOver` отправляет score на сервер
- `playerName` ref для сохранения имени
- Guard после Game Over предотвращает начисление очков

---

## Тесты

### Unit (jest + ts-jest)

**Frontend — 51 тест, все проходят:**
- `tests/unit/engine.test.ts` — 15 тестов (engine, move, pause, game over)
- `tests/unit/board.test.ts` — 14 тестов (board manager)
- `tests/unit/pieces.test.ts` — 14 тестов (factory, shapes, buildPiece)
- `tests/unit/renderer.test.ts` — 8 тестов (render, ghost, pause, game over, no recursion)

**Backend — 9 тестов, все проходят:**
- `tests/unit/scoreService.test.ts` — 9 тестов (saveScore, getTopScores, getLeaderboard, getPlayerStats, getPlayerScores)
- Исправление: вынесен DB_PATH в конструктор `ScoreService({ dbPath })` — тесты изолируют БД

### E2E (playwright)
- `tests/e2e/game.test.ts` — 9 тестов (menu, start, board render, **console error detection**, HUD, game over, menu btn, **pause/resume**, **keyboard movement**, **rotation**)
- `tests/e2e/leaderboard.test.ts` — 4 теста (navigate, table, tabs, back)
- Итого: **13 тестов, все прошли** за 10.5 сек
- Конфиг: `tests/playwright.config.ts` — testDir: './e2e'
- **Console error interception:** `main.ts` перехватывает `console.error` → `window.__consoleErrors` — E2E-тесты ловят ошибки

---

## Исправления найденных багов

### 2.6. isValidPosition не блокировал y<0
**Файл:** `frontend/src/shared/domain/board.ts`
**Исправление:** добавить `boardY < 0` в проверку границ
**Проблема:** И-тетромино могло спавниться над доской

### 2.11. E2E — console error interception
**Файл:** `frontend/src/main.ts`, `tests/e2e/game.test.ts`
**Проблема:** E2E тесты не ловили console errors — RangeError проходил мимо
**Исправление:** `console.error` перехватывается → `window.__consoleErrors` → тесты проверяют `toHaveLength(0)`
**Новые тесты:** pause/resume, keyboard movement, rotation — с проверкой console errors

### 2.8. Render loop — бесконечная рекурсия
**Файл:** `frontend/src/components/GameBoard.vue`
**Проблема:** `watch(gameState, { deep: true })` + `requestAnimationFrame(gameLoop)` оба дергали `render()` → `RangeError: Maximum call stack size exceeded`
**Исправление:** Убрать `watch(gameState)` — `gameLoop` уже рендерит каждый фрейм
**Новые тесты:** `renderer.test.ts` — 8 тестов (render safe, no recursion, 100 calls)

---

## Build

- `npm run build` — проходит (backend: tsc, frontend: vite build)
- TypeScript компиляция — 0 ошибок
- Vite build — 52 modules transformed

---

## Changes Log

| Версия | Дата | Изменения |
|--------|------|-----------|
| v1.0 | 2025 | Начальная версия плана |
| v1.1 | 2025 | Все тесты проходят, баг isValidPosition исправлен |
| v1.2 | 2025 | Backend: ScoreService testable через dbPath опцию. E2E: 9 тестов, все прошли за 2.2s |
| v1.3 | 2025 | render loop: убран watch(gameState), бесконечная рекурсия исправлена. +8 renderer тестов |
| v1.4 | 2025 | E2E: console error interception, 13 тестов, все прошли |
