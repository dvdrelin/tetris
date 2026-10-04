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
| Деплой | рабочий путь — **Docker** (процедура ниже). `deploy.sh` с коммита `fix(deploy): убрать PM2-контур…` ведёт именно в Docker-контур |
| Данные | volume `./backend/data:/app/backend/data:rw` — туда пишется `scores.json` |

### Рабочая процедура деплоя (проверено 2026-10-04 на HEAD `061b71e`)

```bash
# на сервере (root@ntetris.ddns.net)
git clone --depth 1 https://github.com/dvdrelin/tetris.git /opt/neon-tetris-new
rsync -a --delete \
  --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=backend/data --exclude=nginx-proxy \
  /opt/neon-tetris-new/ /opt/neon-tetris/
rm -rf /opt/neon-tetris-new
cd /opt/neon-tetris && docker compose build && docker compose up -d
```

`--exclude=backend/data` и `--exclude=nginx-proxy` обязательны: первый сохраняет `scores.json`
(он же примонтирован в контейнер), второй сохраняет `nginx-proxy/.env` с `DEFAULT_EMAIL`, которого нет в репозитории.

Что проверять после `up -d`:
- `docker ps` → `neon-tetris  neon-tetris-neon-tetris  Up`; `docker logs --tail 15 neon-tetris` → `Neon Tetris server running on port 3000`
- `curl -s https://ntetris.ddns.net | grep -o 'assets/[^"]*'` → новые хэши бандла
- `/api/scores` и `/api/leaderboard` → JSON сохранных рекордов; `wss://ntetris.ddns.net/ws` → успешный handshake
- хэши артефактов в контейнере должны совпадать с локальной сборкой: `frontend/dist/assets/index-B04z4d71.js` →
  `c84daf18…`, `backend/dist/index.js` → `1a45f215…` (совпали байт в байт)

### Один контур на сервере (PM2-контур удалён 2026-10-04)

| Контур | Что исполняет | Как доступен |
|---|---|---|
| контейнер `neon-tetris` | `node backend/dist/index.js` (сборка внутри образа) | единственный: nginx upstream `ntetris.ddns.net` → `172.18.0.4:3000` (сеть `proxy`), снаружи 80/443 |

Раньше параллельно работал PM2-копия того же backend (`pm2 id 0 neon-tetris`,
`node /opt/neon-tetris/backend/dist/index.js`, слушал `*:3000` на хосте). nginx к нему не маршрутизировал,
но `http://ntetris.ddns.net:3000` был доступен извне и отдавал **старый** билд `index-mDXpicBE.js`
от 13 сентября — то есть публично живала копия с неисправленной ротацией. Контур удалён:

```bash
ssh root@ntetris.ddns.net
pm2 delete neon-tetris      # [PM2] [neon-tetris](0) ✓
pm2 save --force            # Successfully saved in /root/.pm2/dump.pm2 (пустой список, 2 байта)
pm2 unstartup systemd       # Removed "/etc/systemd/system/multi-user.target.wants/pm2-root.service"
```

Проверки после удаления (фактический вывод):

| Проверка | Результат |
|---|---|
| `pm2 list` | пустая таблица (ни одного процесса) |
| `systemctl list-unit-files \| grep 'pm2'` | `pm2-root.service` отсутствует |
| `ls /etc/systemd/system/pm2-root.service` | `No such file or directory` |
| `systemctl is-enabled pm2-root` | `not-found` (после ребута resurrect не вернёт процесс) |
| `ss -ltnp \| grep ':3000'` | пусто — на хосте 3000 больше никто не слушает (контейнер наружу 3000 не публикует) |
| `http://ntetris.ddns.net:3000` с локальной машины | `ECONNREFUSED 144.31.195.51:3000` (не 200) |
| `https://ntetris.ddns.net/` | `200`, тот же новый бандл `assets/index-B04z4d71.js` + `assets/index-C_FNZJOZ.css` |
| `docker ps` | `neon-tetris Up`, `nginx-proxy Up`, `nginx-proxy-letsencrypt Up` |

Мёртвые артефакты PM2-контура с хоста удалены: `/opt/neon-tetris/node_modules` (87 МБ),
`/opt/neon-tetris/frontend/dist`, `/opt/neon-tetris/backend/dist`. Не тронуты и обязательны к сохранению:
`/opt/neon-tetris/backend/data/scores.json` (volume контейнера) и `/opt/neon-tetris/nginx-proxy/`
(там `.env` с `DEFAULT_EMAIL`, которого нет в репозитории). `rsync --exclude=dist --exclude=node_modules`
не пересоздаёт удалённое: контейнер собирает `dist` внутри образа.

Замечание по сборке: `Dockerfile` переведён на `node:22-alpine` (обе стадии — builder и production).
На `node:20-alpine` (20.20.2) `npm install` давал `EBADENGINE` (`abbrev@5.0.0`, `nopt@10.0.1` требуют
`^22.22.2 || ^24.15.0 || >=26.0.0`), а Vite 8 требует `^20.19 || >=22.12`. Проверка локальной сборки
образа: `docker build` → exit 0, в логе нет ни одного `EBADENGINE` (только `npm warn deprecated`),
`found 0 vulnerabilities`; в контейнере `node --version` → `v22.23.3`,
`npm ls --omit=dev --depth=0` → `express@4.22.3`, `ws@8.22.0`; лог контейнера —
`Neon Tetris server running on port 3000`.

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
