-- ============================================================
-- migration_v12.sql — إصلاحات محاسبية شاملة
-- الإصلاحات:
--   ① جدول invoice_payments مستقل مع invoice_id
--   ② جدول audit_log للتغييرات الحساسة
--   ③ قيود DB إضافية: amount_paid <= total
--   ④ حقل partial لحالة الفاتورة
--   ⑤ دالة موحدة لحساب رصيد العميل
--   ⑥ دالة مشتقة لحالة الفاتورة
--   ⑦ trigger لتحديث amount_paid من الدفعات
-- شغّل في Supabase SQL Editor
-- ============================================================

-- ① جدول الدفعات المرتبط بالفاتورة (invoice_payments)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id      BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  shop_id         BIGINT REFERENCES shops(id) ON DELETE SET NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','other')),
  paid_at         TIMESTAMPTZ DEFAULT NOW(),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoice_payments' AND policyname='allow_all_invoice_payments') THEN
    CREATE POLICY "allow_all_invoice_payments" ON invoice_payments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inv_payments_invoice_id ON invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_payments_shop_id    ON invoice_payments (shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_payments_paid_at    ON invoice_payments (paid_at DESC);

-- ② جدول سجل التدقيق (audit_log)
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL,          -- 'invoice', 'payment', 'shop'
  entity_id   BIGINT,
  action      TEXT NOT NULL,          -- 'status_change', 'payment_add', 'void', 'return', ...
  old_value   JSONB,
  new_value   JSONB,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_log' AND policyname='allow_all_audit_log') THEN
    CREATE POLICY "allow_all_audit_log" ON audit_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

-- دعم الوحدات المتعددة للمنتجات
-- ② مكرر/مكمل: ربط المديونية القديمة بجدول العملاء
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS old_debt NUMERIC(12,2) DEFAULT 0 CHECK (old_debt >= 0);
CREATE INDEX IF NOT EXISTS idx_shops_old_debt ON shops (old_debt);

-- ② مكرر/مكمل: جدول المصاريف
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

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='expenses' AND policyname='allow_all_expenses') THEN
    CREATE POLICY "allow_all_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);

-- ② مكرر/مكمل: إعدادات عامة قابلة للمزامنة
CREATE TABLE IF NOT EXISTS app_settings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='allow_all_app_settings') THEN
    CREATE POLICY "allow_all_app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings (key);

-- ③ إضافة حالة partial للفواتير
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','pending','partial','paid','void','return'));

-- ④ constraint: amount_paid <= total
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_paid_lte_total;
ALTER TABLE invoices
  ADD CONSTRAINT chk_paid_lte_total
  CHECK (amount_paid <= total + 0.01); -- 0.01 تسامح للتقريب

-- ⑤ دالة حساب رصيد العميل من مصدر واحد
CREATE OR REPLACE FUNCTION get_shop_balance(p_shop_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
  total_invoiced  NUMERIC;
  total_paid      NUMERIC;
  total_returns   NUMERIC;
BEGIN
  -- إجمالي الفواتير المستحقة (غير الملغاة وغير المرتجعات)
  SELECT COALESCE(SUM(total), 0) INTO total_invoiced
  FROM invoices
  WHERE shop_id = p_shop_id
    AND is_return = 0
    AND status NOT IN ('void', 'draft');

  -- إجمالي المدفوعات من invoice_payments
  SELECT COALESCE(SUM(ip.amount), 0) INTO total_paid
  FROM invoice_payments ip
  JOIN invoices inv ON ip.invoice_id = inv.id
  WHERE inv.shop_id = p_shop_id
    AND inv.is_return = 0;

  -- إجمالي المرتجعات (تقلل الدين)
  SELECT COALESCE(SUM(total), 0) INTO total_returns
  FROM invoices
  WHERE shop_id = p_shop_id
    AND is_return = 1
    AND status NOT IN ('void');

  RETURN GREATEST(0, total_invoiced - total_paid - total_returns);
END;
$$ LANGUAGE plpgsql;

-- ⑥ دالة اشتقاق حالة الفاتورة من القيم الفعلية
CREATE OR REPLACE FUNCTION derive_invoice_status(
  p_invoice_id BIGINT,
  p_voided     BOOLEAN DEFAULT FALSE
)
RETURNS TEXT AS $$
DECLARE
  v_total      NUMERIC;
  v_paid       NUMERIC;
BEGIN
  IF p_voided THEN RETURN 'void'; END IF;

  SELECT total INTO v_total FROM invoices WHERE id = p_invoice_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM invoice_payments
  WHERE invoice_id = p_invoice_id;

  IF v_total IS NULL OR v_total = 0 THEN RETURN 'pending'; END IF;
  IF v_paid = 0                      THEN RETURN 'pending'; END IF;
  IF v_paid >= v_total               THEN RETURN 'paid';    END IF;
  RETURN 'partial';
END;
$$ LANGUAGE plpgsql;

-- ⑦ دالة تحديث amount_paid من مجموع الدفعات
CREATE OR REPLACE FUNCTION sync_invoice_amount_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id BIGINT;
  v_total_paid NUMERIC;
  v_total      NUMERIC;
  v_new_status TEXT;
BEGIN
  -- نحدد invoice_id من العملية
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  -- مجموع الدفعات
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM invoice_payments
  WHERE invoice_id = v_invoice_id;

  SELECT total INTO v_total FROM invoices WHERE id = v_invoice_id;

  -- اشتقاق الحالة
  IF v_total_paid = 0          THEN v_new_status := 'pending';
  ELSIF v_total_paid >= v_total THEN v_new_status := 'paid';
  ELSE                               v_new_status := 'partial';
  END IF;

  -- تحديث الفاتورة
  UPDATE invoices
  SET amount_paid = v_total_paid,
      status = CASE
        WHEN status = 'void' THEN 'void'   -- لا نغير الملغاة
        WHEN status = 'return' THEN 'return' -- لا نغير المرتجعات
        ELSE v_new_status
      END,
      updated_at = NOW()
  WHERE id = v_invoice_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_amount_paid();

-- ============================================================
-- للتحقق من نجاح التطبيق:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('invoice_payments', 'audit_log', 'expenses', 'app_settings');
-- يجب أن ترى: invoice_payments, audit_log, expenses, app_settings
-- ============================================================
