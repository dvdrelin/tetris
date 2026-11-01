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
  *Это цифры того времени; актуальный набор (220 frontend / 49 backend / 46 E2E) — в разделе
  «Актуальные цифры тестов» ниже.*

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

**Блок 4 (коммит `c78ab9f`): управление (B2, B3).** Изменены `shared/input/input-actions.ts`,
`repeat-controller.ts`, `input-controller.ts`, `touch.ts` (все четыре — новые), `game-config.ts`
(`DAS_CONFIG = { dasMs: 167, arrMs: 33 }`), `GameView.vue` (слушатели `keydown`/`keyup`, свой rAF-цикл
ввода, `releaseAll()` на blur/visibilitychange/unmount), `TouchControls.vue` (новый), `HudView.vue`
(медиа-запрос ≤ 900 px), `stores/gameStore.ts` (метод `handleKey` удалён — второй путь ввода больше
не нужен); добавлены `tests/unit/input.test.ts` (25 тестов), `tests/e2e/input.test.ts` (7),
`tests/e2e/touch.test.ts` (4), `tests/e2e/helpers.ts`. Проверялось на этом HEAD:
`npx.cmd vue-tsc --noEmit` → exit 0, `npx.cmd jest --runInBand` во `frontend/` →
`9 suites / 173 tests`, в `backend/` → `3 suites / 36 tests`,
`npx.cmd playwright test --config tests/playwright.config.ts` → `30 passed`. Подробные записи
о командах и выводе — `docs/SINGLE_PLAYER_DECISIONS.md`, разделы «Проверка блока 4» и
«Что изменено в коде блока 4». Прод не пересобирался.

**Блок 5 (коммит этого блока): ghost в движке (A7).** `ghostY` больше не считается в сторе:
в `game-engine.ts` появились приватный `landingRow(piece, from)` (спуск по строкам через
единственное правило коллизий `isValidPosition`) и публичный `getGhostY()`; `hardDrop()` теперь
использует `landingRow` (расстояние падения считается до сдвига якоря); в CQRS добавлен
`QueryType.GetGhost`. Из `stores/gameStore.ts` удалена локальная копия расчёта (23 строки обхода
доски с проверкой `value !== 0`, которая шла вразрез с правилом `locked`-клеток) и её экспорт;
`updateState()` читает `engineInstance.getGhostY()`. Контракт с рендерером не менялся: `GameStateDTO.ghostY`
тот же, дефолт `-1`, `renderer.ts` и `GameBoard.vue` не тронуты. Добавлен
`frontend/tests/unit/ghost.test.ts` (10 тестов): призрак = точная клетка фиксации hard drop,
остановка на `locked`-клетке, учёт поворота (`I` горизонталь `H−2` → вертикаль `H−4`) и сдвига,
`-1` без активной фигуры, эквивалентность soft/hard drop.
Проверки блока: `npx.cmd vue-tsc --noEmit` → exit 0, `npx.cmd jest --runInBand` во `frontend/` →
`10 suites / 183 tests`, в `backend/` → `3 suites / 36 tests` и `npx.cmd tsc --noEmit` → exit 0
(бэкенд не менялся), `npx.cmd playwright test --config tests/playwright.config.ts` → `30 passed (32.3s)`.
E2E-счёт не вырос: нового браузерного поведения нет, прогон подтверждает целость канала
`engine → store → renderer`.

**Блок 6 (коммит этого блока): UI (C2, C3, C4, C5, C6).** `GameEngine.stop()` — новый публичный
метод: снимает `isRunning`/`isPaused`, шлёт `onStateChange`, но не `onGameOver`, поэтому заброшенная
партия не отправляет `POST /api/score`. `GameView.onUnmounted` теперь вызывает
`gameStore.stopGame()`: без этого движок оставался «бегущим», а партия возобновлялась при следующем
заходе на доску. В `HudView.vue` — **одна** кнопка паузы под управлением `isPaused` (⏸/▶, класс
`resume-btn`, `title`); старая ветка `▶` была недостижима (`v-else-if` за уже ложным условием),
`store.resumeGame()` удалён как мёртвый код — паузу и возобновление переключает один `togglePause`.
Подсказки клавиш: новый `shared/config/control-hints.ts` (`CONTROL_HINTS`, 11 пар; `VIEW_HINT_KEYS`
для `ESC`/`ENTER`, которые обрабатывает `GameView`, а не `KEY_MAP`) — читают и меню, и HUD;
в `input-actions.ts` добавлен экспорт `KEY_MAP_KEYS` для теста «каждая заявленная клавиша
существует». Имя игрока: новый `shared/domain/player-name.ts` (`PLAYER_NAME_MAX = 32` — потолок
бэкенда, `normalizePlayerName`, `load/savePlayerName` с `try/catch`), поле `.name-input` в
`MenuView.vue` с локальным `nameDraft` (коммит при `blur`/`Enter`/`ИГРАТЬ`), в сторе —
`playerName` из `loadPlayerName()` + `watch`, нормализующий и сохраняющий значение. Из
`MenuView.vue` удалён `gameStore.init()` (C6): единственный `init()` — в `App.vue onMounted`,
иначе каждый монтаж меню подменял экземпляр движка.
Проверки блока: `npx.cmd vue-tsc --noEmit` → exit 0; `npx.cmd jest --runInBand` во `frontend/` →
`11 suites / 196 tests`; в `backend/` → `3 suites / 36 tests`, `npx.cmd tsc --noEmit` → exit 0;
`npx.cmd playwright test --config tests/playwright.config.ts` → `37 passed (33.8s)`;
`npm.cmd run build` → exit 0, `dist/assets/index-DMKMGquF.js` 109.87 kB.
Новые тесты: `frontend/tests/unit/ui-block6.test.ts` (13), `tests/e2e/ui.test.ts` (4),
`tests/e2e/player-name.test.ts` (3). Бэкенд не менялся, прод не пересобирается.

**Актуальные цифры тестов на HEAD этого блока: 220 frontend unit (12 сюит) + 49 backend unit
(4 сюиты: `scoreService`, `gameRouter`, `health`, `rateLimit`) + 45 E2E.** Playwright-конфиг даёт два проекта (`backend` + `frontend`), поэтому
в выводе прогона 45 строк «ok» — это и есть `45 passed`; исторические «19 passed» в записях
блоков 2–3 соответствовали тому же полному прогону того времени.

## Граф проекта (Graphify)

`graphify-out/graph.json` — knowledge-граф этого репозитория, доступен через MCP-сервер
`graphify-tetris` (`query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`,
`graph_stats`, `shortest_path`). Граф пересобран после последнего коммита блока 7; точный
`Built from commit` в шапке `GRAPH_REPORT.md` — авторитетнее этой строки. Текущий масштаб:
**~1081 узел · ~1946 рёбер · 70 сообществ**, плейсхолдеров в именах 0 (`label --missing-only`
после каждого `update`), `GRAPH_REPORT.md` стоит
`Built from commit` = HEAD. Узлы блока 5: `getGhostY()`, `landingRow()`, `GhostQuery`,
`ghost.test.ts`. Узлы блока 6: `stop()`, `stopGame()`, `CONTROL_HINTS`, `normalizePlayerName()`,
`KEY_MAP_KEYS`, `ui-block6.test.ts`.

Обновление графа — **только вручную**, наблюдателей нет. Бесплатная перезагрузка кода
(AST + кластеризация + репорт, 0 LLM-вызовов):

```
graphify update C:\GIT\tetris
```

(в DSH-сессии — через обёртку `C:\Users\dvdre\.dsh\bin\graphify-build.ps1 update C:\GIT\tetris`).
После `update` сообщества получают механические имена по хабам — дешёвая дозапись имён через Polza:
пометка изменившихся (`graphify-mark-changed-labels.py` со снапшота `.graphify_labels.json`) и
`graphify-build.ps1 label C:\GIT\tetris --backend=openai --missing-only`.
**Не делать:** `graphify <path> --update` и `extract --code-only` — первая форма платная и без
репорта, вторая останавливается на `graph.json` и не пересобирает `GRAPH_REPORT.md` и имена.
`graphify-out/` — генерируемый артефакт, в git не попадает (`.gitignore`).

## Что сделано в блоке 7 (бэкенд: D1, D2)

Новый модуль `backend/src/middleware/rate-limit.ts` — `RateLimiter`: скользящее окно на инъекционных
часах (тестируется без реального ожидания), без внешних зависимостей и таймеров; `check(key)` →
`{allowed, retryAfterMs, remaining}`, геттеры `limit`/`window`/`size`, cap на число ключей с чисткой
устаревших. `gameRouter.ts`: `LIMITS.scoreMax` поднят с `1_000_000` до **`10_000_000`** (D2), фабрика
`createGameRouter(scoreService, { scoreLimiter })` — лимитер опционален, на `POST /score` перед
валидацией тела отказ отдаётся как **429** + `Retry-After` (сек) + `X-RateLimit-Limit/-Remaining`.
`index.ts`: `app.set('trust proxy', 1)` (иначе за nginx-proxy все игроки — один «IP» контейнера-прокси;
снимается `TRUST_PROXY=0`), `new RateLimiter({ windowMs: SCORE_RATE_LIMIT_WINDOW_MS || 60000,
max: SCORE_RATE_LIMIT_MAX || 30 })`, лимитер передаётся в роутер и в health-отчёт.
`healthRouter.ts`: новая опция `scoreRateLimit()`, в `checks.api` появился
`scoreRateLimit: { max, windowMs, trackedKeys }` — состояние ограничения видно из `GET /api/health`.

Тесты: новая сюита `backend/tests/unit/rateLimit.test.ts` (+13: 7 чистых тестов `RateLimiter` на
фейковых часах — окно скользит, `Retry-After` уменьшается 1000→600 мс, ключи независимы, устаревшие
ключи выметаются (`maxKeys`), невалидная конфигурация → `RangeError`; 6 тестов маршрута — 429 с
заголовками и **без записи в хранилище**, разные `X-Forwarded-For` → независимые окна,
`GET`-роуты и health не лимитируются, без лимитера поведение прежнее), новый E2E
`tests/e2e/zz-score-rate-limit.test.ts` (+1; префикс `zz-` — запуск последним, потому что тест добивает
окно текущего клиента; лимит и окно читаются из `checks.api.scoreRateLimit`, а не хардкодом). В
`gameRouter.test.ts` переприкручена граница: `1_000_001` теперь легален, нелегален `10_000_001`.

Корректность проверена на фронте: `1_500_000` (выше старого потолка) проходит, `10_000_001` → 400.
Два моих же первоначальных теста оказались неправы, а не код: (1) второй `check('fresh')` при `max: 1`
закономерно даёт `false` — ожидание было «с twice-разрешённым» ключом; (2) я ждал `400` от запроса с
невалидным телом, находясь в исчерпанном окне, — лимитер стоит **до** валидации и отказ отдаёт раньше
разбора тела (это и есть его смысл); плюс `sweepIfTooLarge` имел нестрогое условие (`<=` вместо `<`)
и карта могла уехать за `maxKeys` — исправлено в коде. Фронтенд в этом блоке не менялся; известный
хвост: `fetch('/api/score')` в `gameStore` не проверяет `res.ok` → 429/400 молча означают «рекорд не
ушёл» (править через `console.warn`: E2E-сюиты считают `window.__consoleErrors`, `console.error`
сломал бы их assertions). **Хвост закрыт в этом же блоке:** `onGameOver` проверяет `res.ok` и пишет
`console.warn("Score was not saved: HTTP <код> <тело>")`, сетевой промах `fetch` переведён на warn
(`main.ts` собирает `window.__consoleWarnings` отдельно от `__consoleErrors`); новый E2E
`tests/e2e/ui-score-feedback.test.ts` подменяет `**/api/score` моком `429` (`Retry-After: 37`),
доводит игру до `isGameOver` серией `Space` и требует строку предупреждения при пустом
`__consoleErrors`. Итог прогона: `39 passed (34.9s)`. Не тронуто осознанно: `console.error` в
`leaderboardStore` (деградация GET-чтений) — закрыто отдельной правкой после фазы, см. ниже.

## Следующий шаг

### Деплой блока 7 (2026-11-01) — фаза 5 закрыта

`bash deploy.sh root ntetris.ddns.net 3000` через Git Bash (`& 'C:\Program Files\Git\bin\bash.exe'
/c/GIT/tetris/deploy.sh root ntetris.ddns.net 3000`), exit 0. Прод: `1.261004.4344f3d` →
**`1.261101.b3659bc`** (= HEAD на момент деплоя), хэш бандла `assets/index-lAConWCo.js` совпал
«отдаётся == в образе», `nginx-proxy`/`nginx-proxy-letsencrypt` не тронуты.

Проверки на проде: `checks.api.scoreRateLimit = {max: 30, windowMs: 60000, trackedKeys: 0}`;
серия из 40 `POST /api/score` → ровно 30 × 200 и первый **429 на 31-м** (`retry-after: 59`,
`remaining: 29 → 1`); `GET /api/scores|leaderboard|health` при исчерпанном окне → 200;
`wss://ntetris.ddns.net/ws` — handshake open (встроенный WebSocket-клиент node 22:
`require('ws')` из `/app` в контейнере не резолвится, зависимости в `backend/node_modules`).

Верификация лимита писала в прод по-настоящему: `scores.json` 36 → 66 записей (+30 `DeployProbe`).
По согласованию вычищено: бэкап `backend/data/scores.json.bak-before-probe-cleanup` (13 813 байт),
`node`-скрипт убрал записи `player_name === "DeployProbe"` (66 → 36), затем
`docker compose up -d --force-recreate` — потому что `ScoreService` держит весь массив в памяти
и полной перезаписью на диске его не обновить. Итог: `count: 36`, `DeployProbe` в API больше нет,
файл вернулся ровно к 7543 байтам (размер до пробы).

Второй деплой (`c5db87c`, фикс чтений лидерборда): `1.261101.c5db87c`, бандл `index-Dc0daXVw.js`,
sha256 «отдаётся == в образе». Третий деплой (`ab9e6fc`, UI-состояние отказа): `1.261101.ab9e6fc`,
бандл `index-C9ETx0Oz.js` — тот же хеш, что у локальной сборки `npm run build`, т.е. сборка воспроизводима
между моей машиной и контейнером; прод синхронизирован с HEAD. На этом деплое в прод прилетел **боевой** рекорд: `dvdrelin`, 6680 очков,
`created_at 2026-11-01T21:05:12Z` (до записей 2026-09-08, 36 → 37) — частотное ограничение работает в
живом трафике, а `trackedKeys` при этом 0 (окно к моменту проверки истекло сам).

### Хвост вне блоков: деградация чтений лидерборда

`leaderboardStore` был последним местом, где сетевой сбой вёл себя как падение: `!res.ok` вообще
не проверялся (пустой список мог означать «сервер сказал 429/500», и это выглядело как «рекордов
нет»), а `catch` писал в `console.error` — т.е. штатная деградация попадала в канал ошибок, за которым
следят E2E. Правка: при `!res.ok` — `console.warn("Could not load scores|leaderboard: HTTP <код>")`
+ явная очистка списка; сетевой промах `fetch` переведён с `console.error` на `console.warn`
(как в `gameStore.onGameOver`). `loading` снимается в любом случае — экран не зависает на «Загрузка...».
Новый E2E `tests/e2e/leaderboard-degraded.test.ts` (2 теста): мок `500` на `**/api/scores**` и
`**/api/leaderboard**` → предупреждения с кодом, `.score-table tbody tr`/`.leaderboard-table tbody tr`
пустые, `.loading` отсутствует, `__consoleErrors` пуст; и здоровый путь (мок с одной записью) →
строки отрисованы, `__consoleWarnings` и `__consoleErrors` оба пустые. Прогон: `41 passed (35.3s)`
(было 39). Не делалось осознанно: UI-подсказка «данные не загрузились» вместо пустой таблицы —
сделана следующим шагом, см. ниже.

### Хвост вне блоков: UI-состояние отказа в лидерборде

Проблема осталась та же: пустая таблица враждебна неверию — игрок не отличает «рекордов пока нет»
от «сервер нас отверг». Добавлено:
- `leaderboardStore.error: string | null` — причина последнего неудачного чтения (со статусом сервера
  либо «сервер недоступен»); очищается в начале каждого чтения, поэтому «здоровое» чтение само
  убирает состояние.
- `LeaderboardView`: панель `.load-error` (текст + кнопка `.retry-btn` «↻ Повторить») стоит **до**
  ветки таблицы в `v-if/v-else-if`, поэтому при отказе таблицы не видно вовсе — она не рисуется
  пустой. `retry()` = `switchTab(activeTab.value)`: повторяет чтение текущей вкладки с текущим режимом.
- Стиль панели — пунктирная красная рамка, тон text-warning; ничего не перекрывает, layout не прыгает.

E2E `tests/e2e/leaderboard-degraded.test.ts` переписан и расширен до 3 тестов:
(1) `500` на обеих чтениях → панель видна, содержит текст про «рекорды» и код 500, `.score-table`
отсутствует, `.loading` отсутствует, в warning-канале причина; **retry на этой же вкладке** лечит
(заглушка со 2-й попытки отдаёт 200 → панель исчезает, строка `Recovered` на месте); затем переход на
вкладку «Лидерборд» — своя панель («лидерборд») и свой retry лечит (`RecoveredBoard`); `__consoleErrors`
пуст; (2) честный пустой ответ (`200` + `scores: []`) **не** является состоянием ошибки: таблица
видима, строк 0, панели нет, консоль чистая; (3) здоровое чтение — строки есть, `__consoleWarnings`
и `__consoleErrors` пустые. Первая версия теста была логически неверна: после перехода на вкладку
«Лидерборд» retry повторял именно её (сломанный) запрос, а я ждал восстановления таблицы топ-10 —
переделал так, чтобы каждая вкладка проверялась на своём отказе и своём retry. Прогон: `42 passed
(36.1s)`; frontend unit 196 (UI-состояние в unit-слое не тестируется — сюиты движка/домена без Vue).

### Хвост вне блоков: причина смерти в хардкоре

Симптом от пользователя: скриншот прод-сессии — `GAME OVER`, счёт 6680, «уровень 1», «линии 7»,
доска почти пустая (крохотный стек), консоль браузера пустая. «Баг в хардкоре», воспроизвести
нельзя. Разбор всех путей, ведущих в `hardcoreDeath()`, даёт ровно три причины мгновенной смерти
(всё это — задокументированные механики, не регрессия):
- движение `←`/`→` в стену или в закрепленные клетки (`movePiece`);
- поворот, для которого не подошёл ни один wall-kick (`rotatePiece`);
- блок-аут спавна/hold — он **одинаков в обоих режимах** и вообще не связан с хардкором.

Важное наблюдение про «смерть без причины», которого в доках не было: с DAS/ARR (блок 4) удержание
клавиши `←`/`→` шлёт повторяющиеся `MovePiece`. В аркаде упор в стену безобиден, в хардкоре **каждый**
повтор — смерть. Т.е. игрок, прижавшийся фигурой к стене и не отпустивший клавишу, обречён; со
стороны это выглядит как «умер сам, доска-то пустая». Это осознанное следствие A2, но раньше оно нигде
не было названо.

Сделано: движок фиксирует причину (`GameOverReason` в `types.ts`, поле `overReason` в `GameState`,
`getOverReason()`, `hardcoreDeath(reason)`), `gameStore` транспортирует её в `$state` (как `ghostY` —
решение принимает движок), `renderer` рисует заголовок причины и две строки пояснения, где вторая
строка всегда говорит, как ведёт себя аркада («Аркада такой ход просто игнорирует» / «В аркаде поворот
лишь отменяется» / «в обоих режимах это обычная смерть»). При `overReason = null` оверлей деградирует
к старому виду и не падает.

Тесты: новая unit-сюита `frontend/tests/unit/hardcore-death-reasons.test.ts` (11) — каждая причина на
своём пути, аркада не умирает и не выдумывает причину, restart и `stop()` её обнуляют; +5 тестов в
`renderer.test.ts` (текст причин рисуется, всё влезает в canvas, `null`-причина безопасна); +3 E2E
`tests/e2e/hardcore-reason.test.ts` (вход через `.mode-card` в меню, состояние `overReason =
'hardcore-wall-crash'`, `mode = 1`; в аркаде те же 15 нажатий — жив; Enter-рестарт очищает причину).

Ловушка фикстур, на которой я споткнулся: писать `cell.value = 5` в `getCells()` **бесмысленно** —
правило коллизий движка читает флаг `locked`, поэтому такие клетки не препятствуют ничему. Нужен
`BoardManager.setCell(x, y, value, locked = true)` (координаты x,y). После перехода на `lock()`-хелпер
все фикстуры заработали с первого прогона.

**Визуальная проверка в проде (именно она нашла реальный дефект).** Текст живёт в canvas, поэтому
E2E-снапшот DOM его не показывает — нужен скриншот. Сделала одноразовый E2E-файл, бьющий по
`https://ntetris.ddns.net` (запуск точечно: `--config tests/playwright.config.ts visual-prod-hardcore`),
который умерался в хардкоре и сохранял скрин доски в `tmp-audit/`. Первый скрин показал, что строка
пояснения в 41 символ **вылезает за правый край canvas**: доска = boardWidth·24 = 240 px, 12px-моноширинный
≈ 7.2 px/символ. Исправлено: шрифт 11px и все строки ≤ 34 символов; в `renderer.test.ts` добавлен
guard-тест, который проверяет длину каждой строки `GAME_OVER_TEXT` (тексты теперь экспортированы).
Второй скрин — текст целиком внутри. Одноразовый файл удалён, чтобы не гонять прод-запросы в основном
прогоне (иначе E2E пишет в живой лидерборд). Прод после этого: `1.261101.1b16d14`, бандл
`index-BhxbBi6B.js` (совпал с локальной сборкой).

Порядок чистки верификационных записей в проде (повторяемый): записать скрипт в `tmp-audit/*.sh`
(LF, не CRLF!), выполнить `ssh root@ntetris.ddns.net 'bash -s' < /c/GIT/tetris/tmp-audit/<файл>.sh`
через Git Bash; внутри — бэкап `scores.json.bak-before-*`, node-фильтр по `player_name`, затем
обязательно `docker compose up -d --force-recreate` (`ScoreService` держит массив в памяти
и перезаписывает файл целиком). На хосте **нет node и curl** — проверки состояния делать извне через
`https://ntetris.ddns.net/api/health` и `/api/scores` (`Invoke-RestMethod` в этой сессии падает с
«базовое соединение закрыто», python `urllib` работает). В этот раз удалено 2 строки `ProbeUI`
(44 → 42). За одно окно в прод пришло 5 боевых записей `dvdrelin` с `mode 1` (хардкор) и счётами
`0, 0, 200, 0, 1870` — т.е. хардкор реально играли, и два нуля подряд очень похожи на смерть об стену
на первом же ходе (тот самый DAS-случай).

### Хвост вне блоков: хардкор-краш — стена не убивает, стопка убивает (A13)

**Что измерено.** В проде у `dvdrelin` появились хардкор-сессии со счётом 0, 0 линий, уровень 1 — это удар в
стену на авто-повторе удерживаемой `←`/`→`. Причина не регрессия: правило A2 запрещает боковой ход в
препятствие, а движок получает от ввода один и тот же `MovePiece` и от нажатия, и от DAS/ARR (B2), поэтому
различить «свежее нажатие» и «повтор» внутри движка нельзя.

**Две тупиковые попытки (важно для будущих правок движка).**
1. Промежуточное решение «одна смертельная попытка на ось за фигуру» через флаги `blockedLeftCrash` /
   `blockedRightCrash` (коммит `613b702`): работает, но состояние движка начинает зависеть от истории ввода,
   и первый удар в стену всё равно остаётся смертельным — симптом «пустая доска и смерть без причины» не
   убирается.
2. Чисто геометрический критерий «было ли место за препятствием» (`wouldHaveRoomFor`, пофигурный зонд по
   клеткам: цель хода и клетка за целью) **неприменим**: у первого отказа хода место за препятствием есть по
   определению, поэтому геометрия всегда отвечает «удар», а состояние «фигура уже упёрлась и жива»
   геометрически недостижимо. Два ложных прокси, на которые наступили: bounding-box фигуры (пустая колонка
   внутри коробки делает прижатую фигуру «свободной») и сдвиг всей формы на `2·dx` (двигает и пустые клетки).
   Оба экспериментальных метода из движка удалены.

**Финальное правило (выбор: «стена не убивает, стопка убивает»).** Боковой ход в стоящую фигуру
(locked-клетку) убивает мгновенно и на каждой попытке; боковой ход в боковую стену — безобидный отказ хода,
как в аркаде. Реализация: `hitsPlacedBlock(piece, pos, dx, dy)` — по каждой занятой клетке проверяется цель
хода: выход за поле = стена (не смертельно), locked-клетка внутри поля = стопка (смертельно). Правило
**stateless**: флаги оси из `613b702` из движка удалены, вердикт определяется только геометрией — одинаково
для нажатия, авто-повтора и будущего сетевого хода мультиплеера.

**Оверлей переписан под новое правило:** заголовок `СТОЛКНОВЕНИЕ СО СТОПКОЙ`, строки «Хардкор: ход в фигуру
убивает.» / «В стену — можно: как в аркаде.» (все строки ≤ 34 символа — лимит canvas 240px при 11px
моноширинном). В `types.ts` у `HardcoreWallCrash` помечено: id остаётся историческим `hardcore-wall-crash`,
механика — «стопка».

**Тесты (220 frontend unit / 46 E2E).** `hardcore-death-reasons.test.ts`: стена не убивает ни при каком
количестве нажатий (хардкор и аркада); одиночная locked-клетка в пути = смерть с причиной; стена из
locked-клеток смертельна и на нажатии, и на повторах; фигура, зажатая стеной и блоком одновременно, умирает
(её остановила стопка); мягкое падение на пол не смертельно. `gravity.test.ts`: смерть при ходе в стоящий
блок, безсмертие при упоре в стену. Блок `RepeatController` + настоящий `GameEngine` в `input.test.ts`:
удержание у стены в хардкоре (~28 повторных команд) — жив, причины нет; удержание в блок — смерть, причина
ровно одна, позиция не меняется; аркада — те же удержания безвредны. `tests/e2e/hardcore-reason.test.ts`
(4 теста): 15 дискретных `→` к стене — не смертельно; удержание `→` — не смертельно, причины нет; аркада —
то же; дорожка «уступ» (три фигуры к стене + две левее, каждое нажатие с `await`) — ход в стопку даёт
`hardcore-wall-crash`, Enter очищает причину. **Ловушка E2E:** нажатия без `await` уходят в очередь и могут
обработаться позже следующего hard drop — фигуры падали в центр доски, «уступ» не строился.

**Визуальная проверка на проде (после деплоя).** Одноразовый зонд `tests/e2e/zz-prod-visual.test.ts` (запущен
и удалён, в релиз не попадает): на `ntetris.ddns.net` выбран «Хардкор», удержание `→` 1 секунду — игра
продолжается, призрачная рамка фигуры прижата к правой стене (скрин `tmp-audit/prod-wall-hold.png`); затем
блок-аут 30 жёсткими сбросами в одну колонку — оверлей «НЕТ МЕСТА ДЛЯ ФИГУРЫ» с пояснением (скрин
`tmp-audit/prod-blockout.png`). Хэш обслуживаемого бандла совпал с локальной сборкой (`index-YX0AigD4.js`,
`3b34ed6f…68a0`). Зонд записал одну строку в таблицу: удалена скриптом `tmp-audit/cleanup-visual-probe.sh`
(бэкап `scores.json.bak-before-visual-probe-cleanup`, `docker compose up -d --force-recreate`), итог 46
строк, probe-строк 0. Схема `/api/health`: `{status, version, checks:{db:{ok,writable,count,bytes,mtimeMs},…},
timestamp, uptimeSec}` — поля `ok` верхнего уровня нет, есть `status`.

**Отклонено:** гасить авто-повтор движения на слое ввода (`RepeatController`), если предыдущий ход был
отказан, — защищало бы удержание полностью, но ломало бы семантику B2 (сеанс удержания у стены в аркаде,
смена направления) и требовало бы расширять протокол команд для мультиплеера.

### Итог сессии (цепочка коммитов, всё запушено)

`1d1a231` блок 5 (ghost в движке) → `7468176` + `2f3ee35` блок 6 (UI) → `bb2e066` блок 7 бэкенд
(scoreMax + rate-limit) → `6f5d40f` → `4bf5f0d` хвост (res.ok у отправки счёта) → `b3659bc` (деплой-доки)
→ **задеплоено `1.261101.b3659bc`** → `e547d61` (запись о деплое) → `c5db87c` (warn при отказе чтений)
→ **задеплоено `1.261101.c5db87c`** → `ab9e6fc` (панель ошибки + retry) → **задеплоено `1.261101.ab9e6fc`**
→ `eba1ce9` финальная сверка доков (HEAD). Тесты: 196 FE unit / 49 BE unit / 42 E2E, все зелёные;
`npm run build` exit 0. Прод отстаёт от HEAD ровно на один docs-коммит (`eba1ce9`), артефакт от этого
не отличается. Хвосты после этого: `a895238` (итог сессии), `bd32e8f` (причина смерти в хардкоре),
`1b16d14` (тексты причины влезает в canvas) — **промежуточные шаги и финал A13**: `2f24de0` (доки) → `613b702` (одна смертельная попытка на ось, флаги
оси) + `f8718b3` (доки, A13) → `5bb9a73` (**финал A13**: боковая стена не убивает, смертелен ход в стоящую
фигуру; stateless-геометрия `hitsPlacedBlock`; оверлей «СТОЛКНОВЕНИЕ СО СТОПКОЙ») → `533db91` (фикстуры
wall/stack) — **задеплоено `1.261101.5bb9a73`**, бандл `index-YX0AigD4.js` сверен по sha256 с тем, что
отдаёт домен (`3b34ed6f…68a0`). Тесты: **220 FE unit (12 сюит) / 49 BE unit / 46 E2E**, все зелёные;
`vue-tsc`, `tsc`, `npm run build` — exit 0. Код движка на проде идентичен HEAD; HEAD опережает прод только
тестовыми и документационными коммитами. Таблица рекордов: 46 строк, probe-строк 0.

### Куда дальше

1. Фаза 5 закрыта полностью (блоки 1–7 + деплой). Дальше — **мультиплеер** как отдельная фаза:
   `docs/PHASE3_MULTIPLAYER.md`, `design.game/*`, и там же отдельным решением закрывается D1
   (подпись/сессия результата) — сейчас у `POST /api/score` только потолок и частотное ограничение.
2. Хвосты лидерборда закрыты: `console.error` → warn при деградации GET-чтений **и** UI-состояние
   «данные не загрузились» с retry (см. две секции выше). Больше осознанных «молчаливых» мест в сингле
   нет: и отправка счёта, и чтения лидерборда теперь сообщают о отказе явно.
2b. Хардкор закрыт по A12/A13: причина смерти видна на оверлее, а правило уточнено — боковая стена не
   убивает, смертелен ход в стоящую фигуру (`hitsPlacedBlock`, stateless-геометрия). Открытых продуктовых
   вопросов по хардкору нет; возвращаться к этой теме смысл будет только в мультиплеере: тот же вердикт
   должен приходить из команды, а не из истории нажатий.
3. Бытовое: удалённые команды на сервере запускать через `bash -s` + heredoc (Git Bash), а не
   `-c` из PowerShell — иначе кавычки и `{{.Format}}` у docker ломаются; скрипты в `tmp-audit/`
   нужно сохранять с LF (write-инструмент пишет CRLF).

### Справочно: процедура прод-деплоя (что именно сверяет deploy.sh)
/api/health отдаёт `{status: 'ok', version, checks: {db: {ok, writable, count, bytes, mtimeMs}, …}, timestamp, uptimeSec}` — поля `ok` верхнего уровня нет, версию сверять по `version`.

1. `ssh root@ntetris.ddns.net` (ключ `~/.ssh/id_ed25519`) + наличие на сервере `git rsync docker curl`
   и `docker compose` v2.
2. `git clone --depth 1 https://github.com/dvdrelin/tetris.git /opt/neon-tetris-new` →
   `rsync -a --delete --exclude=.git --exclude=node_modules --exclude=dist --exclude=backend/data
   --exclude=nginx-proxy /opt/neon-tetris-new/ /opt/neon-tetris/` (оба последних исключения
   обязательны: сохраняют `scores.json` и `nginx-proxy/.env` с Let's Encrypt).
3. `APP_VERSION=1.<YYMMDD>.<git short hash>` (из клона, до его удаления) →
   `docker compose build && up -d`.
4. `200` на `/`, `200` на `/api/health` c `version == APP_VERSION`, `200` на `/api/health` **изнутри**
   контейнера, сравнение sha256 отдаваемого бандла с бандлом в образе — всё это делает сам скрипт.
5. Отдельно (не входит в скрипт): `wss://…/ws` встроенным клиентом node, `scoreRateLimit` в health,
   md5/размер `scores.json` до и после.

Бэкенд-часть D1/D2 и хвост фронтенда (`res.ok` + warn) сделаны и закоммичены (`bb2e066` + этот
коммит), тесты зелёные (backend 4 сюиты / 49, frontend 11 / 196, E2E 39). Осталось:

1. **Деплой:** `bash deploy.sh root ntetris.ddns.net 3000`; после него проверить `docker ps`,
   `https://ntetris.ddns.net/api/health` (`version` = `1.<YYMMDD>.<git short hash>` коммита,
   `checks.api.scoreRateLimit` = `{max: 30, windowMs: 60000, …}`), `wss://ntetris.ddns.net/ws`,
   неизменность `/opt/neon-tetris/backend/data/scores.json`. На проде `TRUST_PROXY` по умолчанию
   включён (приложение за nginx-proxy) — если когда-нибудь откроется напрямую, ставить `TRUST_PROXY=0`.
2. После деплоя — `GET /api/score`-данные в прод-лидерборде не должны измениться; при необходимости
   подстроить лимит под живой трафик можно через `SCORE_RATE_LIMIT_MAX` / `SCORE_RATE_LIMIT_WINDOW_MS`
   в контейнере, без правки кода.
3. Дальше по желанию: `console.error` → warn в `leaderboardStore` (деградация GET-чтений) и выход
   на мультиплеер (оба дизайна, `docs/PHASE3_MULTIPLAYER.md`) — отдельное решение.

Напоминание про C5: `engine.stop()` уже не даёт заброшенной партии уходить в лидерборд, так что
rate-limit в блоке 7 закрывает оставшийся риск — частые `POST /api/score` от живой игры, а не
фантомные партии.

Мультиплеер (оба дизайна, `docs/PHASE3_MULTIPLAYER.md`, `design.game/*`) — отдельная тема,
решается на старте MP.
