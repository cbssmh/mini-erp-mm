# Mini ERP MM v1.1.0 - Engineering Quality Update

This document prepares the v1.1.0 release scope. It does not represent a published GitHub Release or tag.

## Highlights

- Transactional goods receipt processing with row locking.
- PR, PO, and GR input validation plus state-transition checks.
- Duplicate PO and GR prevention with application checks and database constraints.
- JWT and Redis active-session protection for inventory APIs.
- Twelve real PostgreSQL and Redis integration tests, including rollback and authentication scenarios.
- Backend, PostgreSQL, and Redis health checks.
- GitHub Actions workflow configured for Docker Compose integration testing.

## Reliability

GR uses one database client for receipt insertion, PO completion, and stock increase. A failure rolls back the complete operation. The PO is locked before validation, and schema checks protect positive quantities, non-negative stock, and the one-PR-to-one-PO / one-PO-to-one-GR model.

## Testing

The suite contains 12 integration tests against real Compose services. It covers procurement workflow, invalid quantities, database constraints, forced rollback, missing resources, authentication failure cases, active Redis sessions, and unauthenticated health endpoints.

## Operations

Docker Compose health checks cover PostgreSQL, Redis, auth-service, and inventory-service. The CI workflow builds the stack, waits for health, runs the integration suite, prints logs on failure, and removes Compose resources afterward.

## Compatibility And Scope

- Existing `/auth/*` and `/inv/*` API paths are retained.
- Partial receipt, approval workflow, and stock movement ledger are not included.
- `db/init.sql` is initialization SQL, not an automatic migration.

## Upgrade Note

Existing PostgreSQL volumes do not automatically receive the v1.1.0 `db/init.sql` constraint changes. For a disposable local development environment, recreate the database volume:

```bash
docker compose down -v
docker compose up --build -d
```

Warning: `docker compose down -v` deletes all local database data. Do not use it for data that must be retained.
