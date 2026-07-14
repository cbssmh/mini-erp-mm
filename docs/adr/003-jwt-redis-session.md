# ADR-003: JWT And Redis Session Validation

## Context

JWT verification alone establishes signature and expiry but does not check whether an issued token remains the active session. Inventory routes need to use the existing login flow without a new authentication service.

## Decision

The inventory service verifies HS256 JWTs with the shared `JWT_SECRET`, reads `session:{username}` from Redis, and requires the stored token to match the bearer token. The auth service creates that session at login.

## Alternatives

- Validate only the JWT signature and expiry.
- Call an auth-service endpoint for every inventory request.
- Add refresh tokens, logout endpoints, or RBAC.

## Consequences

Redis enables active-session comparison but adds a runtime dependency and couples inventory authentication to the auth session format. Redis failures produce `503`; role-based authorization and refresh tokens remain out of scope.
