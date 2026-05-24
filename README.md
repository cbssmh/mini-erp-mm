# Mini ERP Material Management Backend

A containerized mini ERP system that models a simplified material-management workflow inspired by enterprise procurement processes. The project explores how backend services can represent business documents, lifecycle states, inventory movement, authentication, and service boundaries in an ERP-style environment.

The core business flow is:

```text
Purchase Requisition (PR) -> Purchase Order (PO) -> Goods Receipt (GR) -> Inventory Update
```

This repository is intentionally compact, but it is structured around backend concepts that are common in enterprise systems: process-oriented data models, state transitions, transactional business operations, API gateways, service separation, persistent operational records, and containerized deployment.

## Project Overview

Mini ERP MM is a backend-focused business workflow system for managing a basic procurement-to-inventory lifecycle.

It includes:

- A FastAPI authentication service for user registration, login, JWT creation, and Redis-backed session validation.
- A Node.js Express inventory service for purchase requisitions, purchase orders, goods receipt processing, and inventory lookup.
- A PostgreSQL schema containing the operational business entities: materials, vendors, purchase requisitions, purchase orders, goods receipts, and users.
- An Nginx reverse proxy that exposes the system through a single HTTP entry point.
- A small HTML/Bootstrap frontend for manually exercising the workflow.
- Docker Compose orchestration for local end-to-end execution.

The project should be read as a business-process backend prototype rather than a full production ERP. Its value is in the modeling of workflow, service responsibilities, persistence, and lifecycle-oriented backend behavior.

## Business Problem Being Explored

Enterprise material-management systems need to coordinate purchasing intent, supplier ordering, receipt confirmation, and inventory updates. Even a simple procurement flow has multiple stateful business documents:

- A department requests a material.
- Purchasing converts that request into an order for a vendor.
- Receiving confirms that goods arrived.
- Inventory stock is updated as a result of the receiving event.

This project explores how that process can be represented in backend services using relational data, API endpoints, status fields, and explicit write operations. It demonstrates the foundation of ERP-style thinking: business events are not just CRUD records; they move work through a lifecycle and mutate operational state.

## Key Features

- Procurement lifecycle from PR creation to goods receipt.
- Material master data with stock quantity and average price fields.
- Vendor master data for purchase order assignment.
- Purchase requisition tracking by material, quantity, unit price, department, status, and creation timestamp.
- Purchase order creation linked back to the originating purchase requisition.
- Goods receipt processing that records the receipt event, completes the purchase order, and increases material stock.
- JWT-based authentication with password hashing.
- Redis-backed session storage for issued login tokens.
- PostgreSQL-backed operational persistence.
- Reverse-proxy routing through Nginx for frontend, auth, and inventory APIs.
- Dockerized services for repeatable local execution.

## System Architecture

```text
Browser
  |
  v
Nginx Reverse Proxy (:80)
  |
  |-- /              -> Frontend container (Nginx static HTML)
  |-- /auth/*        -> Auth Service (FastAPI, Python)
  |-- /inv/*         -> Inventory Service (Express, Node.js)
                         |
                         v
                    PostgreSQL

Auth Service
  |
  |-- PostgreSQL users table
  |-- Redis session store
```

### Service Responsibilities

| Component | Responsibility |
| --- | --- |
| `proxy` | Single ingress point, path-based routing, service hiding behind stable URL prefixes. |
| `frontend` | Lightweight workflow UI for testing register, login, PR, PO, GR, and inventory operations. |
| `auth-service` | User registration, password hashing, JWT issuance, token validation, Redis session checks. |
| `inventory-service` | Business workflow APIs for purchasing and inventory operations. |
| `db` | PostgreSQL relational store for master data, business documents, and users. |
| `redis` | Session cache for active JWT tokens. |

## Workflow / Lifecycle Explanation

The inventory service models a simplified procurement lifecycle through linked business records.

### 1. Purchase Requisition

A purchase requisition captures internal demand from a department.

```text
purchase_requisition.status = CREATED
```

The PR records the requested material, quantity, expected unit price, requesting department, and creation time. This is the first business document in the workflow.

### 2. Purchase Order

A purchase order is created from a purchase requisition and assigned to a vendor.

```text
purchase_order.status = OPEN
```

The PO references the PR, preserving traceability from internal demand to external supplier order. In a larger ERP system, this stage would typically include approval, sourcing, pricing, and vendor terms. This project keeps the model focused on lifecycle progression.

### 3. Goods Receipt

A goods receipt confirms that ordered material was received.

The `/gr` operation performs three business actions:

1. Inserts a `goods_receipt` record.
2. Updates the related purchase order to `COMPLETED`.
3. Increases `material.current_stock` for the material referenced by the originating PR.

```text
purchase_order.status: OPEN -> COMPLETED
material.current_stock: current_stock + received_quantity
```

This is the most important transactional operation in the project because it turns a receiving event into an inventory movement.

### 4. Inventory Visibility

Inventory can be queried through the `/inventory` endpoint. Stock is maintained on the material master record, allowing the current quantity on hand to be viewed after receipt processing.

## Backend Architecture Explanation

The backend is organized around service boundaries and business capabilities.

### Authentication Boundary

The authentication service owns identity-related operations:

- Registers users in PostgreSQL.
- Hashes passwords using bcrypt.
- Issues JWT tokens with a six-hour expiration.
- Stores issued tokens in Redis using a session key.
- Validates `/me` requests by checking both JWT validity and Redis session state.

This separates access/session concerns from the material-management workflow.

### Inventory and Procurement Boundary

The inventory service owns the procurement and stock lifecycle:

- `POST /pr` creates purchasing demand.
- `GET /pr` exposes requisition history.
- `POST /po` converts a requisition into an order.
- `POST /gr` records receipt, completes the order, and updates stock.
- `GET /inventory` returns material stock state.

The service uses PostgreSQL foreign keys to preserve document relationships:

```text
purchase_order.pr_id -> purchase_requisition.pr_id
goods_receipt.po_id  -> purchase_order.po_id
purchase_requisition.material_id -> material.material_id
purchase_order.vendor_id -> vendor.vendor_id
```

### Relational Domain Model

The schema separates master data from transactional documents:

| Table | Role |
| --- | --- |
| `material` | Material master, unit of measure, current stock, average price. |
| `vendor` | Supplier master data. |
| `purchase_requisition` | Internal demand document. |
| `purchase_order` | Supplier-facing procurement document. |
| `goods_receipt` | Receiving event and audit record. |
| `users` | Authentication identity records. |

This structure mirrors a common enterprise backend pattern: master data defines stable business objects, while transactional tables represent process events and lifecycle documents.

### Maintainability Considerations

The project keeps responsibilities clear:

- API gateway concerns are isolated in Nginx.
- Authentication is implemented independently from inventory workflow logic.
- Material-management operations are grouped in a dedicated inventory service.
- Persistence is centralized in PostgreSQL with explicit relational links.
- Runtime configuration is provided through Docker Compose environment variables.
- The schema and sample data live in `db/init.sql`, making local environments reproducible.

Areas intentionally left as future production hardening include wrapping multi-step goods receipt processing in an explicit database transaction, applying auth middleware to inventory endpoints, adding validation schemas to the Express service, expanding status transition rules, and introducing automated tests.

## Tech Stack

| Layer | Technology |
| --- | --- |
| API Gateway | Nginx |
| Auth Service | Python, FastAPI, Pydantic, PyJWT, Passlib bcrypt |
| Inventory Service | Node.js, Express, `pg` |
| Database | PostgreSQL 14 |
| Session Store | Redis |
| Frontend | HTML, Bootstrap, Nginx static hosting |
| Runtime / Delivery | Docker, Docker Compose |

## API Examples

All examples assume the stack is running through the Nginx reverse proxy at `http://localhost`.

### Register User

```bash
curl -X POST http://localhost/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "buyer01",
    "password": "secret123"
  }'
```

### Login

```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "buyer01",
    "password": "secret123"
  }'
```

Example response:

```json
{
  "token": "<jwt-token>"
}
```

### Validate Current User

```bash
curl http://localhost/auth/me \
  -H "Authorization: Bearer <jwt-token>"
```

### Create Purchase Requisition

```bash
curl -X POST http://localhost/inv/pr \
  -H "Content-Type: application/json" \
  -d '{
    "material_id": 1,
    "quantity": 5,
    "unit_price": 800.00,
    "department": "IT"
  }'
```

### List Purchase Requisitions

```bash
curl http://localhost/inv/pr
```

### Create Purchase Order

```bash
curl -X POST http://localhost/inv/po \
  -H "Content-Type: application/json" \
  -d '{
    "pr_id": 1,
    "vendor_id": 1,
    "expected_date": "2026-06-15"
  }'
```

### Process Goods Receipt

```bash
curl -X POST http://localhost/inv/gr \
  -H "Content-Type: application/json" \
  -d '{
    "po_id": 1,
    "received_quantity": 5
  }'
```

### View Inventory

```bash
curl http://localhost/inv/inventory
```

Example response:

```json
[
  {
    "material_id": 1,
    "material_name": "Laptop",
    "unit": "EA",
    "current_stock": 15,
    "avg_price": "800.00"
  }
]
```

## Project Structure

```text
.
├── auth-service/
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── main.py
│   └── requirements.txt
├── db/
│   └── init.sql
├── docs/
│   └── diagram.pdf
├── frontend/
│   ├── .dockerignore
│   ├── Dockerfile
│   └── index.html
├── inventory-service/
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── app.js
│   └── package.json
├── proxy/
│   └── nginx.conf
├── .env.example
├── .gitignore
├── LICENSE
├── docker-compose.yml
└── README.md
```

## Running Locally

Create a local environment file from the template:

```bash
cp .env.example .env
```

Then replace the placeholder values in `.env` with local development values.

Start the full system:

```bash
docker-compose up --build
```

Open the frontend:

```text
http://localhost
```

The Nginx proxy exposes:

```text
Frontend:          http://localhost/
Auth APIs:         http://localhost/auth/*
Inventory APIs:    http://localhost/inv/*
```

PostgreSQL is initialized from `db/init.sql` with sample materials and vendors.

## Enterprise Backend Concepts Demonstrated

- Business workflow modeling with explicit lifecycle documents.
- State transitions across purchasing and receiving operations.
- Inventory mutation triggered by a business event.
- Separation of master data and transactional records.
- Service boundary between authentication and material-management operations.
- Relational traceability from PR to PO to GR.
- Gateway-based routing for a multi-service backend.
- Containerized local runtime suitable for repeatable review and demonstration.

## Future Improvements

- Add database transactions around goods receipt processing.
- Enforce formal workflow transition rules and invalid-state rejection.
- Apply JWT authorization to inventory endpoints.
- Add role-based access control for requesters, buyers, receivers, and admins.
- Add request validation and domain-specific error responses to the inventory service.
- Add integration tests for PR, PO, GR, and stock update behavior.
- Add audit fields such as created_by, approved_by, received_by, and updated_at.
- Support partial receipts and over-receipt validation.
- Add stock movement ledger records instead of only updating current stock.
