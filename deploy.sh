#!/usr/bin/env bash
# ============================================================================
# deploy.sh — Деплой Neon Tetris на сервер через Docker
#
# Единственный контур на сервере — docker-контейнер `neon-tetris`, который
# nginx-proxy (VIRTUAL_HOST/VIRTUAL_PORT) выводит на https://<HOST>.
# PM2-контура больше нет: он был удалён с сервера (pm2 delete + pm2 unstartup),
# поэтому скрипт больше ничего в PM2 не устанавливает и не запускает.
#
# Использование:
#   bash deploy.sh <USER> <HOST> [PORT]
#
# Примеры:
#   bash deploy.sh root ntetris.ddns.net
#   bash deploy.sh deployer 192.168.1.100 3000
#
# Переменные окружения (опционально):
#   SSH_KEY      — путь к SSH key (по умолчанию: ~/.ssh/id_ed25519)
#   SSH_PORT     — SSH порт (по умолчанию: 22)
#   REPO_URL     — git-репозиторий, который клонируется на сервер
#                  (по умолчанию: https://github.com/dvdrelin/tetris.git)
#   APP_CONTAINER/APP_IMAGE — имя контейнера (он же container_name в
#                  docker-compose.yml) (по умолчанию: neon-tetris)
#
# PORT (третий аргумент) — внутренний порт приложения в контейнере. Он же
# VIRTUAL_PORT в docker-compose.yml. Наружу контейнер его не публикует:
# доступ идёт только через nginx-proxy на 80/443.
#
# Что происходит на сервере (ровно процедура из docs/SESSION_CONTEXT.md):
#   git clone --depth 1 <REPO_URL> /opt/neon-tetris-new
#   rsync -a --delete --exclude=.git --exclude=node_modules --exclude=dist \
#         --exclude=backend/data --exclude=nginx-proxy \
#         /opt/neon-tetris-new/ /opt/neon-tetris/
#   rm -rf /opt/neon-tetris-new
#   cd /opt/neon-tetris && docker compose build && docker compose up -d
#
# `--exclude=backend/data` сохраняет scores.json (он примонтирован в контейнер),
# `--exclude=nginx-proxy` сохраняет nginx-proxy/.env с DEFAULT_EMAIL, которого
# нет в репозитории. Оба исключения обязательны.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Конфигурация по умолчанию
# ---------------------------------------------------------------------------
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_PORT="${SSH_PORT:-22}"
REPO_URL="${REPO_URL:-https://github.com/dvdrelin/tetris.git}"
APP_NAME="neon-tetris"
APP_CONTAINER="${APP_CONTAINER:-neon-tetris}"
REMOTE_DIR="/opt/${APP_NAME}"
CLONE_DIR="/opt/${APP_NAME}-new"

USER="${1:?Ошибка: укажите USER (например root)}"
HOST="${2:?Ошибка: укажите HOST (например ntetris.ddns.net)}"
PORT="${3:-3000}"

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
# Проверки локальной машины
# ---------------------------------------------------------------------------
if ! command -v ssh &>/dev/null; then err "ssh не найден на локальной машине"; fi
if [[ ! -f "$SSH_KEY" ]]; then
    err "SSH key не найден: $SSH_KEY\nСоздайте ключ: ssh-keygen -t ed25519"
fi

SSH_CMD="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"
run() { $SSH_CMD "$USER@$HOST" "$1"; }

echo "═══════════════════════════════════════════════════"
echo -e " ${BLUE}🚀 Деплой Neon Tetris (Docker)${NC}"
echo "═══════════════════════════════════════════════════"
echo "  Пользователь   : $USER@$HOST"
echo "  SSH port       : $SSH_PORT  (key: $SSH_KEY)"
echo "  Репозиторий    : $REPO_URL"
echo "  Удалённый путь : $REMOTE_DIR"
echo "  Порт приложения: $PORT (внутренний, VIRTUAL_PORT)"
echo "═══════════════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# Шаг 0: Проверка соединения и инструментов на сервере
# ---------------------------------------------------------------------------
log "Подключаюсь к серверу..."
if ! run "echo connected" &>/dev/null; then
    err "Не могу подключиться к $USER@$HOST"
fi
ok "Подключено"

log "Проверяю инструменты на сервере..."
MISSING=""
for tool in git rsync docker curl; do
    if ! run "command -v $tool" &>/dev/null; then
        MISSING="$MISSING $tool"
    fi
done
if [[ -n "$MISSING" ]]; then
    err "На сервере нет:$MISSING — установите их перед деплоем"
fi
if ! run "docker compose version" &>/dev/null; then
    err "На сервере нет docker compose (v2) — деплой через Docker невозможен"
fi
ok "git / rsync / docker compose / curl на сервере есть"
echo ""

# ---------------------------------------------------------------------------
# Шаг 1: Клонирование репозитория на сервер
# ---------------------------------------------------------------------------
log "Клонирую $REPO_URL в $CLONE_DIR..."
run "rm -rf $CLONE_DIR && git clone --depth 1 $REPO_URL $CLONE_DIR"
ok "Репозиторий клонирован"
echo ""

# ---------------------------------------------------------------------------
# Шаг 2: Синхронизация в рабочую директорию
# ---------------------------------------------------------------------------
log "Синхронизирую $CLONE_DIR -> $REMOTE_DIR..."
run "mkdir -p $REMOTE_DIR && rsync -a --delete \
    --exclude=.git --exclude=node_modules --exclude=dist \
    --exclude=backend/data --exclude=nginx-proxy \
    $CLONE_DIR/ $REMOTE_DIR/"
run "rm -rf $CLONE_DIR"
ok "Файлы синхронизированы (backend/data и nginx-proxy не тронуты)"
echo ""

# ---------------------------------------------------------------------------
# Шаг 3: Сборка и запуск контейнера
# ---------------------------------------------------------------------------
log "Собираю docker-образ и поднимаю контейнер..."
run "cd $REMOTE_DIR && docker compose build && docker compose up -d"
ok "Контейнер поднят"
echo ""

# ---------------------------------------------------------------------------
# Шаг 4: Самопроверка
# ---------------------------------------------------------------------------
log "Жду ответа приложения..."
HTTP_CODE=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
    HTTP_CODE=$(run "curl -s -o /dev/null -w '%{http_code}' https://$HOST/" || echo 000)
    [[ "$HTTP_CODE" == "200" ]] && break
    sleep 3
done
if [[ "$HTTP_CODE" != "200" ]]; then
    warn "https://$HOST/ отвечает $HTTP_CODE. Логи контейнера:"
    run "docker logs --tail 20 $APP_CONTAINER" || true
    err "Приложение не отвечает 200"
fi
ok "https://$HOST/ → 200"

log "Проверяю GET https://$HOST/api/health..."
HEALTH_RAW=$(run "curl -s -w '\n%{http_code}' https://$HOST/api/health" || echo $'\n000')
HEALTH_CODE=$(echo "$HEALTH_RAW" | tail -1)
HEALTH_BODY=$(echo "$HEALTH_RAW" | head -n -1 | head -c 400)
if [[ "$HEALTH_CODE" != "200" ]]; then
    warn "Ответ ($HEALTH_CODE): $HEALTH_BODY"
    run "docker logs --tail 20 $APP_CONTAINER" || true
    err "GET /api/health вернул $HEALTH_CODE — ожидался 200 со статусом ok"
fi
ok "https://$HOST/api/health → 200: $(echo "$HEALTH_BODY" | tr -d '\n' | cut -c1-160)"
echo ""

log "Проверяю логи контейнера..."
run "docker logs --tail 15 $APP_CONTAINER"
echo ""

log "Проверяю внутренний порт приложения ($PORT) изнутри контейнера..."
if ! run "docker exec $APP_CONTAINER node -e 'fetch(\"http://127.0.0.1:$PORT/api/health\").then(r=>r.json().then(b=>{console.log(\"api/health\", r.status, r.headers.get(\"content-type\"), b.status, JSON.stringify(b.checks)); if(r.status!==200){process.exit(1)}})).catch(e=>{console.error(e.message);process.exit(1)})'"; then
    err "GET /api/health внутри контейнера не вернул 200 ok — приложение на порту $PORT нездорово"
fi
echo ""

log "Сравниваю хэш бандла: то, что отдаёт nginx, против того, что лежит в контейнере..."
ASSET=$(run "curl -s https://$HOST/ | grep -o 'assets/[^\"]*\.js' | head -1")
if [[ -z "$ASSET" ]]; then
    err "Не нашёл assets/*.js в HTML — похоже, отдаётся не SPA-билд"
fi
SERVED_SHA=$(run "curl -s https://$HOST/$ASSET | sha256sum | cut -d' ' -f1")
BUILT_SHA=$(run "docker exec $APP_CONTAINER sha256sum /app/frontend/dist/$ASSET | cut -d' ' -f1")
log "  $ASSET"
log "  отдаётся : $SERVED_SHA"
log "  в образе : $BUILT_SHA"
if [[ "$SERVED_SHA" == "$BUILT_SHA" ]]; then
    ok "Хэш бандла совпадает — домен отдаёт свежую сборку"
else
    err "Хэш бандла НЕ совпадает: домен отдаёт не тот билд, что собран из репозитория"
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
echo -e "   ${GREEN}https://${HOST}/${NC}  (HTTP → HTTPS редирект)"
echo -e "   ${GREEN}https://${HOST}/api/health${NC}  (JSON: статус, db, статика, websocket, runtime)"
echo -e "   ${GREEN}https://${HOST}/api/scores${NC}  (JSON рекордов)"
echo ""
echo -e " Управление (всё через Docker, PM2 на сервере нет):"
echo -e "   ssh $USER@$HOST \"cd $REMOTE_DIR && docker compose ps\""
echo -e "   ssh $USER@$HOST \"docker logs -f $APP_CONTAINER\""
echo -e "   ssh $USER@$HOST \"cd $REMOTE_DIR && docker compose restart\""
echo -e "   ssh $USER@$HOST \"cd $REMOTE_DIR && docker compose build && docker compose up -d\""
echo -e "   ssh $USER@$HOST \"cd $REMOTE_DIR && docker compose down\""
echo ""
echo -e " Данные рекордов: $REMOTE_DIR/backend/data/scores.json (volume, деплоем не перезаписывается)"
echo ""
