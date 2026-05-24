const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
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

// -----------------------------
// 1. PR 생성
// -----------------------------
app.post("/pr", async (req, res) => {
  const { material_id, quantity, unit_price, department } = req.body;

  try {
    await pool.query(
      `INSERT INTO purchase_requisition 
      (material_id, quantity, unit_price, department, status, created_at)
       VALUES ($1, $2, $3, $4, 'CREATED', NOW())`,
      [material_id, quantity, unit_price, department]
    );

    res.json({ message: "PR created." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
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
  const { pr_id, vendor_id, expected_date } = req.body;

  try {
    await pool.query(
      `INSERT INTO purchase_order
      (pr_id, vendor_id, expected_date, status)
       VALUES ($1, $2, $3, 'OPEN')`,
      [pr_id, vendor_id, expected_date]
    );

    res.json({ message: "PO created." });
  } catch (err) {
    res.status(500).json({ error: "DB Error" });
  }
});

// -----------------------------
// 4. 입고(GR) 처리 → 재고 증가
// -----------------------------
app.post("/gr", async (req, res) => {
  const { po_id, received_quantity } = req.body;

  try {
    // 입고 기록
    await pool.query(
      `INSERT INTO goods_receipt 
      (po_id, received_quantity, received_at)
       VALUES ($1, $2, NOW())`,
      [po_id, received_quantity]
    );

    // PO → COMPLETED 변경
    await pool.query(
      `UPDATE purchase_order SET status='COMPLETED' WHERE po_id=$1`,
      [po_id]
    );

    // 재고 증가
    await pool.query(
      `UPDATE material 
       SET current_stock = current_stock + $1 
       WHERE material_id = (
         SELECT pr.material_id 
         FROM purchase_order po 
         JOIN purchase_requisition pr ON po.pr_id = pr.pr_id
         WHERE po.po_id=$2
       )`,
      [received_quantity, po_id]
    );

    res.json({ message: "Goods Received + Stock Updated." });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "DB Error" });
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

app.listen(4000, () => {
  console.log("Inventory Service running on port 4000");
});
