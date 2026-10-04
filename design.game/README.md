# Neon Tetris — Design Documents

> Папка содержит полный комплект геймдизайнерской документации для real-time мультиплеерного Тетриса (Vue 3 + Express + WebSockets).

---

## Состав документов

| № | Файл | Содержание | Кому читать |
|---|------|-----------|-------------|
| 01 | [01_NEON_TETRIS_GDD.md](./01_NEON_TETRIS_GDD.md) | Основной GDD: PvP-атака, баланс, Seed-синхронизация, лобби, Ready Check, чаты. | Разработчики, UI-дизайнер, геймдизайнер |
| 02 | [02_GAME_CONFIG.json](./02_GAME_CONFIG.json) | Все балансные числа в JSON: атака, комбо, задержки, лиги, randomizer. | Бэкенд-разработчик (грузится как конфиг) |
| 03 | [03_SEQUENCE_DIAGRAMS.md](./03_SEQUENCE_DIAGRAMS.md) | Mermaid-диаграммы: полный цикл матча, раздача фигур, Queue Delay + Counteract, Perfect Clear, Ready Check Timeout. | Разработчики (фронтенд + бэкенд) |
| 04 | [04_SPECTATOR_MODE.md](./04_SPECTATOR_MODE.md) | Режим зрителя: роли, UI (сетка стаканов 2×2, карусель на мобильных), WebSocket-поток, ограничения. | Фронтенд-разработчик, UI-дизайнер |
| 05 | [05_RATING_ELO_SYSTEM.md](./05_RATING_ELO_SYSTEM.md) | Система рейтинга: MMR/Glicko-2, EXP и уровни, подбор игроков (matchmaking), таблица рангов, хранение. | Бэкенд-разработчик, аналитик |

---

## Как использовать

1. **Начинать с [01_NEON_TETRIS_GDD.md](./01_NEON_TETRIS_GDD.md)** — общая картина.
2. **[02_GAME_CONFIG.json](./02_GAME_CONFIG.json)** — скопировать на сервер как `game-config.json` (подгружается при старте без пересборки).
3. **[03_SEQUENCE_DIAGRAMS.md](./03_SEQUENCE_DIAGRAMS.md)** — открыть в VS Code (расширение Mermaid) или на [mermaid.live](https://mermaid.live) для визуализации потоков.
4. **[04_SPECTATOR_MODE.md](./04_SPECTATOR_MODE.md)** и **[05_RATING_ELO_SYSTEM.md](./05_RATING_ELO_SYSTEM.md)** — читать параллельно с основным GDD при реализации соответствующих модулей.

---

*Генерация: 2026-04*