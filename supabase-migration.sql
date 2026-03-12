-- ════════════════════════════════════════════════════════════════
-- ORBITUM — SQL Migration: Telegram + Price Alerts
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

-- Индекс для быстрого поиска по chat_id
CREATE INDEX IF NOT EXISTS idx_profiles_tg_chat_id ON profiles(tg_chat_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tg_link_code ON profiles(tg_link_code);

-- 2. Таблица ценовых алертов
CREATE TABLE IF NOT EXISTS price_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,          -- "BTC"
  coingecko_id   TEXT NOT NULL,          -- "bitcoin"
  condition      TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  target_price   NUMERIC(20, 8) NOT NULL,
  triggered      BOOLEAN DEFAULT FALSE,
  triggered_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для алертов
CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id    ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_triggered  ON price_alerts(triggered);

-- 3. RLS политики для price_alerts
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- Пользователь видит только свои алерты
DROP POLICY IF EXISTS "Users see own alerts" ON price_alerts;
CREATE POLICY "Users see own alerts"
  ON price_alerts FOR SELECT
  USING (auth.uid() = user_id);

-- Пользователь создаёт только свои алерты
DROP POLICY IF EXISTS "Users insert own alerts" ON price_alerts;
CREATE POLICY "Users insert own alerts"
  ON price_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Пользователь удаляет только свои алерты
DROP POLICY IF EXISTS "Users delete own alerts" ON price_alerts;
CREATE POLICY "Users delete own alerts"
  ON price_alerts FOR DELETE
  USING (auth.uid() = user_id);

-- Service role (бот) может UPDATE для triggered=true
DROP POLICY IF EXISTS "Service can update alerts" ON price_alerts;
CREATE POLICY "Service can update alerts"
  ON price_alerts FOR UPDATE
  USING (true);  -- только через service key

-- 4. Проверка: смотрим что создалось
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND column_name LIKE 'tg_%'
ORDER BY column_name;
