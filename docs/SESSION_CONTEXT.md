# Контекст сессии для продолжения

## Текущее состояние

**Проект:** Neon Tetris — Vue 3 + Pinia + Express + TypeScript
**Ветка:** `main`, синхронизирована с `origin/main` (`https://github.com/dvdrelin/tetris.git`)
**Коммиты после аудита:** `9dba4ea` (P0–P3: канонические матрицы SRS + направленные wall kicks, тесты, доки,
сборка и деплой), `9db00a3` (внешний API-хост выведен из проекта: убран git-remote, `app.js` → same-origin
`/api`), `b06f4fb` (уточнение утверждений об окружении), обновление `vue-tsc` до 3.3.12 с починкой
найденных типов в `App.vue` (`docs/AUDIT_REPORT.md` §12.6) и обновление зависимостей с устранением всех
уязвимостей `npm audit` (§12.7). Далее: `ea56fc7` (PM2-контур удалён, `deploy.sh` переведён на
`git clone` + `rsync` + `docker compose`), `b0b7ac9` (`node:20-alpine` → `node:22-alpine`),
`5b9418a` (реальный `GET /api/health`, JSON 200/503), `4344f3d` (исключения `.dockerignore` +
build-arg `APP_VERSION`), `757e909` и `e8e2882` (записи об этих деплоях в документах), `96af5cd`
(дизайн-документы), `2613360` (фаза 5, блок 1: типы и расчистка), `4050670` (фаза 5, блок 2: тайминг и
гравитация). Коммит этого блока — фаза 5, блок 3 (lock delay, hold, поворот 180°, очередь из 3 фигур).
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
  **21** backend unit, **16** E2E — `docs/AUDIT_REPORT.md` §11; после блоков 1–3 фазы 5:
  **148** frontend unit (8 сюит), **36** backend unit (3 сюиты), **19** E2E):
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
- **Актуальные цифры тестов (после добавления `GET /api/health` и резолва `APP_VERSION`):** `npm.cmd run test` →
  **109 frontend + 36 backend** (backend: `scoreService`, `gameRouter`, `health`), `npm.cmd run test:e2e` →
  **19/19** (добавлен `tests/e2e/health.test.ts`), `npm.cmd run build` → exit 0, `npm.cmd audit` → 0 уязвимостей

### Эндпоинт самодиагностики `GET /api/health`
- Маршрут `backend/src/routes/healthRouter.ts`, подключён в `index.ts` **до** `express.static` и SPA
  catch-all — иначе `GET /api/health` отдавал бы HTML вместо JSON (так и было до этого коммита:
  маршрута не существовало вообще).
- Ответ всегда JSON: `200` когда все проверки ok, `503` + `"status":"degraded"` когда хотя бы одна упала.
  Проверки: `db` (`ScoreService.health()`: каталог данных, парсинг `scores.json`, запись через отдельный
  `.health-probe`, удаляемый в `finally`), `static` (`frontend/dist/index.html` + файлы в `assets/`),
  `websocket` (`wss.clients.size`, путь `/ws`), `runtime` (Node, uptime, RSS, `NODE_ENV`, `PORT`),
  `api` (самопроверка `/api/scores` и `/api/leaderboard` через тот же `ScoreService`).
- Поле `version`: `APP_VERSION` → `backend/package.json` → `unknown`. `APP_VERSION` задаётся
  build-аргом `Dockerfile` (`ARG APP_VERSION` → `ENV APP_VERSION`), значение считает `deploy.sh`
  как `1.<YYMMDD>.<git short hash>`. Проверено на локальном образе
  (`docker build --build-arg APP_VERSION=1.261004.localcheck` + `docker run`): `docker inspect` →
  `APP_VERSION=1.261004.localcheck`, `GET /api/health` → `"version":"1.261004.localcheck"`.
  Тесты резолва — `backend/tests/unit/health.test.ts` (в т.ч. пустой `APP_VERSION` → `1.0.0`).
- `.dockerignore` исключает из build-контекста `audit-verify/` (он остаётся в git) и `tmp-audit/`
  (он в `.gitignore`, живёт только локально). Проверено размером передаваемого контекста:
  `transferring context: 687.01kB` → `171.68kB`; `docker run --rm <image> ls /app` → `backend`, `frontend`.
- Проверено на реальном образе (`docker build` + `docker run`, `node:22-alpine`): `GET /api/health` →
  `200 application/json`, `"status":"ok"`, `"version":"1.0.0"`, `static.assetCount: 2`, `runtime.node: v22.23.3`;
  после `mv /app/frontend/dist/index.html` → `503` + `"status":"degraded"` с `static.error`; после возврата файла → `200`.
  `GET /` при этом остаётся HTML, каталог `/app/backend/data` после проверок пуст (probe удалён).

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
APP_VERSION="1.$(date -u +%y%m%d).$(git -C /opt/neon-tetris-new rev-parse --short HEAD)"
rm -rf /opt/neon-tetris-new
cd /opt/neon-tetris && APP_VERSION=$APP_VERSION docker compose build && docker compose up -d
```

`APP_VERSION` — build-арг `Dockerfile` (`ARG APP_VERSION` → `ENV APP_VERSION`), он же поле
`version` в `GET /api/health`. Формат: `1.<YYMMDD>.<git short hash>`, например `1.261004.317de99`.
Хэш берётся из `/opt/neon-tetris-new` **до** его удаления: в `/opt/neon-tetris` нет `.git`
(rsync исключает `.git`), поэтому там `git rev-parse` невозможен. `docker-compose.yml`
подставляет его как `build.args.APP_VERSION: ${APP_VERSION:-}`; обычный `docker compose build`
без переменной даёт пустой `APP_VERSION`, а пустой значение `resolveVersion()` считает
незаданным → `version` берётся из `backend/package.json` (`1.0.0`). Деплои до этой
правки собирали образ именно без build-арга, поэтому в health был `1.0.0`.

`--exclude=backend/data` и `--exclude=nginx-proxy` обязательны: первый сохраняет `scores.json`
(он же примонтирован в контейнер), второй сохраняет `nginx-proxy/.env` с `EMAIL` (адрес для Let's Encrypt),
которого нет в репозитории. Проверено на сервере: `cut -d= -f1 /opt/neon-tetris/nginx-proxy/.env` →
комментарий + `EMAIL` (файл 67 байт, `docker-compose.yml` в том же каталоге — 1248 байт).

Что проверять после `up -d`:
- `docker ps` → `neon-tetris  neon-tetris-neon-tetris  Up`; `docker logs --tail 15 neon-tetris` → `Neon Tetris server running on port 3000`
- `curl -s https://ntetris.ddns.net/api/health` → `200` и JSON вида
  `{"status":"ok","uptimeSec":…,"version":"1.261004.317de99","checks":{"db":{"ok":true,"writable":true,"count":…},"static":{"ok":true,"indexHtml":"present","assetCount":2},"websocket":{"ok":true,"clients":0,"path":"/ws"},"runtime":{"ok":true,"node":"v22…"},"api":{"ok":true,…}}}`.
  `version` — вычисленная при деплое `APP_VERSION`; `1.0.0` вместо неё означает, что образ собран без build-арга.
  `503` + `"status":"degraded"` означает реальную проблему (хранилище, собранный SPA или websocket),
  а не HTML-заглушку. Эндпоинт добавлен коммитом `feat(backend): GET /api/health…`; до него
  `/api/health` не был маршрутом и SPA catch-all возвращал HTML.
- `curl -s https://ntetris.ddns.net | grep -o 'assets/[^"]*'` → новые хэши бандла
- `/api/scores` и `/api/leaderboard` → JSON сохранных рекордов; `wss://ntetris.ddns.net/ws` → успешный handshake
- хэши артефактов в контейнере должны совпадать с локальной сборкой: `frontend/dist/assets/index-B04z4d71.js` →
  `c84daf18…`, `backend/dist/index.js` → `1a45f215…` (совпали байт в байт)

`deploy.sh` повторяет эти проверки сам: `https://$HOST/` → 200, `https://$HOST/api/health` → 200,
`GET /api/health` изнутри контейнера (`docker exec … node -e fetch`, печатает и `version`),
сравнение `version` из health с вычисленной `APP_VERSION` (несовпадение = собран не тот коммит),
и сравнение хэша бандла «отдаётся / в образе».

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
(там `.env` с `EMAIL`, которого нет в репозитории). `rsync --exclude=dist --exclude=node_modules`
не пересоздаёт удалённое: контейнер собирает `dist` внутри образа.

Замечание по сборке: `Dockerfile` переведён на `node:22-alpine` (обе стадии — builder и production).
На `node:20-alpine` (20.20.2) `npm install` давал `EBADENGINE` (`abbrev@5.0.0`, `nopt@10.0.1` требуют
`^22.22.2 || ^24.15.0 || >=26.0.0`), а Vite 8 требует `^20.19 || >=22.12`. Проверка локальной сборки
образа: `docker build` → exit 0, в логе нет ни одного `EBADENGINE` (только `npm warn deprecated`),
`found 0 vulnerabilities`; в контейнере `node --version` → `v22.23.3`,
`npm ls --omit=dev --depth=0` → `express@4.22.3`, `ws@8.22.0`; лог контейнера —
`Neon Tetris server running on port 3000`.

Деплой коммита `5b9418a` (`bash deploy.sh root ntetris.ddns.net 3000`, 2026-10-04) — все самопроверки прошли:
- образ `neon-tetris-neon-tetris:latest` → `470d4c44911e` (393 МБ), обе стадии на `node:22-alpine`,
  `found 0 vulnerabilities`; `docker compose ps` → `neon-tetris Up`, порт только `3000/tcp` внутренний
  (`ss -ltnp | grep :3000` → `no_external_listener_3000`);
- `https://ntetris.ddns.net/api/health` → `200` + `application/json`: `"status":"ok"`, `version: "1.0.0"`,
  `db: {ok:true, writable:true, count:31, bytes:6486}`, `static: {indexHtml:"present", assetCount:2}`,
  `websocket: {clients:0, path:"/ws"}`, `runtime: {node:"v22.23.3", env:"production", port:"3000"}`,
  `api: {scoreRecords:10, leaderboardEntries:17}`; изнутри контейнера (`docker exec … node -e fetch(…)`) — тот же `200`;
- хэш бандла совпал: `assets/index-B04z4d71.js` → `c84daf18…` и наружу, и в образе;
- `wss://ntetris.ddns.net/ws` → handshake OK; `http://` → `301` на `https://ntetris.ddns.net/`;
  `/leaderboard` → `200 text/html` (SPA catch-all жив), `/api/health/x` → HTML (маршрут — ровно `/api/health`);
- данные целы: `/opt/neon-tetris/backend/data/` → `.gitignore` + `scores.json` (6486 байт), `.health-probe` отсутствует;
  `nginx-proxy` и `nginx-proxy-letsencrypt` → `Up 2 weeks`, не тронуты; `/opt/neon-tetris` — 140M, `/` — 30% занято;
- откат: предыдущий образ (`8cdd94157c95`, `node:20-alpine`) после пересборки на сервере отсутствует
  (`docker images --filter dangling=true` → пусто). Откат = `git revert` + `docker compose build && docker compose up -d`.

Деплой коммита `4344f3d` (`bash deploy.sh root ntetris.ddns.net 3000`, 2026-10-04) — `APP_VERSION` в проде:
- `deploy.sh` вычислил `APP_VERSION = 1.261004.4344f3d` из клонированного репозитория
  (`date -u +%y%m%d` + `git rev-parse --short HEAD`, хэш читается до `rm -rf /opt/neon-tetris-new`);
- `docker inspect neon-tetris` → `APP_VERSION=1.261004.4344f3d` в окружении контейнера;
- `https://ntetris.ddns.net/api/health` → `200` + `application/json`: `"status":"ok"`,
  `"version":"1.261004.4344f3d"`, `db {ok:true, writable:true, count:31, bytes:6486}`,
  `static {indexHtml:"present", assetCount:2}`, `websocket {clients:0, path:"/ws"}`,
  `runtime {node:"v22.23.3", env:"production", port:"3000"}`, `api {scoreRecords:10, leaderboardEntries:17}`;
  изнутри контейнера — тот же `200` и та же `version`;
- самопроверка скрипта подтвердила: `version в /api/health = 1.261004.4344f3d — образ собран из этого коммита`;
- `.dockerignore` на сервере применён (`load .dockerignore` → `transferring context: 963B`),
  `docker run --rm neon-tetris-neon-tetris ls /app` → `backend`, `frontend`: каталог `audit-verify`
  остался в `/opt/neon-tetris` (он в git), но в образ не попал; `tmp-audit/` на сервере нет вообще (`.gitignore`);
- данные целы: `/opt/neon-tetris/backend/data/` → `scores.json` (`count:31`, `bytes:6486`,
  `mtimeMs:1791118254080.153`), `.health-probe` отсутствует; `nginx-proxy` не тронут;
- хэш бандла совпал: `assets/index-B04z4d71.js` → `c84daf18…` наружу и в образе.

Локальные проверки перед этим деплоем: `tsc --noEmit -p backend/tsconfig.json` и
`vue-tsc --noEmit -p frontend/tsconfig.json` → exit 0; `npm run build` → exit 0; `npm run test` → 109 + 36;
`npm run test:e2e` → 19 passed; `npm audit` → 0; `bash -n deploy.sh` → exit 0.
Сборка с build-аргом: `docker build --build-arg APP_VERSION=1.261004.localcheck` → `docker inspect` c
`APP_VERSION=1.261004.localcheck` и health `"version":"1.261004.localcheck"`; размер передаваемого
контекста `687.01kB` → `171.68kB` (исключения `audit-verify/` и `tmp-audit/`).
`docker compose config`: с переменной → `APP_VERSION: 1.261004.testsha`, без неё → `APP_VERSION: ""`.
Локальные проверочные образы (`neon-tetris:health-check`, `neon-tetris:node22-check`,
`neon-tetris:appver-check`) удалены — прод-образ только на сервере.

Коммит `757e909` (запись этого деплоя) меняет только документы и не требует пересборки: в проде
остаётся образ, собранный из `4344f3d`, поэтому живой `version` — `1.261004.4344f3d`, а не хэш HEAD.
`version` в health всегда показывает, из какого коммита собран образ, — это и есть проверка.

Ранее использовавшийся Amvera-хостинг выведен полностью: упоминаний в репозитории нет (проверено по
всем файлам, исключая `node_modules/`, `.git/`, `dist/`).

## Программа «сингл — полностью» (фаза 5)

Рамки заданы пользователем: «оставь MP за скобками. сейчас надо решить с синглом — полностью.
MP (старый и новый дизайн) — отдельная тема, будет решаться на старте MP». Решение-лист и принятые
решения — `docs/SINGLE_PLAYER_DECISIONS.md`, план блоков — `docs/PLAN.md` (Фаза 5), закрытое из аудита —
`docs/AUDIT_REPORT.md` §12.8.

**Блок 1 (коммит этого блока): типы и расчистка.** Изменены `game-engine.ts`, `board.ts`, `types.ts`,
`commands.ts`, `gameStore.ts`, `App.vue`, `GameBoard.vue`, `tests/unit/engine.test.ts`,
`tests/unit/rotation-kicks.test.ts`; удалён gitignored артефакт `docs/tsc-frontend.log`.
Фронтенд и бэкенд после правок: `npx.cmd vue-tsc --noEmit` → exit 0 (пустой вывод),
`npx.cmd jest --runInBand` во `frontend/` → `6 suites / 109 tests passed`,
`npx.cmd tsc --noEmit` в `backend/` → exit 0, `npx.cmd jest --runInBand` в `backend/` → `3 suites / 36 tests passed`.
Бэкенд в этом блоке не менялся, прод не пересобирается.

**Особенность среды (важно для следующих проверок):** `npm.cmd test` в песочнице падает с
`Error: spawn EPERM` в `jest-worker/ChildProcessWorker.initialize` — воркеры jest не создаются.
Юнит-тесты запускаются `npx.cmd jest --runInBand`. Кроме того, тесты фронтенда не типизируются
(`frontend/jest.config.js`: `ts-jest` с `isolatedModules: true`; `frontend/tsconfig.json` `include`
не покрывает `tests/`), поэтому типизация проверяется отдельно: `npx.cmd vue-tsc --noEmit` (frontend)
и `npx.cmd tsc --noEmit` (backend). Отдельного npm-скрипта `typecheck` в проекте нет.
`npx.cmd playwright test` в песочнице падает так же (`Error: spawn EPERM` на запуске dev-серверов и
браузера) — E2E выполняется с расширенным доступом к песочнице.

**Блок 2 (коммит этого блока): тайминг и гравитация.** Изменены `game-config.ts`
(`dropInterval(level, mode)`, `HARDCORE_SPEED_MULTIPLIER = 0.5`), `commands.ts`
(`TickCommand.payload: { dt: number }`), `game-engine.ts` (`gravityAccumulator`, `elapsedMs`,
`tick(dtMs)` с `while (accumulator >= interval)`, автопадение в обоих режимах, `MAX_TICK_DELTA_MS = 250`,
`MovePiece{down}` = soft drop, `autoDrop()` без мёртвой `interval`), `GameBoard.vue` (цикл только
передаёт `dt`); добавлен `frontend/tests/unit/gravity.test.ts` (16 тестов). Закрыт §12.4 п.6 (C12).
Проверки: `npx.cmd vue-tsc --noEmit` → exit 0 (пустой вывод), `npx.cmd jest --runInBand` во `frontend/`
→ `7 suites / 125 tests passed` (exit 0), `npx.cmd playwright test --config tests/playwright.config.ts`
→ `19 passed`, `LASTEXITCODE=0`. Бэкенд не менялся, прод не пересобирается.

**Блок 3 (коммит этого блока): механика (A3, A4, A5, A6 + C1).** Изменены `game-config.ts`
(`LOCK_CONFIG = { delayMs: 500, maxResets: 15 }`, `QUEUE_SIZE = 3`), `types.ts`
(`nextQueue`/`holdType`/`canHold` вместо `nextPieceType`, `LockConfig`), `commands.ts`
(`HoldPiece`, `direction: 'cw' | 'ccw' | '180'`), `pieces.ts` (`PIECE_COLOR_INDEX`), `game-engine.ts`
(`fillQueue`, `holdPiece`/`canHold`, `lockAccumulator`/`lockResets`, `isGrounded`,
`onSuccessfulManipulation`, кики 180°, `spawnPiece`), `gameStore.ts` (DTO + клавиши `R`, `C`/`Shift`),
`HudView.vue` (слот hold + 3 превью с прозрачностью `[1, 0.6, 0.35]`); добавлен
`frontend/tests/unit/mechanics.test.ts` (17 тестов), `gravity.test.ts` расширен до 22 тестов,
в `rotation-kicks.test.ts` мягких сбросов 30 → 16.
Проверки: `npx.cmd vue-tsc --noEmit` → `LASTEXITCODE=0` (пустой вывод), `npx.cmd jest --runInBand`
во `frontend/` → `8 suites / 148 tests passed`, в `backend/` → `3 suites / 36 tests passed`,
`npx.cmd playwright test --config tests/playwright.config.ts` → `19 passed (26.6s)`, `LASTEXITCODE=0`.
Бэкенд не менялся, прод не пересобирается.

Два практических правила, которые блок 3 зафиксировал:
- E2E запускается **только** как `npx.cmd playwright test --config tests/playwright.config.ts`
  (или `npm.cmd run test:e2e`). Без `--config` Playwright не находит конфиг, обходит всё дерево и
  падает на jest-файлах: `ReferenceError: describe is not defined`.
- `tick()` обрезает `dt` до `MAX_TICK_DELTA_MS = 250`: ожидание в 400–500 мс в тестах набирается
  несколькими вызовами `tick`, иначе время теряется.

## Граф проекта (Graphify)

`graphify-out/graph.json` — knowledge-граф этого репозитория, доступен через MCP-сервер
`graphify-tetris` (`query_graph`, `get_node`, `get_neighbors`, `graph_stats`, `shortest_path`).
Он уже отражает блок 3: узлы `mechanics.test.ts`, `PIECE_COLOR_INDEX`, `holdPiece()`, `fillQueue()`,
`isGrounded()`, `onSuccessfulManipulation()`, `RotationState`.

Обновление графа — **только вручную**, наблюдателей нет. Локальная перезагрузка без LLM
(без расхода Polza-кредитов):

```
& "C:\Users\dvdre\AppData\Roaming\Python\Python313\Scripts\graphify.exe" C:\GIT\tetris --update --code-only
```

Вывод последней такой перезагрузки: `3 code, 0 docs, 0 papers, 0 images changed; 52 unchanged; 0 deleted`,
`wrote graph.json: 624 nodes, 1007 edges, 37 communities`, `LASTEXITCODE=0`.
`graphify-out/` — генерируемый артефакт, в git не попадает (`.gitignore`).
`GRAPH_REPORT.md` и имена сообществ после `--code-only` не пересобираются: для этого нужен
`graphify cluster-only C:\GIT\tetris` (требует LLM-бэкенд), по текущему решению — не запускать.

## Следующий шаг

### Блок 4: управление (B2, B3)

1. **DAS 167 мс / ARR 33 мс** — собственный модуль автоповтора в `frontend/src` (не автоповтор ОС);
   тесты на фиксированных таймерах jest (`jest.useFakeTimers()`).
2. **`keyup`-слушатель** в `GameView.vue` + игнор `e.repeat` в `gameStore.handleKey`.
3. Сохранить текущую карту клавиш (`A`/`D`/`S`/`W`, `↑`/`X`, `Z`/`Q`, `R`, `C`/`Shift`, `Space`, `P`, `Esc`).
4. **Тач-контролы для мобильных (B3)** — обязательны: кнопки/жесты поверх canvas, чтобы в игру
   можно было играть с телефона; существующие E2E (19) не должны сломаться.
5. Тесты на новое поведение — в том же коммите; затем `git commit` + `git push origin main`.

Мультиплеер (оба дизайна, `docs/PHASE3_MULTIPLAYER.md`, `design.game/*`) — отдельная тема,
решается на старте MP.
