# Фаза 3: Мультиплеер

**Версия:** v1.1
**Статус:** 🟨 Идёт (блок A — 2026-11-02, блок B (сервер комнат) — 2026-11-02, блок C (MP-фронтенд) — 2026-11-02)
**Дата:** 2025-09-08 (v1.0) → 2026-11-02 (v1.1)

> **v1.1-уточнение:** реализация идёт по `docs/MP_RECON.md` (решения §6) и `design.game/*`.
> Канонический WS-протокол — типы `shared/src/net/protocol.ts` (GDD §2.3 + lifecycle комнат);
> семивариантный скетч ниже устарел. Комнаты MVP — по коду, без REST-эндпоинтов (п. 3.10
> закрывается WS-протоколом).

---

## To-Do List

| # | Задача | Статус |
|---|--------|--------|
| 3.1 | new: lobbyStore.ts | ⬜ |
| 3.2 | new: LobbyView.vue | ⬜ |
| 3.3 | new: chatStore.ts | ⬜ |
| 3.4 | new: ChatView.vue | ⬜ |
| 3.5 | new: multiplayerStore.ts | ⬜ |
| 3.6 | new: MultiplayerGameView.vue | ⬜ |
| 3.7 | backend: room logic | ⬜ |
| 3.8 | backend: action broadcasting | ⬜ |
| 3.9 | backend: chat messages | ⬜ |
| 3.10 | backend: room endpoints | ⬜ |
| 3.11 | App.vue — интеграция | ⬜ |

---

## Архитектура

```
frontend/src/stores/
  lobbyStore.ts        — управление лобби, списком игроков
  chatStore.ts         — чат до начала PvP
  multiplayerStore.ts  — WebSocket подключение, синхронизация

frontend/src/components/
  LobbyView.vue        — лобби
  ChatView.vue         — чат
  MultiplayerGameView.vue — PvP-игра

backend/src/servers/
  roomServer.ts        — комнаты, lifecycle, broadcasting, chat (пришёл на смену gameServer.ts)
backend/src/routes/
  gameRouter.ts        — room endpoints
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
