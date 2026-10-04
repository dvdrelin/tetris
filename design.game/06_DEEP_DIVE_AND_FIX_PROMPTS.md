# Deep-Dive Review & Treatment Prompts — Neon Tetris

> Содержит глубокий анализ корневых причин каждой проблемы из ревью и
> **готовые промпты для AI-агента**, которые можно скормить в кодер/редактор,
> чтобы автоматически исправить GDD, конфиг и архитектурные решения.

---

## Содержание

| # | Проблема | Тип | Приоритет |
|---|----------|-----|:---------:|
| [P1](#p1) | Ceil + Single = Double-equivalent в комбо | Баланс атаки | 🔴 Critical |
| [P2](#p2) | Counteract double-jeopardy | Механика защиты | 🔴 Critical |
| [P3](#p3) | Reconnection protocol — отсутствует | Инфраструктура | 🔴 Critical |
| [P4](#p4) | Queue Delay 400 ms ниже реактивного порога | Тайминги | 🟡 High |
| [P5](#p5) | FFA S-value: 3rd = 4th = 0.0 | Рейтинг | 🟡 High |
| [P6](#p6) | Everyone mode — экспоненциальный мусор | Баланс режима | 🟡 High |
| [P7](#p7) | BO4: 4 wins → матч до 12 мин | Темп игры | 🟢 Medium |
| [P8](#p8) | MMR начальный 1500 — Bronze невидим | Ранги | 🟢 Medium |
| [P9](#p9) | Replay / Anti-spam / Schema / Colorblind | Качество жизни | 🟢 Medium |

---

## P1. Округление Ceil + Single = Double-equivalent в комбо

### 🔬 Анализ корневой причины

**Формула сейчас:**
```
GarbageSent = ceil(BaseLines × ComboMultiplier)
База: Single = 1, Double = 2
```

**Матожидание потерь мусора при комбо-2:**

| Действие | Расчёт | Результат | Эффективный множитель |
|----------|--------|:--------:|:---------------------:|
| 2×Single | ceil(1×1.25)=ceil(1.25)=**2** | **2.0** garbage | **×2.0** (должен быть ×1.25) |
| 1×Single | ceil(1×1.0)=1 | 1 garbage | ×1.0 |
| 1×Double | ceil(2×1.0)=2 | 2 garbage | ×1.0 |
| 2×Double | ceil(2×1.25)=ceil(2.5)=**3** | **3** garbage | ×1.5 |
| 2×Tetris | ceil(7×1.25)=ceil(8.75)=**9** | **9** garbage | ×1.285 |

**Вывод:**
- **2×Single = 1×Double** (оба = 2 garbage) — стимул делать Double убит.
- ceil искажает малые числа сильнее всего. На Single это превращает ×1.25 в ×2.0 — **реальный множитель на 60% выше заявленного**.
- Игрок, спамящий Single, получает ту же атаку, что и игрок, делающий Double — за меньшее усилие.

### 💥 Импакт на геймплей

1. **Мета "Single spam"**: выгоднее делать много Single (легко, безопасно), чем ждать Tetris (рискованно). Это ломает пирамиду риска-награды — основа любой good game design.
2. **Double бессмыслен** в комбо-режиме: 2×Single = 2 garbage, 1×Double = 2 garbage — зачем riskовать?
3. **Triple (4) vs 4×Single (ceil(4×1.0)=4)**: 1 Triple = 4 garbage, 4 Single тоже = 4 garbage — Triple тоже обесценен при комбо.

### 🛠️ Исправление

**Вариант A (рекомендуемый) — изменить округление и базу:**
- Single → база **0** garbage lines (чисто очки, никакой атаки).
- Single в классическом Tetris и так не награда — это минимальное действие.
- Комбо-счётчик для Single: не увеличивает множитель (Single не считается "атакой").
- Double+ остаются как есть, но rounding → `floor + 1` (т.е. всегда хотя бы 1).

**Вариант B — поставить Single множитель отдельно:**
- Single base = 1, но *игнорирует* комбо-множитель (всегда ×1.0).
- Комбо-множитель растёт только от Double+.

**Вариант C — изменить округление:**
- Для Single: `floor` вместо `ceil`.
- Для Double+: `ceil` (оставить).
- 2×Single = floor(1×1.25)=1.25→**1** garbage. Тогда 2×Single=1 < 1×Double=2 — разница восстановлена.

**Итоговый фикс по варианту A (мой выбор):**

```
base_lines.single      = 0     // не генерирует мусор
base_lines.double      = 2
base_lines.triple      = 4
base_lines.tetris      = 7
base_lines.perfect_clear = 10

combo_multiplier: { 1:1.0, 2:1.25, 3:1.5, 4+:2.0 }
combo_eligible: ["double","triple","tetris","perfect_clear"]  // Single исключён
rounding: "ceil_floor"  // ceil для всего, кроме single (там floor, но single=0 не даст мусора)
```

---

## P2. Counteract double-jeopardy (защита ускоряет смерть)

### 🔬 Анализ корневой причины

**Текущее правило:**
> Цель сжигает 1 линию → нейтрализует 1 мусорную линию из буфера.

Проблема: **сжигание линии поднимает стакан цели вверх**, И она уже получает мусор снизу (который поднимает стакан ещё больше). То есть игрок зажат между двух огней:
1. Снизу давят мусорные линии из буфера.
2. Чтобы их нейтрализовать — надо сжечь свои линии, но для этого надо вращать/двигать фигуры, а стакан уже почти полон.

**Пример с цифрами:**

```
Стакан: высота 20 строк, занято 16 строк (80%).
Buffer: 5 мусорных линий.
```

**Сценарий А — не защищается:** Buffer → +5 строк → стакан 21/20 → **top-out**.
**Сценарий Б — защищается:** Игрок ищет Tetris → находит! → сжигает 4 линии → нейтрализует 4 из 5 мусорных.
  Но: стакан был 16, минус 4 = 12. Потом применение 1 оставшейся мусорной → 13. Выжил!
  
**Сценарий В — защищается, но в стакане нет Tetris:**
  Стакан 16, buffer 5. Игрок сжигает Single (1) → нейтрализует 1. buffer = 4. Стакан был 16 → 15 (после сжигания 1 линии). +4 мусор = 19. Выжил!

**Сценарий Г — реальная проблема:**
  Стакан 18/20, buffer 7. Single → нейтрализует 1 = 6 buffer. Стакан 18→17. +6 = 23. **Top-out.**
  Игрок защищался, но умер быстрее, чем если бы просто принял мусор (18+7=25 vs 17+6=23 — да, 23 < 25, но всё равно top-out).

### 💥 Импакт на геймплей

1. **Counteract — ловушка для новичков**: опытный игрок знает, что иногда *не надо* защищаться (т.к. сжигание = уменьшение стакана, но не всегда спасает). Новичок жмёт защиту инстинктивно и умирает.
2. **Double-jeopardy напрямую**: сжигание даёт очки цели, что кормит её рейтинг. Атакующий получает double reward: его мусор + его цель набирает очки защитой. Это **perverse incentive** не атаковать лидера, потому что это даёт ему очки.

### 🛠️ Исправление

**Фикс A — Particle Break (рекомендуемый):**
> При нейтрализации мусорной линии цель НЕ получает очки (Score) за сожжённую линию.
> Только защита, без счёта.

Почему: убирает perverse incentive. Игрок выбирает между "очки себе" и "защита от мусора".

**Фикс B — Shield Buffer:**
> Нейтрализованные мусорные линии не просто "исчезают", а переводятся в **защитный буфер**.
> Каждая нейтрализованная линия даёт 1 "щит-строку" которая *вычитается* из следующего же входящего мусора, но уже без необходимости сжигать.
> Щит хранится максимум 10 секунд.

То есть: сжёг 3 линии → нейтрализовал 3 мусора + получил 3 shield. Следующая атака в 2 garbage: shield 3 → 2 уходят в щит, атака полностью заблокирована, shield = 1 остаётся.

**Фикс C — Bounce mechanic:**
> Игрок, нейтрализовавший хотя бы 1 мусорную линию, получает **Clean Slate Lite** — 0.5 сек иммунитета ко всем новым garbage.
> Даёт передышку, стимулирует защищаться даже в плохой позиции.

**Итоговый фикс (A+B вместе):**

```
GarbageCounteract:
  nullify_score: false                    // очки за нейтрализованные не начисляются
  shield_grant: true                      // фикс B
  shield_max_lines: 3                     // не больше 3 shield
  shield_duration_ms: 10000
  clean_slate_lite_ms: 500                // фикс C
```

---

## P3. Reconnection protocol — полное отсутствие

### 🔬 Анализ

Клиент-сервер — WebSocket. Природа WebSockets: соединение может прерваться в любой момент (мобильная сеть, переключение WiFi, таймаут бездействия).

**Текущее поведение (по GDD):**
> "Если сервер получает piece_lock с неверным global_step или piece_type, он немедленно отключает клиента."

Это анти-чит механика. Но что происходит при *потере соединения* (не чит, а сеть)? **Ничего не описано.** Клиент просто исчезает.

**Сценарий отказа:**
1. Игрок A делает Tetris (7 мусора летит в B).
2. У B отваливается WiFi на 2 секунды.
3. За эти 2 секунды сервер не получает piece_lock от B.
4. B получает +7 мусора. B переподключается через 3 сек.
5. Сервер: "disconnect", B заморожен. Матч продолжается для остальных.
6. B наказан за обрыв связи, хотя не читерил.

**Проблема:** Для web-игры потери пакетов до 1-2 сек — норма. Отключать игрока = терять пользователей.

### 💥 Импакт

- Игроки с нестабильным интернетом (а это большинство мобильных игроков и регионы с плохим покрытием) не смогут играть competitive.
- Рейтинговая система будет punish за network issues, не за skill.
- Репутация игры: "пинг 200? иди нахуй" — плохо для retention.

### 🛠️ Исправление

**Нужен Reconnection Protocol:**

```
Фаза 1: Grace Period (3-5 сек)
  - Сервер замечает, что от клиента нет сообщений > 1.5 сек.
  - Помечает его как "disconnected" (стакан заморожен, мусор не летит в него).
  - Запускает таймер grace_period_ms (5000).

Фаза 2: Reconnect
  - Клиент переподключается по WebSocket (тот же player_id, room_id).
  - Сервер проверяет: grace_period не истёк? → выполняет sync:
    {
      type: "game_state_sync",
      board: "base64...",           // текущее состояние стакана
      garbage_buffer: [...],        // необработанный мусор (с заморозкой времени)
      score: текущий счёт,
      global_step: текущий шаг,
      seed: тот же seed,
      missed_steps: [4,5,6]        // ходы, которые клиент пропустил
    }
  - Клиент: "догоняет" состояние (пропущенные ходы применяются моментально).
  - Игра продолжается.

Фаза 3: Timeout
  - grace_period истёк → hard disconnect.
  - Игрок считается выбывшим (как top-out).
  - Матч продолжается для остальных.
  - Игрок получает поражение, но рейтинг снижается меньше, чем при top-out? 
    (Зависит от политики: "10% less MMR loss" для network-issue).

Фаза 4: Anti-Abuse
  - Больше 3 реконнектов за матч → больше никаких grace period.
  - reconnect считает время как alive-time (не даёт вечно избегать мусора).
```

**Добавить в GDD:**

```
reconnect:
  grace_period_ms: 5000
  max_reconnects_per_match: 3
  state_sync_enabled: true
  missed_step_catchup: "instant"       // пропущенные ходы применяются мгновенно
  elo_loss_mitigation: 0.9             // 90% от обычного MMR loss при disconnect timeout
```

**Добавить в sequence diagram:**

```
участник: Игрок A, Сервер
A->>S: [connection lost]
S->>S: mark_disconnected(A)
Note over S: grace period 5s timer
A->>S: reconnect(player_id, room_id)
S->>A: game_state_sync { board, garbage_buffer, score, global_step, missed_steps }
A->>S: piece_lock { ... }  // продолжение
```

---

## P4. Queue Delay 400 ms — ниже реактивного порога

### 🔬 Анализ

**Человеческий фактор:**
- Визуальная реакция (увидел индикатор → мозг обработал): ~200-250 мс.
- Моторная реакция (нажал кнопку): ~100-150 мс.
- RTT клиент-сервер (WebSocket, средний ping): ~50-150 мс.
- **Итого от появления индикатора до подтверждения сервером: 350-550 мс.**

| Задержка | Время на реакцию | Результат |
|:--------:|:----------------:|:---------:|
| 400 ms | 400-550 = **-150 мс** | Игрок физически не успевает |
| 700 ms | 700-550 = **150 мс** | Успевает, но впритык |
| 900 ms | 900-550 = **350 мс** | Комфортно |
| 1200 ms | 1200-550 = **650 мс** | Много времени |

**На практике:** Single (400 ms) защитить невозможно при ping > 50. Double (500 ms) — почти невозможно. Все Single-атаки = guaranteed damage.

Это ломает механик counteract: если Single не защитим, зачем показывать индикатор?

### 💥 Импакт

- Single становится "unavoidable chip damage". В PvP это раздражает, а не делает игру глубже.
- Механика "queue delay" теряет смысл для 60% атак (Single + Double = 50%+ от всех действий в матче).

### 🛠️ Исправление

```
queue_delay_ms:
  single:  400 → 700     // +300 мс — теперь защитим
  double:  500 → 700     // унифицировать с single (простота)
  triple:  700 → 800     // +100 мс
  tetris:  900 → 1000    // +100 мс: ровная секунда
  perfect_clear: 1200    // оставить (уже норм)
```

**Альтернатива — реактивный порог на основе RD (Rating Deviation):**
```
queue_delay_ms:
  single: 700 * (1 - clamp(RD/350, 0, 0.3))   
  // для RD=350 (новичок): 700*0.7=490 ms  
  // для RD=100 (стабильный): 700 ms
```

Но это overengineering. Просто поднять до 700.

---

## P5. FFA S-value: 3rd = 4th = 0.0

### 🔬 Анализ

**Текущая формула:**
```
place 1 → S = 1.0
place 2 → S = 0.5
place 3 → S = 0.0
place 4 → S = 0.0
eliminated early → S = 0.0
```

**Проблема:** Игрок, который выбыл на 5-й секунде (misdrop) и игрок, который продержался 4:50 и выбыл третьим — получают одинаковый S=0.0. Рейтинговая система не видит разницы между "полным провалом" и "достойной борьбой".

### 💥 Импакт

- Игрок, выбывший третьим после долгой борьбы, расстраивается: "я старался, а теряю столько же, сколько тот, кто тупо уронил фигуру в начале".
- MMР не отражает реальную силу: "выживаемость" не награждается.
- **Smurfing**: сильные игроки могут намеренно выбывать третьими (S=0.0), чтобы не поднимать MMR, и играть со слабыми.

### 🛠️ Исправление

**Линейная интерполяция (Plackett-Luce правильная):**

```
function ffa_score(place, total_alive):
  // place = 1..total_alive (1 = победитель)
  // total_alive = сколько было живых на старте матча (4 обычно)
 
  if place == total_alive:   // последний (выбыл первым)
    return 0.0
  if place == 1:             // победитель
    return 1.0
  
  // 2-е и 3-е места — линейно между 1.0 и 0.0
  // Для 4 игроков:
  //   1st = 1.0, 2nd = 0.666, 3rd = 0.333, 4th = 0.0
  // Для 3 игроков (кто-то выбыл раньше):
  //   1st = 1.0, 2nd = 0.5, 3rd = 0.0
  // Для 2 игроков (финальный 1v1):
  //   1st = 1.0, 2nd = 0.0 (классический ELO)
  
  return (total_alive - place) / (total_alive - 1)
```

**Для eliminations (выбыл не по top-out, а по disconnect/afk):**
```
if disconnected or afk:
  // Игрок, который отвалился на 10-й секунде, получает -50% от S, 
  // которое получил бы при честном top-out на этом месте.
  S = computed_s * 0.5
  
  // Анти-spike: не улетает ниже -0.2 (min S = -0.2)
```

**Итоговый фикс в GDD и Rating:**

```
FFA S-values:
  1st: 1.0
  2nd: (total_players - 2) / (total_players - 1)
  3rd: (total_players - 3) / (total_players - 1)
  ...
  last: 0.0

  early_elimination_penalty: 0.5  // умножает S на 0.5
  min_possible_S: -0.2
```

---

## P6. Everyone mode — экспоненциальный мусор

### 🔬 Анализ

**Сценарий:** 4 игрока, Everyone mode. Один игрок делает Tetris (7 мусора × 3 цели = 21 garbage line всего, по 7 каждому).

Если за матч (5 мин) каждый игрок делает:
- 5 Tetris'ов (реалистично для 5 мин)
- 10 Double/Single

**Мусорооборот в Everyone mode:**
```
5 Tetris × 7 × 3 = 105 garbage lines за матч (всего)
10 Double × 2 × 3 = 60 garbage lines
Итого: ~165 garbage lines за 5 мин.
Стакан: 20 строк. 165 / 20 = 8.25 полных переполнений.
```

То есть **каждый игрок получит ~40 мусорных строк за матч** (165/4 = 41.25). При counteract (1-for-1) — если игрок сжигает 20 линий за матч, он нейтрализует 20. Получает ~20. Стакан 20 → каждый игрок умирает от переполнения минимум 1 раз.

**Без counteract:** 41 мусорная строка / 20 = 2+ top-out гарантировано.

### 💥 Импакт

- Everyone mode = **ускоренная смерть**.
- Первый же Tetris решает матч (7 строк → цель получает 7 → если она не успела защититься, её стакан поднимается на 7 → следующая атака её добивает).
- Нет "борьбы": матч заканчивается за 3-4 хода.

### 🛠️ Исправление

**Фикс A — Garbage Cap (уже есть, но не описан):**
```
per_player_garbage_cap: 20    // максимальное количество мусорных строк
                               // в буфере одного игрока одномоментно
```
Если у игрока уже 20 в буфере — новые атаки в него *не отправляются* (атакующий получает сообщение "GARBAGE REFLECTED: target full").

**Фикс B — Diminishing returns на одинаковую цель:**
```
target_repetition_decay:
  decay_per_hit: 0.15   // каждое следующее попадание в ту же цель 
                         // даёт на 15% меньше мусора
  min_decay: 0.4        // нижняя граница (не ниже 40% от base)
  reset_on_new_target: true  // смена цели сбрасывает decay
```

То есть: 1-я атака в A: 7 строк. 2-я в A: 7 × 0.85 = 5.95→**6**. 3-я в A: 7 × 0.70 = 4.9→**5**.

**Фикс C — Buffer capacity как ресурс:**
```
buffer_capacity_per_player: 15  // можно накопить не более 15 линий
overflow_redirect: "random"     // если лимит — мусор перенаправляется другому
```

**Итоговый фикс:**
```
targeting:
  all_mode:
    per_player_garbage_cap: 15
    overflow_behaviour: "redirect_to_random_alive"
    diminishing_returns: true
    decay_per_hit: 0.15
    min_decay: 0.4
```

---

## P7. BO4: 4 wins = до 12 минут

### 🔬 Анализ

**Текущие цифры:**
- `wins_needed: 4` (первый до 4 побед)
- `round_duration: 90 sec`
- `break: 10 sec`
- `max_rounds: 7`

**Максимальная длина BO4 матча:**
```
7 раундов × 90 сек = 630 сек (10:30)
6 перерывов × 10 сек = 60 сек
Итого: ~11.5 минут
```

Для "быстрых матчей" (fast-paced cyberpunk) — это очень долго. Средний матч в Tetris 99 = 3-5 мин.

**Если 4 wins не набраны за 7 раундов:**
> Правило не описано. Что происходит? Игрок с 3 wins vs 3 wins после 7 раундов — ничья?

### 💥 Импакт

- High skill gap: чем равнее соперники, тем дольше матч. Равный матч = все 7 раундов = 11:30.
- Retention: проиграть 11 минут — больно. Выиграть 11 минут подряд — устать.
- Противоречие с заявленным "fast-paced hardcore".

### 🛠️ Исправление

```
bo4:
  wins_needed: 3               // Best of 5 (max 5 раундов)
  round_duration_sec: 90
  break_duration_sec: 5        // 10→5 sec
  max_rounds: 5
  tie_breaker: "sudden_death"  // если после 5 раундов ничья (3-3? но 3 wins = победа сразу)
                               // на самом деле max 5, wins=3 → не может быть ничьей.
                               // но если после 5 раундов никто не набрал 3 → побеждает с > очками
  new_seed_per_round: true
```

**Максимальная длина после фикса:**
```
5 раундов × 90 = 450 сек (7:30)
4 перерыва × 5 = 20 сек
Итого: ~7:50 — приемлемо для "быстрых матчей".
```

---

## P8. MMR начальный 1500 — Bronze невидим

### 🔬 Анализ

**Текущая таблица:**
```
Bronze I:   0-1199
Bronze II:  1200-1399
Silver I:   1400-1599  ← стартовый MMR = 1500
Silver II:  1600-1799
Gold I:     1800-1999
...
```

Новый игрок начинает с MMR=1500 → сразу попадает в **середину Silver I**. Bronze ранги увидят только те, кто:
1. Проиграл первые 5+ матчей подряд (MMR падает на ~20-30 за матч в минус).
2. Новички, которые сразу ушли в минус.

**Проблема:** Bronze — это "путь новичка", но он пуст. Нет чувства прогрессии (beginner→intermediate).

### 💥 Импакт

- Психология: игрок начинает в "середине", нет ощущения роста.
- Ранги обесценены: Bronze не существует в природе.
- Matchmaking: новичок с MMR=1500 матчится с опытными Silver I — теряет 2-3 матча, MMR падает до 1400 → Bronze II? Нет, 1400 → Bronze I (0-1399). Wait: 1400 это Silver I по таблице? (Silver I: 1400-1599). Так 1400 = Silver I, 1399 = Bronze II. Очень узкий Bronze.

### 🛠️ Исправление

**Вариант A (рекомендуемый) — сдвиг стартового MMR:**
```
start_mmr: 1000    // вместо 1500
```

И обновить пороги:
```
Bronze I:   0-799     // начальный
Bronze II:  800-999
Silver I:   1000-1299
Silver II:  1300-1599
Gold I:     1600-1899
Gold II:    1900-2199
Platinum:   2200-2499
Elite:      2500-2999
Neon:       3000+
```

Новичок (1000) → Bronze II. Выиграл пару матчей → Silver I. Чувствуется прогресс.

**Вариант B — сместить пороги при текущем 1500:**
```
Bronze:     0-999      // шире
Silver:     1000-1699  // старт 1500 → середина Silver
Gold:       1700-2199
Platinum:   2200-2699
Elite:      2700-3199
Neon:       3200+
```

---

## P9. Качество жизни (JSON Schema / Colorblind / Fast phrase spam)

### P9a. JSON Schema для game-config.json

**Сейчас:** `"$schema": "Neon Tetris Server Configuration v1.0"` — это просто строка, не ссылка на реальную схему.

**Фикс:** Создать `game-config.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://neon-tetris/schemas/game-config-v1.json",
  "type": "object",
  "properties": {
    "attack": {
      "type": "object",
      "properties": {
        "base_lines": {
          "type": "object",
          "properties": {
            "single": { "type": "integer", "minimum": 0, "default": 1 },
            "double": { "type": "integer", "minimum": 2, "default": 2 }
          },
          "required": ["single", "double", "triple", "tetris", "perfect_clear"]
        },
        "rounding": { "type": "string", "enum": ["ceil", "floor", "ceil_floor", "none"] },
        "combo_multiplier": { ... },
        "queue_delay_ms": { ... },
        "garbage_counteract_ratio": { "type": "number", "minimum": 0, "maximum": 2 },
        "per_player_garbage_cap": { "type": "integer", "minimum": 5, "maximum": 100 }
      },
      "required": ["base_lines", "combo_multiplier", "queue_delay_ms"]
    },
    "match": { ... },
    "randomizer": { ... },
    "chat": { ... },
    "anticheat": { ... },
    "garbage_visual": { ... }
  },
  "required": ["attack", "match", "randomizer", "chat", "anticheat", "garbage_visual"]
}
```

### P9b. Colorblind palette

**Сейчас:** цвета фигур — стандартные Tetris цвета (I_cyan, O_yellow, T_purple, S_green, Z_red, J_blue, L_orange).

**Проблема:** 8% мужчин имеют дейтеранопию (крайно-зеленый). Z_red (red) и S_green (green) — неразличимы. O_yellow и L_orange — тоже близки.

**Фикс — добавить pattern overlay (узор) или гарантировать контраст:**
```
garbage_visual:
  colorblind_friendly: true
  pieces_per_line: 10
  color_pool:
    I: { color: "#00FFFF", pattern: "solid" }
    O: { color: "#FFD700", pattern: "dots" }
    T: { color: "#9B30FF", pattern: "stripes" }
    S: { color: "#32CD32", pattern: "cross" }    // зелёный, но с крестом
    Z: { color: "#FF4500", pattern: "diagonal" }  // оранжево-красный, с диагональю
    J: { color: "#1E90FF", pattern: "horizontal" }
    L: { color: "#FF8C00", pattern: "vertical" }
```

### P9c. Fast phrase anti-spam

**Сейчас:** `chat.room.fast_phrase_max_length: 50` — лимит длины, но нет rate limit на target-уведомления.

**Проблема:** Игрок может спамить `"FOCUS #2"` 10 раз в секунду, создавая visual clutter на экране цели. Это не читерство, но disruptive.

**Фикс:**
```
chat:
  room:
    fast_phrase_max_length: 50
    fast_phrase_rate_limit_ms: 3000      // 1 fast phrase per 3 sec per player
    fast_phrase_global_cooldown_ms: 500   // глобальный кулдаун на любую фразу в комнате
    target_notification_max_per_sec: 2    // не более 2 target-уведомлений в секунду на одного игрока
    spectators_readonly: true
```

---

# 🚀 Лечащие промпты

> Готовые промпты для AI-агента (или разработчика), которые исправляют исходные файлы.

---

## ПРОМПТ A: Исправить баланс атаки (P1 + P4)

**Цель:** Поменять `base_lines.single = 0`, исключить Single из комбо, поднять queue_delay_ms.

**Файлы:** `02_GAME_CONFIG.json`, `01_NEON_TETRIS_GDD.md` (таблица атаки)

**Промпт:**

```
Ты — гейм-балансер. Исправь конфиг и GDD Neon Tetris по следующим правилам:

1. Single line (1 линия) больше НЕ генерирует мусорные линии. 
   base_lines.single = 0. Single даёт только очки (1 очко счёта) и сдвигает комбо-счётчик?
   НЕТ — Single не считается атакой, комбо-множитель от Single не растёт.

2. Комбо-множитель применяется только к Double, Triple, Tetris, Perfect Clear.
   Добавь поле combo_eligible: ["double","triple","tetris","perfect_clear"].

3. Queue Delay:
   - Single: 400 → 700 ms
   - Double: 500 → 700 ms
   - Triple: 700 → 800 ms
   - Tetris: 900 → 1000 ms
   - Perfect Clear: 1200 → оставить

4. Rounding: оставить ceil, но для single=0 это не имеет значения. 
   Добавь rounding_rules: { single: "floor" (хотя 0 остаётся 0), default: "ceil" }.

5. Обнови GDD: в таблице "Базовые значения атаки" Single = 0 garbage lines.
   В комбо-таблицу добавь примечание: "Single не участвует в комбо-множителе".

6. Все изменения отрази в конфиге и секции 1.1 GDD.
```

---

## ПРОМПТ B: Переписать Counteract (P2)

**Цель:** Убрать double-jeopardy, добавить shield buffer и clean slate lite.

**Файлы:** `01_NEON_TETRIS_GDD.md` (секция 1.2), `02_GAME_CONFIG.json`

**Промпт:**

```
Перепиши механику Garbage Counteract в GDD и конфиге:

1. Нейтрализация больше НЕ даёт очки счёта (score). Добавь: "nullify_score: false".
   Цель выбирает: заработать очки сжиганием ИЛИ защититься от мусора, но не и то, и другое.

2. Добавь механнику Shield Buffer:
   - Каждая нейтрализованная мусорная линия превращается в 1 единицу "щита".
   - Щит автоматически поглощает 1 мусорную линию из следующей атаки.
   - Щит хранится 10 секунд, максимум 3 единицы.
   - shield_grant: true, shield_max_lines: 3, shield_duration_ms: 10000.

3. Добавь Clean Slate Lite:
   - Если игрок нейтрализовал хотя бы 1 мусорную линию за последние 2 секунды,
     он получает 500 мс иммунитета к ЛЮБЫМ новым атакам (Clean Slate Lite).
   - Не суммируется с обычным Clean Slate Buff.

4. Обнови формулу финального расчёта:
   FinalApplied = max(0, TargetGarbageReceived - Nullified - ShieldAbsorbed)
   Shield потребляется только если мусор применился (после Queue Delay).
   NullifiedLines → ShieldBuffer += min(nullifiedLines, 3 - currentShield)

5. Добавь в config.json:
   garbage_counteract:
     nullify_score: false
     shield_grant: true
     shield_max_lines: 3
     shield_duration_ms: 10000
     clean_slate_lite_ms: 500
```

---

## ПРОМПТ C: Reconnection Protocol (P3)

**Цель:** Добавить reconnect sequence в GDD, sequence diagram, и anticheat-логику.

**Файлы:** `01_NEON_TETRIS_GDD.md` (секция 2.3, приложение), `03_SEQUENCE_DIAGRAMS.md`

**Промпт:**

```
Добавь в GDD Neon Tetris протокол переподключения (reconnection):

1. В секцию "2.3 Клиент-серверная синхронизация" добавь подсекцию "Reconnection Protocol":

   Grace Period (5000 ms):
   - Сервер замечает отсутствие сообщений от клиента > 1500 мс.
   - Помечает игрока как "disconnected" (стакан заморожен, мусор в него не летит).
   - Запускает таймер grace_period_ms = 5000.

   Reconnect:
   - Клиент переподключается (тот же player_id, room_id).
   - Сервер шлёт game_state_sync { board, garbage_buffer, score, global_step, seed, missed_steps[] }.
   - Клиент применяет пропущенные ходы мгновенно.
   - Игра продолжается.

   Timeout:
   - Grace period истёк → hard disconnect.
   - Игрок считается выбывшим (top-out-equivalent).
   - Матч продолжается для остальных.

   Anti-Abuse:
   - Максимум 3 реконнекта за матч (max_reconnects_per_match: 3).
   - При превышении — grace period отключается.

2. Добавь протокол в античит:
   - Если клиент переподключается и пытается "пропустить" мусор через recconect,
     сервер сверяет missed_steps с actual пропущенными — mismatch = бан.

3. В sequence diagrams (03_SEQUENCE_DIAGRAMS.md) добавь новую диаграмму:
   "6. Reconnection Flow" (Mermaid).
   Участники: Игрок A, Сервер.
   Покажи: disconnect → grace timer → reconnect → state_sync → continue.

4. Обнови таблицу событий в GDD:
   Добавь событие game_state_sync.
```

---

## ПРОМПТ D: Исправить FFA Rating S-values (P5)

**Цель:** Линейная интерполяция S-value для 1-4 мест.

**Файлы:** `05_RATING_ELO_SYSTEM.md` (секция 3.3)

**Промпт:**

```
Исправь систему рейтинга для FFA (4 игрока) в 05_RATING_ELO_SYSTEM.md:

1. Замени текущую S-value таблицу на линейную интерполяцию:

   Для total_alive = N игроков:
   S(place) = (N - place) / (N - 1)
   
   Примеры:
   - N=4: S(1)=1.0, S(2)=0.666, S(3)=0.333, S(4)=0.0
   - N=3 (кто-то выбыл): S(1)=1.0, S(2)=0.5, S(3)=0.0
   - N=2 (финальный 1v1): S(1)=1.0, S(2)=0.0 (классика)

2. Добавь правило для early elimination (disconnect/AFK):
   - Если игрок выбыл не по top-out, а по disconnect/afk:
     S = computed_S × 0.5 (штраф)
   - S не может быть ниже -0.2 (min_possible_S: -0.2).

3. Исправленный K-factor:
   - Heads-up (1v1): K=48 (оставить)
   - Shortlist (4 игрока): K=48 (поднять с 32 — FFA шумнее, нужна большая волатильность)
   - BO4: K=32 per round (уменьшить, т.к. много раундов)

4. Обнови секцию "3.5 Разброс RD":
   - Увеличь σ с 0.06 до 2.0 (стандартный Glicko-2 decay).
   - t — по-прежнему в днях.
```

---

## ПРОМПТ E: Everyone mode cap + decay (P6)

**Цель:** Предотвратить экспоненциальный мусор в Everyone mode.

**Файлы:** `01_NEON_TETRIS_GDD.md` (секция 1.3), `02_GAME_CONFIG.json`

**Промпт:**

```
Исправь режим "Против Всех" (Target: Everyone) в GDD и конфиге:

1. Добавь per_player_garbage_cap = 15 в config.json (attack раздел).
   Если у игрока уже 15 мусорных строк в буфере (ожидающих Queue Delay или уже в стакане),
   новые атаки в него не направляются. Вместо этого:
   - Если cap достигнут → garbage перенаправляется на случайного живого противника (redirect_to_random_alive).
   - Атакующий получает уведомление "GARBAGE REFLECTED: <target> full".

2. Добавь diminishing returns:
   - Каждое последующее попадание в ту же цель (в пределах 1 матча) даёт на 15% меньше мусора.
   - Минимальное значение: 40% от базового.
   - Сброс: при смене цели или новом раунде (BO4).
   - config: decay_per_hit: 0.15, min_decay: 0.4, reset_on_new_target: true.

3. В GDD секция "1.3 Режим 2: Против Всех":
   - Упомяни garbage cap с пояснением "Защита от спирали смерти".
   - Добавь пример: "Если у B уже 15 линий в буфере, следующая атака в B перенаправляется на C".
   - Добавь уведомление "GARBAGE REFLECTED" в таблицу системных событий (секция 4.2).
```

---

## ПРОМПТ F: BO4 — сократить матч (P7)

**Цель:** 4 → 3 wins, break 5 sec.

**Файлы:** `01_NEON_TETRIS_GDD.md` (секция 3.1), `02_GAME_CONFIG.json`

**Промпт:**

```
Измени формат BO4 (Best of 4) на Best of 5:

В GDD (01) и config.json (02):
1. wins_needed: 4 → 3
2. max_rounds: 7 → 5
3. break_duration_sec: 10 → 5
4. Обнови максимальную длину матча в GDD: с ~12 мин → ~8 мин.

В GDD:
- Поменяй название на "BO5 (Best of 5)" или оставь "BO4" но с wins=3?
  Лучше оставить "BO4" как бренд (Best of 4 wins), но сделать 3.
  Или переименовать в "Best of 5 — Bo5".
- Обнови психологию: "3 победы из 5 — быстрый формат, матч до 8 минут".
```

---

## ПРОМПТ G: MMR + ранги (P8)

**Цель:** Сдвиг стартового MMR до 1000, обновление порогов.

**Файлы:** `05_RATING_ELO_SYSTEM.md` (секция 5), config (если есть)

**Промпт:**

```
Обнови рейтинговую систему в 05_RATING_ELO_SYSTEM.md:

1. Начальный MMR: 1500 → 1000.
2. Обновить таблицу рангов:

   | Ранг    | MMR (min) | MMR (max) |
   |---------|:---------:|:---------:|
   | Бронза I   | 0     | 799   |
   | Бронза II  | 800   | 999   |
   | Серебро I  | 1000  | 1299  |
   | Серебро II | 1300  | 1599  |
   | Золото I   | 1600  | 1899  |
   | Золото II  | 1900  | 2199  |
   | Платина    | 2200  | 2499  |
   | Элита      | 2500  | 2999  |
   | Неон       | 3000+ | ∞     |

3. Новичок с MMR=1000 попадает в Bronze II → после 1-2 побед → Silver I.
   Это даёт чувство прогресса.

4. Обнови секцию 3.2: "Начальные параметры: MMR = 1000 (новый игрок)".
```

---

## ПРОМПТ H: JSON Schema + Colorblind + Anti-spam (P9)

**Цель:** Создать JSON Schema, добавить colorblind паттерны и fast phrase anti-spam.

**Файлы:** `02_GAME_CONFIG.json`, `01_NEON_TETRIS_GDD.md` (секция 4)

**Промпт:**

```
Выполни три задачи:

[1] Создай файл game-design/game-config.schema.json — JSON Schema draft-07 для game-config.json.
    Включи все поля с типами, минимумами, дефолтами и enum.
    Ссылка на схему в game-config.json: "$schema": "./game-config.schema.json".

[2] В GDD (секция 1.1, сноска про визуал мусора) добавь colorblind-friendly palette:
    - Каждая фигура имеет не только цвет, но и pattern overlay (solid, dots, stripes, cross, diagonal, horizontal, vertical).
    - Это позволяет дальтоникам различать мусорные линии по текстуре.
    - Не обязательно для MVP, но задокументировать как known improvement.

[3] Добавь anti-spam для fast phrases (секция 4.3):
    - fast_phrase_rate_limit_ms: 3000 (1 фраза в 3 сек на игрока)
    - target_notification_max_per_sec: 2 (не более 2 таргет-уведомлений в сек)
    - global_cooldown_ms: 500 (глобальный кулдаун на любую быструю фразу в комнате)

    Обнови config.json.chat.room соответствующими полями.
```

---

## ⚡ ПРОМПТ-СУПЕРСЕТ (batch)

Если нужно запустить одним промптом все фиксы сразу:

```
Ты — senior game designer + technical architect. 
Перед тобой полный комплект документов Neon Tetris (GDD, config, sequence diagrams, rating, spectator mode).

Внеси исправления по следующим правилам (приоритет: critical → high):

=== CRITICAL (блокирующие игру) ===

1. [БАЛАНС АТАКИ] base_lines.single = 0, Single не генерирует мусор и не участвует в комбо.
   queue_delay_ms: single=700, double=700, triple=800, tetris=1000, perfect_clear=1200.

2. [COUNTERACT] Не давать очки (nullify_score=false), shield_grant=true (max 3, 10s),
   clean_slate_lite_ms=500.

3. [RECONNECT] Добавить grace_period_ms=5000, max_reconnects=3, game_state_sync событие.

=== HIGH ===

4. [FFA RATING] S-place линейная интерполяция (1st=1.0, 2nd=0.666, 3rd=0.333, 4th=0.0).
   K=48 для Shortlist, σ=2.0.

5. [EVERYONE MODE] per_player_garbage_cap=15, diminishing_returns (0.15 decay, 0.4 min).

6. [BO4] wins_needed=3, max_rounds=5, break=5s.

7. [MMR] Начальный MMR=1000, обновить пороги рангов.

=== MEDIUM ===

8. Создать game-config.schema.json.
9. Добавить colorblind pattern overlay в документацию.
10. Добавить fast phrase anti-spam (rate 3s, target 2/s).

Обнови файлы: 01_GDD.md, 02_game-config.json, 03_sequence.md, 05_rating.md.
```

---

*Сформировано по результатам Game Design Review от 2026-04.*
*Все промпты готовы к передаче в AI-агент или разработчику.*