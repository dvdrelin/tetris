# 🎮 Neon Tetris

Красочный, яркий аркадный Тетрис с неоновой стилистикой на Vue 3 + Express.

## ✨ Особенности

- **Неоновая графика** — светящиеся блоки, частицы, анимированный фон
- **2 режима** — Аркадный (авто-дроп, комбо) и Хардкор
- **7-Bag randomizer** — честное распределение фигур
- **Ghost piece** — предсказание места падения
- **Комбо-система** — множитель за последовательные очистки
- **Таблица рекордов** — сохранение лучших результатов на сервере
- **Канонические SRS wall kicks** — 8 направленных пар поворотов, отдельные таблицы для I и JLSTZ

> **Управление только клавиатурное.** Touch-/swipe-обработчиков в `frontend/src` нет
> (поиск по `touch|swipe|pointerdown|pointerup` → 0 совпадений); ввод читается одним
> `keydown`-слушателем в `frontend/src/components/GameView.vue` → `gameStore.handleKey`.

## 🎮 Управление

| Клавиша | Действие |
|---------|----------|
| ← → / A D | Движение |
| ↑ / W / X / Z / C | Вращение CW |
| Q | Вращение CCW |
| ↓ / S | Soft Drop |
| Space | Hard Drop |
| P / Esc | Пауза / Выход в меню |
| Enter | Рестарт после Game Over |

## 🚀 Запуск локально

```bash
npm install
npm run dev          # Frontend (:3001) + Backend (:3000)
npm run build        # vue-tsc (типы, включая .vue) + vite build → frontend/dist
```

## 🐳 Деплой с Docker

### Docker Compose (с HTTPS)

```bash
# Запустить nginx-proxy + Let's Encrypt
cd nginx-proxy && docker compose up -d

# Запустить Neon Tetris
cd .. && docker compose up -d
```

### Доступ

- 🔒 **HTTPS:** https://ntetris.ddns.net (Let's Encrypt)
- 🔀 **HTTP → HTTPS:** http://ntetris.ddns.net → https://ntetris.ddns.net

### Docker (без прокси)

```bash
# Собрать образ
docker build -t neon-tetris .

# Запустить
docker run -p 3000:3000 neon-tetris
```

### SSH-деплой одним скриптом

```bash
bash deploy.sh root <HOST> 3000        # SSH key по умолчанию: ~/.ssh/id_ed25519
```

`deploy.sh` работает только через Docker: клонирует репозиторий на сервер, синхронизирует
`rsync`-ом (не трогая `backend/data` и `nginx-proxy`), выполняет `docker compose build && up -d`
и сам проверяет ответ сайта, JSON API и совпадение хэша бандла «отдаётся / в образе».
PM2 в скрипте больше нет — этого контура на сервере тоже нет. Процедура и проверки:
`docs/SESSION_CONTEXT.md` → «Боевое окружение (действующий деплой)».

## 📁 Структура проекта

```
tetris/
├── frontend/src/          # Vue 3 + Pinia + TypeScript
│   ├── components/        # GameBoard, MenuView, GameView, LeaderboardView
│   ├── engine/            # renderer.ts (canvas-рендер по DTO из стора)
│   ├── stores/            # gameStore, leaderboardStore
│   └── shared/            # GameEngine, BoardManager, PieceFactory, types
├── backend/src/           # Express + WebSocket
│   ├── servers/           # GameServer, WebSocket handling
│   ├── routes/            # API endpoints (score, leaderboard)
│   └── services/          # ScoreService
├── nginx-proxy/           # Nginx proxy + Let's Encrypt
│   ├── docker-compose.yml
│   └── README.md
├── tests/                 # E2E тесты (Playwright)
├── frontend/tests/        # Unit тесты (Jest)
├── backend/tests/         # Unit тесты (Jest)
├── docs/                  # Документация
└── app.js                 # legacy-версия игры: НЕ подключается к frontend/index.html и не участвует в сборке
```

## 📚 Документация

| Документ | Описание | Статус |
|----------|----------|--------|
| [PLAN.md](docs/PLAN.md) | **Главный план** — 4 фазы: баг-фиксы, архитектура, мультиплеер, Docker+HTTPS | v1.5 |
| [PHASE1_FIXES.md](docs/PHASE1_FIXES.md) | **Фаза 1: Исправление багов** — Game Over, score, menu, leaderboard | ✅ Завершено |
| [PHASE2_ARCHITECTURE.md](docs/PHASE2_ARCHITECTURE.md) | **Фаза 2: Архитектура + Тесты** — SRP, 74 теста, render loop fix | ✅ Завершено |
| [PHASE3_MULTIPLAYER.md](docs/PHASE3_MULTIPLAYER.md) | **Фаза 3: Мультиплеер** — Lobby, Chat, PvP через WebSocket | ⬜ Не начато |
| [architecture.md](docs/architecture.md) | **Архитектура** — детальное описание слоёв, потоков данных, решений | актуально |
| [ROTATION_SYSTEM_REFERENCE.md](docs/ROTATION_SYSTEM_REFERENCE.md) | **Вращение фигур** — матрицы и SRS kick-таблицы боевого движка | актуально |
| [errors.md](docs/errors.md) | **Реестр ошибок** A–H со статусами «исправлено» | перепроверен аудитом |
| [AUDIT_REPORT.md](docs/AUDIT_REPORT.md) | **Аудит**: противоречия доков ↔ кода, регрессия вращения, P0/P1/P3 и замеры после починки | актуально |
| [SESSION_CONTEXT.md](docs/SESSION_CONTEXT.md) | **Контекст сессии** — полное состояние проекта | актуально |

## 🧪 Тестирование

```bash
npm run test            # Jest (frontend + backend)
npm run test:e2e        # Playwright E2E
```

**Результаты (перепроверено после обновления зависимостей — jest 30 / vite 8 / tsx):**
- Frontend unit: **109 тестов** в 6 сюитах (engine, board, pieces, renderer, `rotation-geometry`, `rotation-kicks`)
- Backend unit: **21 тест** в 2 сюитах (scoreService, `gameRouter` — границы HTTP-API)
- E2E (Playwright): **16 тестов** в 2 файлах (game flow, keyboard controls, пауза/рестарт, leaderboard,
  реальный поворот и hard drop на канвасе) — webServer поднимает backend через `tsx watch`, frontend через `vite 8`

## 🔒 Зависимости

`npm audit` → **found 0 vulnerabilities** (было 42: 7 moderate / 35 high). Удалён неиспользуемый
`ssh-mcp` и мёртвые `@types/uuid` / `@types/better-sqlite3`; обновлены `vite 8.3.2`,
`@vitejs/plugin-vue 6.0.9`, `jest 30.5.2`, `ts-jest 29.4.14`, `@types/jest 30.0.0`, `express 4.22.3`,
`tsx 4.23.15` (вместо `ts-node-dev`), `@vue/test-utils 2.5.1`. Конфиг Vite — `frontend/vite.config.mts`
(ESM). Подробности: `docs/AUDIT_REPORT.md` §12.7 и `docs/errors.md` E2.

В PowerShell шимы `npm.ps1` и `npx.ps1` блокируются политикой выполнения — работают `npm.cmd` и `npx.cmd`,
либо прямые бинарники:
`node node_modules\jest\bin\jest.js --config frontend\jest.config.js`,
`node node_modules\@playwright\test\cli.js test --config tests\playwright.config.ts`.
Раньше весь npm ломался из-за `proxy`/`https-proxy` на мёртвый `127.0.0.1:1301` в пользовательском
`%USERPROFILE%\.npmrc` (`ECONNREFUSED`); эти строки удалены — реестр доступен напрямую
(подробности: `docs/AUDIT_REPORT.md` §12.5).

## 🏗 Архитектура

- **CQRS** — Commands (Start, Move, Rotate, Drop) / Queries (GetState, GetNextPiece, GetBoardState);
  query-путь реализован в движке, но UI им не пользуется (см. `docs/errors.md` C2)
- **OOP** — GameEngine, BoardManager, PieceFactory
- **SOLID** — каждая ответственность в отдельном классе
- **Pinia** — state management (gameStore, leaderboardStore)
- **Express + WebSocket** — REST API (`/api/score`, `/api/scores`, `/api/leaderboard`, `/api/player/:name`)
  работает; WebSocket-сервер (`backend/src/servers/gameServer.ts`) поднят и проксируется (`/ws`), но
  **real-time синхронизации игры нет**: фронтенд не открывает ни одного сокета (0 упоминаний
  `WebSocket|ws://|wss://` в `frontend/src`), а `GameServer.handleAction` — заглушка. Мультиплеер —
  не начатая Фаза 3 (`docs/PHASE3_MULTIPLAYER.md`)
