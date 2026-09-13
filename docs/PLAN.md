# Neon Tetris — Главный план обновлений

**Версия:** v1.5
**Дата:** 2025-09-13

## Статус

| Фаза | Статус |
|------|--------|
| Фаза 1: Исправление багов | ✅ Завершено |
| Фаза 2: Архитектурное ревью + Тесты | ✅ Завершено (74 теста, все прошли) |
| Фаза 3: Мультиплеер | ⬜ Не начато |
| Фаза 4: Docker + HTTPS деплой | ✅ Завершено |

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

### Фаза 4 — ✅ Выполнены
- ✅ Docker image собран и запушен на сервер
- ✅ nginx-proxy + acme-companion запущены
- ✅ HTTPS сертификат Let's Encrypt получен
- ✅ HTTP → HTTPS редирект работает
- ✅ Проект доступен по https://ntetris.ddns.net

---

## Деплой: Nginx Proxy + Let's Encrypt

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
