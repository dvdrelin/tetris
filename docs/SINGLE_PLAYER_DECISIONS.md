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
| A3 | Lock delay | Фигура блокировалась в тот же момент, когда касалась опоры: «клиренс» и манёвры у пола невозможны | **Lock delay 500 мс + 15 сбросов таймера** (перемещение/поворот откладывает фиксацию). Soft drop на пол и hard drop фиксируют сразу | ✅ блок 3 |
| A4 | Hold | Команды hold нет, клавиша не занята | **Hold вводится**: `C` / `Shift`, не более одного hold на фигуру, слот в HUD | ✅ блок 3 |
| A5 | Поворот на 180° | Только ±90° | **180° добавлен** (клавиша `R`, отдельный небольшой набор киков) | ✅ блок 3 |
| A6 | Очередь фигур | В UI показывалась одна следующая фигура | **Очередь из 3 фигур.** Визуал зафиксирован пользователем: «чем дальше фигура в очереди от текущей, тем прозрачнее» (≈ 1.0 / 0.6 / 0.35) | ✅ блок 3 |
| A7 | Ghost («призрак») | `ghostY` считался в сторе (`getGhostY`) своей копией проверки коллизий | **Единственный источник — движок** (`GameEngine.getGhostY()`); сторе остаётся только прочитать значение | ⏳ блок 5 |
| A8 | Аккумулятор времени | `tickAccumulator` в UI сбрасывался в 0, а не вычитал интервал: при просадке кадра терялось время | **Цикл `while (acc >= interval)`** на стороне движка, dt приходит каждый кадр | ✅ блок 2 |
| A9 | Две функции коллизий | `hasCollision` и `isValidPosition` в `board.ts` имели разную семантику (`boardY < 0`), `hasCollision` движком не вызывалась | **Одно правило — одна реализация:** `hasCollision(piece, pos) === !isValidPosition(piece, pos)`; обёртка `hasCollision` в движке удалена | ✅ блок 1 |
| A10 | Таблица скоростей | `800 − (level−1)·50`, минимум `50` (уровень 16) | **Менять не нужно** — таблица остаётся | ✅ принято, правок нет |
| A11 | Подсчёт очков | Нет T-spin, back-to-back, perfect clear | **Не вводим** — scoring остаётся как есть (100/300/500/800, soft 10, hard 20, combo ×1.5) | ✅ принято, правок нет |

## B. Управление

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| B1 | Клавиши вращения | `↑` и `w` уходили в `MovePiece{direction:'rotateCW'}`, `z` — тоже в CW, `c` — в CW | **Единая карта:** `↑` / `X` = CW, `Z` / `Q` = CCW; `A`/`D`/`S`/`W` сохранены | ✅ блок 1 (карта) + блок 3 (`R` = 180°, `C`/`Shift` = hold) |
| B2 | DAS / ARR | Удержание клавиши давало только автоповтор ОС; `keyup` не слушался, `e.repeat` не отсекался | **Собственный DAS 167 мс / ARR 33 мс** + слушатель `keyup` + игнор `e.repeat` | ✅ блок 4 |
| B3 | Мобильные устройства | Touch/pointer-обработчиков в `frontend/src` нет | **Поддержка мобильных обязательна** (тач-контролы сингла) | ✅ блок 4 |
| B4 | Вращение как «движение» | Поворот был возможен и как `MovePiece`, и как `RotatePiece` | **Только `RotatePiece`.** `MoveCommand.payload.direction` сужен до `'left' \| 'right' \| 'down'` — псевдо-направления больше не компилируются | ✅ блок 1 |

## C. UI

| # | Вопрос | Что показал аудит | Решение | Статус |
|---|---|---|---|---|
| C1 | Цвет превью очереди | `HudView.vue` брал форму из `PIECE_SHAPES[nextPieceType]`, а цвет — из `CELL_COLORS[nextPieceType as unknown as number]`: строковый enum → `undefined` → всегда `CELL_COLORS[1]` (циан) | **Индекс цвета экспортируется из `pieces.ts`** и используется и в canvas, и в HUD | ✅ блок 3 (`PIECE_COLOR_INDEX`, общий с доской) |
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

---

## Проверка блока 3 (команды и их вывод)

| Команда | Вывод |
|---|---|
| `npx.cmd vue-tsc --noEmit` (в `frontend/`) | пустой вывод, `LASTEXITCODE=0` |
| `npx.cmd jest --runInBand` (в `frontend/`) | `Test Suites: 8 passed, 8 total` · `Tests: 148 passed, 148 total` |
| `npx.cmd jest --runInBand tests/unit/<suite>.test.ts` (в `frontend/`) | `board 14` · `engine 17` · `gravity 22` · `mechanics 17` · `pieces 12` · `renderer 8` · `rotation-geometry 44` · `rotation-kicks 14` (сумма = 148) |
| `npx.cmd jest --runInBand` (в `backend/`) | `Test Suites: 3 passed, 3 total` · `Tests: 36 passed, 36 total` |
| `npx.cmd playwright test --config tests/playwright.config.ts` (в корне) | `19 passed (26.6s)` · `LASTEXITCODE=0` |

Важно про запуск E2E: в этом репозитории Playwright запускается **только** с явным конфигом
(`npm run test:e2e` = `playwright test --config tests/playwright.config.ts`). Без `--config` он не
находит конфигурацию, сканирует всё дерево и падает на jest-файлах с
`ReferenceError: describe is not defined` (`backend/tests/unit/*.test.ts`, `frontend/tests/unit/*.test.ts`).

## Что изменено в коде блока 3

- `frontend/src/shared/config/game-config.ts` — `LOCK_CONFIG = Object.freeze({ delayMs: 500, maxResets: 15 })`,
  `QUEUE_SIZE = 3`; `GAME_CONFIG` получил `lockConfig: LOCK_CONFIG`.
- `frontend/src/shared/domain/types.ts` — `GameState`: вместо `nextPieceType` →
  `nextQueue: PieceType[]`, `holdType: PieceType | null`, `canHold: boolean`; новый `LockConfig`,
  `GameConfig.lockConfig`.
- `frontend/src/shared/cqrs/commands.ts` — `CommandType.HoldPiece` + `HoldPieceCommand` в `AnyCommand`;
  `RotateCommand.payload.direction`: `'cw' | 'ccw' | '180'`.
- `frontend/src/shared/domain/pieces.ts` — приватный `COLORS` → экспортируемый `PIECE_COLOR_INDEX`
  (его же использует `buildPiece`), C1.
- `frontend/src/shared/engine/game-engine.ts` — `nextQueue`/`fillQueue()` (всегда `QUEUE_SIZE`),
  `holdPiece()` + `canHold`, `lockAccumulator`/`lockResets` + `isGrounded()` + `onSuccessfulManipulation()`,
  набор киков 180° (`0>2`, `2>0`, `1>3`, `3>1`; `O` — только `(0,0)`), `spawnPiece(type)` с
  центрированием по ширине фигуры; геттеры `getNextQueue()`, `getHoldType()`, `canHoldPiece()`,
  `getCurrentRotation()`, `getLockAccumulator()`, `getLockResets()`.
- `frontend/src/stores/gameStore.ts` — DTO `nextQueue`/`holdType`/`canHold`; клавиши `R` →
  `RotatePiece{direction:'180'}`, `C`/`Shift` → `HoldPiece`.
- `frontend/src/components/HudView.vue` — слот «УДЕРЖАНИЕ» + `QUEUE_SIZE` превью «СЛЕДУЮЩИЕ»
  (canvas 76×76, геометрия `PIECE_SHAPES[type][0]`, цвет `PIECE_COLOR_INDEX`), прозрачность
  `QUEUE_OPACITY = [1, 0.6, 0.35]` и `HOLD_USED_OPACITY = 0.4` при использованном hold;
  перерисовка по `watch` на ключе `${nextQueue}|${holdType}|${canHold}`.
- `frontend/tests/unit/mechanics.test.ts` — новый файл, 17 тестов: очередь (длина, порядок,
  пополнение, копия снапшота), hold (обмен со слотом, запрет второго hold, возврат удержанной
  фигуры, отсутствие очков/фиксации, игнор на паузе, сброс lock-состояния, спавн `y = 0`,
  видимость в DTO), 180° (все четыре перехода индексов, эквивалентность двум CW на L, кейс с киком,
  полностью заблокированный поворот → Arcade жив / Hardcore смерть, трата сброса на опоре).
- `frontend/tests/unit/gravity.test.ts` — 16 → 22 теста: новая сюита «Lock delay (A3)» (фигура на
  опоре остаётся управляемой 500 мс, манёвр перезапускает таймер, 15 сбросов и 16-й манёвр,
  отказ хода не сбрасывает, приземление от гравитации не фиксирует в том же кадре, пауза не тратит
  таймер) + переписанный Hardcore-тест под lock delay.
- `frontend/tests/unit/rotation-kicks.test.ts` — тест «soft drop до пола фиксирует всю фигуру»:
  30 мягких сбросов → 16 (лишние сбросы давали приземление следующей фигуры на башню из I и
  +4 клетки к ожидаемому снимку).

Граница блока 3 (осознанно): механика движка + очередь/hold в HUD. DAS/ARR, `keyup`, `e.repeat`,
тач-контролы — блок 4; `getGhostY` в движке — блок 5; кнопка паузы, общие подсказки, имя игрока,
`engine.stop()` — блок 6. Клавиши `R` и `C` подключены минимально, чтобы механику можно было
тестировать; полноценная обработка удержания клавиш — в блоке 4.

---

## Проверка блока 4 (команды и их вывод)

| Команда | Вывод |
|---|---|
| `npx.cmd vue-tsc --noEmit` (в `frontend/`) | пустой вывод, `vue-tsc exit: 0` |
| `npx.cmd jest --runInBand` (в `frontend/`) | `Test Suites: 9 passed, 9 total` · `Tests: 173 passed, 173 total` · `jest exit: 0` |
| `npx.cmd jest --runInBand` (в `backend/`) | `Test Suites: 3 passed, 3 total` · `Tests: 36 passed, 36 total` · `backend jest exit: 0` |
| `npx.cmd playwright test --config tests/playwright.config.ts` (в корне) | `30 passed (30.1s)` · `playwright exit: 0` |
| grep `handleKey\|e\.repeat\|keyup` по `frontend/src/**.{ts,vue}` | 18 совпадений: `shared/input/input-controller.ts`, `shared/input/repeat-controller.ts`, `components/GameView.vue`; в `stores/gameStore.ts` — ни одного (метод `handleKey` удалён) |

Прирост тестов: `173 − 148 = 25` юнит-тестов — все в новом `frontend/tests/unit/input.test.ts`
(2 — значения `DAS_CONFIG`, 5 — карта клавиш и `HELD_ACTIONS`, 10 — `RepeatController`,
8 — `InputController`). E2E: `30 − 19 = 11` тестов — 6 в `tests/e2e/input.test.ts` (клавиатура),
1 там же (на десктопе `.touch-controls` отсутствует), 4 в `tests/e2e/touch.test.ts` (телефон).

Как именно доказаны два ключевых факта B2:

- **Автоповтор ОС не управляет игрой.** `tests/e2e/input.test.ts` диспатчит 8 синтетических
  `KeyboardEvent('keydown', { key: 'ArrowLeft', repeat: true })` прямо в `document`; слушатель в
  странице подтверждает, что все 8 событий дошли (`delivered === 8`), а позиция фигуры не изменилась
  (`after.x === before.x`). Тот же ключ без `repeat` сдвигает фигуру на 1 — слушатель работает.
- **Повторы даёт наш DAS/ARR, а не браузер.** `page.keyboard.down('ArrowRight')` отправляет ровно
  один `keydown` (автоповтора ОС в Playwright нет), и за 400 мс фигура проходит ≥ 2 клеток; после
  `keyboard.up()` три замера подряд дают одну и ту же координату. В юнитах те же числа получаются на
  фейковых таймерах Jest: `jest.advanceTimersByTime()` двигает `Date.now()`, а часы контроллеру
  передаются инъекцией, поэтому тесты ничего не ждут в реальном времени.

## Что изменено в коде блока 4

- `frontend/src/shared/input/input-actions.ts` (новый) — словарь действий `InputAction`
  (`left`, `right`, `softDrop`, `hardDrop`, `rotateCW`, `rotateCCW`, `rotate180`, `hold`, `pause`),
  `HELD_ACTIONS = ['left', 'right', 'softDrop']` (только они автоповторяются), `KEY_MAP`
  (`←`/`A`, `→`/`D`, `↓`/`S`, `↑`/`X`/`W`, `Z`/`Q`, `R`, `C`/`Shift`, `Space`, `P`), `actionForKey()`,
  `isModifiedCombo()` (Ctrl/Alt/Cmd остаются браузеру) и `actionToCommand()` — переход
  «действие → команда CQRS». Буквы сравниваются без регистра, поэтому `CapsLock` и буква с `Shift`
  больше не теряются (старая карта в сторе их выбрасывала).
- `frontend/src/shared/input/repeat-controller.ts` (новый) — `RepeatController` с `dasMs`/`arrMs`:
  первое нажатие стреляет сразу, повтор начинается через `dasMs` и идёт каждые `arrMs`; одно
  обновление кадра = максимум один повтор (просадка кадра не «телепортирует» фигуру);
  `keyup`/`releaseAll()` сбрасывают состояние; последнее нажатое ключ держит управление, а его
  отпускание передаёт управление ключу, который всё ещё удержан; повторное `keydown` без `keyup`
  не перезапускает DAS. Чистый модуль: часы и диспетчер передаются аргументами, DOM не используется.
- `frontend/src/shared/input/input-controller.ts` (новый) — единственное место, где сырые события
  становятся действиями: `handleKeyDown` (отбрасывает `e.repeat` и модифицированные комбинации),
  `handleKeyUp`, `pressAction`/`releaseAction` (тач), `update()` (раз в кадр), `releaseAll()`.
- `frontend/src/shared/input/touch.ts` (новый) — `isTouchDevice()` по
  `matchMedia('(pointer: coarse)')`; `window.__FORCE_TOUCH_CONTROLS === true` включает контролы
  принудительно (для отладки).
- `frontend/src/shared/config/game-config.ts` — `DAS_CONFIG = Object.freeze({ dasMs: 167, arrMs: 33 })`
  (B2) рядом с `LOCK_CONFIG` и `QUEUE_SIZE`.
- `frontend/src/components/GameView.vue` — слушатели `keydown` **и** `keyup` на `document`;
  собственный цикл `requestAnimationFrame` для ввода (DAS/ARR живут отдельно от цикла гравитации
  `GameBoard`); `releaseAll()` на `blur`, `visibilitychange` и `onUnmounted`, а также каждый кадр,
  пока игра на паузе, закончена или не запущена; `Enter` после game over переехал из стора сюда;
  `Esc` не изменён (C7: сначала снять паузу, иначе — меню); подключён `<TouchControls :input="input" />`;
  медиа-запрос `max-width: 900px` (колонка, отступ снизу 150 px под панель кнопок).
- `frontend/src/components/TouchControls.vue` (новый) — тач-панель B3: `◀ ▼ ▶` как удерживаемые
  действия (`pointerdown`/`pointerup`/`pointercancel`/`pointerleave`), `⟲ ⟳ 180° HOLD DROP` как
  одноударные (`pointerdown`); `Set` по действию не даёт второму пальцу на той же кнопке выстрелить
  дважды; `touch-action: none`, `user-select: none`, `env(safe-area-inset-bottom)`, `z-index: 90`;
  на узких экранах кнопки 48×48, а кластер действий переносится на свою строку
  (`flex-wrap` + `margin-left: auto`) — иначе кнопки `HOLD`/`DROP` на 390 px выпадали за viewport
  (это и была причина первых падений E2E).
- `frontend/src/stores/gameStore.ts` — метод `handleKey` удалён (функция и экспорт): путь ввода теперь
  один, через `InputController`. Остальные экспорты не изменились.
- `frontend/src/components/HudView.vue` — медиа-запрос `max-width: 900px` (HUD строкой под доской,
  `.hud-section { flex: 1 1 28% }`, значение 20 px, очередь строкой).
- `frontend/tests/unit/input.test.ts` (новый, 25 тестов), `tests/e2e/input.test.ts` (7 тестов),
  `tests/e2e/touch.test.ts` (4 теста, профиль iPhone 13 без `defaultBrowserType` — E2E идёт в одном
  chromium-проекте конфига), `tests/e2e/helpers.ts` (общие хелперы `getErrors`/`getGameState`/
  `startGame`/`piecePosition`).

Граница блока 4 (осознанно): только ввод и его тайминг. `getGhostY` в движке — блок 5; кнопка паузы,
общие подсказки, имя игрока, `engine.stop()` и один `init()` — блок 6; бэкенд (`scoreMax`, rate-limit) —
блок 7.
