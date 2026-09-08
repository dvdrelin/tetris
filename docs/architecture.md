# Архитектура проекта Neon Tetris

Подробная документация архитектуры веб-игры «Тетрис» (неоновый стиль). Проект — это
monorepo на npm workspaces, состоящий из двух независимых, но связанных проектов:
**frontend** (SPA на Vue 3) и **backend** (Node.js + Express + WebSocket).

---

## 1. Обзор проекта

- **Название пакета:** `neon-tetris` (версия 1.0.0), приватный моно-репозиторий.
- **Цель:** браузерная игра Тетрис с неоновой графикой, двумя режимами сложности и
  REST/WS API для сохранения очков и лидербордов (задел под мультиплеер).
- **Архитектурные идеи:**
  - Разделение на **доменную логику** (чистые классы) и **представление** (UI).
  - Применение паттерна **CQRS** к игровому движку: команды изменяют состояние,
    запросы только читают его.
  - Конфигурирование через «замороженные» объекты (`Object.freeze`).

---

## 2. Технологический стек и версии

| Слой        | Технология / версия            | Назначение                          |
|-------------|--------------------------------|-------------------------------------|
| Frontend    | Vue 3 `^3.4`                   | UI-фреймворк (смешанный API)        |
| State       | Pinia `^2.1.7`                 | Управление состоянием                |
| Build       | Vite `^5.0`, @vitejs/plugin-vue `^4.4` | сборка, dev-сервер (порт 3001) |
| TS          | TypeScript `^5.3`              | типизация                           |
| Backend     | Node.js, Express `^4.18.2`     | HTTP/REST API                       |
| Backend     | ws `^8.16.0`                   | WebSocket-сервер (мультиплеер)      |
| Backend     | (были `better-sqlite3`, `uuid`) | зависимости **удалены** из package.json после фикса C3; id → crypto.randomUUID, persistence — через fs |
| Shared      | —                              | доменная логика, общая для обоих слоёв |

---

## 3. Структура репозитория

```
tetris/                          (корень monorepo, npm workspaces: frontend, backend)
├── package.json                 # root scripts (dev/build/start), npm-run-all
├── tsconfig.base.json           # общие компиляторные опции (alias @shared/* удалён, C5)
│
├── frontend/                    # Vue 3 SPA
│   ├── package.json             # vue, pinia (+ dev: vite, vue-tsc)
│   ├── index.html               # точка монтирования #app
│   ├── env.d.ts                 # типы для *.vue и vite/client
│   ├── vite.config.ts           # alias @ -> src; прокси /api и /ws на :3000
│   └── src/
│       ├── main.ts              # createApp + createPinia, mount('#app')
│       ├── App.vue              # корень: переключатель MenuView / GameView
│       ├── shared/              # ← доменная логика (общая)
│       │   ├── domain/          #   types.ts, board.ts, pieces.ts
│       │   ├── cqrs/            #   commands.ts, queries.ts
│       │   └── config/          #   game-config.ts
│       ├── stores/              # pinia-хранилище
│       │   └── gameStore.ts     # мост UI <-> engine, ввод с клавиатуры, частицы
│       └── components/          # представления
│           ├── App-level:        MenuView.vue (меню, выбор режима)
│           │                     GameView.vue (контейнер + обработка нажатий)
│           │                     GameBoard.vue (canvas-рендер + игровой цикл)
│           └── HudView.vue      # HUD: счёт/уровень/линии/комбо/следующая фигура
│
└── backend/                     # Node.js сервер
    ├── package.json             # express, ws
    ├── tsconfig.json            # target ES2020, module commonjs, rootDir src
    └── src/
        ├── index.ts             # создание app/httpServer/ws + upgrade-роутинг /ws
        ├── servers/
        │   └── gameServer.ts    # WebSocket: join/action/leave, broadcast
        ├── routes/
        │   └── gameRouter.ts    # REST: POST /score, GET /scores,/leaderboard,/player/:name
        └── services/
            └── scoreService.ts  # persistence в data/scores.json + лидерборды
```

---

## 4. Общая архитектура (слои)

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vue SPA)                     │
│                                                               │
│  ┌──────────┐   emits/props    ┌───────────────┐             │
│  │ MenuView │ ───────────────> │     App.vue   │             │
│  └──────────┘                  └───────┬───────┘             │
│                                         │ showGame/menu        │
│  ┌──────────┐                          ▼                     │
│  │ HudView  │◄──────────── GameView.vue ◄─ keydown            │
│  └──────────┘   watch(gameState)      (handleKeydown)         │
│       ▲  render next-piece canvas                              │
│       │                                                        │
│  ┌────┴───────────────────────────────────────────┐          │
│  │              Pinia: gameStore                   │          │
│  │  gameState(ref) · particles(ref)                │          │
│  │   • init / startGame / handleCommand            │          │
│  │   • handleKey (клавиатура)                       │          │
│  │   • getGhostY, updateParticles/spawnParticles    │          │
│  └────┬───────────────────────────────────────────┘          │
│       │ callbacks: onStateChange / onLineClear / onGameOver   │
│       ▼                                                        │
│  ┌──────────────────────── GameEngine (CQRS) ───────────────┐ │
│  │  handleCommand() → start/move/rotate/drop/tick/pause…     │ │
│  │  handleQuery()  → getGameState/getNextPiece/getBoardState  │ │
│  │   ├─ BoardManager (сетка, коллизии, clearLines)           │ │
│  │   ├─ PieceFactoryProvider / PieceFactory (7-bag)          │ │
│  │   └─ GAME_CONFIG / SCORING_CONFIG (frozen)                │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                │ (чистая логика, импортируется и из frontend через relative,
                                │  и задумана для reuse в backend через alias @shared/*)
┌───────────────────────────────▼───────────────────────────────┐
│                        BACKEND (Node/Express)                  │
│  ┌─────────────┐   HTTP    ┌──────────────┐                    │
│  │ gameRouter  │ <────app> │ express app  │                    │
│  │ (REST scores)│          └──────────────┘                    │
│  └──────┬──────┘                                                  │
│         │ ScoreService                                            │
│         ▼                                                         │
│  data/scores.json   ←→   WebSocket gameServer (/ws)              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 Доменный слой (`frontend/src/shared`)
Чистая, без-UI логика игры:
- **`types.ts`** — все типы и enum'ы проекта: `Cell`, `Position`, `Piece`, `GameState`,
  `MoveAction`, `Action`, `TickResult`, `Particle`, конфиги (`GameConfig`, `ScoringConfig`,
  `SpeedConfig`) и enum'ы `CellState`, `PieceType`, `GameMode`.
- **`board.ts`** — класс `BoardManager`: создание/сброс сетки, `setCells`, валидация
  позиции, коллизии, `clearLines` (удаление заполненных строк), ghost-расчёт. Проверка game-over вынесена в движок (`GameEngine.spawnNextPiece`).
- **`pieces.ts`** — таблица форм всех 7 фигур (`PIECE_SHAPES`, каждая из 4 ориентаций =
  корректный тетромино по 4 клетки, все — истинные 90°-повороты) + маппинг цветов; классы
  `PieceFactory` (7-bag рандомизатор с Fisher–Yates), `PieceFactoryProvider`, и вспомогательная
  функция **`buildPiece(type, shape)`** — собирает `{type, shape, colors}` под заданную ориентацию.
  При повороте движок пересобирает фишку через `buildPiece` (раньше менялись только индекс
  вращения и `shape`, но не цвета → «кривые» фигуры). Импортируется в `game-engine.ts`.
- **`game-config.ts`** — три замороженных константы: `SCORING_CONFIG`, `SPEED_CONFIG`,
  `GAME_CONFIG` (10×20).

### 4.2 CQRS (`frontend/src/shared/cqrs`)
- **`commands.ts`** — enum `CommandType` и набор интерфейсов команд с `payload`.
- **`queries.ts`** — enum `QueryType` и интерфейсы запросов.

### 4.3 Игровой движок (`GameEngine`, `game-engine.ts`)
Сердце логики. Хранит приватное состояние (сетка, текущая фигура, позицию, вращение,
счёт, уровень, линии, комбо, флаги) и exposes его через:
- **Команды** — `handleCommand()` dispatch по `handlerMap`: StartGame, MovePiece,
  RotatePiece (+ wall-kick SRS + мгновенная смерть в Hardcore), SoftDrop, HardDrop, Tick (auto-drop в Arcade), Pause/Resume.
- **Запросы** — `handleQuery()`: GetGameState / GetNextPiece / GetBoardState.
- Вспомогательное: спавн фигур (`spawnNextPiece`, проверка game over), размещение и
  подсчёт очков (`placePiece`, `calculateScore` с комбо-множителем). **Поворот** — в
  `rotatePiece`: пробует wall-kick'и SRS, а при успешном повороте пересобирает фишку через
  `buildPiece(type, rotatedShape)` (форма + цвета остаются согласованными). Система частиц в
  движке удалена (B6); визуальные эффекты — в хранилище/UI.

### 4.4 Pinia + UI
- **`gameStore.ts`** — мост между UI и движком: держит `gameState` (DTO) и `particles`,
  инстанцирует один `GameEngine`, переводит результат запроса в DTO, вычисляет позицию
  «призрачной» фигуры (`getGhostY`), обрабатывает клавиатуру.
- **Компоненты:**
  - `App.vue` — переключатель между меню и игрой (`v-if="showMenu"` / `v-else`). Важно:
    `showMenu` должен быть в `return {}` из `setup()` (иначе шаблон падает с «property not defined»).
  - `GameView.vue` — контейнер + глобальный слушатель `keydown`.
  - `GameBoard.vue` — canvas-рендер (сетка, уложенные ячейки, ghost, текущая фигура,
    частицы, оверлеи паузы/game over) и **игровой цикл** на `requestAnimationFrame` с
    накопителем времени для авто-tick в Arcade. Рисует текущую фигуру по `currentPiece.shape`.
  - `HudView.vue` — HUD (счёт/уровень/линии/комбо), превью следующей фигуры на canvas,
    кнопки паузы; рендерится через **`<template>`** (раньше был строковый `render()`, отдававший
    HTML как текстовый узел → пустой экран; см. errors.md §H). Использует `gameStore.gameState`.

### 4.5 Backend
- **`index.ts`** — Express + HTTP-сервер (порт `PORT || 3000`), роутинг `/api`,
  WebSocket-сервер (`ws`, режим `noServer`) и хендлер `upgrade` для подключения по `/ws`.
- **`gameServer.ts`** — управление сессиями игроков (`players`, `gameStates` maps):
  обработка сообщений `join / action / leave`, broadcast всем клиентам.
- **`scoreService.ts`** — persistence очков в `data/scores.json`: сохранение, топ-очки,
  лидерборд (по игроку/режиму), статистика по игроку.
- **`gameRouter.ts`** — REST: `POST /api/score`, `GET /api/scores`, `/leaderboard`,
  `/player/:name`.

---

## 5. Поток данных

### 5.1 Запуск игры
```
MenuView.startGame(mode) → gameStore.startGame(mode)
   → engine.handleCommand({StartGame, payload:{mode}})
     → reset() + spawnNextPiece(); isRunning=true
gameStore.updateState() → пересчёт DTO + ghostY → re-render
```

### 5.2 Ввод игрока → движок
```
keydown (в GameView) → gameStore.handleKey(e)
   → engine.handleCommand({MovePiece/Rotate/SoftDrop/HardDrop/Pause…})
     → изменение приватного состояния + onStateChange()
gameStore.updateState() → gameState.value = {...}  → watch() → GameBoard.render()
```

### 5.3 Игровой цикл рендера (GameBoard.vue)
`requestAnimationFrame(gameLoop)` каждую итерацию:
1. вычисляет `dt`;
2. в Arcade-режиме накапливает время и при достижении интервала (`initialInterval − (level−1)*intervalDecrease`,
   не ниже `minInterval`) отправляет команду `Tick` движку;
3. обновляет частицы (`updateParticles(dt)`);
4. рисует всё на canvas.

### 5.4 Подсчёт очков и лидерборд
```
placePiece() → clearLines() > 0
   → score += calculateScore(lines, combo) (комбо-множитель 1.5)
   → level = floor(linesCleared/10)+1
   → onLineClear() → spawnParticles()
После партии (POST /api/score) → ScoreService.saveScore() → data/scores.json
```

### 5.5 WebSocket (задел на мультиплеер)
Клиент подключается по `/ws`, отправляет `{type:'join', payload:{name,mode}}`;
сервер создаёт уникальный `playerId`, инициализирует пустое состояние и broadcast'ит
`playerJoined`. Состояние игроков/сессий хранится в памяти (maps).

---

## 6. Конкурентность и тайминг

- Движок — **single-threaded** JS: все мутации состояния происходят синхронно внутри
  обработчиков команд; нет асинхронности в игровой логике.
- Рендер — `requestAnimationFrame` (≈60 fps), развязан от игрового темпа через
  **накопитель времени** (`tickAccumulator`) и нормализацию по `dt`.
- Частицы реализованы **одной системой** в хранилище (`store.particles`, рендерит GameBoard); движковая система частиц удалена (B6 — была мёртвой, не связана с очисткой строк).
- Persistence — атомарная запись через temp + rename (D3), конкурентность/блокировки на уровне ОС.

---

## 7. Конфигурирование

Игра полностью параметризуется через три замороженных объекта в `game-config.ts`:
размер поля (10×20), кривая скорости (`initialInterval=800`, `intervalDecrease=50`,
`minInterval=50`) и таблица очков (`single/double/triple/tetris/softDrop/hardDrop`,
комбо-множитель 1.5, decay 0.5). Изменение любого параметра не требует правки логики.

---

## 8. Ключевые решения и trade-offs

| Решение | Обоснование / компромисс |
|---------|--------------------------|
| CQRS в движке | Чёткое разделение мутаций/чтения; но добавляет обёртку `handlerMap`/switch и касты `any`. |
| Домен «в frontend» | Логика живёт в UI-проекте, а не вынесена в отдельный пакет. Задуман alias `@shared/*`, но он **не используется** — импорт идёт по относительным путям. |
| Ghost через вычисление в store | Позиция ghost считалась в Pinia (`getGhostY`); координаты были рассинхронизованы (B2), теперь getGhostY возвращает верхнюю строку приземления — совпадает с размещением в движке. |
| 7-bag рандомизатор | Гарантирует равномерное распределение фигур; реализован вручную (Fisher–Yates). |
| Файловая persistence вместо БД | Простота; запись теперь атомарная (temp+rename, D3). Зависимости `better-sqlite3`/`uuid` удалены из deps (C3). |
| WebSocket без маппинга ws→player | Привязка действий/выхода к конкретному сокету была сломана (D1); теперь Map<WebSocket, playerId> — действия и leave корректны. Broadcast всем клиентам сохранён. |

---

## 9. Зависимости между модулями (сводка)

- `App.vue` → `MenuView`, `GameView`; `main.ts` → `App`.
- `gameStore` → `GameEngine`, домен, CQRS, конфиг; управляет движком через callbacks.
- `GameBoard`/`HudView` → `gameStore.gameState` (watch/ref); `GameBoard` рисует canvas + цикл tick.
- `GameEngine` → `BoardManager`, `PieceFactoryProvider`, `PIECE_SHAPES`, конфиги, CQRS.
- Backend: `index.ts` → `GameServer`, `ScoreService`(через router), роутер; `gameRouter` → `ScoreService`.
