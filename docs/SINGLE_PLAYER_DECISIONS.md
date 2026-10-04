# Решения по сингл-режиму (Single Player Decisions)

Дата: 2026-10-04. Источник: решение-лист, развёрнутый по итогам аудита `frontend/src`
(`AUDIT_REPORT.md`, §12.4 «Что осталось открытым»).

**Рамки решения (сформулированы пользователем дословно):**
«оставь MP за скобками. сейчас надо решить с синглом — полностью.
MP (старый и новый дизайн) — отдельная тема, будет решаться на старте MP».

Следовательно: всё, что ниже, относится **только** к одиночной игре. Мультиплеер
(оба дизайна, `docs/PHASE3_MULTIPLAYER.md`, `design.game/*`) вынесен на старт MP и в этой
работа не участвует.

Статусы: `✅ блок N` — сделано и проверено в блоке N; `⏳ блок N` — принято, срок исполнения — блок N.
Каждый блок = один коммит + `git push origin main`, документация — в том же коммите.

---

## A. Механика

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| A1 | Кто владеет гравитацией | Интервал падения считался в UI (`GameBoard.vue`), движок получал готовый «тик» и сам интервал не знал | **Гравитация — ответственность движка.** UI передаёт только прошедшее время (`Tick` + `dt`), движок сам копит аккумулятор и решает, сколько клеток упала фигура | ✅ блок 2 |
| A2 | Автопадение в Hardcore | `tick()` делал авто-drop только в Arcade: в Hardcore фигура стояла на месте | **Автопадение есть в обоих режимах**; Hardcore отличается смертью при блокировке, а не отсутствием гравитации. Скорость Hardcore — та же таблица, интервал пополам (`HARDCORE_SPEED_MULTIPLIER = 0.5`, не ниже `minInterval`) | ✅ блок 2 |
| A3 | Lock delay | Фигура блокировалась в тот же момент, когда касалась опоры: «клиренс» и манёвры у пола невозможны | **Lock delay 500 мс + 15 сбросов таймера** (перемещение/поворот откладывает фиксацию). Soft drop на пол и hard drop фиксируют сразу | ⏳ блок 3 |
| A4 | Hold | Команды hold нет, клавиша не занята | **Hold вводится**: `C` / `Shift`, не более одного hold на фигуру, слот в HUD | ⏳ блок 3 |
| A5 | Поворот на 180° | Только ±90° | **180° добавлен** (клавиша `R`, отдельный небольшой набор киков) | ⏳ блок 3 |
| A6 | Очередь фигур | В UI показывалась одна следующая фигура | **Очередь из 3 фигур.** Визуал зафиксирован пользователем: «чем дальше фигура в очереди от текущей, тем прозрачнее» (≈ 1.0 / 0.6 / 0.35) | ⏳ блок 3 |
| A7 | Ghost («призрак») | `ghostY` считался в сторе (`getGhostY`) своей копией проверки коллизий | **Единственный источник — движок** (`GameEngine.getGhostY()`); сторе остаётся только прочитать значение | ⏳ блок 5 |
| A8 | Аккумулятор времени | `tickAccumulator` в UI сбрасывался в 0, а не вычитал интервал: при просадке кадра терялось время | **Цикл `while (acc >= interval)`** на стороне движка, dt приходит каждый кадр | ✅ блок 2 |
| A9 | Две функции коллизий | `hasCollision` и `isValidPosition` в `board.ts` имели разную семантику (`boardY < 0`), `hasCollision` движком не вызывалась | **Одно правило — одна реализация:** `hasCollision(piece, pos) === !isValidPosition(piece, pos)`; обёртка `hasCollision` в движке удалена | ✅ блок 1 |
| A10 | Таблица скоростей | `800 − (level−1)·50`, минимум `50` (уровень 16) | **Менять не нужно** — таблица остаётся | ✅ принято, правок нет |
| A11 | Подсчёт очков | Нет T-spin, back-to-back, perfect clear | **Не вводим** — scoring остаётся как есть (100/300/500/800, soft 10, hard 20, combo ×1.5) | ✅ принято, правок нет |

## B. Управление

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| B1 | Клавиши вращения | `↑` и `w` уходили в `MovePiece{direction:'rotateCW'}`, `z` — тоже в CW, `c` — в CW | **Единая карта:** `↑` / `X` = CW, `Z` / `Q` = CCW; `A`/`D`/`S`/`W` сохранены | ✅ блок 1 (карта), `R` — блок 3 |
| B2 | DAS / ARR | Удержание клавиши давало только автоповтор ОС; `keyup` не слушался, `e.repeat` не отсекался | **Собственный DAS 167 мс / ARR 33 мс** + слушатель `keyup` + игнор `e.repeat` | ⏳ блок 4 |
| B3 | Мобильные устройства | Touch/pointer-обработчиков в `frontend/src` нет | **Поддержка мобильных обязательна** (тач-контролы сингла) | ⏳ блок 4 |
| B4 | Вращение как «движение» | Поворот был возможен и как `MovePiece`, и как `RotatePiece` | **Только `RotatePiece`.** `MoveCommand.payload.direction` сужен до `'left' \| 'right' \| 'down'` — псевдо-направления больше не компилируются | ✅ блок 1 |

## C. UI

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| C1 | Цвет превью очереди | `HudView.vue` брал форму из `PIECE_SHAPES[nextPieceType]`, а цвет — из `CELL_COLORS[nextPieceType as unknown as number]`: строковый enum → `undefined` → всегда `CELL_COLORS[1]` (циан) | **Индекс цвета экспортируется из `pieces.ts`** и используется и в canvas, и в HUD | ⏳ блок 6 |
| C2 | Кнопка паузы | `⏸` рендерился при `isRunning && !isGameOver`, `▶` — во `v-else-if="isPaused"`, куда поток не доходил | **Кнопка управляется `isPaused`:** один элемент, ⏸/▶ | ⏳ блок 6 |
| C3 | Подсказки клавиш | В меню было написано «↑ / ↓ — Вращение / Сброс», что не соответствует коду | **Общий `CONTROL_HINTS`**, который читают и меню, и HUD | ⏳ блок 6 |
| C4 | Имя игрока | `playerName` жёстко `'Игрок'`, поля ввода нет | **Поле ввода + `localStorage`**, валидация 1–32 символа (потолок бэкенда) | ⏳ блок 6 |
| C5 | Заброшенная игра | При выходе из игры движок не останавливался | **`engine.stop()` при `beforeUnmount`** `GameView`; заброшенная партия не уходит в лидерборд | ⏳ блок 6 |
| C6 | Двойной `init()` | `gameStore.init()` вызывался и в `App.vue`, и в `MenuView.vue` | **Дублирующий вызов из `MenuView.vue` убран** | ⏳ блок 6 |
| C7 | Поведение `Esc` | `Esc`: пауза → снять паузу, иначе → меню | **Оставить как есть** | ✅ принято, правок нет |

## D. Бэкенд

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| D1 | Доверие к очкам | `POST /api/score` без аутентификации: любой может прислать любое число | **Сейчас:** честный потолок + rate-limit на IP. Серверная сессия/подпись результата — **на старте MP** | ⏳ блок 7 |
| D2 | Потолок `scoreMax` | `1_000_000` при реальной таблице очков достижим выше | **Поднять до `10_000_000`** и добавить `429` на частоту запросов | ⏳ блок 7 |

## E. Гигиена кода

| # | Что | Решение | Статус |
|---|---|---|---|
| E1 | `handleCommand` строил `handlerMap` и проверял тип через `isCommandType()`, приватные хендлеры принимали `command: any` | **`switch` с сужением типа** + типизированные хендлеры (`StartGameCommand`, `MoveCommand`); `isCommandType`, `CommandHandler`, `QueryHandler` удалены | ✅ блок 1 |
| E2 | Мёртвые типы в `types.ts` | `CellState`, `GameStateSnapshot`, `MoveAction`, `Action`, `TickResult`, `GhostPiece` **удалены** | ✅ блок 1 |
| E3 | Мёртвый код в сторе и `App.vue` | удалены `CellDTO`, `KeyHandler`, `tickInterval`/`animFrame`/`lastTime`, `nextView`/`viewOrder`; `handleCommand(cmd: any)` → `handleCommand(cmd: AnyCommand)`; недостижимая ветка `Escape` в `handleKey` убрана (её обрабатывает `GameView.vue`) | ✅ блок 1 |
| E4 | `docs/tsc-frontend.log` | нечитаемый артефакт (gitignored) — **удалён** | ✅ блок 1 |
| E5 | Документы дизайна в `design.game/` | уже в git — трогать не нужно | ✅ подтверждено пользователем |

---

## Проверка блока 1 (команды и их вывод)

| Команда | Вывод |
|---|---|
| `npx.cmd vue-tsc --noEmit` (в `frontend/`) | пустой вывод, `exit 0` |
| `npx.cmd jest --runInBand` (в `frontend/`) | `Test Suites: 6 passed, 6 total` · `Tests: 109 passed, 109 total` · `jest exit code: 0` |
| `npx.cmd tsc --noEmit` (в `backend/`) | `tsc exit: 0` |
| `npx.cmd jest --runInBand` (в `backend/`) | `Test Suites: 3 passed, 3 total` · `Tests: 36 passed, 36 total` · `jest exit: 0` |
| grep `rotateCW\|GameStateSnapshot\|TickResult\|GhostPiece\|MoveAction\|CellState\|KeyHandler\|CellDTO\|nextView\|tickInterval` по `frontend/**.{ts,vue}` | `No matches found` |

Замечание по среде: `npm.cmd test` в песочнице падает на `Error: spawn EPERM`
(`jest-worker` не может поднять воркеров), поэтому юнит-тесты запускаются
`npx.cmd jest --runInBand`. Это ограничение песочницы, а не проекта.

## Что изменено в коде блока 1

- `frontend/src/shared/engine/game-engine.ts` — `handleCommand` = `switch` с сужением типа;
  `startGame(command: StartGameCommand)` (обратная совместимость со старым `payload.hardcore`
  сохранена через явный каст), `movePiece(command: MoveCommand)` без `rotateCW`/`rotateCCW`,
  `softDrop()`/`hardDrop()` без параметров, удалены `isCommandType`, `CommandHandler`,
  `QueryHandler` и обёртка `hasCollision`.
- `frontend/src/shared/domain/board.ts` — `hasCollision` теперь `!isValidPosition`
  (одинаковая семантика, в том числе `boardY < 0`), проверка `locked` упрощена.
- `frontend/src/shared/domain/types.ts` — удалены 6 мёртвых типов.
- `frontend/src/shared/cqrs/commands.ts` — `MoveCommand.payload.direction` стал
  `'left' | 'right' | 'down'`.
- `frontend/src/stores/gameStore.ts` — типизированный `handleCommand`, новая карта клавиш
  (`↑`/`x`/`w` → `RotatePiece{cw}`, `z`/`q` → `RotatePiece{ccw}`), мёртвый код удалён.
- `frontend/src/components/GameBoard.vue` — `{ type: CommandType.Tick }` вместо строки.
- `frontend/src/App.vue` — `nextView`/`viewOrder` и неиспользуемый импорт `computed` удалены.
- `frontend/tests/unit/{engine,rotation-kicks}.test.ts` — команды отправляются через
  `CommandType.*` вместо строковых литералов.

---

## Проверка блока 2 (команды и их вывод)

| Команда | Вывод |
|---|---|
| `npx.cmd vue-tsc --noEmit` (в `frontend/`) | пустой вывод, `vue-tsc exit=0` |
| `npx.cmd jest --runInBand` (в `frontend/`) | `Test Suites: 7 passed, 7 total` · `Tests: 125 passed, 125 total` · `jest exit=0` |
| `npx.cmd playwright test --config tests/playwright.config.ts` (в корне) | `19 passed (27.0s)` · `playwright LASTEXITCODE=0` |

## Что изменено в коде блока 2

- `frontend/src/shared/config/game-config.ts` — `dropInterval(level, mode)` как единственный
  источник интервала гравитации + `HARDCORE_SPEED_MULTIPLIER = 0.5`. Таблица Arcade
  (`800 − (level−1)·50`, минимум `50`) не изменена; некорректный `level` даёт уровень 1.
- `frontend/src/shared/cqrs/commands.ts` — `TickCommand.payload: { dt: number }` (миллисекунды
  с прошлого тика).
- `frontend/src/shared/engine/game-engine.ts` — `gravityAccumulator` и `elapsedMs` в движке;
  `tick(dtMs)` с `while (accumulator >= interval)`; автопадение в обоих режимах;
  `MAX_TICK_DELTA_MS = 250` (фон-вкладка не может телепортировать фигуру); нечисловой/отрицательный
  `dt` не двигает фигуру; после фиксации фигуры остаток времени не тратится на новую фигуру;
  `autoDrop()` без мёртвой переменной `interval`; `MovePiece{down}` = soft drop (фиксируется
  на полу, не убивает в Hardcore); геттеры `getElapsedMs()`, `getGravityAccumulator()`,
  `getDropInterval()`.
- `frontend/src/components/GameBoard.vue` — игровой цикл только передаёт прошедшее время
  (`{ type: CommandType.Tick, payload: { dt: dt * 1000 } }`); интервал и аккумулятор из UI удалены.
- `frontend/tests/unit/gravity.test.ts` — новый файл: 16 тестов на таблицу интервалов,
  аккумулятор, несколько клеток за кадр, Hardcore-гравитацию, ограничение дельты, паузу/game over,
  фиксацию при приземлении и «down — это soft drop».
