# ADR-001: Service Separation

## Context

The project has identity/session concerns and procurement/inventory workflow concerns. Keeping both in one application would simplify the runtime but blur those responsibilities.

## Decision

Use a FastAPI `auth-service` for registration, login, JWT issuance, and Redis session storage. Use an Express `inventory-service` for PR, PO, GR, and inventory operations. Nginx routes the two APIs through one local entry point.

## Alternatives

- A single backend application with authentication and workflow routes together.
- A separate database for each service.

## Consequences

Responsibility boundaries are easier to demonstrate, but Docker Compose and inter-service configuration add complexity. The services currently share PostgreSQL, so they are not fully data-independent services. This is a compact local architecture, not evidence of independently operated microservices.
