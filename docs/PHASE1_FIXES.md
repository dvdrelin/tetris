# Фаза 1: Исправление багов

**Версия:** v1.1
**Статус:** ✅ Завершено
**Дата:** 2025-09-08

---

## To-Do List

| # | Задача | Статус |
|---|--------|--------|
| 1.1 | Fix: очки после Game Over | ✅ |
| 1.2 | Fix: сохранение результатов | ✅ |
| 1.3 | Fix: выход в меню | ✅ |
| 1.4 | Fix: экран рекордов | ✅ |

---

## 1.1. Fix: очки после Game Over

**Файл:** `frontend/src/stores/gameStore.ts`, `handleKey()`

**Проблема:** `isRunning()` возвращает `true` после Game Over (не сбрасывается), switch обрабатывает клавиши → очки.

**Решение:** Добавить guard:
```ts
if (engineInstance.isGameOver()) return;
```
Сразу после проверки `Enter`, до `isRunning()` check.

---

## 1.2. Fix: сохранение результатов

**Файл:** `frontend/src/stores/gameStore.ts`, `onGameOver` callback

**Проблема:** `console.log('Game Over! Score:', score)` — не отправляет на сервер.

**Решение:** Заменить на fetch POST `/api/score` с параметрами: playerName, score, mode, level, linesCleared.

---

## 1.3. Fix: выход в меню

**Файлы:** `GameView.vue`, `MenuView.vue`, `App.vue`

**Решение:**
- Добавить кнопку «Меню» в `GameView.vue` с фиксированным позиционированием
- Добавить Escape в `GameView.vue` для выхода в меню (если не пауза)
- Добавить кнопку «Рекорды» в `MenuView.vue`
- Emit 'menu' на App.vue

---

## 1.4. Fix: экран рекордов

**Новые файлы:**
- `frontend/src/stores/leaderboardStore.ts` — Pinia store для загрузки рекордов
- `frontend/src/components/LeaderboardView.vue` — таблица рекордов с фильтрами

**Модификации:**
- `App.vue` — добавить LeaderboardView, переключение по `L` или через меню
- `gameStore.ts` — `playerName` ref для сохранения имени

**API:**
- GET `/api/scores?mode=N&limit=10`
- GET `/api/leaderboard?mode=N`

---

## Changes Log

| Версия | Дата | Изменения |
|--------|------|-----------|
| v1.0 | 2025 | Начальная версия плана |
| v1.1 | 2025 | Все баг-фиксы реализованы, тесты проходят |
