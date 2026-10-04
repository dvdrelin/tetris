# Контекст сессии для продолжения

## Текущее состояние

**Проект:** Neon Tetris — Vue 3 + Pinia + Express + TypeScript
**Ветка:** `main`, синхронизирована с `origin/main` (`https://github.com/dvdrelin/tetris.git`)
**Коммиты после аудита:** `9dba4ea` (P0–P3: канонические матрицы SRS + направленные wall kicks, тесты, доки,
сборка и деплой), `9db00a3` (внешний API-хост выведен из проекта: убран git-remote, `app.js` → same-origin
`/api`), `b06f4fb` (уточнение утверждений об окружении), обновление `vue-tsc` до 3.3.12 с починкой
найденных типов в `App.vue` (`docs/AUDIT_REPORT.md` §12.6) и обновление зависимостей с устранением всех
уязвимостей `npm audit` (§12.7).
Историческая справка: до аудита HEAD был `e570ee8` («Fix: deploy.sh — skip vue-tsc…», дата `2026-09-13`);
упоминавшийся ранее `bbecb19` («Phase 2 completion: 74 tests…») — коммит реальный, но он на 24 коммита позади
того HEAD. Незакоммиченных изменений P0/P1/P3 больше нет; полный список правок — `docs/AUDIT_REPORT.md` §10
и §12.

## Что сделано

### Phase 1: ✅ Завершено
- Баг-фиксы (Game Over score, save scores, menu exit, leaderboard)
- Все 4 задачи выполнены

### Phase 2: ✅ Завершено
- SRP рефакторинг (renderer.ts, piecePreview.ts)
  — **поправка аудита:** `frontend/src/engine/piecePreview.ts` удалён как мёртвый код
  (`renderPiecePreview` нигде не импортировался); `renderer.ts` остался — его используют
  `GameBoard.vue` и `renderer.test.ts`
- **74 теста проходят** (историческая цифра фазы; актуально на момент аудита: **109** frontend unit,
  **21** backend unit, **16** E2E — `docs/AUDIT_REPORT.md` §11):
  - Frontend unit: 51 тест (jest + ts-jest)
  - Backend unit: 9 тестов (jest + ts-jest)
  - E2E: 14 тестов (playwright)
- **Ключевые баги исправлены:**
  - Render loop: `render()` → `renderCanvas()` (бесконечная рекурсия)
  - isValidPosition: добавлен `boardY < 0`
  - Console error interception: `window.onerror` + `console.error` → `window.__consoleErrors`

## Текущий статус

### Рабочее окружение
- Frontend: `C:\GIT\tetris\frontend` (Vite 8.3.2, порт 3001)
- Backend: `C:\GIT\tetris\backend` (Express, порт 3000)
- Dev server: `npm run dev` (frontend на 3001, backend на 3000)

### Важно (проверено в аудите)
- Vite proxy: `/api` → `http://localhost:3000`, `/ws` → `ws://localhost:3000`
- PowerShell: шимы `npm.ps1` и `npx.ps1` блокируются политикой выполнения («running scripts is disabled»).
  Работают `.cmd`-шимы: **`npm.cmd`** и **`npx.cmd`** (проверено: `npx.cmd --version` → 11.13.0,
  `npx.cmd tsc --version` → 5.9.3, `npm.cmd run test` из корня → 109 + 21 тестов). Эквивалентный обход
  через прямые бинарники:
  - `node node_modules\typescript\bin\tsc --noEmit -p frontend\tsconfig.json`
  - `node node_modules\jest\bin\jest.js --config frontend\jest.config.js --runInBand`
  - `node node_modules\@playwright\test\cli.js test --config tests\playwright.config.ts`
- Зависимости workspace hoisted в корневой `node_modules`, поэтому из каталога `frontend` Vite запускается
  как `node ..\node_modules\vite\bin\vite.js --port 3001 --host`
- `vue-tsc@1.8.27` был несовместим с установленным `typescript@5.9.3`
  (`Search string not found: "/supportedTSExtensions = .*(?=;)/"`) → `npm run build` во frontend падал.
  **Решено:** `vue-tsc` обновлён до `3.3.12`, `"build"` снова `vue-tsc --noEmit && vite build`
  (вариант без типизации `.vue` — `"build:tsc"`); проверка `.vue` нашла 7 реальных ошибок типов в `App.vue`,
  они исправлены (см. `docs/AUDIT_REPORT.md` §12.6)
- Сеть **есть**: `registry.npmjs.org:443` и `github.com:443` доступны (`Test-NetConnection` → `True`,
  `git push` проходит). npm падал из-за устаревших строк `proxy` / `https-proxy = http://127.0.0.1:1301`
  в `C:\Users\<user>\.npmrc`, где никто не слушал (`Test-NetConnection 127.0.0.1:1301` → `TcpTestSucceeded=False`).
  **Эти строки удалены** — `npm.cmd ping` → `PONG`, `npm.cmd view vue-tsc version` → `3.3.12`.
  Если локальный прокси на :1301 снова появится, их надо вернуть (в файле оставлен комментарий).
- `ts-node-dev` из проекта **удалён**: dev-скрипт бэкенда — `tsx watch src/index.ts` (`tsx@4.23.15`).
  Причина не только в том, что `ts-node-dev` не поддерживал `--transpileOnly`, но и в том, что он тянул
  `chokidar@3` → `micromatch` → `braces` (уязвимость high).
- Зависимости обновлены, `npm.cmd audit` → **found 0 vulnerabilities** (было 42: 7 moderate / 35 high).
  Ключевые версии: `vite 8.3.2` + `@vitejs/plugin-vue 6.0.9` + `esbuild 0.28.2`, `jest 30.5.2` +
  `jest-environment-jsdom 30.5.2` + `ts-jest 29.4.14` + `@types/jest 30.0.0`, `express 4.22.3`
  (`qs 6.16.0`, `body-parser 1.20.8`), `tsx 4.23.15`, `@vue/test-utils 2.5.1`; из корня удалён
  неиспользуемый `ssh-mcp`. Конфиг Vite — `frontend/vite.config.mts` (ESM, alias через `import.meta.url`).
  Проверено после обновления: `npm run build` → exit 0, `npm run test` → 109 + 21, `npm run test:e2e` → 16/16
  (подробности: `docs/AUDIT_REPORT.md` §12.7)

### Известные файлы
- `docs/PLAN.md` — главный план, обновлён
- `docs/PHASE1_FIXES.md` — v1.1, завершено
- `docs/PHASE2_ARCHITECTURE.md` — v1.4, завершено
- `docs/PHASE3_MULTIPLAYER.md` — v1.0, не начато

## Боевое окружение (действующий деплой) — не удалять

Упоминания `ntetris.ddns.net` в `README.md`, `docs/PLAN.md`, `docker-compose.yml`, `start.sh` и
`nginx-proxy/` описывают **живое** окружение проекта. Из проекта был выведен только внешний API-хост
(`9db00a3`); домен, DNS и хостинг остаются действующими, их правки/удаление — ошибка.

| Параметр | Значение |
|---|---|
| Домен | `ntetris.ddns.net` (HTTP → HTTPS редирект) |
| DNS | **No-IP** — динамический DNS, зона `ddns.net` |
| Хостинг | **hshp** (значение от владельца проекта; SSH-доступ `ssh root@ntetris.ddns.net`, путь `/opt/neon-tetris`) |
| TLS | Let's Encrypt, сертификат выдаёт `nginxproxy/acme-companion` |
| Reverse proxy | `nginxproxy/nginx-proxy:1.11`, внешняя docker-сеть `proxy`, переменные `VIRTUAL_HOST` / `VIRTUAL_PORT` / `ACME_HOST` в `docker-compose.yml` |
| Сервис | контейнер `neon-tetris`, внутренний порт 3000 (backend отдаёт `frontend/dist`), снаружи 80/443 через nginx-proxy |
| Деплой | `bash deploy.sh <USER> <HOST> [PORT]` (порт по умолчанию 3000) либо на сервере `docker compose build && docker compose up -d` |
| Данные | volume `./backend/data:/app/backend/data:rw` — туда пишется `scores.json` |

Ранее использовавшийся Amvera-хостинг выведен полностью: упоминаний в репозитории нет (проверено по
всем файлам, исключая `node_modules/`, `.git/`, `dist/`).

## Следующий шаг

### Phase 3: Мультиплеер

Пользователь запросил мультиплеер через multi-agent подход.

**Архитектура:**
- Lobby (lobbyStore.ts, LobbyView.vue) — список игроков, выбор, ready
- Chat (chatStore.ts, ChatView.vue) — чат до начала PvP
- Multiplayer game (multiplayerStore.ts, MultiplayerGameView.vue) — PvP с двумя board'ами
- Backend room logic — broadcast actions, chat messages, room endpoints

**План реализации:**
1. Добавить WebSocket room логику в backend
2. Создать frontend stores для lobby, chat, multiplayer
3. Создать Vue компоненты: LobbyView, ChatView, MultiplayerGameView
4. Интегрировать в App.vue

**Рекомендуемый подход:** Multi-agent orchestration — разделить на подзадачи для бэкенда и фронтенда

## Команда для начала
Сначала проверь `npm run dev` и убедись что фронтенд и бэкенд запущены. Потом начни Phase 3.
