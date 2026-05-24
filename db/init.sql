-- ===========================
-- MATERIAL TABLE (자재)
-- ===========================
CREATE TABLE IF NOT EXISTS material (
    material_id SERIAL PRIMARY KEY,
    material_name VARCHAR(100) NOT NULL,
    unit VARCHAR(20),
    current_stock INTEGER DEFAULT 0,
    avg_price NUMERIC(10,2) DEFAULT 0
);

-- ===========================
-- VENDOR TABLE (공급업체)
-- ===========================
CREATE TABLE IF NOT EXISTS vendor (
    vendor_id SERIAL PRIMARY KEY,
    vendor_name VARCHAR(100) NOT NULL,
    contact VARCHAR(100)
);

-- ===========================
-- PURCHASE REQUISITION (PR)
-- ===========================
CREATE TABLE IF NOT EXISTS purchase_requisition (
    pr_id SERIAL PRIMARY KEY,
    material_id INTEGER REFERENCES material(material_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    department VARCHAR(50),
    status VARCHAR(20) DEFAULT 'CREATED',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ===========================
-- PURCHASE ORDER (PO)
-- ===========================
CREATE TABLE IF NOT EXISTS purchase_order (
    po_id SERIAL PRIMARY KEY,
    pr_id INTEGER REFERENCES purchase_requisition(pr_id),
    vendor_id INTEGER REFERENCES vendor(vendor_id),
    expected_date DATE,
    status VARCHAR(20) DEFAULT 'OPEN'
);

-- ===========================
-- GOODS RECEIPT (입고)
-- ===========================
CREATE TABLE IF NOT EXISTS goods_receipt (
    gr_id SERIAL PRIMARY KEY,
    po_id INTEGER REFERENCES purchase_order(po_id),
    received_quantity INTEGER NOT NULL,
    received_at TIMESTAMP DEFAULT NOW()
);

-- ===========================
-- USERS (로그인 사용자)
-- ===========================
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
);


-- ===========================
-- 샘플 데이터 삽입(Optional)
-- 과제 테스트하기 쉽게 하기 위해 몇 개 넣어둠
-- 필요 없으면 삭제 가능
-- ===========================

INSERT INTO material (material_name, unit, current_stock, avg_price)
VALUES 
('Laptop', 'EA', 10, 800.00),
('Monitor', 'EA', 20, 120.00),
('Keyboard', 'EA', 50, 20.00)
ON CONFLICT DO NOTHING;

INSERT INTO vendor (vendor_name, contact)
VALUES 
('Samsung Electronics', '010-1111-2222'),
('LG Electronics', '010-3333-4444')
ON CONFLICT DO NOTHING;
