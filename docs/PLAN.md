# Neon Tetris — Главный план обновлений

**Версия:** v1.5
**Дата:** 2025-09-13

## Статус

| Фаза | Статус |
|------|--------|
| Фаза 1: Исправление багов | ✅ Завершено |
| Фаза 2: Архитектурное ревью + Тесты | ✅ Завершено (74 теста, все прошли) |
| Фаза 3: Мультиплеер | ⬜ Не начато (решается на старте MP) |
| Фаза 4: Docker + HTTPS деплой | ✅ Завершено |
| Фаза 5: Сингл — полностью (блоки 1–7) | ✅ Завершена (деплой `1.261101.b3659bc` на ntetris.ddns.net) |

> **Поправка аудита (рабочее состояние после блока 7; база `2f3ee35`).** Цифры фазы 2 исторические: актуально
> 196 frontend unit (11 сюит) + 49 backend unit (4 сюиты: `scoreService`, `gameRouter`, `health`, `rateLimit`) + 42 E2E
> (`docs/AUDIT_REPORT.md` §11, §12.1; проверка блока 3 — `docs/SINGLE_PLAYER_DECISIONS.md`). Фазы 1–2 **не** включали
> починку вращения боевого фронтенда: «финальная» система вращения из
> `docs/ROTATION_SYSTEM_REFERENCE.md` была закоммичена только в legacy `app.js` (`04be72a`), тогда как
> Vue-движок получил регрессию матриц в `9d43990` — именно она давала «некорректное вращение фигур».
> Починка (P0), тесты (P1) и правки docs/build/deploy (P2/P3) оформлены отдельно: `docs/AUDIT_REPORT.md` §9–§11.

---

## Фаза 1: Исправление багов — ✅ Завершено

1. **Game Over score bug** — после Game Over клавиши накапливают очки → исправлено
2. **Save scores** — console.log вместо отправки на сервер → исправлено
3. **Menu exit** — нет кнопки/горячего выхода в меню → исправлено
4. **Leaderboard** — нет экрана просмотра рекордов → реализовано

→ [Детали](PHASE1_FIXES.md)

---

## Фаза 2: Архитектурное ревью + Тесты — ✅ Завершено

1. **SRP** — split gameStore.ts, вынести рендер в renderer.ts → выполнено
2. **Тесты** — 74 теста (51 frontend + 9 backend + 14 E2E) → все проходят
3. **Render loop** — бесконечная рекурсия из-за именного конфликта → исправлено
4. **Console error interception** — E2E теперь ловят window.onerror → реализовано

→ [Детали](PHASE2_ARCHITECTURE.md)

---

## Фаза 3: Мультиплеер — ⬜ Не начато

1. **Лобби** — список игроков, выбор, авто-подбор, ready
2. **Чат** — до начала PvP, 10 сообщений
3. **PvP** — два экрана, побеждает тот, чей противник закончил первым

→ [Детали](PHASE3_MULTIPLAYER.md)

---

## Фаза 4: Docker + HTTPS деплой — ✅ Завершено

1. **Dockerfile** — multi-stage сборка из monorepo
2. **docker-compose.yml** — Neon Tetris сервис с VIRTUAL_HOST
3. **nginx-proxy** — отдельный compose с acme-companion для HTTPS
4. **Let's Encrypt** — сертификат для ntetris.ddns.net активен
5. **HTTP → HTTPS** — редирект настроен

→ [Детали](#деплой-nginx-proxy-lets-encrypt)

---

## Фаза 5: Сингл — полностью — ✅ Завершена

Рамки заданы пользователем: «оставь MP за скобками. сейчас надо решить с синглом — полностью.
MP (старый и новый дизайн) — отдельная тема, будет решаться на старте MP». Решение-лист и
принятые решения — `docs/SINGLE_PLAYER_DECISIONS.md`; что закрыто из аудита — `docs/AUDIT_REPORT.md` §12.8–12.9.

| Блок | Содержание | Статус |
|---|---|---|
| 1 | Типы и расчистка: типизированный `handleCommand`, `hasCollision = !isValidPosition`, удаление мёртвых типов/кода, карта клавиш вращения, тесты через `CommandType` | ✅ готово |
| 2 | Тайминг и гравитация: `dropInterval(level, mode)` в конфиге, движок копит время (`Tick` + `dt`), автопадение в обоих режимах | ✅ готово |
| 3 | Механика: lock delay 500 мс + 15 сбросов, hold, поворот 180°, очередь из 3 фигур (прозрачность по удалённости) | ✅ готово |
| 4 | Управление: DAS 167 мс / ARR 33 мс, `keyup`, игнор `e.repeat`, тач-контролы для мобильных | ✅ готово |
| 5 | Ghost в движке: `GameEngine.getGhostY()` — единственный источник | ✅ готово |
| 6 | UI: кнопка паузы по `isPaused`, общие подсказки клавиш, имя игрока + `localStorage`, `engine.stop()` при выходе, один `init()` | ✅ готово |
| 7 | Бэкенд: `scoreMax` → 10 000 000, rate-limit на `POST /api/score` (429) + деплой | ✅ (`bb2e066` + `4bf5f0d`, деплой `1.261101.b3659bc`) |
| — | Хвост вне блоков: деградация GET-чтений лидерборда (`!res.ok` → warn) + E2E | ✅ |
| — | Хвост вне блоков: UI-состояние «данные не загрузились» + retry в лидерборде | ✅ |

Каждый блок = отдельный коммит + `git push origin main`, документация обновляется в том же коммите.

---

### Деплой блока 7 (проверено 2026-11-01)

Команда: `bash deploy.sh root ntetris.ddns.net 3000` (на Windows — Git Bash:
`& 'C:\Program Files\Git\bin\bash.exe' /c/GIT/tetris/deploy.sh root ntetris.ddns.net 3000`).
Сервер: клон → rsync (исключения `backend/data` и `nginx-proxy` отработали) →
`docker compose build && up -d` → `200` на `/` → `version` в `/api/health` = `APP_VERSION` =
**`1.261101.b3659bc`** (совпал с HEAD) → хэш бандла `assets/index-lAConWCo.js` (sha256 `03aafb73…`)
«отдаётся == в образе». Было `1.261004.4344f3d`.

Что проверено на проде после деплоя:

| Проверка | Результат |
|---|---|
| `checks.api.scoreRateLimit` | `{"max":30,"windowMs":60000,"trackedKeys":0}` |
| 40 `POST /api/score` подряд | ровно `30 × 200`, первый `429` — **на 31-м** запросе, `x-ratelimit-limit: 30`, `remaining: 29 → 1`, `retry-after: 59`, тело `{"error":"too many score submissions","retryAfter":59}` |
| Чтения при исчерпанном окне | `/api/scores`, `/api/leaderboard`, `/api/health` → `200` (точечность лимита подтверждена на проде) |
| `wss://ntetris.ddns.net/ws` | handshake **open** (встроенным в node 22 WebSocket-клиентом; `ws://127.0.0.1:3000/ws` внутри контейнера — тоже open). `GET /ws` без upgrade → SPA-HTML (200, `text/html`) — ожидаемо, upgrade-контур отдельный |
| `scores.json` | до пробы 36 записей (md5 `a483e58a…`), после пробы 66 (**+30 строк `DeployProbe`**), после чистки снова **36**, файл ровно `7543` байта; резервная копия `backend/data/scores.json.bak-before-probe-cleanup` (13 813 байт) на сервере |
| nginx | `nginx-proxy` и `nginx-proxy-letsencrypt` — `Up 7 weeks`, деплой их не трогал |

Бытовые заметки для следующих прогонов: `require('ws')` из `/app` в контейнере не резолвится
(зависимости в `backend/node_modules`), а node 22 уже умеет встроенный `WebSocket`-клиент;
`docker ps --format "…"` через `ssh` из PowerShell требует запуска удалённой команды через
`bash -s` (heredoc), иначе кавычки/фигурные скобки ломаются.

---

## Критерии успеха

### Фаза 1 — ✅ Выполнены
- ✅ Game Over: клавиши не вызывают действие
- ✅ Enter перезапускает игру
- ✅ Кнопка «В меню» + Escape
- ✅ Score отправляется на сервер
- ✅ Leaderboard отображает данные

### Фаза 2 — ✅ Выполнены
- ✅ `npm run build` без ошибок
- ✅ Unit-тесты: 74 теста проходят
- ✅ E2E тесты: 14 тестов проходят
- ✅ Console error interception работает

### Фаза 3
- [ ] Лобби показывает онлайн
- [ ] Выбор противника
- [ ] Чат работает
- [ ] PvP с двумя экранами
- [ ] Победа: противник закончил первым

### Фаза 5 — ✅ Выполнены
- ✅ Одиночная партия доигрывается до конца на легальной скорости: автопадение в обоих режимах,
  аккумулятор времени не теряет dt при просадке кадра
- ✅ Механика: lock delay + 15 сбросов, hold, поворот 180°, очередь из 3 фигур
- ✅ Единый ввод: DAS/ARR, `keyup`, отсечение `e.repeat`, тач-контролы; у клавиш и кнопок один путь
- ✅ «Призрачная» фигура считается один раз в движке и совпадает с местом hard drop
- ✅ Один контрол паузы, один `init()`, подсказки клавиш в меню и HUD не расходятся с картой
- ✅ Имя игрока вводится и переживает перезагрузку, упираясь в потолок бэкенда (32)
- ✅ Заброшенная партия не попадает в лидерборд, завершённая отправляет ровно один счёт
- ✅ Бэкенд: потолок `10 000 000` + частотное ограничение (`429` + `Retry-After`), чтения лимитом
  не задеваются
- ✅ Ни один отказ сети не прячется: и отправка счёта, и чтения лидерборда сообщают явно
  (`console.warn`; в лидерборде — ещё и панель с причиной и retry)
- ✅ Задеплоено: `version` в health = HEAD, sha256 бандла «отдаётся == в образе», `scores.json` цел

### Фаза 4 — ✅ Выполнены
- ✅ Docker image собран и запушен на сервер
- ✅ nginx-proxy + acme-companion запущены
- ✅ HTTPS сертификат Let's Encrypt получен
- ✅ HTTP → HTTPS редирект работает
- ✅ Проект доступен по https://ntetris.ddns.net

---

## Деплой: Nginx Proxy + Let's Encrypt

### Действующая инфраструктура (не удалять)

Это живой прод-деплой проекта: **хостинг — hshp**, **DNS — No-IP** (динамический, зона `ddns.net`),
**TLS — Let's Encrypt** через `acme-companion`, домен `ntetris.ddns.net`. Фаза 4 считается завершённой
именно потому, что этот контур работает; удалённым был только внешний API-хост (коммит `9db00a3`),
а не домен и не хостинг.

### Структура
```
/opt/neon-tetris/
├── docker-compose.yml    # Neon Tetris сервис
├── Dockerfile            # Multi-stage сборка
├── nginx-proxy/
│   ├── docker-compose.yml # Nginx-proxy + acme-companion
│   └── README.md
└── start.sh              # Скрипт быстрого запуска
```

### Деплой из репозитория (проверено 2026-10-04)

```bash
git clone --depth 1 https://github.com/dvdrelin/tetris.git /opt/neon-tetris-new
rsync -a --delete --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=backend/data --exclude=nginx-proxy \
  /opt/neon-tetris-new/ /opt/neon-tetris/
APP_VERSION="1.$(date -u +%y%m%d).$(git -C /opt/neon-tetris-new rev-parse --short HEAD)"
rm -rf /opt/neon-tetris-new
cd /opt/neon-tetris && APP_VERSION=$APP_VERSION docker compose build && docker compose up -d
```

`deploy.sh` работает в тот же Docker-контур, который обслуживает домен: клонирует репозиторий на сервер,
синхронизирует его `rsync`-ом с теми же исключениями, вычисляет `APP_VERSION` в формате
`1.<YYMMDD>.<git short hash>` (например `1.261004.317de99`), передаёт её build-аргом в
`docker compose build && docker compose up -d` и проверяет ответ `https://<HOST>/`,
`GET https://<HOST>/api/health` (снаружи и изнутри контейнера), совпадение `version` из health
с вычисленной `APP_VERSION`, JSON-запрос к API и совпадение SHA-256 бандла «отдаётся через nginx»
против «лежит в контейнере».
PM2 в скрипте больше нет — PM2-контур удалён с сервера (см. `docs/SESSION_CONTEXT.md`, раздел «Один контур на сервере»).

### Что проверять после деплоя

| Проверка | Ожидаемый результат |
|---|---|
| `docker ps` | `neon-tetris`, `nginx-proxy`, `nginx-proxy-letsencrypt` — все `Up` |
| `curl -s -o /dev/null -w '%{http_code}' https://ntetris.ddns.net/` | `200` |
| `curl -s https://ntetris.ddns.net/api/health` | `200` + JSON `"status":"ok"` и `checks.db/static/websocket/runtime/api` со `"ok":true` (при проблеме — `503` + `"status":"degraded"`, тоже JSON) |
| `"version"` в ответе `/api/health` | `1.<YYMMDD>.<git short hash>` деплояемого коммита (например `1.261004.317de99`); `1.0.0` означает, что образ собран без build-арга `APP_VERSION` |
| `curl -s https://ntetris.ddns.net \| grep -o 'assets/[^"]*'` | хэши бандла, собранные этим деплоем |
| `curl -s https://ntetris.ddns.net/api/scores` | JSON сохранённых рекордов (`/opt/neon-tetris/backend/data/scores.json` деплоем не перезаписывается) |
| `wss://ntetris.ddns.net/ws` | успешный WebSocket handshake |
| `ss -ltnp \| grep ':3000'` на хосте | пусто: контейнер не публикует 3000 наружу, `http://ntetris.ddns.net:3000` недоступен |

### Управление на сервере
```bash
# Подключиться к серверу
ssh root@ntetris.ddns.net

# Перейти в директорию
cd /opt/neon-tetris

# Запустить всё
docker compose up -d

# Остановить всё
docker compose down

# Пересобрать и запустить
docker compose build && docker compose up -d

# Логи
docker logs nginx-proxy
docker logs nginx-proxy-letsencrypt
docker logs neon-tetris
```

### Локальный запуск (с nginx-proxy)
```bash
# Запустить nginx-proxy
cd nginx-proxy && docker compose up -d

# Запустить Neon Tetris
cd .. && docker compose up -d
```

### Доступ
- 🔒 HTTPS: https://ntetris.ddns.net
- 🔀 HTTP → HTTPS: http://ntetris.ddns.net → https://ntetris.ddns.net
- 🩺 Здоровье сервиса: https://ntetris.ddns.net/api/health (JSON: db, статика, websocket, runtime)
