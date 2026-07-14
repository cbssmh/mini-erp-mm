const assert = require("node:assert/strict");
const { after, afterEach, before, test } = require("node:test");
const { once } = require("node:events");
const { app, closeRedis, pool, redisClient } = require("../app");

let server;
let baseUrl;
let authToken;
let username;
const password = "integration-test-password";
const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:8000";

async function request(path, body, options = {}) {
  const { method = body === undefined ? "GET" : "POST", token = authToken } = options;
  const headers = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { response, body: await response.json() };
}

async function loginTestUser() {
  const response = await fetch(`${authServiceUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof body.token, "string");
  return body.token;
}

async function createMaterialAndVendor(stock = 10) {
  const material = await pool.query(
    "INSERT INTO material (material_name, unit, current_stock, avg_price) VALUES ($1, 'EA', $2, 100) RETURNING material_id",
    ["Test Material", stock]
  );
  const vendor = await pool.query(
    "INSERT INTO vendor (vendor_name, contact) VALUES ($1, $2) RETURNING vendor_id",
    ["Test Vendor", "test@example.com"]
  );

  return {
    materialId: material.rows[0].material_id,
    vendorId: vendor.rows[0].vendor_id,
  };
}

async function createPurchaseRequisition(materialId, quantity = 5) {
  const result = await request("/pr", {
    material_id: materialId,
    quantity,
    unit_price: 100,
    department: "QA",
  });
  assert.equal(result.response.status, 200);

  const pr = await pool.query(
    "SELECT pr_id FROM purchase_requisition WHERE material_id = $1",
    [materialId]
  );
  return pr.rows[0].pr_id;
}

async function createPurchaseOrder(prId, vendorId) {
  const result = await request("/po", {
    pr_id: prId,
    vendor_id: vendorId,
    expected_date: "2026-12-31",
  });
  assert.equal(result.response.status, 200);

  const po = await pool.query("SELECT po_id FROM purchase_order WHERE pr_id = $1", [prId]);
  return po.rows[0].po_id;
}

function assertErrorResponse(result, status) {
  assert.equal(result.response.status, status);
  assert.equal(typeof result.body.error, "string");
  assert.equal(typeof result.body.message, "string");
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  username = `inventory-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const registerResponse = await fetch(`${authServiceUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(registerResponse.status, 200);
  authToken = await loginTestUser();
});

afterEach(async () => {
  await pool.query(
    "TRUNCATE TABLE goods_receipt, purchase_order, purchase_requisition, material, vendor RESTART IDENTITY CASCADE"
  );
  authToken = await loginTestUser();
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await closeRedis();
  await pool.end();
});

test("health endpoints are available without authentication", async () => {
  const inventoryHealth = await fetch(`${baseUrl}/health`);
  assert.equal(inventoryHealth.status, 200);
  assert.deepEqual(await inventoryHealth.json(), { status: "ok", service: "inventory-service" });

  const authHealth = await fetch(`${authServiceUrl}/health`);
  assert.equal(authHealth.status, 200);
  assert.deepEqual(await authHealth.json(), { status: "ok", service: "auth-service" });
});

test("protected endpoints reject requests without an authorization header", async () => {
  const result = await request(
    "/pr",
    { material_id: 1, quantity: 5, unit_price: 100, department: "QA" },
    { token: null }
  );
  assertErrorResponse(result, 401);

  const count = await pool.query("SELECT COUNT(*) FROM purchase_requisition");
  assert.equal(Number(count.rows[0].count), 0);
});

test("protected endpoints reject invalid JWTs", async () => {
  const result = await request(
    "/pr",
    { material_id: 1, quantity: 5, unit_price: 100, department: "QA" },
    { token: "invalid.jwt.token" }
  );
  assertErrorResponse(result, 401);

  const count = await pool.query("SELECT COUNT(*) FROM purchase_requisition");
  assert.equal(Number(count.rows[0].count), 0);
});

test("a signed JWT without a Redis session is rejected", async () => {
  const tokenWithoutSession = authToken;
  const validAccess = await request("/inventory");
  assert.equal(validAccess.response.status, 200);
  await redisClient.del(`session:${username}`);

  const result = await request(
    "/pr",
    { material_id: 1, quantity: 5, unit_price: 100, department: "QA" },
    { token: tokenWithoutSession }
  );
  assertErrorResponse(result, 401);

  const count = await pool.query("SELECT COUNT(*) FROM purchase_requisition");
  assert.equal(Number(count.rows[0].count), 0);
});

test("a login token with an active Redis session can access inventory", async () => {
  const token = await loginTestUser();
  const result = await request("/inventory", undefined, { token });
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body));
});

test("normal PR -> PO -> GR updates inventory exactly once", async () => {
  const { materialId, vendorId } = await createMaterialAndVendor(10);
  const prId = await createPurchaseRequisition(materialId, 5);
  const poId = await createPurchaseOrder(prId, vendorId);

  const receipt = await request("/gr", { po_id: poId, received_quantity: 5 });
  assert.equal(receipt.response.status, 200);
  assert.equal(receipt.body.message, "Goods Received + Stock Updated.");

  const state = await pool.query(
    `SELECT po.status, gr.po_id, gr.received_quantity, m.current_stock
     FROM purchase_order po
     JOIN goods_receipt gr ON gr.po_id = po.po_id
     JOIN purchase_requisition pr ON pr.pr_id = po.pr_id
     JOIN material m ON m.material_id = pr.material_id
     WHERE po.po_id = $1`,
    [poId]
  );

  assert.equal(state.rowCount, 1);
  assert.equal(state.rows[0].status, "COMPLETED");
  assert.equal(state.rows[0].po_id, poId);
  assert.equal(state.rows[0].received_quantity, 5);
  assert.equal(state.rows[0].current_stock, 15);
});

test("zero and negative quantities are rejected without creating rows", async () => {
  const { materialId } = await createMaterialAndVendor();

  for (const quantity of [0, -1]) {
    const pr = await request("/pr", {
      material_id: materialId,
      quantity,
      unit_price: 100,
      department: "QA",
    });
    assertErrorResponse(pr, 400);

    const gr = await request("/gr", { po_id: 1, received_quantity: quantity });
    assertErrorResponse(gr, 400);
  }

  const rows = await pool.query(
    "SELECT (SELECT COUNT(*) FROM purchase_requisition) AS pr_count, (SELECT COUNT(*) FROM goods_receipt) AS gr_count"
  );
  assert.equal(Number(rows.rows[0].pr_count), 0);
  assert.equal(Number(rows.rows[0].gr_count), 0);
});

test("a second purchase order for the same PR is rejected", async () => {
  const { materialId, vendorId } = await createMaterialAndVendor();
  const prId = await createPurchaseRequisition(materialId);
  await createPurchaseOrder(prId, vendorId);

  const duplicate = await request("/po", {
    pr_id: prId,
    vendor_id: vendorId,
    expected_date: "2026-12-31",
  });
  assertErrorResponse(duplicate, 409);

  const count = await pool.query("SELECT COUNT(*) FROM purchase_order WHERE pr_id = $1", [prId]);
  assert.equal(Number(count.rows[0].count), 1);
});

test("a second GR is rejected and does not increase inventory again", async () => {
  const { materialId, vendorId } = await createMaterialAndVendor(10);
  const prId = await createPurchaseRequisition(materialId, 5);
  const poId = await createPurchaseOrder(prId, vendorId);

  const firstReceipt = await request("/gr", { po_id: poId, received_quantity: 5 });
  assert.equal(firstReceipt.response.status, 200);
  const stockAfterFirstReceipt = await pool.query(
    "SELECT current_stock FROM material WHERE material_id = $1",
    [materialId]
  );

  const duplicate = await request("/gr", { po_id: poId, received_quantity: 5 });
  assertErrorResponse(duplicate, 409);

  const state = await pool.query(
    `SELECT po.status, (SELECT COUNT(*) FROM goods_receipt WHERE po_id = po.po_id) AS gr_count,
            m.current_stock
     FROM purchase_order po
     JOIN purchase_requisition pr ON pr.pr_id = po.pr_id
     JOIN material m ON m.material_id = pr.material_id
     WHERE po.po_id = $1`,
    [poId]
  );
  assert.equal(state.rows[0].status, "COMPLETED");
  assert.equal(Number(state.rows[0].gr_count), 1);
  assert.equal(state.rows[0].current_stock, stockAfterFirstReceipt.rows[0].current_stock);
  assert.equal(state.rows[0].current_stock, 15);
});

test("missing resources return 404 without incomplete records", async () => {
  const missingMaterial = await request("/pr", {
    material_id: 99999,
    quantity: 5,
    unit_price: 100,
    department: "QA",
  });
  assertErrorResponse(missingMaterial, 404);

  const missingPr = await request("/po", {
    pr_id: 99999,
    vendor_id: 99999,
    expected_date: "2026-12-31",
  });
  assertErrorResponse(missingPr, 404);

  const { materialId, vendorId } = await createMaterialAndVendor();
  const prId = await createPurchaseRequisition(materialId);
  const missingVendor = await request("/po", {
    pr_id: prId,
    vendor_id: 99999,
    expected_date: "2026-12-31",
  });
  assertErrorResponse(missingVendor, 404);

  const missingPo = await request("/gr", { po_id: 99999, received_quantity: 5 });
  assertErrorResponse(missingPo, 404);

  const rows = await pool.query(
    "SELECT (SELECT COUNT(*) FROM purchase_order) AS po_count, (SELECT COUNT(*) FROM goods_receipt) AS gr_count"
  );
  assert.equal(Number(rows.rows[0].po_count), 0);
  assert.equal(Number(rows.rows[0].gr_count), 0);
});

test("GR rolls back when the material update fails", async () => {
  const { materialId, vendorId } = await createMaterialAndVendor(10);
  const prId = await createPurchaseRequisition(materialId, 5);
  const poId = await createPurchaseOrder(prId, vendorId);

  await pool.query(`CREATE FUNCTION fail_material_stock_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'test material update failure';
    END;
  $$ LANGUAGE plpgsql`);
  await pool.query(
    "CREATE TRIGGER fail_material_stock_update BEFORE UPDATE ON material FOR EACH ROW EXECUTE FUNCTION fail_material_stock_update()"
  );

  try {
    const receipt = await request("/gr", { po_id: poId, received_quantity: 5 });
    assertErrorResponse(receipt, 500);
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS fail_material_stock_update ON material");
    await pool.query("DROP FUNCTION IF EXISTS fail_material_stock_update()");
  }

  const state = await pool.query(
    `SELECT po.status, (SELECT COUNT(*) FROM goods_receipt WHERE po_id = po.po_id) AS gr_count,
            m.current_stock
     FROM purchase_order po
     JOIN purchase_requisition pr ON pr.pr_id = po.pr_id
     JOIN material m ON m.material_id = pr.material_id
     WHERE po.po_id = $1`,
    [poId]
  );
  assert.equal(state.rows[0].status, "OPEN");
  assert.equal(Number(state.rows[0].gr_count), 0);
  assert.equal(state.rows[0].current_stock, 10);
});

test("database constraints reject invalid quantity, stock, and duplicate relations", async () => {
  const { materialId, vendorId } = await createMaterialAndVendor(10);

  await assert.rejects(
    pool.query(
      "INSERT INTO purchase_requisition (material_id, quantity, unit_price, status) VALUES ($1, 0, 100, 'CREATED')",
      [materialId]
    ),
    { code: "23514" }
  );
  await assert.rejects(
    pool.query("UPDATE material SET current_stock = -1 WHERE material_id = $1", [materialId]),
    { code: "23514" }
  );

  const pr = await pool.query(
    "INSERT INTO purchase_requisition (material_id, quantity, unit_price, status) VALUES ($1, 5, 100, 'CREATED') RETURNING pr_id",
    [materialId]
  );
  const prId = pr.rows[0].pr_id;
  const po = await pool.query(
    "INSERT INTO purchase_order (pr_id, vendor_id, status) VALUES ($1, $2, 'OPEN') RETURNING po_id",
    [prId, vendorId]
  );

  await assert.rejects(
    pool.query("INSERT INTO purchase_order (pr_id, vendor_id, status) VALUES ($1, $2, 'OPEN')", [prId, vendorId]),
    { code: "23505" }
  );
  await assert.rejects(
    pool.query("INSERT INTO goods_receipt (po_id, received_quantity) VALUES ($1, 0)", [po.rows[0].po_id]),
    { code: "23514" }
  );
});
