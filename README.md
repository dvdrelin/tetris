# 🎮 Neon Tetris

Красочный, яркий аркадный Тетрис с неоновой стилистикой на Vue 3 + Express.

## ✨ Особенности

- **Неоновая графика** — светящиеся блоки, частицы, анимированный фон
- **2 режима** — Аркадный (авто-дроп, комбо) и Хардкор
- **7-Bag randomizer** — честное распределение фигур
- **Ghost piece** — предсказание места падения
- **Комбо-система** — множитель за последовательные очистки
- **Таблица рекордов** — сохранение лучших результатов на сервере
- **Touch-управление** — свайпы на мобильных

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

### SSH-деплой (старый метод)

```bash
bash deploy.sh root 192.168.1.100 3000
```

## 📁 Структура проекта

```
tetris/
├── frontend/src/          # Vue 3 + Pinia + TypeScript
│   ├── components/        # GameBoard, MenuView, GameView, LeaderboardView
│   ├── engine/            # renderer.ts, piecePreview.ts
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
└── docs/                  # Документация
```

## 📚 Документация

| Документ | Описание | Статус |
|----------|----------|--------|
| [PLAN.md](docs/PLAN.md) | **Главный план** — 4 фазы: баг-фиксы, архитектура, мультиплеер, Docker+HTTPS | v1.5 |
| [PHASE1_FIXES.md](docs/PHASE1_FIXES.md) | **Фаза 1: Исправление багов** — Game Over, score, menu, leaderboard | ✅ Завершено |
| [PHASE2_ARCHITECTURE.md](docs/PHASE2_ARCHITECTURE.md) | **Фаза 2: Архитектура + Тесты** — SRP, 74 теста, render loop fix | ✅ Завершено |
| [PHASE3_MULTIPLAYER.md](docs/PHASE3_MULTIPLAYER.md) | **Фаза 3: Мультиплеер** — Lobby, Chat, PvP через WebSocket | ⬜ Не начато |
| [architecture.md](docs/architecture.md) | **Архитектура** — детальное описание слоёв, потоков данных, решений | актуально |
| [SESSION_CONTEXT.md](docs/SESSION_CONTEXT.md) | **Контекст сессии** — полное состояние проекта | актуально |

## 🧪 Тестирование

```bash
npm run test            # Jest (frontend + backend)
npm run test:e2e        # Playwright E2E
```

**Результаты:**
- Frontend unit: **51 тест** (engine, board, pieces, renderer)
- Backend unit: **9 тестов** (scoreService)
- E2E: **14 тестов** (game flow, keyboard controls, pause/resume, leaderboard)

## 🏗 Архитектура

- **CQRS** — Commands (Start, Move, Rotate, Drop) / Queries (GetState)
- **OOP** — GameEngine, BoardManager, PieceFactory
- **SOLID** — каждая ответственность в отдельном классе
- **Pinia** — state management (gameStore, leaderboardStore)
- **Express + WebSocket** — backend API и real-time sync
