#!/usr/bin/env bash
# ============================================================================
# deploy.sh — Полный цикл деплоя Neon Tetris на сервер
#
# Использование:
#   bash deploy.sh <USER> <HOST> [PORT]
#
# Примеры:
#   bash deploy.sh root 192.168.1.100
#   bash deploy.sh deployer example.com 8080
#
# Переменные окружения (опционально):
#   SSH_KEY      — путь к SSH key (по умолчанию: ~/.ssh/id_rsa)
#   SSH_PORT     — SSH порт (по умолчанию: 22)
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Конфигурация по умолчанию
# ---------------------------------------------------------------------------
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_PORT="${1:-3000}"

USER="${1:?Ошибка: укажите USER (например root)}"
HOST="${2:?Ошибка: укажите HOST (например 192.168.1.100)}"
PORT="${3:-3000}"

APP_NAME="neon-tetris"
REMOTE_DIR="/opt/${APP_NAME}"

# ---------------------------------------------------------------------------
# Цвета для вывода
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# Проверки
# ---------------------------------------------------------------------------
if ! command -v ssh &>/dev/null; then err "ssh не найден"; fi
if ! command -v scp  &>/dev/null; then err "scp не найден"; fi
if ! command -v rsync &>/dev/null; then warn "rsync не найден — использую scp"; fi

if [[ ! -f "$SSH_KEY" ]]; then
    err "SSH key не найден: $SSH_KEY\nСоздайте ключ: ssh-keygen -t ed25520"
fi

echo "═══════════════════════════════════════════════════"
echo -e " ${BLUE}🚀 Деплой Neon Tetris${NC}"
echo "═══════════════════════════════════════════════════"
echo "  Пользователь : $USER@$HOST"
echo "  Порт приложения: $PORT"
echo "  Удалённый путь : $REMOTE_DIR"
echo "  SSH port      : $SSH_PORT"
echo "═══════════════════════════════════════════════════"
echo ""

SSH_CMD="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"

# ---------------------------------------------------------------------------
# Шаг 0: Проверка соединения
# ---------------------------------------------------------------------------
log "Подключаюсь к серверу..."
if ! $SSH_CMD "$USER@$HOST" "echo connected" &>/dev/null; then
    err "Не могу подключиться к $USER@$HOST"
fi
ok "Подключено"
echo ""

# ---------------------------------------------------------------------------
# Шаг 1: Установка Node.js
# ---------------------------------------------------------------------------
log "Проверяю Node.js на сервере..."
NODE_VERSION=$($SSH_CMD "$USER@$HOST" "node --version 2>/dev/null || echo not-installed")

if [[ "$NODE_VERSION" == "not-installed" ]]; then
    log "Node.js не установлен — устанавливаю..."
    $SSH_CMD "$USER@$HOST" "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
    ok "Node.js установлен"
else
    ok "Node.js уже установлен: $NODE_VERSION"
fi

PM2_VERSION=$($SSH_CMD "$USER@$HOST" "pm2 --version 2>/dev/null || echo not-installed")
if [[ "$PM2_VERSION" == "not-installed" ]]; then
    log "Устанавливаю PM2 для управления процессом..."
    $SSH_CMD "$USER@$HOST" "npm install -g pm2"
    ok "PM2 установлен"
else
    ok "PM2 уже установлен: $PM2_VERSION"
fi
echo ""

# ---------------------------------------------------------------------------
# Шаг 2: Подготовка директории
# ---------------------------------------------------------------------------
log "Подготовка директории $REMOTE_DIR..."
$SSH_CMD "$USER@$HOST" "mkdir -p $REMOTE_DIR"
ok "Директория готова"
echo ""

# ---------------------------------------------------------------------------
# Шаг 3: Копирование файлов
# ---------------------------------------------------------------------------
log "Копирую исходники и package.json на сервер..."

# Собираю список файлов для копирования (исключая node_modules, dist, и т.д.)
FILES_TO_COPY=$(
    git ls-files | grep -vE '(^node_modules/|^dist/|^frontend/dist/|^backend/dist/|^frontend/node_modules/|^backend/node_modules/|\.git/|\.dockerignore|Dockerfile|deploy\.sh|README\.md|\.md$)' || true
)

# Копирую package.json, tsconfig, vite.config и исходники
$SSH_CMD "$USER@$HOST" "mkdir -p $REMOTE_DIR/{frontend,backend}"

# Копируем package.json файлы
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    package.json \
    frontend/package.json \
    frontend/tsconfig.json \
    frontend/vite.config.ts \
    backend/package.json \
    backend/tsconfig.json \
    backend/jest.config.js \
    "$USER@$HOST:$REMOTE_DIR/"

# Копируем исходники бэкенда
rsync -avz --delete \
    -e "ssh -i $SSH_KEY -p $SSH_PORT" \
    --exclude=node_modules \
    --exclude=dist \
    backend/src/ \
    "$USER@$HOST:$REMOTE_DIR/backend/src/" || \
scp -i "$SSH_KEY" -r -P "$SSH_PORT" \
    backend/src/ \
    "$USER@$HOST:$REMOTE_DIR/backend/src/"

# Копируем исходники фронтенда
rsync -avz --delete \
    -e "ssh -i $SSH_KEY -p $SSH_PORT" \
    --exclude=node_modules \
    --exclude=dist \
    frontend/src/ \
    "$USER@$HOST:$REMOTE_DIR/frontend/src/" || \
scp -i "$SSH_KEY" -r -P "$SSH_PORT" \
    frontend/src/ \
    "$USER@$HOST:$REMOTE_DIR/frontend/src/"

# Копируем данные (scores.json)
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    backend/data/scores.json \
    "$USER@$HOST:$REMOTE_DIR/backend/data/" 2>/dev/null || true

ok "Файлы скопированы"
echo ""

# ---------------------------------------------------------------------------
# Шаг 4: Установка зависимостей и сборка
# ---------------------------------------------------------------------------
log "Устанавливаю зависимости и собираю проект на сервере..."

$SSH_CMD "$USER@$HOST" "
    cd $REMOTE_DIR &&
    echo '--- Installing root dependencies ---' &&
    npm install &&
    echo '--- Installing frontend dependencies ---' &&
    (cd frontend && npm install) &&
    echo '--- Building frontend ---' &&
    (cd frontend && npm run build) &&
    echo '--- Installing backend dependencies ---' &&
    (cd backend && npm install) &&
    echo '--- Building backend ---' &&
    (cd backend && npm run build) &&
    echo '--- BUILD COMPLETE ---'
"
ok "Сборка завершена"
echo ""

# ---------------------------------------------------------------------------
# Шаг 5: Запуск приложения
# ---------------------------------------------------------------------------
log "Запускаю приложение на порту $PORT..."

# Завершаем старый процесс, если он есть
$SSH_CMD "$USER@$HOST" "pm2 stop neon-tetris 2>/dev/null; pm2 delete neon-tetris 2>/dev/null; echo done"

# Запускаем через PM2
$SSH_CMD "$USER@$HOST" "
    cd $REMOTE_DIR &&
    pm2 start \
        --name neon-tetris \
        --interpreter node \
        backend/dist/index.js \
        --name neon-tetris \
        -- 2>/dev/null || true
"

# На всякий случай — перезапускаем
$SSH_CMD "$USER@$HOST" "pm2 restart neon-tetris"

sleep 2

# Проверяем, что приложение запущено
if $SSH_CMD "$USER@$HOST" "pm2 describe neon-tetris | grep -q 'online'"; then
    ok "Приложение запущено!"
else
    warn "Процесс может быть не в статусе online. Проверяю логи..."
    $SSH_CMD "$USER@$HOST" "pm2 logs neon-tetris --lines 10"
fi

echo ""

# ---------------------------------------------------------------------------
# Финал
# ---------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}🎉 Деплой завершён!${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo -e " Приложение доступно по адресу:"
echo -e "   ${GREEN}http://${HOST}:${PORT}${NC}"
echo ""
echo -e " Управление через PM2:"
echo -e "   ssh $USER@$HOST \"pm2 list\""
echo -e "   ssh $USER@$HOST \"pm2 logs neon-tetris\""
echo -e "   ssh $USER@$HOST \"pm2 restart neon-tetris\""
echo ""
echo -e "${YELLOW}Теперь запустите deploy.sh с нужными параметрами:"
echo -e "   bash deploy.sh root 192.168.1.100 3000${NC}"
echo ""
