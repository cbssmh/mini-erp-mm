# ADR-002: Goods Receipt Transaction

## Context

A GR writes a receipt record, changes a PO from `OPEN` to `COMPLETED`, and increases material stock. Separate queries could leave only some changes committed after an error or concurrent request.

## Decision

Use one PostgreSQL transaction and one client. Lock the PO with `SELECT ... FOR UPDATE`, validate the state and quantity, insert the GR, update the PO, update stock, and commit. Roll back on any error.

## Alternatives

- Execute the three writes independently.
- Use application-only duplicate checks without row locking.
- Add partial-receipt accounting.

## Consequences

The current one-GR model prevents duplicate receipt and partial state changes for one PO. It intentionally does not support partial receipts, over-receipt logic, or a separate stock movement ledger.
