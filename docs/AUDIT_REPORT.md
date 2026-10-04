# Аудит: вращение фигур + противоречия документации

**Дата:** 2026-09-13 · **Метод:** мультиагентный аудит + собственная инструментальная верификация
**Что проверялось:** все 8 документов в `docs/`, `README.md`, весь `frontend/src`, `backend/src`, `app.js`, `tests/`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, git-история.
**Как верифицировалось:** реальный TS-движок компилировался (`tsc` → CommonJS) и прогонялся в Node; бандл `frontend/dist` проверялся поиском; тесты запускались; геометрия фигур считалась скриптом. Все артефакты — в `audit-verify/` (см. §10).

> **Статус:** §1–§10 описывают состояние **до** исправления (замеры сделаны на коммите `e570ee8`). P0 из §9 **применён**, повторные замеры на исправленном коде — в **§11**.

---

## 1. Главный вывод (корень «некорректного вращения»)

В игру играет **Vue-приложение** (`frontend/`, прод-бандл `frontend/dist`, который отдаёт backend; dev — `localhost:3001`).

«Финальная исправленная система вращения» из `docs/ROTATION_SYSTEM_REFERENCE.md` объявлена **ЗАФИКСИРОВАННОЙ**, но по собственному заголовку она «Применено в: `app.js`». Git это подтверждает буквально:

| Коммит | Что реально изменено |
|---|---|
| `04be72a` «FINAL: зафиксировать систему вращения фигур (SHAPES + wall kicks)» | **только** `app.js` (+54/−22) и 4 файла `docs/`. Ни одного файла `frontend/`. |
| `9d43990` «feat: fix piece rotation» | `frontend/src/shared/domain/pieces.ts`: корректные 3×3 матрицы **заменены** на 3×2 (`- [[0,1,0],[0,1,1],[0,1,0]]` → `+ [[0,1],[0,1],[0,1]]`, `+ [[1,1],[1,1],[0,1]]`, `+ [[1,1,0],[0,1],[0,1]]`) |

`9d43990` — предок `HEAD` (`e570ee8`). То есть **коммит с названием «fix piece rotation» и есть регрессия**: он вернул в боевой код ровно те дефекты (матрицы 3×2/3×1, фигуры не из 4 клеток), которые `docs/PHASE1_FIXES.md §1.5` и `docs/errors.md H5` объявляют исправленными.

Итог: в проекте **две разные системы вращения**. `app.js` (legacy, недоступный ни из одного пути сборки) содержит корректный SRS. Боевой `frontend/src/shared/domain/pieces.ts` содержит сломанные матрицы, а `game-engine.ts` — 5 wall-kick вместо документированных 11.

Прод-бандл (`frontend/dist/assets/index-mDXpicBE.js`, mtime 2026-09-13 23:10) подтверждает: в нём **есть** `[[0,1],[0,1],[0,1]]` и `[[1,1],[1,1],[0,1]]`, **нет** `{x:-2,y:0}`.

---

## 2. Фактическое состояние `frontend/src/shared/domain/pieces.ts` (строки 13–56)

Скрипт `audit-verify/check-shapes.mjs` (матрицы скопированы дословно из файла):

| Фигура | rot0 | rot1 | rot2 | rot3 | Диагноз |
|---|---|---|---|---|---|
| I | 4 кл., 4×4, row1 | 4 кл., col **1** | 4 кл., row2 | 4 кл., col **3** | форма ок, но **нет центрирования**: I rot3 прижат к правому краю бокса |
| O | 2×2 ×4 | — | — | — | ок |
| T | 4 кл., 3×3 | **3 кл., 3×2** | 4 кл., 3×3 | 4 кл., **3×2** | rot1 — не тетромино; rot1/rot3 не 90°-повороты rot0 |
| S | 4 кл., 3×3 | 4 кл., **3×2** | = rot0 | = rot1 | форма ок (у S действительно 2 формы), но rot2 не смещён на строку вниз, как в SRS |
| Z | 4 кл., 3×3 | 4 кл., **3×2** | = rot0 | = rot1 | то же |
| J | 4 кл., 3×3 | **3 кл., 3×2** | 4 кл., 3×3 | 4 кл., **рваная 3/2/2** | rot1 — не тетромино; rot3 — «лесенка», не тетромино |
| L | 4 кл., 3×3 | **5 кл., 3×2** | 4 кл., 3×3 | **5 кл., 3×2** | rot1/rot3 — пятиклеточные фигуры |

Сравнение с эталоном SRS (канонические нормализованные формы): **MISMATCH** у `T rot1`, `J rot1`, `J rot3`, `L rot1`, `L rot3`. Всё остальное совпадает по форме.

**Почему это видно глазами.** У всех JLSTZ чётные вращения — 3 колонки, нечётные — 2 колонки. Движок позиционирует фигуру по верхнему левому углу матрицы (`currentPos`), поэтому при каждом повороте bounding box меняет ширину 3→2 и фигура **прыгает на клетку вбок**. Плюс T/J теряют клетку, L приобретает лишнюю.

---

## 3. Проверено прогонами реального движка (`audit-verify/engine-probe*.cjs`)

| # | Наблюдение | Факт |
|---|---|---|
| 1 | Число клеток текущей фигуры меняется при повороте | T: `4 → 3 → 4 → 4 → 4`; J: `4 → 3 → 4 → 4 → 4`; L: `4 → 5 → 4 → 5 → 4` |
| 2 | `softDrop` (строки 200–208) увеличивает `y` **до** проверки валидности, затем `placePiece()` | Два `SoftDrop` подряд зафиксировали O в невалидной позиции и **перезаписали уже закреплённые клетки Z**: `(4,2)` и `(5,2)` сменили `value=5` на `value=2` |
| 3 | Очки начисляются за невалидное движение | `score += 10` до проверки → +10 за «промах» |
| 4 | Клетки теряются за нижним краем | Вертикальный I, 30× `SoftDrop`: зафиксировалось **3** клетки из 4 (`17,4 18,4 19,4`) |
| 5 | `hardcoreDeath` (165–168) не сбрасывает `_isRunning` | После смерти в Hardcore: `isGameOver=true`, но `isRunning=true`; `Tick/SoftDrop/HardDrop` продолжают исполняться — счёт вырос с `0` до `350` **после** Game Over (спасает только guard в `gameStore.handleKey`) |
| 6 | `rotatePiece` (170–198) | Только 5 kick-позиций: `{0,0}, {-1,0}, {1,0}, {0,-1}, {0,1}`; `{±2,0}` и диагональных **нет** |
| 7 | I у правой стены | 2×CW корректно доходит до колонок 6–9 (случайно, за счёт счётчика клеток) |
| 8 | O | поворот меняет только индекс — ок |

### 3.1 Полный перебор позиций (свип по всему полю 10×20)

Скрипт `tmp-audit/audit3_kicks.mjs` (артефакт предыдущего прогона) сравнивал каждый
возможный поворот в каждой клетке поля с эталонным SRS:

| Сценарий | Проверено | Отличий от SRS |
|---|---|---|
| **A.** текущие `PIECE_SHAPES` + текущие 5 kicks | 4331 | **167 (3.9 %)** — I 21, T 26, S 34, Z 34, J 26, L 26 |
| **B.** эталонные SRS-формы + текущие 5 kicks | 4242 | **61 (1.4 %)** — все 61 приходятся на I |
| **B2.** эталонные формы, CCW (движок использует **тот же** список kicks, что и для CW) | 4242 | **88 (2.1 %)**, из них 48 — I |

Разница между A и B (167 → 61) изолирует вклад битых матриц; остаток 61/88 — вклад kick-таблицы.
Движок **не различает направления поворота**: один и тот же список kick-позиций применяется и
для CW, и для CCW, тогда как в SRS таблицы разные для каждой пары вращений.
Пример расхождения: `I rot0 CW at (0,18)` — движок **отказывает** в повороте, SRS даёт
`(1,16)` через kick `(1,-2)`.

---

## 4. Противоречия «документ ↔ документ»

| № | Документ A | Документ B | Суть |
|---|---|---|---|
| D1 | `ROTATION_SYSTEM_REFERENCE.md:144`: `T \| ↓ \| → \| ↑ \| ← \|` | `PHASE1_FIXES.md:121` (было): `T \| ↓ \| ← \| ↑ \| → \|` | Одно и то же — стрелки T rot1/rot3 были переставлены. **Устранено:** матрицы (`[[0,1,0],[0,1,1],[0,1,0]]` = выступ справа) однозначно дают rot1 = →, rot3 = ←; `PHASE1_FIXES.md:121` приведён к `↓ → ↑ ←`, оба документа согласованы |
| D2 | `ROTATION_SYSTEM_REFERENCE.md §1` (правило: «ВСЕ 4 вращения имеют ОДИНАКОВЫЙ размер матрицы») | `ROTATION_SYSTEM_REFERENCE.md §2` (собственные матрицы) | Внутреннее противоречие: §2 корректен, но §5-таблица описывает их неверно (см. D3) |
| D3 | `ROTATION_SYSTEM_REFERENCE.md §5` / `PHASE1_FIXES.md:119`: «I rot1 — верт. col 1, rot3 — верт. col 2» | `ROTATION_SYSTEM_REFERENCE.md §2` (матрицы): rot1 — колонка 3, rot3 — колонка 2 | Таблица противоречит матрицам того же документа |
| D4 | `ROTATION_SYSTEM_REFERENCE.md:5` «Применено в: `app.js`» | `PHASE2_ARCHITECTURE.md:103–107`, `architecture.md:132–137`, `errors.md H5` | Один документ говорит, что система в `app.js`; остальные приписывают её `pieces.ts` / `GameEngine` Vue-фронтенда |
| D5 | `PHASE1_FIXES.md` шапка: v1.1 / 2025-09-08 | `PHASE1_FIXES.md:135–136`: v1.2, v1.3 / 2025-09-13 | Версия и дата внутри одного файла не согласованы |
| D6 | Все даты в `docs/`: 2025-09-xx | git: коммиты `04be72a`, `9d43990` — **2026-09-13** | Документация «моложе» кода на год |
| D7 | `SESSION_CONTEXT.md:7`: HEAD = `bbecb19` | git: HEAD = `e570ee8` | Документ описывает состояние на 5 коммитов старее; `bbecb19` существует, но не является HEAD |
| D8 | `PLAN.md:11` / `PHASE2_ARCHITECTURE.md:4`: Фаза 2 «✅ Завершено (74 теста, все прошли)» | `PLAN.md` / `PHASE3_MULTIPLAYER.md:4`: Фаза 3 «⬜ Не начато», при этом `README.md:118` заявляет «real-time sync» | Готовность Phase 2 подтверждается тестами, которые не запускаются штатной командой (см. §7) |
| D9 | `errors.md:546–547` «vue-tsc НЕ использовать (E1)» | `frontend/package.json:7` `"build": "vue-tsc --noEmit && vite build"` | Документ запрещает то, что является штатным скриптом сборки фронтенда |
| D10 | `README.md:13` «Touch-управление — свайпы на мобильных» | `frontend/src` (grep `touch\|swipe\|pointerdown` = **0 совпадений**) | Свайпы есть только в legacy `app.js` |
| D11 | `architecture.md:176,255` (WS «join/action/leave», «действия корректны», broadcast) | `PHASE3_MULTIPLAYER.md:4` «Не начато» | Архитектурный документ описывает работающий WS-геймплей, план — отсутствующий мультиплеер |

---

## 5. Противоречия «документ ↔ код»

> Таблица фиксирует состояние **на момент аудита** (HEAD `e570ee8`, до починки). Что из этого закрыто
> правками P0–P3 и что осталось — §12.

| № | Утверждение документа | Реальность в коде |
|---|---|---|
| C1 | `architecture.md:132–133`: «PIECE_SHAPES, каждая из 4 ориентаций = **корректный тетромино по 4 клетки**, все — истинные 90°-повороты» | `pieces.ts`: T rot1 и J rot1 — **3 клетки**, L rot1/rot3 — **5 клеток**, J rot3 — рваная матрица 3/2/2; 5 из 28 проверенных ориентаций не являются 90°-поворотом предыдущей |
| C2 | `errors.md H5` «✅ исправлено: все 4 ориентации каждой из 7 фигур — ровно 4 клетки» | Регрессия `9d43990` вернула баг; на момент аудита — **не исправлено** |
| C3 | `errors.md H7` / `PHASE2_ARCHITECTURE.md:107`: «wall kicks расширены до **11 позиций** (включая `{-1,-1},{1,-1},{-1,1},{1,1},{-2,0},{2,0}`)» | `app.js:186–213` — 11 позиций ✅. `game-engine.ts:177–179` — **5 позиций** ❌. В прод-бандле `{x:-2,y:0}` отсутствует |
| C4 | `errors.md:519` «Вращение работает для всех фигур (клавиши ↑/x/z/c/w — CW; q — CCW)» | Работает в `app.js`. Во фронтенде — см. §2–3. Кроме того, `q`/`a`/`d`/`e` нигде не описаны в UI-подсказках (`HudView.vue`) |
| C5 | `errors.md B4` «Убран `comboDecay`» | `types.ts:119` (`comboDecay: number`) и `game-config.ts:11` (`comboDecay: 0.5`) живы; поле обязательно в типе и **нигде не используется** |
| C6 | `errors.md C2` «✅ исправлено — запросы удалены (`GetNextPiece`, `GetBoardState`)» | `game-engine.ts handleQuery` по-прежнему реализует **все три** (`GetGameState`, `GetNextPiece`, `GetBoardState`); `queries.ts` не удалён |
| C7 | `errors.md C1` «добавлена валидация payload» | `rotatePiece`: `(command as any).payload?.direction === 'cw' ? 1 : -1` — приведение к `any`, нет проверки; любое значение ≠ `'cw'` = CCW |
| C8 | `README.md:103` `npm run test` | В корневом `package.json` скрипта `test` **нет** (есть только `test:e2e`) |
| C9 | `README.md:118` «Express + WebSocket — real-time sync» | `frontend/src` **не открывает WebSocket** (только `fetch` в `gameStore.ts:95`, `leaderboardStore.ts:31,45`); серверный `action` — пустая заглушка (`gameServer.ts:135–137`), broadcast только на join (`:126`) |
| C10 | `README.md:13` touch | См. D10 |
| C11 | `architecture.md:159` «gameStore … вычисляет позицию ghost» | Утверждение по сути верно: ghost считается **только** в сторе (`gameStore.ts:152 getGhostY`, судит по `value !== 0`). **Поправка к аудиту:** в `board.ts` никакого `calculateGhost` нет (в нём только `reset/getCell/setCell/setCells/isValidPosition/hasCollision/clearLines/getSnapshot/getCells/getWidth/getHeight`), а движок `ghostY` не заполняет вовсе — то есть «двух источников истины» по `locked` не существует; в `architecture.md:130–131` ghost ошибочно был приписан `BoardManager` (исправлено в P2) |
| C12 | `architecture.md:149` «Tick (auto-drop в Arcade)» | Скорость падения фактически живёт в `GameBoard.vue` (`tickAccumulator`), а `SCORING_CONFIG`/`SPEED_CONFIG.autoDropInterval` в движке вычисляется и **не используется**. **Поправка к аудиту:** поля `autoDropInterval` в текущем коде нет; неиспользуемым остался локальный `interval` в `GameEngine.autoDrop()` — см. §12.4 п.6 |
| C13 | `PHASE2_ARCHITECTURE.md:58` — E2E-тест «rotation» | `tests/e2e/game.test.ts:83` нажимает `ArrowUp`, но **ничего не проверяет**, кроме отсутствия ошибок консоли |
| C14 | `PHASE2_ARCHITECTURE.md` / `README.md:108`: «51 frontend = 15+14+14+8» | Файлы дают 17 (`engine`) и 12 (`pieces`); сумма 51 совпадает, разбивка — нет |
| C15 | `Dockerfile:28` / корневой `build:frontend` — `vite build` | `frontend/package.json:7` — `vue-tsc --noEmit && vite build`. Штатная команда `npm run build` **падает** (vue-tsc 1.8.27 несовместим с TypeScript 5.9.3: `Search string not found: "/supportedTSExtensions = .*(?=;)/"`) → `.vue`-файлы в проекте **никогда не типизируются** |
| C16 | `deploy.sh` «полная выгрузка проекта» | Не копирует `frontend/index.html` (строки 126–156) → удалённый `npx vite build` (`:180`) не имеет SPA-входа; не копирует `tsconfig.base.json`, который расширяет `frontend/tsconfig.json:2`; `backend/jest.config.js` копируется в **корень**, а не в `backend/`; каталог `backend/data` на сервере не создаётся |
| C17 | `SESSION_CONTEXT.md:35` «npx заблокирован» | Корневые скрипты `dev/build` (`package.json:11–15`) построены на `npx` → локально не работают |
| C18 | `README.md` / `docs/` описывают единое приложение | Legacy `index.html` + `app.js` + `styles.css` недоступны ни из одного пути: не копируются `Dockerfile` (только `frontend/`, `backend/`), не отдаются backend'ом (`express.static → frontend/dist`), не участвуют в `vite.config.ts` (ныне — `frontend/vite.config.mts`, см. §12.7). **Поправка к аудиту:** исторически `app.js:9` указывал на внешний API-хост, который больше **не является окружением** этого проекта; сейчас там `API_URL = ''` (same-origin `/api/score`, `/api/leaderboard` — `app.js:14,27`). Мёртвым остаётся сам файл `app.js` |

---

## 6. Ложные отметки «✅ исправлено» в `docs/errors.md`

| ID | Статус в документе | Итог аудита |
|---|---|---|
| **H5** | ✅ исправлено | **НЕ исправлено** (регрессия `9d43990`) — 3-клеточные T/J, 5-клеточные L |
| **H7** | ✅ исправлено | Исправлено **только для `app.js`**; в боевом движке wall-kick'ов по-прежнему 5 |
| **B4** | ✅ исправлено | `comboDecay` не удалён из типов и конфига (мёртвая конфигурация) |
| **C2** | ✅ исправлено | Запросы не удалены: `handleQuery` реализует все 3 типа |
| **C1** | ✅ исправлено | Валидации `payload` у `RotatePiece` нет (`as any`) |
| **A1/A2, B1–B3, B6, H1–H4, H6** | ✅ исправлено | Подтверждено: код соответствует (проверено чтением и компиляцией) |
| **D1–D3** | ✅ исправлено | Подтверждено для `app.js`; к фронтенду не относятся |

**Статус тех же пунктов после P0/P1/P2 (рабочее дерево):**

| ID | Итог после правок |
|---|---|
| **H5** | ✅ **Исправлено по-настоящему** в боевом коде: канонические `PIECE_SHAPES` (`shared/domain/pieces.ts`) + тесты `rotation-geometry.test.ts` (28/28 ориентаций против эталона SRS) и `rotation-kicks.test.ts` |
| **H7** | ✅ Исправлено в боевом движке: 8 направленных пар kicks (`KICKS_JLSTZ`/`KICKS_I`/`KICKS_O`), а не «11 универсальных позиций» — такая формулировка была верна только для `app.js` |
| **B4** | ✅ `comboDecay` удалён из `ScoringConfig` (`types.ts`) и `SCORING_CONFIG` (`game-config.ts`); сброс комбо без дробного затухания закреплён тестом |
| **C1** | ✅ Добавлена проверка `payload.direction` (`'cw'`/`'ccw'`, иначе команда игнорируется) + тест на «мусорный» direction; остаток: приватные хендлеры движка по-прежнему принимают `command: any` |
| **C2** | ❌ **Осталось как есть (осознанно):** `handleQuery` реализует все 3 запроса, `queries.ts` не удалён. В `errors.md` статус перебит на «не исправлено» — ложная отметка снята, код не ломали |
| **C3** | ✅ Runtime-зависимости `uuid`/`better-sqlite3` из backend удалены; мёртвые dev-зависимости `@types/uuid` и `@types/better-sqlite3` удалены позже, при обновлении зависимостей (§12.7) |
| **H1** | ⚠️ Формулировка в `errors.md` исправлена: идентификатора `showMenu` в `App.vue` нет и никогда не было — переключение экрана делает `currentView` (`App.vue:12,142–148,160–161`) |

---

## 7. Тесты: заявленное vs фактическое

| Слой | Заявлено | Факт |
|---|---|---|
| Frontend unit | 51, «все проходят» | **51/51 проходят**, но **только при запуске из `frontend/`**. Из корня — 4 сюиты падают: `frontend/jest.config.js:12` → `tsconfig: './tsconfig.json'`, который из корня резолвится в отсутствующий `C:\GIT\tetris\tsconfig.json` |
| Backend unit | 9 | **9/9 проходят** ✅ |
| E2E | 14, «все проходят» | 14 объявлено (`game.test.ts` 10 + `leaderboard.test.ts` 4). Штатная команда `npm run test:e2e` = `playwright test` из корня **падает**: `ReferenceError: describe is not defined` (`frontend/tests/unit/board.test.ts:4`), `beforeEach is not defined` (`backend/tests/unit/scoreService.test.ts:14`) — Playwright подхватывает Jest-тесты, `tests/playwright.config.ts` не подхватывается, `webServer`/`baseURL` не заданы |
| Покрытие геометрии вращения | — | **Нулевое.** `pieces.test.ts:67–92` проверяет только «4 состояния» и «≥1 заполненная клетка». Нет проверок «ровно 4 клетки», размеров 3×3/4×4, SRS-киков. `renderer.test.ts` мокает `rotate` как `jest.fn()`. Слово «kick» в тестах не встречается |

**Вывод:** 60 Jest-тестов честные, но ни один не способен был поймать регрессию `9d43990`.

---

## 8. Прочие подтверждённые дефекты (вне вращения)

1. **`board.ts setCells`** пишет `{value, locked: true}` безусловно — затирает уже закреплённые клетки (см. §3 п.2).
2. **`board.ts`**: `isValidPosition` запрещает `boardY < 0`, а `hasCollision` — разрешает; `hasCollision` движком не используется.
3. **`game-engine.ts reset()` (119–131)** присваивает `this.board = boardManager.getCells()` до `reset()` → мёртвое поле-алиас.
4. **`GameStateSnapshot.currentPiece: number[]`** — тип описывает фигуру как плоский массив чисел; реальной такой формы нет.
5. **`frontend/src/engine/piecePreview.ts`** — `renderPiecePreview` экспортируется и **нигде не импортируется** (grep) → мёртвый код; при этом `HudView.vue:8–16` содержит **4-ю копию** таблицы фигур (`PREVIEW_SHAPES`), независимую от `PIECE_SHAPES`.
6. **`App.vue`**: `bgParticles` объявлен как `Array<{x,y,vx,vy,size,baseAlpha,hue}>`, а пушатся объекты с `phase,speed,alphaMin,alphaMax,hue` → несовпадение типов; не ловится, потому что vue-tsc сломан (C15). `nextView`/`viewOrder` — мёртвый код.
7. **Backend**: `getDBDir = join(dbPath, '..', '..')` (`scoreService.ts:10–12`) даёт `backend/`, а не `backend/data/`; при отсутствии `backend/data` `saveScores` бросает неперехваченный `ENOENT` → POST падает (в Docker маскируется `mkdir` из `Dockerfile:48`, в `deploy.sh` каталог не создаётся).
8. **Backend**: `POST /api/score` без аутентификации, лимитов и границ (`gameRouter.ts:20–27`) — принимаются отрицательные, дробные, `1e18`, произвольные `mode/level/lines`, имя игрока без ограничения длины.
9. **`docs/tsc-frontend.log`** — нечитаем (бинарный), при этом упоминается как артефакт проверки типов.

---

## 9. Приоритетный план исправлений

### P0 — починить вращение (боевой фронтенд) — **ПРИМЕНЕНО, см. §11**
1. `frontend/src/shared/domain/pieces.ts` → канонические SRS-матрицы (совпадают с `app.js:42–80` и `ROTATION_SYSTEM_REFERENCE.md §2`):
```ts
I: [ [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
     [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
     [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
     [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]] ],
O: [[1,1],[1,1]],
T: [ [[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]],
     [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]] ],
S: [ [[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]],
     [[0,0,0],[0,1,1],[1,1,0]], [[1,0,0],[1,1,0],[0,1,0]] ],
Z: [ [[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]],
     [[0,0,0],[1,1,0],[0,1,1]], [[0,1,0],[1,1,0],[1,0,0]] ],
J: [ [[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]],
     [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]] ],
L: [ [[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]],
     [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]] ]
```
2. `game-engine.ts rotatePiece` → **таблицы kicks по паре вращений** (0→R, 0→L, R→2, 2→R, 2→L, L→2, R→0, L→0), отдельные для I и JLSTZ, с учётом того, что в движке **ось Y направлена вниз** (знаки `y` из классических SRS-таблиц надо инвертировать). Отказаться от «11 универсальных позиций» — такой подход в документации описан неверно даже для `app.js`.
3. `softDrop`: сначала `y+1` + проверка, `placePiece()` **только** если позиция невалидна; очки — только за валидное движение.
4. `hardcoreDeath`: `_isRunning = false` (и guard в `handleCommand`, а не только в `gameStore.handleKey`).
5. `board.ts setCells`: не перетирать `locked`-клетки.

### P1 — тесты, которые ловят этот класс багов
6. В `pieces.test.ts`: ровно 4 заполненные клетки в каждой ориентации; одинаковая ширина/высота матрицы у всех 4 ориентаций; `rot(k+1) === rotate90(rot(k))`; отсутствие рваных строк.
7. Тесты wall-kick у стены/в углу; E2E-проверка формы после `ArrowUp` (сейчас `game.test.ts:83` ничего не проверяет).
8. Починить запуск: `test`-скрипт в корне, `rootDir`/`tsconfig` в `jest.config.js`, `webServer` + `testDir` в Playwright (или явный путь к `tests/playwright.config.ts`).

### P2 — документы
9. Убрать из `ROTATION_SYSTEM_REFERENCE.md` гриф «FINAL / не менять» и заголовочную ложь: либо распространить систему на `frontend/`, либо явно пометить `app.js` как legacy-скелет, не участвующий в сборке.
10. Исправить §5-таблицу (I rot1 = колонка 3, rot3 = колонка 2) — **не сделано**. Согласовать стрелки T в `ROTATION_SYSTEM_REFERENCE.md` и `PHASE1_FIXES.md:121` — **сделано** (см. D1).
11. Переоткрыть в `errors.md` пункты H5, H7, B4, C2, C1; обновить HEAD в `SESSION_CONTEXT.md`; привести даты к реальной хронологии git.
12. Убрать из `README.md` несуществующее (`npm run test`, touch-управление, «real-time sync»).

### P3 — сборка/деплой
13. Починить или убрать `vue-tsc` (сейчас `npm run build` в `frontend` нерабочий → `.vue` не типизируются).
14. `deploy.sh`: добавить `frontend/index.html`, `tsconfig.base.json`, правильное место `jest.config.js`, создание `backend/data`.
15. `scoreService.getDBDir` → `dirname(dbPath)`; валидация границ в `gameRouter`.
16. Удалить мёртвое: `piecePreview.ts`, `comboDecay`, дублирующая `PREVIEW_SHAPES` в `HudView.vue` (взять формы из `PIECE_SHAPES`).

---

## 10. Артефакты аудита

- `audit-verify/check-shapes.mjs` — геометрия фигур из `pieces.ts`: клетки, размеры, рваность, 90°-проверка, сравнение с SRS.
- `audit-verify/engine-probe.cjs`, `audit-verify/engine-probe2.cjs` — прогоны **реального** `GameEngine` (клетки при повороте, soft-drop перезапись, Hardcore-после-смерти, I у стены).
- `audit-verify/build/shared/**` — компиляция боевого TS-движка в CommonJS (ошибок компиляции нет).
- `audit-verify/sweep-srs.cjs` — независимая сверка **реального** движка с опубликованными SRS-таблицами (эталон записан в классической форме «+y вверх», переводится в координаты движка при сравнении) + структурная проверка самих таблиц.
- `tmp-audit/audit3_kicks.mjs`, `tmp-audit/audit_shapes.mjs`, `tmp-audit/audit_engine.mjs` + `out_*.txt` — переборные свипы поворотов по всему полю (результаты сведены в §3.1).

Эти файлы — временные, в git не зафиксированы (`?? audit-verify/`, `?? tmp-audit/`); их можно удалить после принятия отчёта.

---

## 11. Применённое исправление P0 и повторная верификация

Изменённые файлы (git: ` M`):

| Файл | Что изменено |
|---|---|
| `frontend/src/shared/domain/pieces.ts` | `PIECE_SHAPES` → канонические SRS-состояния: I 4×4 (rot1 = колонка 2, rot3 = колонка 1), O 2×2, JLSTZ 3×3 во всех 4 ориентациях; добавлен комментарий-правило (бокс сохраняется, каждый поворот = истинный 90°) |
| `frontend/src/shared/engine/game-engine.ts` | добавлены `KICKS_I` / `KICKS_JLSTZ` / `KICKS_O` — по 8 пар вращений, **направленно** (CW и CCW разные), ось Y инвертирована под движок; `rotatePiece` использует `kicksFor(type, from, to)` вместо 5 универсальных позиций; `softDrop` проверяет позицию до движения и не начисляет очки за блокированное нажатие; `hardcoreDeath` ставит `_isRunning = false` и вызывает `onGameOver`; `spawnNextPiece` при block-out тоже гасит `_isRunning`; `handleCommand` игнорирует игровые команды после Game Over (кроме `StartGame`); `startGame` читает `payload.mode` (раньше читал `payload.hardcore`, которого стору не передаёт → **Hardcore-режим никогда не включался**); `reset()` присваивает `this.board` после `boardManager.reset()` |
| `frontend/src/shared/domain/board.ts` | `setCells` больше не перетирает `locked`-клетки |
| `frontend/dist/**` | пересобрано (`vite build`): новый бандл `index-Cu8UKkMy.js` вместо `index-mDXpicBE.js` |
| `docs/ROTATION_SYSTEM_REFERENCE.md`, `docs/PHASE1_FIXES.md` | согласованы стрелки T (rot1 = →, rot3 = ←) — единственная правка документов, снятая противоречие D1 |

Повторные проверки (после правок):

| Проверка | Результат |
|---|---|
| `tsc --noEmit -p frontend/tsconfig.json` | exit 0 |
| `audit-verify/check-shapes.mjs` | 28/28 ориентаций: ровно 4 клетки, бокс 4×4 / 2×2 / 3×3, нет рваных строк, каждый поворот = 90° от предыдущего, **все 28 совпадают с эталоном SRS** |
| `audit-verify/sweep-srs.cjs` | **8484** реальных вызова `RotatePiece` (7 фигур × 4 стартовых ориентации × CW/CCW × все позиции 10×20) — **0 расхождений** с опубликованными SRS-таблицами; структурное свойство SRS `kicks(A→B) = −kicks(B→A)` выполняется для всех 16 пар эталона |
| `audit-verify/engine-probe.cjs` | все фигуры `4 → 4 → 4 → 4 → 4`; CW+CCW возвращает фигуру в исходное состояние; I у правой стены после CW занимает колонки 6–9 (kick `+2`), после 2×CW — `2,6…2,9`; вертикальная I после 30 SoftDrop ставит **4** клетки (`16,5 17,5 18,5 19,5`); ghost-Y совпадает с фактическим приземлением для всех 7 фигур |
| `audit-verify/engine-probe2.cjs` | SoftDrop больше не перезаписывает закреплённые клетки Z; очки за блокированное нажатие = 0; после смерти `_isRunning = false`, счёт после Game Over не растёт (`0 → 0`); Hardcore включается (`mode = 1`) и отказ вращения убивает |
| `jest` (cwd `frontend/`) | 51/51 тестов проходят — регрессии нет |
| содержимое нового бандла | канонические матрицы присутствуют (`[0,1,0],[0,1,1],[0,1,0]`, `[0,1,1],[0,1,0],[0,1,0]`), kick-смещения `x:-2,y:0` / `x:2,y:0` присутствуют; битые литералы `[[0,1],[0,1],[0,1]]` и `[[1,1],[1,1],[0,1]]` **исчезли** |

Что осталось незафиксированным (осознанно вне P0):

1. **Документы в основном не переписаны** (исключение — согласованные стрелки T, D1). Пункты H5/H7/B4/C2/C1 в `errors.md`, «FINAL / не менять» в `ROTATION_SYSTEM_REFERENCE.md`, ложные строки `architecture.md:132–133`, HEAD `bbecb19` в `SESSION_CONTEXT.md`, даты 2025-09 и несуществующие пункты `README.md` — см. P2 (§9). После правок кода часть утверждений docs стала верной для `frontend/`, но тексты документов это не отражают.
2. **Тестов на геометрию и wall-kick по-прежнему нет** (P1). Защита от повторной регрессии `9d43990` отсутствует.
3. `npm run build` во фронтенде остаётся нерабочим (`vue-tsc` 1.8.27 × TypeScript 5.9.3); бандл пересобран прямым запуском `vite build` (P3).
4. `HudView.vue` и `engine/piecePreview.ts` держат **свои** копии форм (rot0) вместо `PIECE_SHAPES` — сейчас значения корректны, но дублирование остаётся источником будущих расхождений (P3).
5. `board.ts`: `isValidPosition` запрещает `boardY < 0`, `hasCollision` разрешает — две разные семантики; `hasCollision` нигде не вызывается. Ghost в `gameStore` судит по `value`, движок — по `locked` (зафиксировано в `engine-probe.cjs`, раздел I).

---

## 12. Итог P1 / P2 / P3 (рабочее дерево после аудита)

### 12.1 Тесты (P1)

| Что сделано | Где | Проверено |
|---|---|---|
| Сюиты геометрии вращения: эталон SRS в тесте, `rotate90cw`, инверсия знака Y (`y - ky`), полный свип по полю, wall/floor kicks, Hardcore-смерть, soft-drop очки, сохранение `locked` | `frontend/tests/unit/rotation-geometry.test.ts` (новый) | `expect(checked).toBeGreaterThan(8000)`, `expect(mismatches).toEqual([])` |
| Сюиты kick-таблиц движка: сверка `kicksFor` с опубликованными SRS-парами, инвариант `kicks(A→B) === −kicks(B→A)`, валидация `payload.direction` | `frontend/tests/unit/rotation-kicks.test.ts` (новый, 269 строк) | 269 строк, включая тест «мусорный direction игнорируется» |
| Границы HTTP-API: лимиты, 400 на невалидное, дефолты пропущенных полей, clamp `limit` | `backend/tests/unit/gameRouter.test.ts` (новый, 12 тестов, supertest + временный `mkdtempSync`-каталог) | 12/12 |
| Конфиги Jest починены: `rootDir: __dirname`, `ts-jest` c `isolatedModules: true`, `testMatch` по `tests/unit/**` — раньше запуск из корня ронял 4 сюиты (`tsconfig: './tsconfig.json'`) | `frontend/jest.config.js`, `backend/jest.config.js` | 6/6 и 2/2 сюиты |
| Корневой `npm test` появился (C8 закрыт): `npm-run-all test:unit test:backend` | `package.json` | ✅ |
| E2E починены: `webServer`-массив (backend :3000 + frontend :3001), `reuseExistingServer`, тесты реального поворота и hard drop на канвасе | `tests/playwright.config.ts`, `tests/e2e/game.test.ts` | 16/16 |

**Итог:** frontend **109** unit (6 сюит) · backend **21** unit (2 сюиты) · **16** E2E — все проходят.
**Позже** (коммит `feat(backend): GET /api/health…`): backend **34** unit (3 сюиты) · **19** E2E —
добавлены `backend/tests/unit/health.test.ts` (13 тестов) и `tests/e2e/health.test.ts` (3 теста).
**Позже** (build-arg `APP_VERSION` → поле `version` в health): backend **36** unit (3 сюиты) —
в `health.test.ts` **15** тестов (резолв `APP_VERSION` и фолбэк на `backend/package.json` при пустом значении).
Команды без `npx`: `node node_modules\jest\bin\jest.js --config frontend\jest.config.js --runInBand`,
`node node_modules\@playwright\test\cli.js test --config tests\playwright.config.ts`.

### 12.2 Документы (P2)

| Файл | Что исправлено |
|---|---|
| `docs/errors.md` | Легенда статусов (✅ verified in shipped code / ⚠️ только legacy `app.js` / ❌ утверждение было ложным). Переписаны H5 (регрессия `9d43990`, починка в `pieces.ts`), H7 (11 kicks были только в `app.js`), B4 (comboDecay), C1 (валидация реально добавлена + остаток `command: any`), C2 (отмечено «НЕ исправлено»), C3 (остаток `@types/*`), H1 (`showMenu` не существует) |
| `docs/ROTATION_SYSTEM_REFERENCE.md` | Снято «FINAL / НЕ ИЗМЕНЯТЬ»; исправлены комментарии I (`rot1` = колонка 2, `rot3` = колонка 1); §3 заменён на реальные таблицы движка (8 направленных пар, JLSTZ/I/O, инверсия Y) вместо списка «11 позиций»; §5 I-строка; §6 — список файлов и правило «править только вместе с двумя тестами» |
| `docs/PHASE1_FIXES.md` | I-строка таблицы (col 2 / col 1); блок «область действия»: пункты 1.5–1.5.3 относятся к legacy `app.js` (`04be72a`), не к `frontend/` |
| `docs/PHASE2_ARCHITECTURE.md` | Раздел «Вращение фигур» переписан под боевой движок (`rotatePiece`, kick-таблицы, ghost в сторе); «11 позиций» снято; статус-строка с актуальными числами тестов |
| `docs/architecture.md` | `BoardManager` больше **не** описывается как источник ghost-расчёта: ghost — `stores/gameStore.ts:152` (`getGhostY`), в `board.ts` его нет |
| `docs/SESSION_CONTEXT.md` | HEAD исправлен на `e570ee8` (`bbecb19` — реальный коммит, но на 24 коммита позади HEAD); цифры тестов; блок окружения (`npm.cmd`/`npx.cmd`, обход через `node node_modules\<pkg>\bin\...`, hoisted deps, поломка `vue-tsc` 1.8.27 × TS 5.9.3, причина сбоев npm — proxy-строки в пользовательском `.npmrc`, см. §12.5); `piecePreview.ts` помечен удалённым |
| `docs/PLAN.md` | Поправка к таблице статусов: цифры фазы 2 исторические; фазы 1–2 не включали починку вращения боевого фронтенда |
| `README.md` | Удалён пункт «Touch-управление — свайпы» (в `frontend/src` 0 touch/pointer-обработчиков); дерево: `piecePreview.ts` убран, добавлен `app.js` как legacy; числа тестов 109/21/16; «Express + WebSocket — real-time sync» заменён на честное описание (REST работает, WebSocket-сервер поднят, фронтенд сокета не открывает, `handleAction` — заглушка); таблица документации дополнена `AUDIT_REPORT.md`, `ROTATION_SYSTEM_REFERENCE.md`, `errors.md` |

### 12.3 Сборка, деплой, backend (P3)

| Файл | Изменение |
|---|---|
| `frontend/package.json` | `"build": "tsc --noEmit && vite build"` (было `vue-tsc --noEmit && vite build` — падало из-за `vue-tsc@1.8.27`); после обновления `vue-tsc` до 3.3.12 основной `build` возвращён к `vue-tsc --noEmit && vite build`, вариант без типизации `.vue` перенесён в `build:tsc` — см. §12.6 |
| `frontend/dist/**` | Пересобран штатной `npm run build`: `index.html` 0.58 kB · `assets/index-1GF7EUM4.js` 99.99 kB · `assets/index-DPHrKT2t.css` 6.77 kB (53 модуля) |
| `deploy.sh` | `REMOTE_PORT="${3:-3000}"` (было `${1:-3000}` — порт брался из USER); scp разнесён по каталогам (прежде `frontend/package.json` и `backend/package.json` выгружались в один `$REMOTE_DIR/` и перезаписывали друг друга); копируются `package-lock.json`, `tsconfig.base.json`, `frontend/env.d.ts`, `frontend/index.html`; `mkdir -p backend/data` до scp; сборка через `npm run build` вместо `npx …`; PM2: один `--name`, `--cwd`, без безусловного `pm2 restart`; удалён неиспользуемый `FILES_TO_COPY` и бессмысленный финальный блок «Теперь запустите deploy.sh…»; `bash -n deploy.sh` → OK. **Снято позже:** весь PM2-контур скрипта удалён — `deploy.sh` переведён на `git clone` + `rsync` + `docker compose build && up -d`, PM2-контур с сервера удалён (`docs/SESSION_CONTEXT.md`, «Один контур на сервере») |
| `backend/src/services/scoreService.ts` | `getDBDir = dirname(dbPath)` (было `join(dbPath, '..', '..')` → `ENOENT`); `loadScores` создаёт каталог и возвращает `[]` при отсутствии/битом файле; `saveScores` пишет во временный файл и делает `renameSync` |
| `backend/src/routes/gameRouter.ts` | Фабрика `createGameRouter(scoreService = new ScoreService())`; `LIMITS` (имя ≤ 32, score ≤ 1e6, level ≤ 999, lines ≤ 1000, limit ≤ 100); пропущенные поля → дефолты, невалидные → 400; `GET /scores` клампит `limit` в `[1, 100]` |
| Мёртвый код | `frontend/src/engine/piecePreview.ts` удалён (нигде не импортировался); `HudView.vue` рендерит превью из `PIECE_SHAPES` вместо собственной 4-й копии таблиц |
| `game-engine.ts` (P1-остаток) | `RotatePiece` валидирует `payload.direction` через типизированный `RotateCommand`; `movePiece` получил `default: return` (неизвестное направление больше не «двигает в никуда») |
| `backend/src/routes/healthRouter.ts` (**добавлено позже**, коммит `5b9418a`) | Реальный `GET /api/health`: раньше такого маршрута не было, и SPA catch-all возвращал на него HTML. Роутер подключён в `index.ts` до `express.static` и catch-all; всегда JSON, `200` при `ok` и `503` при `degraded`; проверки `db` (`ScoreService.health()`), `static` (`frontend/dist/index.html` + файлы в `assets/`), `websocket` (`wss.clients.size`, `/ws`), `runtime` (Node, uptime, RSS, `NODE_ENV`, `PORT`), `api` (самопроверка `/api/scores` и `/api/leaderboard` через тот же сервис). В payload нет абсолютных путей и секретов; `scores.json` не пишется — проверка записи использует `.health-probe`, удаляемый в `finally`. Проверено на проде (`5b9418a`): `200 application/json`, `"status":"ok"`, `runtime.node: v22.23.3`; при удалённом `dist/index.html` — `503` + `"status":"degraded"`. Поле `version` (добавлено позже): `APP_VERSION` → `backend/package.json` → `unknown`; `APP_VERSION` — build-arg `Dockerfile`, значение `1.<YYMMDD>.<git short hash>` вычисляет `deploy.sh` |

### 12.4 Что осталось открытым (осознанно)

1. **C2** — query-путь (`GetNextPiece`, `GetBoardState`) жив и UI не используется: менять не стали, ложная отметка в `errors.md` снята.
2. ~~Приватные хендлеры движка по-прежнему принимают `command: any` (валидация есть только на входе
   `handleCommand` для `RotatePiece`/`MovePiece`)~~ — **закрыто (блок 1 сингла)**: `handleCommand` —
   `switch` с сужением типа, хендлеры типизированы (`StartGameCommand`, `MoveCommand`),
   `isCommandType` / `CommandHandler` / `QueryHandler` удалены; `MoveCommand.payload.direction`
   сужен до `'left' | 'right' | 'down'` (`docs/SINGLE_PLAYER_DECISIONS.md`, E1/B4).
3. ~~`@types/uuid` и `@types/better-sqlite3` в `backend/package.json:20–21` — мёртвые dev-зависимости~~ —
   **закрыто**: оба пакета удалены из `devDependencies` при обновлении зависимостей (§12.7).
4. ~~`vue-tsc` ≥2.x (типизация `.vue`) не установлен~~ — **закрыто после аудита**: `vue-tsc` обновлён до
   `3.3.12`, типизация `.vue` вернулась в `npm run build`; см. §12.6.
5. ~~`hasCollision` не вызывается; расхождение `isValidPosition` (`boardY < 0` запрещён) vs `hasCollision`
   (разрешён) не устранено~~ — **закрыто (блок 1 сингла)**: в `board.ts` `hasCollision(piece, pos)`
   реализован как `!isValidPosition(piece, pos)` (одна коллизия — одно правило), обёртка `hasCollision`
   из `GameEngine` удалена (`docs/SINGLE_PLAYER_DECISIONS.md`, A9).
6. Мёртвый расчёт скорости в движке: в `GameEngine.autoDrop()` (`frontend/src/shared/engine/game-engine.ts:294–295`)
   вычисляется локальная `interval` из `GAME_CONFIG.speedConfig` и **не используется** (комментарий: «tick-based,
   move down one row per tick»), а реальный тик живёт в `GameBoard.vue` (`tickAccumulator`, `:60–65`) — C12.
   Уточнение к исходной формулировке: поля `SPEED_CONFIG.autoDropInterval` в коде больше нет —
   `SpeedConfig` = `initialInterval` / `intervalDecrease` / `minInterval` (`game-config.ts:13–17`).
7. ~~`GameStateSnapshot.currentPiece: number[]` — тип не описывает реальную форму фигуры~~ —
   **закрыто (блок 1 сингла)**: `GameStateSnapshot` вместе с `CellState`, `MoveAction`, `Action`,
   `TickResult`, `GhostPiece` удалён из `types.ts` как неиспользуемый (`docs/SINGLE_PLAYER_DECISIONS.md`, E2).
8. ~~`docs/tsc-frontend.log` — нечитаемый бинарный артефакт, упоминается как результат проверки типов~~ —
   **закрыто (блок 1 сингла)**: файл удалён из рабочего каталога (он был gitignored, в истории не попадал);
   проверка типов фиксируется выводом `npx.cmd vue-tsc --noEmit` (`exit 0`).
9. Фаза 3 (мультиплеер) не начата: WebSocket-сервер поднят и проксируется, но `GameServer.handleAction` — заглушка, фронтенд сокет не открывает.
10. ~~Эндпоинта самодиагностики не было: `GET /api/health` не являлся маршрутом, SPA catch-all
    отдавал на него HTML~~ — **закрыто**: добавлен `backend/src/routes/healthRouter.ts`
    (`db` / `static` / `websocket` / `runtime` / `api`, JSON всегда, `200`/`503`), подключён в
    `index.ts` до статики и catch-all; тесты — `backend/tests/unit/health.test.ts` (15 тестов)
    и `tests/e2e/health.test.ts`; см. строку про `healthRouter.ts` в §12.3.
11. Все правки закоммичены и запушены: `9dba4ea` (P0–P3), `9db00a3` (удаление внешнего API-хоста),
    `b06f4fb` (уточнение утверждений об окружении), `37ba308` (`vue-tsc` 3.3.12), коммит с обновлением
    зависимостей (§12.7), `ea56fc7` (`deploy.sh` переведён на Docker, PM2-контур удалён),
    `b0b7ac9` (`node:22-alpine` — `EBADENGINE` при сборке больше нет), `5b9418a`
    (`GET /api/health` + тесты + docs), `7a30e48` (протокол деплоя и исправление `DEFAULT_EMAIL` → `EMAIL`),
     правка build-арга `APP_VERSION` `4344f3d` (поле `version` в health, формат `1.<YYMMDD>.<git short hash>`)
     и исключения `.dockerignore` для `audit-verify/` и `tmp-audit/` —
    `main` синхронизирован с `origin/main`, прод-контейнер пересобирается из текущего `main`
     (`docker compose build && docker compose up -d`; откат — `git revert` + пересборка).

### 12.5 Повторная проверка сетевых утверждений (после аудита)

Утверждение «сети для npm registry нет → починки только офлайн» оказалось **ложным**: это была конфигурация,
а не ограничение среды.

| Проверка | Результат |
|---|---|
| `C:\Users\<user>\.npmrc` | содержит `proxy=http://127.0.0.1:1301` и `https-proxy=http://127.0.0.1:1301` |
| `Test-NetConnection 127.0.0.1:1301` | `TcpTestSucceeded=False` — слушателя нет (отсюда `ECONNREFUSED 127.0.0.1:1301` в npm) |
| `Test-NetConnection registry.npmjs.org:443` | `TcpTestSucceeded=True` (`104.16.7.34`) |
| `Test-NetConnection github.com:443` | `TcpTestSucceeded=True` (`140.82.121.3`); `git push origin main` проходит |
| `npm.cmd ping` (конфиг по умолчанию) | `ECONNREFUSED 127.0.0.1:1301` |
| `npm.cmd --userconfig <чистый .npmrc> ping` | `PONG 558ms` |
| `npm.cmd --userconfig <чистый .npmrc> view vue-tsc version` | `3.3.12` |
| `node -e "fetch('https://registry.npmjs.org/vue-tsc')…"` | `HTTP 200`, `latest = 3.3.12` |
| `npm --version` / `npx --version` (шимы `.ps1`) | блокируются политикой выполнения («running scripts is disabled») |
| `npx.cmd --version` / `npx.cmd tsc --version` | `11.13.0` / `Version 5.9.3` |
| `npm.cmd run test` из корня | 109 frontend + 21 backend — все проходят |

Вывод: офлайн-ограничение снимается, пункт 4 (обновление `vue-tsc`) технически выполним — что и сделано в §12.6.
На момент аудита `C:\Users\<user>\.npmrc` не правили (конфиг вне репозитория), обход проверялся через
`--userconfig`; позже обе proxy-строки из этого файла удалены.

### 12.6 Обновление `vue-tsc` и первая проверка типов в `.vue`

После снятия блокировки npm (`proxy` / `https-proxy` удалены из `C:\Users\<user>\.npmrc`) выполнено:

| Шаг | Результат |
|---|---|
| `npm install vue-tsc@^3.3.12 --save-dev --workspace=frontend` | `vue-tsc 3.3.12` (peer `typescript >=5.0.0`, в проекте `typescript@5.9.3`); `npm.cmd ping` → `PONG 670ms` |
| первый запуск `vue-tsc --noEmit -p frontend/tsconfig.json` | **7 ошибок типов в `frontend/src/App.vue`** — раньше `.vue` в проекте не типизировались никогда |
| правки `App.vue` | добавлены `type ViewName` и `interface BgParticle`: поля `phase`, `speed`, `alphaMin`, `alphaMax` использовались в коде, но отсутствовали в типе массива частиц (TS2353/TS2339); мёртвое поле `baseAlpha` из типа убрано; `viewOrder` объявлен `computed<ViewName[]>` (был `string[]` → TS2322 при присваивании `currentView`) |
| `vue-tsc --noEmit -p frontend/tsconfig.json` после правок | exit 0, 0 ошибок |
| `frontend/package.json` | `"build": "vue-tsc --noEmit && vite build"`, `"build:tsc": "tsc --noEmit && vite build"` (цель `build:vue-tsc` удалена как дубль) |
| корневой `package.json` | `build:frontend` → `npm run build --workspace frontend`, `build:backend` → `npm run build --workspace backend`: корневая сборка больше не обходит типизацию `.vue` (раньше было `cd frontend && npx vite build`) |
| `npm.cmd run build` (корень) | exit 0: backend `tsc` + frontend `vue-tsc` + `vite build` → `dist/index.html` 0.58 kB · `assets/index-1GF7EUM4.js` 99.99 kB · `assets/index-DPHrKT2t.css` 6.77 kB (53 модуля; хэши не изменились — правки `App.vue` чисто типовые) |
| `npm.cmd run test` | 109 frontend + 21 backend — все проходят |
| `npm.cmd run test:e2e` | 16 Playwright-тестов — все проходят (26.1s) |

Природа найденных ошибок: тип имени вьюшки и тип частиц фона писались «на глаз» и никогда не проверялись —
сломанный `vue-tsc` не запускался, а обычный `tsc` не видит `.vue`.

### 12.7 Устранение уязвимостей зависимостей (42 → 0)

Запрошено пользователем: «33 уязвимости (2 moderate, 31 high) — поправь». Фактический снимок на момент
начала работ был другим, и он тоже зафиксирован: `npm.cmd audit` → **42 уязвимости (7 moderate, 35 high)**.
Ни одна не относилась к коду игры: все шли через dev-зависимости и один неиспользуемый пакет.

| Уязвимый пакет (копия) | Цепочка в дереве | Что сделано |
|---|---|---|
| `@grpc/grpc-js` (high ×2), `fast-uri`, `ip-address` (moderate ×3) | корневой devDep `ssh-mcp@2.8.1` → `@modelcontextprotocol/sdk`, `@opentelemetry/sdk-node` → `@opentelemetry/otlp-transformer` → `@grpc/grpc-js`; `fast-uri` и `ip-address` — через `@modelcontextprotocol/sdk` | `ssh-mcp` **удалён** из `package.json`: в исходниках проекта (`frontend/`, `backend/`, `tests/`) он не импортировался нигде |
| `braces` (high) → `micromatch`, `chokidar` | `jest@29` → `jest-haste-map`, `jest-message-util`, `jest-config`; `ts-node-dev@2` → `chokidar@3` | `jest` и `jest-environment-jsdom` → `30.5.2` (в jest 30 пакетов `jest-haste-map`/`micromatch` нет — `npm view jest-haste-map@30.5.2` → `E404`), `@types/jest` → `30.0.0`, `ts-jest` → `29.4.14` (peer `jest ^29 \|\| ^30`); `ts-node-dev` **заменён** на `tsx@4.23.15` (единственная зависимость — `esbuild ~0.28.0`), `dev:backend` → `tsx watch src/index.ts` |
| `esbuild@0.21.5` (moderate: dev-сервер отвечал на запросы с произвольного Origin) | `vite@5.4.21` | `vite` → `8.3.2`, `@vitejs/plugin-vue` → `6.0.9`; esbuild → `0.28.2` |
| `qs@6.15.3` (moderate ×2) | `express@4.22.2` → `body-parser@1.20.6` → `qs`; также `supertest@6` → `superagent` | `express` → `4.22.3` (пиннит `qs ~6.16.0`, `body-parser ~1.20.5`); `supertest` поднят до `6.3.4` → `superagent 8.1.2` → `formidable 2.1.5`. На express 5 не переходили: API роутера (`gameRouter.ts`) не менялся |
| `brace-expansion@1.1.18`, `brace-expansion@5.0.9` (high ×3) | `npm-run-all@4` → `minimatch@3`; `@vue/test-utils@2.4.x` → `js-beautify` → `editorconfig` → `glob@10` → `minimatch@10` | `npm audit fix`: `brace-expansion` → `1.1.21` и `5.0.12` (через `minimatch@3.1.5` / `minimatch@10.2.6`); `@vue/test-utils` → `2.5.1` |

Ход работ и проверки:

| Шаг | Результат |
|---|---|
| `npm.cmd view <pkg> version` для кандидатов | `vite 8.3.2`, `@vitejs/plugin-vue 6.0.9`, `jest 30.5.2`, `ts-jest 29.4.14`, `@types/jest 30.0.0`, `tsx 4.23.15`, `express 4.22.3` / `5.2.1`, `qs 6.16.0`, `body-parser 1.20.8`, `minimatch 3.1.5` / `10.2.6` |
| `npm.cmd install` после правки трёх `package.json` | 42 → **5 уязвимостей (3 moderate, 2 high)**; `npm.cmd ls braces micromatch chokidar` → пусто; но `npm.cmd ls vite esbuild` → `ELSPROBLEMS` (устаревший вложенный `vite@5.4.21` под `@vitejs/plugin-vue@6.0.9` и hoisted `esbuild@0.21.5`) |
| `Remove-Item -Recurse -Force node_modules, frontend\node_modules, backend\node_modules` + `npm.cmd install` | exit 0 (`added 102, removed 219, changed 84`), дерево чистое |
| `npm.cmd audit fix` (без `--force`) | `added 1, removed 9, changed 6` → **found 0 vulnerabilities** |
| `npm.cmd audit` повторно | **found 0 vulnerabilities** |
| Итоговые версии в дереве | `vite 8.3.2`, `@vitejs/plugin-vue 6.0.9`, `esbuild 0.28.2`, `jest 30.5.2`, `jest-environment-jsdom 30.5.2`, `ts-jest 29.4.14`, `@types/jest 30.0.0`, `tsx 4.23.15`, `express 4.22.3`, `body-parser 1.20.8`, `qs 6.16.0`, `brace-expansion 1.1.21`, `@vue/test-utils 2.5.1` |
| `npm.cmd run build` | exit 0: backend `tsc` + frontend `vue-tsc --noEmit && vite build` → `dist/index.html` 0.51 kB · `assets/index-B04z4d71.js` 99.13 kB · `assets/index-C_FNZJOZ.css` 6.62 kB (`✓ 54 modules transformed`, 85 ms) |
| `npm.cmd run test` | **109 frontend + 21 backend — все проходят** (jest 30 + ts-jest 29.4.14; `isolatedModules: true` в обоих `jest.config.js`) |
| `npm.cmd run test:e2e` | **16/16 Playwright** (26.2s): webServer поднимает `npm run dev:backend` (`tsx watch`) и `npm run dev:frontend` (vite 8) |

Побочные эффекты обновления, зафиксированные в коде:

1. **`frontend/vite.config.ts` → `frontend/vite.config.mts`.** Vite 8 при запуске выдавал
   «(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to
   become the default in a future major version of Vite: ESM syntax in a file loaded as CommonJS
   (vite.config.ts:1:1)». В `.mts` файл грузится как ESM, а `__dirname` в ESM недоступен, поэтому alias
   `@` описан как `fileURLToPath(new URL('./src', import.meta.url))`. После переименования предупреждение
   исчезло, бандл собирается без изменений в логике. Обновлены `deploy.sh` (scp-список
   `frontend/vite.config.mts`) и `docs/architecture.md` (дерево проекта).
2. **`backend/package.json`**: удалены мёртвые `@types/uuid` и `@types/better-sqlite3` (закрыт пункт 3 §12.4
   и остаток C3 в `docs/errors.md`).
3. **Корневой `package.json`**: `dev:backend` больше не использует `ts-node-dev` (он и был источником
   `chokidar@3` → `braces`), теперь `cd backend && npx tsx watch src/index.ts`.
4. **jest 30**: removal legacy fake timers проекту не мешает — в тестах из fake-таймеров используется только
   `jest.fn()` (`frontend/tests/unit/renderer.test.ts`), таймеры в тестах не мокются.
5. Бандл фронтенда пересобран vite 8: `99.13 kB` JS / `6.62 kB` CSS против `99.99 kB` / `6.77 kB` на vite 5
   (53 → 54 модуля). Хэши файлов изменились только из-за версии сборщика.

### 12.8 Программа «сингл — полностью»: блок 1 (типы и расчистка)

Рамки работы заданы пользователем: мультиплеер вынесен за скобки, решается только одиночная игра
(«MP (старый и новый дизайн) — отдельная тема, будет решаться на старте MP»). Решение-лист и
принятые по нему решения зафиксированы в `docs/SINGLE_PLAYER_DECISIONS.md`.

Блок 1 — E1, E2, E3, E4, A9, B4 (механику A1–A8, UI C1–C6, бэкенд D1–D2 блоки 2–7 не трогали):

| Файл | Изменение |
|---|---|
| `frontend/src/shared/engine/game-engine.ts` | `handleCommand` вместо сборки `handlerMap` — `switch` с сужением типа (`StartGame → startGame(command)`, `MovePiece → movePiece(command)`, `RotatePiece` с проверкой `payload.direction`, `SoftDrop`/`HardDrop`/`Tick`/`PauseGame`/`ResumeGame`, неизвестное — игнор). Удалены `isCommandType()`, `export type CommandHandler`, `export type QueryHandler` и обёртка `hasCollision`. `startGame` принимает `StartGameCommand` (старый `payload.hardcore` поддержан явным кастом), `movePiece` — `MoveCommand` без псевдо-направлений `rotateCW`/`rotateCCW`, `softDrop()`/`hardDrop()` — без параметров. Guard «после Game Over» остался первым |
| `frontend/src/shared/domain/board.ts` | `hasCollision(piece, pos) = !isValidPosition(piece, pos)`; проверка `locked` в `isValidPosition` упрощена до `if (this.cells[boardY][boardX].locked) return false`; импорт — только `Cell, Piece, Position` |
| `frontend/src/shared/domain/types.ts` | удалены неиспользуемые `CellState`, `GameStateSnapshot`, `MoveAction`, `Action`, `TickResult`, `GhostPiece` (119 → 79 строк) |
| `frontend/src/shared/cqrs/commands.ts` | `MoveCommand.payload.direction`: `string` → `'left' \| 'right' \| 'down'` |
| `frontend/src/stores/gameStore.ts` | `handleCommand(cmd: any)` → `handleCommand(cmd: AnyCommand)`; удалены `CellDTO`, `KeyHandler`, `tickInterval`/`animFrame`/`lastTime`; `↑`/`x`/`w` → `RotatePiece{cw}`, `z`/`q` → `RotatePiece{ccw}` (было: `MovePiece{direction:'rotateCW'}`); недостижимая ветка `Escape` убрана — `Esc` обрабатывает `GameView.vue`; импорт `CellState`/`Cell`/`GameConfig` убран |
| `frontend/src/components/GameBoard.vue` | `{ type: 'Tick' }` → `{ type: CommandType.Tick }` (после типизации `handleCommand` строковый литерал больше не проходит `vue-tsc`) |
| `frontend/src/App.vue` | удалены мёртвые `nextView()` и `viewOrder` + неиспользуемый импорт `computed` |
| `frontend/tests/unit/engine.test.ts`, `frontend/tests/unit/rotation-kicks.test.ts` | команды отправляются через `CommandType.*` вместо строковых литералов; в `engine.test.ts` убран неиспользуемый импорт `GameState` |
| `docs/tsc-frontend.log` | удалён (gitignored артефакт, в истории git не был) |
| `docs/SINGLE_PLAYER_DECISIONS.md` | **добавлен**: решение-лист A1–A11 / B1–B4 / C1–C7 / D1–D2 / E1–E5 со статусами и выводом проверок |

Проверки блока 1 (фактический вывод):

| Команда | Результат |
|---|---|
| `npx.cmd vue-tsc --noEmit` (`frontend/`) | пустой вывод, `exit 0` |
| `npx.cmd jest --runInBand` (`frontend/`) | `Test Suites: 6 passed, 6 total` · `Tests: 109 passed, 109 total` |
| `npx.cmd tsc --noEmit` (`backend/`) | `exit 0` |
| `npx.cmd jest --runInBand` (`backend/`) | `Test Suites: 3 passed, 3 total` · `Tests: 36 passed, 36 total` |
| grep удалённых идентификаторов по `frontend/**.{ts,vue}` | `No matches found` |

Ограничение среды, выявленное при проверке: `npm.cmd test` в песочнице падает с `Error: spawn EPERM`
(`jest-worker` не может создать воркеров) — юнит-тесты запускаются `npx.cmd jest --runInBand`.
Тесты фронтенда при этом **не типизируются** (`ts-jest` с `isolatedModules: true`, тесты вне
`include` в `frontend/tsconfig.json`), поэтому типизация проверяется отдельно — `npx.cmd vue-tsc --noEmit`.
