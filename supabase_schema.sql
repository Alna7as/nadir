-- =====================================================
-- nadir-pos — Supabase Schema الكامل (v3)
-- يشمل كل الجداول + القيود + الدوال + الـ Triggers
-- شغّل هذا الملف في: Supabase → SQL Editor → New Query
-- ملاحظة: آمن للتشغيل مرات متعددة (IF NOT EXISTS)
-- =====================================================

-- ① products
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  barcode     TEXT UNIQUE,
  price       NUMERIC(12,2) DEFAULT 0 CHECK (price >= 0),
  cost        NUMERIC(12,2) DEFAULT 0 CHECK (cost  >= 0),
  quantity    INTEGER DEFAULT 0 CHECK (quantity >= 0),
  min_stock   INTEGER DEFAULT 5 CHECK (min_stock >= 0),
  category    TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ② shops
CREATE TABLE IF NOT EXISTS shops (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL,
  contact        TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  balance        NUMERIC(12,2) DEFAULT 0 CHECK (balance >= 0),
  old_debt       NUMERIC(12,2) DEFAULT 0 CHECK (old_debt >= 0),
  returns_total  NUMERIC(12,2) DEFAULT 0 CHECK (returns_total >= 0),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ③ expenses
CREATE TABLE IF NOT EXISTS expenses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT DEFAULT 'أخرى',
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  legacy_id   TEXT UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ③ app_settings
CREATE TABLE IF NOT EXISTS app_settings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ③ invoices (مع حالة partial + قيد amount_paid <= total)
CREATE TABLE IF NOT EXISTS invoices (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number         TEXT UNIQUE,
  shop_id        BIGINT REFERENCES shops(id) ON DELETE SET NULL,
  shop_name      TEXT,
  items          JSONB,
  subtotal       NUMERIC(12,2) DEFAULT 0,
  discount       NUMERIC(12,2) DEFAULT 0 CHECK (discount >= 0),
  tax            NUMERIC(12,2) DEFAULT 0,
  tax_pct        NUMERIC(5,2)  DEFAULT 0,
  total          NUMERIC(12,2) DEFAULT 0 CHECK (total >= 0),
  amount_paid    NUMERIC(12,2) DEFAULT 0 CHECK (amount_paid >= 0),
  note           TEXT,
  status         TEXT DEFAULT 'pending'
                   CHECK (status IN ('draft','pending','partial','paid','void','return')),
  is_return      INTEGER DEFAULT 0 CHECK (is_return  IN (0,1)),
  is_returned    INTEGER DEFAULT 0 CHECK (is_returned IN (0,1)),
  return_of      BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  -- قيد: لا يمكن دفع أكثر من الإجمالي (مع تسامح 1 قرش للتقريب)
  CONSTRAINT chk_paid_lte_total CHECK (amount_paid <= total + 0.01)
);

-- ④ stock_movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name    TEXT,
  type            TEXT CHECK (type IN ('in','out')),
  qty             INTEGER CHECK (qty > 0),
  reason          TEXT,
  invoice_id      BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number  TEXT,
  balance_before  INTEGER DEFAULT 0,
  balance_after   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ⑤ invoice_payments — الدفعات الفعلية مرتبطة بالفاتورة
CREATE TABLE IF NOT EXISTS invoice_payments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id      BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  shop_id         BIGINT REFERENCES shops(id) ON DELETE SET NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','credit','transfer','other')),
  paid_at         TIMESTAMPTZ DEFAULT NOW(),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ⑥ payments — تسديدات على مستوى العميل (legacy, محتفظ به للتوافق)
CREATE TABLE IF NOT EXISTS payments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id     BIGINT REFERENCES shops(id) ON DELETE SET NULL,
  shop_name   TEXT,
  amount      NUMERIC(12,2) DEFAULT 0 CHECK (amount > 0),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ⑦ audit_log — سجل تدقيق للتغييرات الحساسة
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   BIGINT,
  action      TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Row Level Security (مفتوح — يُقيَّد بعد إضافة Auth)
-- =====================================================
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='products'         AND policyname='allow_all_products')  THEN CREATE POLICY "allow_all_products"          ON products          FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shops'            AND policyname='allow_all_shops')     THEN CREATE POLICY "allow_all_shops"             ON shops             FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoices'         AND policyname='allow_all_invoices')  THEN CREATE POLICY "allow_all_invoices"          ON invoices          FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_movements'  AND policyname='allow_all_stock')     THEN CREATE POLICY "allow_all_stock"             ON stock_movements   FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_payments' AND policyname='allow_all_inv_pay')   THEN CREATE POLICY "allow_all_inv_pay"           ON invoice_payments  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments'         AND policyname='allow_all_payments')  THEN CREATE POLICY "allow_all_payments"          ON payments          FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_log'        AND policyname='allow_all_audit')     THEN CREATE POLICY "allow_all_audit"             ON audit_log         FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='expenses'         AND policyname='allow_all_expenses')  THEN CREATE POLICY "allow_all_expenses"          ON expenses          FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings'     AND policyname='allow_all_app_settings') THEN CREATE POLICY "allow_all_app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- =====================================================
-- Indexes
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_products_barcode      ON products (barcode)        WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_is_active    ON products (is_active);
CREATE INDEX IF NOT EXISTS idx_invoices_shop_id      ON invoices (shop_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_is_return    ON invoices (is_return);
CREATE INDEX IF NOT EXISTS idx_invoices_is_returned  ON invoices (is_returned);
CREATE INDEX IF NOT EXISTS idx_invoices_return_of    ON invoices (return_of);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at   ON invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_product_id      ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_invoice_id      ON stock_movements (invoice_id);
CREATE INDEX IF NOT EXISTS idx_stock_created_at      ON stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_pay_invoice_id    ON invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_pay_shop_id       ON invoice_payments (shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_pay_paid_at       ON invoice_payments (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_shop_id      ON payments (shop_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity          ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created         ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shops_old_debt        ON shops (old_debt);
CREATE INDEX IF NOT EXISTS idx_expenses_date         ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category     ON expenses (category);
CREATE INDEX IF NOT EXISTS idx_app_settings_key      ON app_settings (key);

-- =====================================================
-- Trigger لتحديث updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_products_updated_at')  THEN CREATE TRIGGER trg_products_updated_at  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_shops_updated_at')     THEN CREATE TRIGGER trg_shops_updated_at     BEFORE UPDATE ON shops     FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_invoices_updated_at')  THEN CREATE TRIGGER trg_invoices_updated_at  BEFORE UPDATE ON invoices  FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_app_settings_updated_at') THEN CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
END $$;

-- =====================================================
-- Trigger: تحديث amount_paid و status من invoice_payments
-- =====================================================
CREATE OR REPLACE FUNCTION sync_invoice_amount_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id BIGINT;
  v_total_paid NUMERIC;
  v_total      NUMERIC;
  v_new_status TEXT;
  v_cur_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_invoice_id := OLD.invoice_id;
  ELSE                      v_invoice_id := NEW.invoice_id;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_total_paid
  FROM invoice_payments WHERE invoice_id = v_invoice_id;

  SELECT total, status INTO v_total, v_cur_status
  FROM invoices WHERE id = v_invoice_id;

  -- لا نغير void أو return
  IF v_cur_status IN ('void','return','draft') THEN RETURN COALESCE(NEW,OLD); END IF;

  IF    v_total_paid <= 0              THEN v_new_status := 'pending';
  ELSIF v_total_paid >= v_total - 0.01 THEN v_new_status := 'paid';
  ELSE                                      v_new_status := 'partial';
  END IF;

  UPDATE invoices
  SET amount_paid = v_total_paid,
      status      = v_new_status,
      updated_at  = NOW()
  WHERE id = v_invoice_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sync_amount_paid') THEN
    CREATE TRIGGER trg_sync_amount_paid
      AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
      FOR EACH ROW EXECUTE FUNCTION sync_invoice_amount_paid();
  END IF;
END $$;

-- =====================================================
-- دالة RPC: save_invoice_atomic
-- تنفذ حفظ الفاتورة + المخزون + الدفعة + رصيد العميل في transaction واحدة
-- =====================================================
CREATE OR REPLACE FUNCTION save_invoice_atomic(p IN JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id   BIGINT;
  v_invoice_number TEXT;
  v_shop_balance NUMERIC;
  v_item         JSONB;
  v_old_items    JSONB;
  v_prod_qty     INTEGER;
  v_prod_cost    NUMERIC;
BEGIN
  -- ① حفظ الفاتورة
  IF (p->>'editId') IS NOT NULL THEN
    SELECT number, items
    INTO v_invoice_number, v_old_items
    FROM invoices
    WHERE id = (p->>'editId')::BIGINT
    FOR UPDATE;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_old_items, '[]'::JSONB))
    LOOP
      SELECT quantity, cost INTO v_prod_qty, v_prod_cost
      FROM products WHERE id = (v_item->>'productId')::BIGINT
      FOR UPDATE;

      IF v_prod_qty IS NOT NULL THEN
        UPDATE products
        SET quantity   = v_prod_qty + (v_item->>'qty')::INTEGER,
            updated_at = NOW()
        WHERE id = (v_item->>'productId')::BIGINT;

        INSERT INTO stock_movements (product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
        VALUES (
          (v_item->>'productId')::BIGINT,
          v_item->>'name',
          'in',
          (v_item->>'qty')::INTEGER,
          COALESCE(p->>'reverseStockReason','تعديل فاتورة (عكس)'),
          (p->>'editId')::BIGINT,
          v_invoice_number,
          v_prod_qty,
          v_prod_qty + (v_item->>'qty')::INTEGER
        );
      END IF;
    END LOOP;
    -- تعديل فاتورة موجودة
    UPDATE invoices SET
      shop_id    = (p->>'shopId')::BIGINT,
      shop_name  = p->>'shopName',
      items      = p->'items',
      subtotal   = (p->>'subtotal')::NUMERIC,
      discount   = (p->>'discount')::NUMERIC,
      tax        = (p->>'tax')::NUMERIC,
      tax_pct    = (p->>'taxPct')::NUMERIC,
      total      = (p->>'total')::NUMERIC,
      note       = p->>'note',
      updated_at = NOW()
    WHERE id = (p->>'editId')::BIGINT
    RETURNING id, number INTO v_invoice_id, v_invoice_number;
  ELSE
    -- إنشاء فاتورة جديدة
    INSERT INTO invoices (number,shop_id,shop_name,items,subtotal,discount,tax,tax_pct,total,amount_paid,note,status,is_return,return_of,is_returned)
    VALUES (
      p->>'number',
      NULLIF(p->>'shopId','')::BIGINT,
      p->>'shopName',
      p->'items',
      (p->>'subtotal')::NUMERIC,
      (p->>'discount')::NUMERIC,
      COALESCE((p->>'tax')::NUMERIC, 0),
      COALESCE((p->>'taxPct')::NUMERIC, 0),
      (p->>'total')::NUMERIC,
      0,  -- amount_paid يبدأ 0، الـ trigger يحدثه
      p->>'note',
      'pending',
      COALESCE((p->>'isReturn')::INTEGER, 0),
      NULLIF(p->>'returnOf','')::BIGINT,
      0
    )
    RETURNING id, number INTO v_invoice_id, v_invoice_number;
  END IF;

  -- ② تسجيل الدفعة الأولية (لو موجودة)
  IF (p->>'amountPaid')::NUMERIC > 0 AND (p->>'editId') IS NULL THEN
    INSERT INTO invoice_payments (invoice_id, shop_id, amount, payment_method, paid_at, note)
    VALUES (
      v_invoice_id,
      NULLIF(p->>'shopId','')::BIGINT,
      (p->>'amountPaid')::NUMERIC,
      COALESCE(p->>'paymentMethod','cash'),
      NOW(),
      COALESCE(p->>'paymentNote', 'دفعة أولية')
    );
    -- الـ trigger يحدث amount_paid و status تلقائياً
  END IF;

  -- ③ حركات المخزون لكل صنف
  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items')
  LOOP
    SELECT quantity, cost INTO v_prod_qty, v_prod_cost
    FROM products WHERE id = (v_item->>'productId')::BIGINT
    FOR UPDATE;  -- lock لمنع race condition

    IF v_prod_qty IS NOT NULL THEN
      UPDATE products
      SET quantity   = GREATEST(0, v_prod_qty - (v_item->>'qty')::INTEGER),
          updated_at = NOW()
      WHERE id = (v_item->>'productId')::BIGINT;

      INSERT INTO stock_movements (product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
      VALUES (
        (v_item->>'productId')::BIGINT,
        v_item->>'name',
        'out',
        (v_item->>'qty')::INTEGER,
        COALESCE(p->>'stockReason','فاتورة مبيعات'),
        v_invoice_id,
        COALESCE(NULLIF(p->>'number',''), v_invoice_number),
        v_prod_qty,
        GREATEST(0, v_prod_qty - (v_item->>'qty')::INTEGER)
      );
    END IF;
  END LOOP;

  -- ④ تحديث رصيد العميل
  IF (p->>'shopId') IS NOT NULL AND (p->>'shopId') != '' THEN
    SELECT GREATEST(0,
      COALESCE(SUM(i.total),0)
      - COALESCE((SELECT SUM(ip2.amount) FROM invoice_payments ip2 JOIN invoices i2 ON ip2.invoice_id=i2.id WHERE i2.shop_id=(p->>'shopId')::BIGINT AND i2.is_return=0),0)
      - COALESCE((SELECT SUM(i3.total) FROM invoices i3 WHERE i3.shop_id=(p->>'shopId')::BIGINT AND i3.is_return=1 AND i3.status!='void'),0)
    ) INTO v_shop_balance
    FROM invoices i
    WHERE i.shop_id = (p->>'shopId')::BIGINT
      AND i.is_return = 0
      AND i.status NOT IN ('void','draft');

    UPDATE shops SET balance = v_shop_balance, updated_at = NOW()
    WHERE id = (p->>'shopId')::BIGINT;
  END IF;

  RETURN jsonb_build_object('invoiceId', v_invoice_id, 'ok', true);

EXCEPTION WHEN OTHERS THEN
  RAISE;  -- يُعيد الخطأ ويتراجع كل التغييرات تلقائياً
END;
$$;

-- =====================================================
-- دالة RPC: collect_payment_atomic
-- تسديد دفعة من صفحة التحصيلات في transaction واحدة
-- =====================================================
CREATE OR REPLACE FUNCTION collect_payment_atomic(p IN JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_shop_id      BIGINT;
  v_amount       NUMERIC;
  v_leftover     NUMERIC;
  v_method       TEXT;
  v_note         TEXT;
  v_inv          RECORD;
  v_to_apply     NUMERIC;
  v_new_paid     NUMERIC;
  v_shop_balance NUMERIC;
BEGIN
  v_shop_id  := (p->>'shopId')::BIGINT;
  v_amount   := (p->>'amount')::NUMERIC;
  v_method   := COALESCE(p->>'paymentMethod','cash');
  v_note     := COALESCE(p->>'note','تسديد من صفحة التحصيلات');
  v_leftover := v_amount;

  -- ① توزيع الدفعة على الفواتير المتبقية (الأقدم أولاً)
  FOR v_inv IN
    SELECT id, total, amount_paid
    FROM invoices
    WHERE shop_id = v_shop_id
      AND is_return = 0
      AND status IN ('pending','partial')
      AND amount_paid < total - 0.01
    ORDER BY id ASC
    FOR UPDATE  -- lock لمنع race condition
  LOOP
    EXIT WHEN v_leftover <= 0.001;

    v_to_apply := LEAST(v_leftover, v_inv.total - v_inv.amount_paid);
    v_leftover := v_leftover - v_to_apply;

    -- تسجيل دفعة في invoice_payments (الـ trigger يحدث amount_paid و status)
    INSERT INTO invoice_payments (invoice_id, shop_id, amount, payment_method, paid_at, note)
    VALUES (v_inv.id, v_shop_id, v_to_apply, v_method, NOW(), v_note);
  END LOOP;

  -- ② تحديث رصيد العميل من المصدر الموحد
  SELECT GREATEST(0,
    COALESCE(SUM(i.total),0)
    - COALESCE((SELECT SUM(ip2.amount) FROM invoice_payments ip2 JOIN invoices i2 ON ip2.invoice_id=i2.id WHERE i2.shop_id=v_shop_id AND i2.is_return=0),0)
    - COALESCE((SELECT SUM(i3.total) FROM invoices i3 WHERE i3.shop_id=v_shop_id AND i3.is_return=1 AND i3.status!='void'),0)
  ) INTO v_shop_balance
  FROM invoices i
  WHERE i.shop_id = v_shop_id
    AND i.is_return = 0
    AND i.status NOT IN ('void','draft');

  UPDATE shops SET balance = v_shop_balance, updated_at = NOW()
  WHERE id = v_shop_id;

  -- ③ سجل في payments (legacy للتوافق مع كشف الحساب القديم)
  INSERT INTO payments (shop_id, shop_name, amount, note)
  SELECT v_shop_id, name, v_amount, v_note
  FROM shops WHERE id = v_shop_id;

  RETURN jsonb_build_object(
    'ok',         true,
    'applied',    v_amount - v_leftover,
    'newBalance', v_shop_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- =====================================================
-- دالة RPC: void_invoice_atomic
-- إلغاء فاتورة في transaction واحدة
-- =====================================================
CREATE OR REPLACE FUNCTION void_invoice_atomic(p_invoice_id BIGINT, p_reason TEXT DEFAULT 'إلغاء')
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inv    RECORD;
  v_item   JSONB;
  v_qty    INTEGER;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','invoice not found');
  END IF;

  IF v_inv.status = 'void' THEN
    RETURN jsonb_build_object('ok',false,'error','already void');
  END IF;

  -- تغيير الحالة
  UPDATE invoices SET status='void', updated_at=NOW() WHERE id=p_invoice_id;

  -- عكس المخزون (إذا لم تكن مرتجع)
  IF v_inv.is_return = 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_inv.items)
    LOOP
      SELECT quantity INTO v_qty FROM products WHERE id=(v_item->>'productId')::BIGINT FOR UPDATE;
      IF v_qty IS NOT NULL THEN
        UPDATE products
        SET quantity = v_qty + (v_item->>'qty')::INTEGER, updated_at=NOW()
        WHERE id = (v_item->>'productId')::BIGINT;

        INSERT INTO stock_movements(product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
        VALUES(
          (v_item->>'productId')::BIGINT, v_item->>'name',
          'in', (v_item->>'qty')::INTEGER,
          p_reason||' - '||v_inv.number,
          p_invoice_id, v_inv.number,
          v_qty, v_qty+(v_item->>'qty')::INTEGER
        );
      END IF;
    END LOOP;
  END IF;

  -- تحديث رصيد العميل
  IF v_inv.shop_id IS NOT NULL THEN
    UPDATE shops SET
      balance = GREATEST(0,(
        SELECT COALESCE(SUM(i.total),0)
          - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON ip.invoice_id=i2.id WHERE i2.shop_id=v_inv.shop_id AND i2.is_return=0),0)
          - COALESCE((SELECT SUM(i3.total) FROM invoices i3 WHERE i3.shop_id=v_inv.shop_id AND i3.is_return=1 AND i3.status!='void'),0)
        FROM invoices i WHERE i.shop_id=v_inv.shop_id AND i.is_return=0 AND i.status NOT IN('void','draft')
      )),
      updated_at=NOW()
    WHERE id=v_inv.shop_id;
  END IF;

  INSERT INTO audit_log(entity_type,entity_id,action,old_value,new_value,note)
  VALUES('invoice',p_invoice_id,'void',
    jsonb_build_object('status',v_inv.status),
    jsonb_build_object('status','void'),
    p_reason
  );

  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;

-- =====================================================
-- للتحقق من نجاح التطبيق:
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('products','shops','invoices','stock_movements','invoice_payments','payments','audit_log','expenses','app_settings')
ORDER BY table_name;

-- =====================================================
-- دالة RPC: void_invoice_atomic (JSONB overload)
-- تأخذ { invoiceId, reason } كـ JSONB — للاستخدام من callRpc في الـ Frontend
-- =====================================================
CREATE OR REPLACE FUNCTION void_invoice_atomic(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN void_invoice_atomic(
    (p->>'invoiceId')::BIGINT,
    COALESCE(p->>'reason', 'إلغاء')
  );
END;
$$;

-- =====================================================
-- دالة RPC: restore_invoice_atomic
-- استعادة فاتورة من void → pending/partial/paid (ذرية)
-- =====================================================
CREATE OR REPLACE FUNCTION restore_invoice_atomic(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id BIGINT;
  v_inv        RECORD;
  v_item       JSONB;
  v_qty        INTEGER;
  v_real_paid  NUMERIC;
  v_new_status TEXT;
BEGIN
  v_invoice_id := (p->>'invoiceId')::BIGINT;

  SELECT * INTO v_inv FROM invoices WHERE id = v_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice not found');
  END IF;

  IF v_inv.status != 'void' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice is not void');
  END IF;

  -- اشتقاق الحالة من الدفعات الفعلية
  SELECT COALESCE(SUM(amount), 0) INTO v_real_paid
  FROM invoice_payments WHERE invoice_id = v_invoice_id;

  IF    v_real_paid <= 0                    THEN v_new_status := 'pending';
  ELSIF v_real_paid >= v_inv.total - 0.01   THEN v_new_status := 'paid';
  ELSE                                           v_new_status := 'partial';
  END IF;

  -- تحديث الحالة و amountPaid
  UPDATE invoices
  SET status     = v_new_status,
      amount_paid = v_real_paid,
      updated_at  = NOW()
  WHERE id = v_invoice_id;

  -- خصم المخزون مجدداً (إذا لم يكن مرتجع)
  IF v_inv.is_return = 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_inv.items)
    LOOP
      SELECT quantity INTO v_qty FROM products WHERE id=(v_item->>'productId')::BIGINT FOR UPDATE;
      IF v_qty IS NOT NULL THEN
        UPDATE products
        SET quantity = GREATEST(0, v_qty - (v_item->>'qty')::INTEGER), updated_at = NOW()
        WHERE id = (v_item->>'productId')::BIGINT;

        INSERT INTO stock_movements(product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
        VALUES(
          (v_item->>'productId')::BIGINT, v_item->>'name',
          'out', (v_item->>'qty')::INTEGER,
          'استعادة فاتورة - ' || v_inv.number,
          v_invoice_id, v_inv.number,
          v_qty, GREATEST(0, v_qty - (v_item->>'qty')::INTEGER)
        );
      END IF;
    END LOOP;
  END IF;

  -- تحديث رصيد العميل
  IF v_inv.shop_id IS NOT NULL THEN
    UPDATE shops SET
      balance = GREATEST(0,(
        SELECT COALESCE(SUM(i.total),0)
          - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON ip.invoice_id=i2.id WHERE i2.shop_id=v_inv.shop_id AND i2.is_return=0),0)
          - COALESCE((SELECT SUM(i3.total) FROM invoices i3 WHERE i3.shop_id=v_inv.shop_id AND i3.is_return=1 AND i3.status!='void'),0)
        FROM invoices i WHERE i.shop_id=v_inv.shop_id AND i.is_return=0 AND i.status NOT IN('void','draft')
      )),
      updated_at = NOW()
    WHERE id = v_inv.shop_id;
  END IF;

  INSERT INTO audit_log(entity_type,entity_id,action,old_value,new_value,note)
  VALUES('invoice', v_invoice_id, 'restore',
    jsonb_build_object('status','void'),
    jsonb_build_object('status', v_new_status, 'amountPaid', v_real_paid),
    COALESCE(p->>'reason', 'استعادة فاتورة')
  );

  RETURN jsonb_build_object('ok', true, 'newStatus', v_new_status, 'amountPaid', v_real_paid);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;

-- =====================================================
-- دالة RPC: delete_invoice_atomic
-- حذف فاتورة مع عكس كل آثارها (ذري)
-- =====================================================
CREATE OR REPLACE FUNCTION delete_invoice_atomic(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id BIGINT;
  v_inv        RECORD;
  v_item       JSONB;
  v_qty        INTEGER;
  v_orig       RECORD;
BEGIN
  v_invoice_id := (p->>'invoiceId')::BIGINT;

  SELECT * INTO v_inv FROM invoices WHERE id = v_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice not found');
  END IF;

  -- عكس المخزون (فاتورة عادية لم تُلغَ)
  IF v_inv.is_return = 0 AND v_inv.status != 'void' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_inv.items)
    LOOP
      SELECT quantity INTO v_qty FROM products WHERE id=(v_item->>'productId')::BIGINT FOR UPDATE;
      IF v_qty IS NOT NULL THEN
        UPDATE products
        SET quantity = v_qty + (v_item->>'qty')::INTEGER, updated_at = NOW()
        WHERE id = (v_item->>'productId')::BIGINT;

        INSERT INTO stock_movements(product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
        VALUES(
          (v_item->>'productId')::BIGINT, v_item->>'name',
          'in', (v_item->>'qty')::INTEGER,
          'حذف فاتورة - ' || v_inv.number,
          v_invoice_id, v_inv.number,
          v_qty, v_qty + (v_item->>'qty')::INTEGER
        );
      END IF;
    END LOOP;
  END IF;

  -- فاتورة مرتجع: عكس الكميات واسترجاع is_returned على الأصل
  IF v_inv.is_return = 1 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_inv.items)
    LOOP
      SELECT quantity INTO v_qty FROM products WHERE id=(v_item->>'productId')::BIGINT FOR UPDATE;
      IF v_qty IS NOT NULL THEN
        UPDATE products
        SET quantity = GREATEST(0, v_qty - (v_item->>'qty')::INTEGER), updated_at = NOW()
        WHERE id = (v_item->>'productId')::BIGINT;

        INSERT INTO stock_movements(product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
        VALUES(
          (v_item->>'productId')::BIGINT, v_item->>'name',
          'out', (v_item->>'qty')::INTEGER,
          'حذف مرتجع - ' || v_inv.number,
          v_invoice_id, v_inv.number,
          v_qty, GREATEST(0, v_qty - (v_item->>'qty')::INTEGER)
        );
      END IF;
    END LOOP;

    IF v_inv.return_of IS NOT NULL THEN
      UPDATE invoices SET is_returned = 0, updated_at = NOW() WHERE id = v_inv.return_of;
      UPDATE shops SET
        returns_total = GREATEST(0, COALESCE(returns_total,0) - COALESCE(v_inv.total,0)),
        updated_at = NOW()
      WHERE id = v_inv.shop_id;
    END IF;
  END IF;

  -- حذف الفاتورة (cascade يحذف invoice_payments تلقائياً)
  DELETE FROM invoices WHERE id = v_invoice_id;

  -- تحديث رصيد العميل
  IF v_inv.shop_id IS NOT NULL THEN
    UPDATE shops SET
      balance = GREATEST(0,(
        SELECT COALESCE(SUM(i.total),0)
          - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON ip.invoice_id=i2.id WHERE i2.shop_id=v_inv.shop_id AND i2.is_return=0),0)
          - COALESCE((SELECT SUM(i3.total) FROM invoices i3 WHERE i3.shop_id=v_inv.shop_id AND i3.is_return=1 AND i3.status!='void'),0)
        FROM invoices i WHERE i.shop_id=v_inv.shop_id AND i.is_return=0 AND i.status NOT IN('void','draft')
      )),
      updated_at = NOW()
    WHERE id = v_inv.shop_id;
  END IF;

  INSERT INTO audit_log(entity_type,entity_id,action,old_value,note)
  VALUES('invoice', v_invoice_id, 'delete',
    jsonb_build_object('number', v_inv.number, 'total', v_inv.total, 'status', v_inv.status),
    COALESCE(p->>'reason', 'حذف فاتورة')
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;

-- =====================================================
-- دالة RPC: create_return_atomic
-- إنشاء مرتجع كامل (فاتورة مرتجع + مخزون + رصيد) في transaction واحدة
-- =====================================================
CREATE OR REPLACE FUNCTION create_return_atomic(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_orig_id    BIGINT;
  v_orig       RECORD;
  v_ret_id     BIGINT;
  v_item       JSONB;
  v_qty        INTEGER;
  v_paid_amt   NUMERIC;
BEGIN
  v_orig_id := (p->>'originalInvoiceId')::BIGINT;

  SELECT * INTO v_orig FROM invoices WHERE id = v_orig_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invoice not found');
  END IF;
  IF v_orig.is_return = 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot return a return invoice');
  END IF;
  IF v_orig.status = 'void' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot return a void invoice');
  END IF;
  IF v_orig.is_returned = 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already returned');
  END IF;

  -- إنشاء فاتورة المرتجع
  INSERT INTO invoices(number,shop_id,shop_name,items,subtotal,discount,tax,tax_pct,total,amount_paid,note,status,is_return,return_of,is_returned)
  VALUES(
    'RET-' || v_orig.number,
    v_orig.shop_id, v_orig.shop_name,
    v_orig.items,
    v_orig.subtotal, v_orig.discount, v_orig.tax, v_orig.tax_pct, v_orig.total,
    0,
    'مرتجع للفاتورة ' || v_orig.number,
    'return', 1, v_orig_id, 0
  )
  RETURNING id INTO v_ret_id;

  -- تحديث الفاتورة الأصلية
  UPDATE invoices SET is_returned = 1, updated_at = NOW() WHERE id = v_orig_id;

  -- إعادة الكميات للمخزون
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_orig.items)
  LOOP
    SELECT quantity INTO v_qty FROM products WHERE id=(v_item->>'productId')::BIGINT FOR UPDATE;
    IF v_qty IS NOT NULL THEN
      UPDATE products
      SET quantity = v_qty + (v_item->>'qty')::INTEGER, updated_at = NOW()
      WHERE id = (v_item->>'productId')::BIGINT;

      INSERT INTO stock_movements(product_id,product_name,type,qty,reason,invoice_id,invoice_number,balance_before,balance_after)
      VALUES(
        (v_item->>'productId')::BIGINT, v_item->>'name',
        'in', (v_item->>'qty')::INTEGER,
        'مرتجع - ' || v_orig.number,
        v_orig_id, v_orig.number,
        v_qty, v_qty + (v_item->>'qty')::INTEGER
      );
    END IF;
  END LOOP;

  -- تحديث رصيد العميل + المرتجعات
  IF v_orig.shop_id IS NOT NULL THEN
    UPDATE shops SET
      returns_total = COALESCE(returns_total, 0) + v_orig.total,
      balance = GREATEST(0,(
        SELECT COALESCE(SUM(i.total),0)
          - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON ip.invoice_id=i2.id WHERE i2.shop_id=v_orig.shop_id AND i2.is_return=0),0)
          - COALESCE((SELECT SUM(i3.total) + v_orig.total FROM invoices i3 WHERE i3.shop_id=v_orig.shop_id AND i3.is_return=1 AND i3.status!='void'),0)
        FROM invoices i WHERE i.shop_id=v_orig.shop_id AND i.is_return=0 AND i.status NOT IN('void','draft')
      )),
      updated_at = NOW()
    WHERE id = v_orig.shop_id;
  END IF;

  INSERT INTO audit_log(entity_type,entity_id,action,old_value,new_value,note)
  VALUES('invoice', v_orig_id, 'return_created',
    jsonb_build_object('isReturned', 0),
    jsonb_build_object('isReturned', 1, 'returnInvoiceId', v_ret_id),
    'مرتجع للفاتورة ' || v_orig.number
  );

  RETURN jsonb_build_object('ok', true, 'returnInvoiceId', v_ret_id);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;
