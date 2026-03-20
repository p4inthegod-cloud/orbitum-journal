-- ════════════════════════════════════════════════════════════════
-- ORBITUM — SQL Migration v2: Full schema
-- Запускать в Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. Добавляем TG-поля в profiles (если их нет)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tg_chat_id       TEXT,
  ADD COLUMN IF NOT EXISTS tg_username      TEXT,
  ADD COLUMN IF NOT EXISTS tg_linked        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tg_link_code     TEXT,
  ADD COLUMN IF NOT EXISTS tg_notify_trades BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tg_notify_daily  BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tg_notify_alerts BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tg_notify_tilt   BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tg_notify_weekly BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_tg_chat_id ON profiles(tg_chat_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tg_link_code ON profiles(tg_link_code);

-- 2. RLS для trades (если ещё не включён)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own trades" ON trades;
CREATE POLICY "Users see own trades"
  ON trades FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own trades" ON trades;
CREATE POLICY "Users insert own trades"
  ON trades FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own trades" ON trades;
CREATE POLICY "Users update own trades"
  ON trades FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own trades" ON trades;
CREATE POLICY "Users delete own trades"
  ON trades FOR DELETE USING (auth.uid() = user_id);

-- 3. RLS для profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own profile" ON profiles;
CREATE POLICY "Users see own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Public read for leaderboard/follow (limited columns)
DROP POLICY IF EXISTS "Public read basic profile" ON profiles;
CREATE POLICY "Public read basic profile"
  ON profiles FOR SELECT USING (true);

-- 4. Таблица ценовых алертов (с repeat_mode, note, alert_type)
CREATE TABLE IF NOT EXISTS price_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,
  coingecko_id   TEXT NOT NULL,
  condition      TEXT NOT NULL CHECK (condition IN ('above', 'below', 'cross')),
  target_price   NUMERIC(20, 8),
  alert_type     TEXT DEFAULT 'price' CHECK (alert_type IN ('price', 'price_cross', 'volume', 'change', 'rsi_ob', 'rsi_os', 'pump', 'dump', 'volatility')),
  repeat_mode    TEXT DEFAULT 'once' CHECK (repeat_mode IN ('once', 'every', 'daily')),
  note           TEXT,
  triggered      BOOLEAN DEFAULT FALSE,
  triggered_at   TIMESTAMPTZ,
  last_price     NUMERIC(20, 8),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id    ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_triggered  ON price_alerts(triggered);

-- Добавляем колонки если таблица уже существует
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS alert_type  TEXT DEFAULT 'price';
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS repeat_mode TEXT DEFAULT 'once';
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS note        TEXT;
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS last_price  NUMERIC(20, 8);
-- Extended alert type fields
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS volume_multiplier NUMERIC(10,2);
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS vol_avg_7d       NUMERIC(20,2);
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS change_threshold NUMERIC(10,2);
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS change_window    INTEGER;
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS rsi_threshold    NUMERIC(5,1);
ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS target_value     NUMERIC(20,8);

-- FIX: Update CHECK constraints if table already existed with old constraints
-- (Run these manually if ALTER TABLE above didn't create fresh)
-- ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_alert_type_check;
-- ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_alert_type_check
--   CHECK (alert_type IN ('price','price_cross','volume','change','rsi_ob','rsi_os','pump','dump','volatility'));

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own alerts" ON price_alerts;
CREATE POLICY "Users see own alerts"
  ON price_alerts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own alerts" ON price_alerts;
CREATE POLICY "Users insert own alerts"
  ON price_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own alerts" ON price_alerts;
CREATE POLICY "Users delete own alerts"
  ON price_alerts FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service can update alerts" ON price_alerts;
CREATE POLICY "Service can update alerts"
  ON price_alerts FOR UPDATE USING (true);

-- 5. Таблица оплат (FIX B9)
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan           TEXT NOT NULL CHECK (plan IN ('monthly', 'lifetime')),
  amount_usdt    NUMERIC(10, 2) NOT NULL,
  tx_hash        TEXT NOT NULL,
  wallet_from    TEXT,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own payments" ON payments;
CREATE POLICY "Users see own payments"
  ON payments FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own payments" ON payments;
CREATE POLICY "Users insert own payments"
  ON payments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. Таблица быстрых заметок (FIX B10)
CREATE TABLE IF NOT EXISTS quick_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT DEFAULT 'note' CHECK (type IN ('note', 'idea', 'mistake', 'lesson')),
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_notes_user_id ON quick_notes(user_id);

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own notes" ON quick_notes;
CREATE POLICY "Users see own notes"
  ON quick_notes FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own notes" ON quick_notes;
CREATE POLICY "Users insert own notes"
  ON quick_notes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. Проверка
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'trades', 'price_alerts', 'payments', 'quick_notes')
ORDER BY table_name;
