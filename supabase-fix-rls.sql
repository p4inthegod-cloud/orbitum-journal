-- ════════════════════════════════════════════════════════════════
-- ORBITUM — RLS Security Fix
-- КРИТИЧНО: запустить в Supabase SQL Editor НЕМЕДЛЕННО
-- ════════════════════════════════════════════════════════════════

-- ── 1. FIX: Убираем дыру "Public read basic profile" ─────────────
-- Эта политика позволяла ЛЮБОМУ читать ВСЕ профили (tg_chat_id, role, plan и т.д.)
DROP POLICY IF EXISTS "Public read basic profile" ON profiles;

-- Только сам пользователь видит свой профиль
DROP POLICY IF EXISTS "Users see own profile" ON profiles;
CREATE POLICY "Users see own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Для публичных профилей (leaderboard, социальные фичи) — только безопасные поля
-- Создай отдельный VIEW если нужен leaderboard:
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, username, full_name, plan, created_at
  FROM profiles;
-- Примечание: VIEW наследует RLS родительской таблицы

-- ── 2. FIX: price_alerts UPDATE policy — убираем USING (true) ───
-- Позволяло любому пользователю обновлять чужие алерты
DROP POLICY IF EXISTS "Service can update alerts" ON price_alerts;

-- Алерты обновляет только серверный cron через service key (обходит RLS)
-- Никакой клиентской политики UPDATE не нужно
-- Если нужна политика для собственных алертов пользователя:
CREATE POLICY "Users update own alerts"
  ON price_alerts FOR UPDATE
  USING (auth.uid() = user_id);

-- ── 3. Проверка итоговых политик ─────────────────────────────────
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('profiles', 'price_alerts', 'trades', 'payments')
ORDER BY tablename, cmd;
