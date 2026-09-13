# Nginx Proxy + Let's Encrypt

Эта директория содержит инфраструктуру для HTTPS-проксирования Neon Tetris через nginx-proxy с автоматическим получением сертификатов Let's Encrypt.

## Быстрый старт

```bash
docker compose up -d
```

## Как это работает

**nginx-proxy-acme** объединяет в себе:
- **nginx-proxy** — проксирует запросы к контейнерам, которым назначены переменные `VIRTUAL_HOST`
- **acme.sh** — автоматически получает и обновляет SSL-сертификаты Let's Encrypt

## Настройка новых сервисов

Для добавления нового сервиса в прокси:

```yaml
version: '3.8'
services:
  my-service:
    environment:
      - VIRTUAL_HOST=example.com
      - VIRTUAL_PORT=8080
      - LETSENCRYPT_HOST=example.com
      - LETSENCRYPT_EMAIL=dvdrelin@gmail.com
```

## Файлы конфигурации

- `docker-compose.yml` — определение сервиса
- `conf/nginx-proxy/` — конфигурация nginx (генерируется автоматически)

## Переменные окружения

| Переменная | Описание |
|-----------|----------|
| `VIRTUAL_HOST` | Доменное имя для проксирования |
| `VIRTUAL_PORT` | Порт внутреннего сервиса |
| `LETSENCRYPT_HOST` | Домен для SSL-сертификата |
| `LETSENCRYPT_EMAIL` | Email для Let's Encrypt |

## Обновление сертификатов

Компаньон автоматически обновляет сертификаты. Для принудительного обновления:

```bash
docker exec nginx-proxy /bin/sh -c "python3 /app/acme.sh --force"
```

## Логи

```bash
docker logs nginx-proxy
```

## Запуск Neon Tetris

После запуска nginx-proxy, перенесите docker-compose.yml из родительской директории в текущую и запустите:

```bash
cd /GIT/tetris
docker compose up -d
```

Проект автоматически будет доступен по адресу `https://ntetris.ddns.net`.
