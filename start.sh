#!/usr/bin/env bash
# ============================================================================
# start.sh — Запуск Neon Tetris с HTTPS через nginx-proxy-acme
#
# Использование:
#   chmod +x start.sh
#   bash start.sh
# ============================================================================

set -euo pipefail

echo "═══════════════════════════════════════════════════"
echo "🚀 Запуск Neon Tetris с HTTPS (Let's Encrypt)"
echo "═══════════════════════════════════════════════════"
echo ""

# Проверяем, запущен ли docker
if ! command -v docker &>/dev/null; then
    echo "❌ Docker не установлен"
    exit 1
fi

# Запускаем nginx-proxy, если он ещё не запущен
echo "📡 Запускаем nginx-proxy + Let's Encrypt..."
(
    cd nginx-proxy
    docker compose up -d
)
echo "✅ nginx-proxy запущен"
echo ""

# Ждём пока nginx-proxy инициализируется
sleep 3

# Запускаем Neon Tetris
echo "🎮 Запускаем Neon Tetris..."
docker compose up -d
echo "✅ Neon Tetris запущен"
echo ""

echo "═══════════════════════════════════════════════════"
echo "🎉 Всё запущено!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Проект доступен по адресу:"
echo "  📌 http://ntetris.ddns.net"
echo "  🔒 https://ntetris.ddns.net (Let's Encrypt)"
echo ""
echo "Управление:"
echo "  docker compose -p tetris up -d   # Запустить"
echo "  docker compose -p tetris down     # Остановить"
echo "  docker logs nginx-proxy           # Логи прокси"
echo "  docker logs neon-tetris           # Логи приложения"
echo ""
