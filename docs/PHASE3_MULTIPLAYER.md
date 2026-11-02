# Фаза 3: Мультиплеер

**Версия:** v1.1
**Статус:** 🟨 Идёт (блок A — 2026-11-02, блок B (сервер комнат) — 2026-11-02, блок C (MP-фронтенд) — 2026-11-02, блок D (реплей+garbage+анти-чит) — 2026-11-02)
**Дата:** 2025-09-08 (v1.0) → 2026-11-02 (v1.1)

> **v1.1-уточнение:** реализация идёт по `docs/MP_RECON.md` (решения §6) и `design.game/*`.
> Канонический WS-протокол — типы `shared/src/net/protocol.ts` (GDD §2.3 + lifecycle комнат);
> семивариантный скетч ниже устарел. Комнаты MVP — по коду, без REST-эндпоинтов (п. 3.10
> закрывается WS-протоколом).

---

## To-Do List

| # | Задача | Статус |
|---|--------|--------|
| 3.1 | new: lobbyStore.ts | 🟰 заменено: комната живёт в `multiplayerStore` (нет отдельного лобби-стора) |
| 3.2 | new: LobbyView.vue | 🟰 заменено: `RoomView.vue` (лобби комнаты + чат) |
| 3.3 | new: chatStore.ts | 🟰 заменено: чат в `multiplayerStore` (cooldown на сервере) |
| 3.4 | new: ChatView.vue | 🟰 заменено: чат внутри `RoomView` |
| 3.5 | new: multiplayerStore.ts | ✅ (блок C+D: WS, реконнект, rejoin, матч-движок, garbage, буфер локов) |
| 3.6 | new: MultiplayerGameView.vue | ✅ (блок C: свой canvas + DOM-тень соперника из релеев) |
| 3.7 | backend: room logic | ✅ (блок B: коды, lifecycle, grace/rejoin, forfeits) |
| 3.8 | backend: action broadcasting | ✅ (C: релей `piece_locked`; D: верификация реплеем + `garbage_arrive`) |
| 3.9 | backend: chat messages | ✅ (блок B, cooldown+лимиты) |
| 3.10 | backend: room endpoints | ❌ по дизайну: REST-комнат нет, всё через WS (`MP_RECON.md` §7) |
| 3.11 | App.vue — интеграция | ✅ (вьюхи room/mp-game) |

---

## Архитектура

```
frontend/src/stores/
  multiplayerStore.ts  — WebSocket-клиент: комната, матч, чат, garbage, реконнект/rejoin

frontend/src/components/
  RoomView.vue         — лобби комнаты (код, игроки, ready, чат)
  MultiplayerGameView.vue — PvP-игра (canvas + тень соперника)

backend/src/servers/
  roomServer.ts        — комнаты, lifecycle, broadcasting, chat (пришёл на смену gameServer.ts)
backend/src/services/
  matchState.ts        — серверный реплей партии: верификация piece_lock + боевая очередь
backend/src/config/
  mpConfig.ts          — env-тюнимые параметры комнат/лимитов
  mpBalance.ts         — боевая таблица (зеркало design.game/02_GAME_CONFIG.json)
```

---

## WebSocket Protocol

```ts
interface WSMessage {
  type: 'join' | 'action' | 'state' | 'gameOver' | 'chat' | 'ready' | 'start'
  payload: {
    playerId?: string
    action?: string
    state?: GameState
    message?: string
    text?: string
  }
}
```

---

## PvP Flow

1. Игроки в лобби → выбирают друг друга → ready
2. Чат (10 сообщений или команда «Старт»)
3. Игра: оба видят оба board'а
4. `gameOver` → сервер определяет победителя

---

## Changes Log

| Версия | Дата | Изменения |
|--------|------|-----------|
| v1.0 | 2025 | Начальная версия плана |
| v1.1 | 2026-11-02 | Статус: блоки A/B сделаны; протокол перенесён в `shared/src/net/protocol.ts`; REST-комнат нет — WS |
| v1.2 | 2026-11-02 | Блок D: `matchState.ts` (реплей+верификация+garbage-очередь), `mpBalance.ts`, `garbage_arrive`, time-limit, сертифицированные `MatchResult.lines`; зачёркнуты пункты 3.5–3.9/3.11, 3.10 закрыт как «нет по дизайну» |
