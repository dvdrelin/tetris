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

## 🚀 Запуск

```bash
npm install
npm run dev          # Frontend (:3001) + Backend (:3000)
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
├── tests/                 # E2E тесты (Playwright)
├── frontend/tests/        # Unit тесты (Jest)
├── backend/tests/         # Unit тесты (Jest)
└── docs/                  # Документация
```

## 📚 Документация

| Документ | Описание | Статус |
|----------|----------|--------|
| [PLAN.md](docs/PLAN.md) | **Главный план обновлений** — три фазы: баг-фиксы, архитектура, мультиплеер. Критерии успеха для каждой фазы. | v1.4 |
| [PHASE1_FIXES.md](docs/PHASE1_FIXES.md) | **Фаза 1: Исправление багов** — Game Over score bug, сохранение результатов, выход в меню, экран рекордов. Все 4 задачи выполнены. | ✅ Завершено |
| [PHASE2_ARCHITECTURE.md](docs/PHASE2_ARCHITECTURE.md) | **Фаза 2: Архитектурное ревью + Тесты** — SRP рефакторинг, 74 unit/E2E теста, исправление render loop (бесконечная рекурсия), console error interception. | ✅ Завершено |
| [PHASE3_MULTIPLAYER.md](docs/PHASE3_MULTIPLAYER.md) | **Фаза 3: Мультиплеер** — Lobby, Chat, PvP через WebSocket. Архитектура, WebSocket протокол, PvP flow. | ⬜ Не начато |
| [SESSION_CONTEXT.md](docs/SESSION_CONTEXT.md) | **Контекст сессии** — полное состояние проекта, рабочие окружения, известные файлы, план Phase 3. | актуально |

## 🧪 Тестирование

```bash
npm run test            # Jest (frontend + backend)
npm run test:e2e        # Playwright E2E
```

**Результаты:**
- Frontend unit: **51 тест** (engine, board, pieces, renderer)
- Backend unit: **9 тестов** (scoreService)
- E2E: **14 тестов** (game flow, keyboard controls, pause/resume, leaderboard)

## 🐳 Деплой

### Docker

```bash
# Собрать образ
docker build -t neon-tetris .

# Запустить
docker run -p 3000:3000 neon-tetris
```

### SSH-деплой (автоматизированный)

```bash
# Запуск скрипта деплоя
echo "ssh-keygen -t ed25520"   # если ключа нет
bash deploy.sh root 192.168.1.100 3000
```

Скрипт:
1. Подключается к серверу по SSH
2. Устанавливает Node.js 20 и PM2
3. Копирует все исходники
4. Устанавливает зависимости и собирает проект
5. Запускает приложение через PM2

Смотрите [deploy.sh](deploy.sh) для подробностей.

## 🏗 Архитектура

- **CQRS** — Commands (Start, Move, Rotate, Drop) / Queries (GetState)
- **OOP** — GameEngine, BoardManager, PieceFactory
- **SOLID** — каждая ответственность в отдельном классе
- **Pinia** — state management (gameStore, leaderboardStore)
- **Express + WebSocket** — backend API и real-time sync
