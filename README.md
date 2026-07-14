# Mini ERP Material Management Backend

A compact ERP-style backend that models the Purchase Requisition (PR) -> Purchase Order (PO) -> Goods Receipt (GR) -> Inventory workflow with transactional consistency, authentication, and PostgreSQL integration tests.

This is a learning and portfolio project for modeling an ERP-style procurement workflow. It does not reproduce SAP MM or aim to be a production ERP replacement.

## What This Project Demonstrates

- PostgreSQL transaction handling with `SELECT ... FOR UPDATE` for goods receipt processing.
- Application validation plus database `CHECK` and `UNIQUE` constraints.
- JWT authentication with Redis-backed active-session validation.
- Twelve integration tests against a real PostgreSQL and Redis Compose environment.
- Docker Compose local execution, service health checks, Nginx path routing, and a configured GitHub Actions workflow.

## Business Workflow

```text
Purchase Requisition
  -> Purchase Order
  -> Goods Receipt
  -> Purchase Order COMPLETED
  -> Material inventory increased
```

| Document | Role in the current model |
| --- | --- |
| PR | Records internal material demand, quantity, unit price, and department. |
| PO | Connects one PR to one vendor and begins in `OPEN`. |
| GR | Confirms receipt, completes the PO, and increases material stock. |

Current scope rules:

- One PR can have one PO; one PO can have one GR.
- Partial receipts are not supported.
- A GR quantity must equal the originating PR quantity.
- The only allowed PO transition is `OPEN -> COMPLETED`.
- A completed PO cannot receive goods again.

## Architecture

```text
Browser
  |
  v
Nginx (:80)
  |-- /auth/* -> FastAPI auth-service
  |-- /inv/*  -> Express inventory-service
  `-- /       -> static frontend

auth-service
  |-- PostgreSQL users table
  `-- Redis session:{username}

inventory-service
  |-- PostgreSQL procurement and inventory tables
  `-- Redis active-session validation
```

The backend is separated into two services by responsibility and executed together through Docker Compose. Both services use the same PostgreSQL database; this is not a fully data-independent microservice architecture. Nginx provides the single local HTTP entry point and path-based routing.

An [existing architecture diagram](docs/diagram.pdf) is included from the original project. Its current structural alignment has not been revalidated in this documentation update.

## Key Engineering Improvements

### Transaction And Data Consistency

Goods receipt processing uses one PostgreSQL client and the following transaction sequence:

```text
BEGIN
-> SELECT purchase order FOR UPDATE
-> Validate status and quantity
-> Insert goods receipt
-> Mark purchase order COMPLETED
-> Increase material inventory
-> COMMIT
```

Any failure triggers `ROLLBACK`, preventing a GR record, PO status, and inventory value from being only partly updated. The row lock serializes concurrent GR attempts for the same PO.

The schema adds `quantity > 0`, `received_quantity > 0`, and `current_stock >= 0` checks, plus unique PR-to-PO and PO-to-GR relationships. Application validation provides request-level feedback; database constraints protect data if API validation is bypassed.

### Authentication Flow

```text
Login
-> FastAPI verifies password
-> JWT issued with HS256
-> Token stored as Redis session:{username}
-> Client sends Authorization: Bearer <token>
-> Inventory service verifies JWT
-> Inventory service compares the Redis session token
-> Request allowed
```

The auth and inventory services use the same `JWT_SECRET`. Missing headers, malformed or invalid JWTs, and missing or mismatched Redis sessions return `401`. Redis session-check failures return `503` without exposing internal details. `/auth/health` and `/inv/health` do not require authentication.

This is authentication and active-session validation, not role-based authorization. RBAC and refresh tokens are out of scope.

## Testing

The integration suite currently contains **12 tests** and is run against real PostgreSQL and Redis services, not database mocks.

| Area | Covered scenarios |
| --- | --- |
| Workflow | PR -> PO -> GR -> inventory, duplicate PO, duplicate GR, missing resources |
| Consistency | zero/negative quantity, database checks and uniqueness, forced rollback |
| Authentication | missing token, invalid JWT, absent Redis session, real login token, unauthenticated health endpoints |

The rollback test temporarily creates a PostgreSQL trigger that fails the material update. It then confirms that the GR is absent, the PO remains `OPEN`, and stock remains unchanged.

## Local Setup

Prerequisites: Docker and Docker Compose.

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
```

The `.env.example` values are development placeholders. Replace them in `.env` for local use; do not commit real secrets.

Check health through Nginx:

```bash
curl http://localhost/auth/health
curl http://localhost/inv/health
```

Run the integration tests:

```bash
docker compose exec -T inventory-service npm test
```

Stop services while preserving the database volume:

```bash
docker compose down
```

Reset the local database:

```bash
docker compose down -v
```

`-v` deletes the PostgreSQL volume and all local data. `db/init.sql` is applied only when PostgreSQL initializes a new volume; it is not a migration mechanism for an existing volume.

## CI

The [GitHub Actions workflow](.github/workflows/ci.yml) is configured to perform:

```text
Checkout
-> Prepare .env from .env.example
-> Validate Compose configuration
-> Build and start services
-> Wait for DB, Redis, auth, and inventory health checks
-> Run integration tests
-> Print logs on failure
-> Always remove containers and volumes
```

It uses local Compose services and placeholder environment values only. This repository does not claim a recorded GitHub Actions run in this document.

## API Overview

| Method | Path | Auth | Purpose |
| --- | --- | ---: | --- |
| POST | `/auth/register` | No | Create a user. |
| POST | `/auth/login` | No | Issue a JWT and Redis session. |
| GET | `/auth/me` | Yes | Validate the active session. |
| GET | `/auth/health` | No | Auth process health. |
| POST | `/inv/pr` | Yes | Create a purchase requisition. |
| GET | `/inv/pr` | Yes | List purchase requisitions. |
| POST | `/inv/po` | Yes | Create a purchase order. |
| POST | `/inv/gr` | Yes | Process a goods receipt. |
| GET | `/inv/inventory` | Yes | View material inventory. |
| GET | `/inv/health` | No | Inventory process health. |

## Limitations

- Local Docker Compose execution only; no production deployment record.
- No role-based authorization or refresh tokens.
- No partial receipt, approval workflow, or stock movement ledger.
- No migration tool; schema initialization applies only to a new database volume.
- Shared PostgreSQL database between services.
- Redis has no password configuration; its port is not published to the host, but this is not a hardened production setup.
- No metrics, alerting, automated backup, or restore workflow.
- Not a complete SAP MM implementation, production ERP replacement, large-scale distributed architecture, or Kubernetes deployment.

## Documentation

- [Architecture decisions](docs/adr/)
- [Operations guide](docs/operations.md)
- [v1.1.0 release notes](RELEASE_NOTES.md)
- [Integration tests](inventory-service/test/integration.test.js)
- [CI workflow](.github/workflows/ci.yml)
