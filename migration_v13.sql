-- =====================================================
-- migration_v13.sql
-- ضمان وجود app_settings لمزامنة البيانات المشتركة بين الأجهزة
-- يستخدمه النظام الآن في حفظ مخزون المندوب المشترك داخل المفتاح:
--   ops_meta_shared_v1
-- =====================================================

BEGIN;

-- 1) جدول app_settings
CREATE TABLE IF NOT EXISTS app_settings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) فهرس على المفتاح
CREATE INDEX IF NOT EXISTS idx_app_settings_key
  ON app_settings (key);

-- 3) دالة تحديث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 4) Trigger لتحديث updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_app_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 5) تفعيل RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 6) Policy مفتوحة مثل بقية جداول المشروع الحالية
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_settings'
      AND policyname = 'allow_all_app_settings'
  ) THEN
    CREATE POLICY "allow_all_app_settings"
    ON app_settings
    FOR ALL
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- =====================================================
-- تحقق سريع بعد التشغيل:
-- SELECT * FROM app_settings WHERE key = 'ops_meta_shared_v1';
-- =====================================================
