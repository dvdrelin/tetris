# Nginx Proxy + Let's Encrypt

Эта директория содержит инфраструктуру для HTTPS-проксирования Neon Tetris через nginx-proxy с автоматическим получением сертификатов Let's Encrypt.

## Компоненты

- **nginx-proxy** (`nginxproxy/nginx-proxy:1.11`) — проксирует запросы к контейнерам
- **acme-companion** (`nginxproxy/acme-companion`) — автоматически получает SSL-сертификаты Let's Encrypt

## Быстрый старт

```bash
docker compose up -d
```

## Как это работает

1. **nginx-proxy** — проксирует запросы к контейнерам, которым назначены переменные `VIRTUAL_HOST`
2. **acme-companion** — автоматически получает и обновляет SSL-сертификаты Let's Encrypt

## Настройка новых сервисов

Для добавления нового сервиса в прокси:

```yaml
version: '3.8'
services:
  my-service:
    environment:
      - VIRTUAL_HOST=example.com
      - VIRTUAL_PORT=8080
      - ACME_HOST=example.com
```

## Файлы конфигурации

- `docker-compose.yml` — определение сервисов
- `conf/nginx-proxy/` — конфигурация nginx (генерируется автоматически)

## Переменные окружения

| Переменная | Описание |
|-----------|----------|
| `VIRTUAL_HOST` | Доменное имя для проксирования |
| `VIRTUAL_PORT` | Порт внутреннего сервиса |
| `ACME_HOST` | Домен для SSL-сертификата |

## Обновление сертификатов

Компаньон автоматически обновляет сертификаты.

## Логи

```bash
docker logs nginx-proxy
docker logs nginx-proxy-letsencrypt
```
