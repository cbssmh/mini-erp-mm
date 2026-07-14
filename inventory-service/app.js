const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");
const app = express();

app.use(bodyParser.json());

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// -----------------------------
// DB 연결 설정
// -----------------------------
const pool = new Pool({
  host: process.env.DB_HOST || "db",
  user: requiredEnv("DB_USER"),
  password: requiredEnv("DB_PASSWORD"),
  database: requiredEnv("DB_NAME"),
  port: Number(process.env.DB_PORT || 5432),
});

const JWT_SECRET = requiredEnv("JWT_SECRET");
const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const redisClient = createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
let redisConnecting;

redisClient.on("error", (error) => {
  console.error("Redis client error:", error.message);
});

class ApiError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function sendError(res, error) {
  res.status(error.status).json({
    error: error.error,
    message: error.message,
  });
}

function logDatabaseError(operation, error) {
  console.error(`${operation} failed:`, error.message);
}

async function getRedisClient() {
  if (redisClient.isReady) {
    return redisClient;
  }

  if (!redisConnecting) {
    redisConnecting = redisClient.connect().finally(() => {
      redisConnecting = undefined;
    });
  }

  await redisConnecting;
  return redisClient;
}

async function closeRedis() {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

function unauthorized(res) {
  return res.status(401).json({
    error: "UNAUTHORIZED",
    message: "Authentication is required.",
  });
}

async function authenticate(req, res, next) {
  const authorization = req.get("Authorization");
  if (!authorization) {
    return unauthorized(res);
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return unauthorized(res);
  }

  const token = match[1];
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (error) {
    return unauthorized(res);
  }

  if (!payload || typeof payload.username !== "string" || !payload.username) {
    return unauthorized(res);
  }

  try {
    const client = await getRedisClient();
    const savedToken = await client.get(`session:${payload.username}`);
    if (savedToken !== token) {
      return unauthorized(res);
    }
  } catch (error) {
    console.error("Authentication session check failed:", error.message);
    return res.status(503).json({
      error: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service is unavailable.",
    });
  }

  req.user = { username: payload.username };
  return next();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "inventory-service" });
});

app.use(authenticate);

// -----------------------------
// 1. PR 생성
// -----------------------------
app.post("/pr", async (req, res) => {
  const { material_id, quantity, unit_price, department } = req.body || {};

  try {
    if (!isPositiveInteger(material_id) || !isPositiveInteger(quantity)) {
      throw new ApiError(
        400,
        "INVALID_PURCHASE_REQUISITION_INPUT",
        "material_id and quantity must be positive integers."
      );
    }

    if (unit_price === undefined || unit_price === null || unit_price === "" || !Number.isFinite(unit_price)) {
      throw new ApiError(
        400,
        "INVALID_PURCHASE_REQUISITION_INPUT",
        "unit_price is required and must be a number."
      );
    }

    const material = await pool.query(
      "SELECT material_id FROM material WHERE material_id = $1",
      [material_id]
    );

    if (material.rowCount === 0) {
      throw new ApiError(404, "MATERIAL_NOT_FOUND", "The material does not exist.");
    }

    await pool.query(
      `INSERT INTO purchase_requisition 
      (material_id, quantity, unit_price, department, status, created_at)
       VALUES ($1, $2, $3, $4, 'CREATED', NOW())`,
      [material_id, quantity, unit_price, department]
    );

    res.json({ message: "PR created." });
  } catch (err) {
    if (err instanceof ApiError) {
      return sendError(res, err);
    }

    logDatabaseError("Create PR", err);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: "Unable to create purchase requisition." });
  }
});

// -----------------------------
// 2. PR 목록 조회
// -----------------------------
app.get("/pr", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM purchase_requisition");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "DB Error" });
  }
});

// -----------------------------
// 3. PO 생성
// -----------------------------
app.post("/po", async (req, res) => {
  const { pr_id, vendor_id, expected_date } = req.body || {};

  try {
    if (!isPositiveInteger(pr_id) || !isPositiveInteger(vendor_id)) {
      throw new ApiError(
        400,
        "INVALID_PURCHASE_ORDER_INPUT",
        "pr_id and vendor_id must be positive integers."
      );
    }

    const pr = await pool.query(
      "SELECT pr_id FROM purchase_requisition WHERE pr_id = $1",
      [pr_id]
    );
    if (pr.rowCount === 0) {
      throw new ApiError(404, "PURCHASE_REQUISITION_NOT_FOUND", "The purchase requisition does not exist.");
    }

    const vendor = await pool.query(
      "SELECT vendor_id FROM vendor WHERE vendor_id = $1",
      [vendor_id]
    );
    if (vendor.rowCount === 0) {
      throw new ApiError(404, "VENDOR_NOT_FOUND", "The vendor does not exist.");
    }

    const existingPo = await pool.query(
      "SELECT po_id FROM purchase_order WHERE pr_id = $1",
      [pr_id]
    );
    if (existingPo.rowCount > 0) {
      throw new ApiError(
        409,
        "PURCHASE_ORDER_ALREADY_EXISTS",
        "A purchase order already exists for this purchase requisition."
      );
    }

    await pool.query(
      `INSERT INTO purchase_order
      (pr_id, vendor_id, expected_date, status)
       VALUES ($1, $2, $3, 'OPEN')`,
      [pr_id, vendor_id, expected_date]
    );

    res.json({ message: "PO created." });
  } catch (err) {
    if (err instanceof ApiError) {
      return sendError(res, err);
    }

    if (err.code === "23505") {
      return sendError(
        res,
        new ApiError(
          409,
          "PURCHASE_ORDER_ALREADY_EXISTS",
          "A purchase order already exists for this purchase requisition."
        )
      );
    }

    logDatabaseError("Create PO", err);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: "Unable to create purchase order." });
  }
});

// -----------------------------
// 4. 입고(GR) 처리 → 재고 증가
// -----------------------------
app.post("/gr", async (req, res) => {
  const { po_id, received_quantity } = req.body || {};

  if (!isPositiveInteger(po_id) || !isPositiveInteger(received_quantity)) {
    return sendError(
      res,
      new ApiError(
        400,
        "INVALID_GOODS_RECEIPT_INPUT",
        "po_id and received_quantity must be positive integers."
      )
    );
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const po = await client.query(
      `SELECT po.po_id, po.status, pr.material_id, pr.quantity
       FROM purchase_order po
       JOIN purchase_requisition pr ON po.pr_id = pr.pr_id
       WHERE po.po_id = $1
       FOR UPDATE`,
      [po_id]
    );

    if (po.rowCount === 0) {
      throw new ApiError(404, "PURCHASE_ORDER_NOT_FOUND", "The purchase order does not exist.");
    }

    const purchaseOrder = po.rows[0];
    if (purchaseOrder.status === "COMPLETED") {
      throw new ApiError(
        409,
        "PURCHASE_ORDER_ALREADY_COMPLETED",
        "The purchase order has already been completed."
      );
    }

    if (purchaseOrder.status !== "OPEN") {
      throw new ApiError(
        409,
        "PURCHASE_ORDER_INVALID_STATUS",
        "The purchase order is not open for goods receipt."
      );
    }

    if (received_quantity !== Number(purchaseOrder.quantity)) {
      throw new ApiError(
        400,
        "GOODS_RECEIPT_QUANTITY_MISMATCH",
        "received_quantity must match the purchase order quantity."
      );
    }

    const existingReceipt = await client.query(
      "SELECT gr_id FROM goods_receipt WHERE po_id = $1",
      [po_id]
    );
    if (existingReceipt.rowCount > 0) {
      throw new ApiError(
        409,
        "GOODS_RECEIPT_ALREADY_EXISTS",
        "A goods receipt already exists for this purchase order."
      );
    }

    await client.query(
      `INSERT INTO goods_receipt 
      (po_id, received_quantity, received_at)
       VALUES ($1, $2, NOW())`,
      [po_id, received_quantity]
    );

    const poUpdate = await client.query(
      "UPDATE purchase_order SET status = 'COMPLETED' WHERE po_id = $1 AND status = 'OPEN'",
      [po_id]
    );
    if (poUpdate.rowCount !== 1) {
      throw new ApiError(
        409,
        "PURCHASE_ORDER_INVALID_STATUS",
        "The purchase order is not open for goods receipt."
      );
    }

    const stockUpdate = await client.query(
      "UPDATE material SET current_stock = current_stock + $1 WHERE material_id = $2",
      [received_quantity, purchaseOrder.material_id]
    );
    if (stockUpdate.rowCount !== 1) {
      throw new ApiError(404, "MATERIAL_NOT_FOUND", "The material does not exist.");
    }

    await client.query("COMMIT");

    res.json({ message: "Goods Received + Stock Updated." });
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logDatabaseError("Rollback GR transaction", rollbackError);
      }
    }

    if (err instanceof ApiError) {
      return sendError(res, err);
    }

    if (err.code === "23505") {
      return sendError(
        res,
        new ApiError(
          409,
          "GOODS_RECEIPT_ALREADY_EXISTS",
          "A goods receipt already exists for this purchase order."
        )
      );
    }

    logDatabaseError("Process GR", err);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: "Unable to process goods receipt." });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// -----------------------------
// 5. 재고 조회
// -----------------------------
app.get("/inventory", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM material");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "DB Error" });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`Inventory Service running on port ${port}`);
  });
}

module.exports = { app, pool, redisClient, closeRedis };
