# 🚀 Деплой Neon Tetris

## ✅ Готовый бэкенд

Бэкенд компилируется и запускается успешно:
```
✅ TypeScript компилируется без ошибок
✅ Server running on port 3000
✅ REST API работает (POST /api/score, GET /api/scores, GET /api/leaderboard)
✅ JSON-хранилище (без native deps)
✅ WebSocket сервер (базовый)
```

---

## 📋 Чек-лист перед деплоем

- [x] Бэкенд компилируется: `cd backend && npx tsc`
- [x] Бэкенд запускается: `cd backend && node dist/index.js`
- [x] API отвечает: `curl http://localhost:3000/api/scores`
- [x] Фронтенд открывается в браузере
- [ ] CORS: добавьте `npm install cors` для связки бэкенд↔фронтенд

---

## 🌐 Бесплатные хостинги

### 1. Render ⭐ (Рекомендуется)

**Бесплатно:** Web Service + Static Site + HTTPS

**Инструкция:**

#### Шаг 1: Push в GitHub
```bash
cd C:\GIT\tetris
git init
git add .
git commit -m "Initial commit"
# Создайте репо на GitHub
git remote add origin https://github.com/USERNAME/tetris.git
git branch -M main
git push -u origin main
```

#### Шаг 2: Бэкенд на Render
1. [render.com](https://render.com) → **New Web Service**
2. Подключите GitHub → выберите репо
3. Настройки:
   - **Name:** tetris-api
   - **Root Directory:** `backend`
   - **Build Command:** `npx tsc`
   - **Start Command:** `node dist/index.js`
   - **Node Version:** 20
4. Нажмите **Create**

#### Шаг 3: Фронтенд на Render
1. [render.com](https://render.com) → **New Static Site**
2. Подключите GitHub → выберите репо
3. Настройки:
   - **Name:** tetris-web
   - **Publish Directory:** `frontend` (или `dist` если собираете)
   - **Install Command:** (пусто)
   - **Build Command:** (пусто — HTML не требует сборки)
4. Нажмите **Create**

#### Шаг 4: CORS
В `backend/src/index.ts` добавьте:
```typescript
import cors from 'cors'
app.use(cors({ origin: 'https://tetris-web.onrender.com' }))
```

---

### 2. Railway

**Бесплатно:** $5 credit/month (хватает на 1 сервис)

1. [railway.app](https://railway.app) → **New Project** → **GitHub**
2. Выберите репо
3. Railway автоматически определит Node.js
4. Build: `cd backend && npx tsc`
5. Start: `node dist/index.js`
6. **Deploy**

---

### 3. Vercel (только фронтенд)

**Бесплатно:** Неограниченно

```bash
npx vercel
# Или через GitHub: подключите репо на vercel.com
```

---

### 4. Fly.io

**Бесплатно:** 3 VM (small)

```bash
flyctl init
flyctl deploy
```

---

## 🎯 Итоговая архитектура на хостинге

```
┌──────────────────────┐         ┌──────────────────────┐
│  Frontend (Vercel)   │ ──API──▶ │  Backend (Render)    │
│  https://tetris.app  │         │  https://tetris-api  │
│  index.html          │         │  Express + REST      │
│  app.js              │         │  WebSocket (WS)      │
│  styles.css          │         │  JSON scores.db      │
└──────────────────────┘         └──────────────────────┘
```

Все бесплатно, всё с HTTPS, всё с авто-деплоем при push.
