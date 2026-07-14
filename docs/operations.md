# Operations Guide

This guide is for local Docker Compose execution. It does not describe a production deployment.

## Prerequisites

- Docker
- Docker Compose

## Environment Setup

```bash
cp .env.example .env
```

Set development values in `.env` without committing it. `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` configure both backend database clients. `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` initialize PostgreSQL. `REDIS_HOST` and `REDIS_PORT` configure sessions. `JWT_SECRET` signs and verifies JWTs.

## Start

```bash
docker compose up --build -d
```

## Verify

```bash
docker compose ps
curl http://localhost/auth/health
curl http://localhost/inv/health
```

The database, Redis, auth service, and inventory service expose Compose health checks. The proxy and frontend do not have health checks.

## Test

```bash
docker compose exec -T inventory-service npm test
```

## Logs

```bash
docker compose logs --tail=100
docker compose logs -f inventory-service
docker compose logs -f auth-service
```

## Stop And Reset

```bash
docker compose down
```

```bash
docker compose down -v
```

The reset command deletes the PostgreSQL volume and all local data. Use it when a clean initialization from `db/init.sql` is required.

## Common Problems

| Problem | Check | Response |
| --- | --- | --- |
| A service is unhealthy | `docker compose ps` and `docker compose logs --tail=100 <service>` | Resolve the reported startup error, then recreate the stack. |
| PostgreSQL is not ready | `docker compose exec -T db pg_isready` | Wait for readiness; inspect `docker compose logs db` if it does not become ready. |
| Redis is unavailable | `docker compose exec -T redis redis-cli ping` | Confirm `PONG`; inspect Redis logs and environment values. |
| Inventory returns 401 | Check the `Authorization: Bearer <token>` header | Log in again and use the current token; verify the Redis session exists. |
| `.env` is missing | `test -f .env` | Run `cp .env.example .env` and set local development values. |
| Port 80 is occupied | `docker compose ps` and local port inspection | Stop the conflicting process or change the proxy host port mapping. |
| Image build fails | `docker compose build --no-cache <service>` | Review dependency download and build output, then retry after correcting the cause. |

## Known Operational Limits

- Single-host Compose runtime only.
- Redis has no password configuration. Its port is not published to the host, but the setup is not production hardened.
- No automated backup or restore process.
- No metrics or alerting.
- No production operation validation.
