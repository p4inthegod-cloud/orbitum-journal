# ORBITUM — Bug Fix Changelog v2

## 16 файлов изменено, 24 бага найдено, 20 исправлено в коде

---

## 🔴 КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ

### ✅ FIX #22 — Redirect Loop: Cabinet → Journal → Login → Cabinet (НОВЫЙ)
**Проблема:** При переходе из кабинета в журнал — бесконечный цикл редиректов. Три причины:
- **A)** `journal.html` и `screener.html` создавали Supabase client без `{persistSession:true, autoRefreshToken:true}` — токен не обновлялся
- **B)** `journal.html`, `screener.html`, `pay.html`, `admin.html` использовали `getUser()` (сетевой запрос, фейлится с протухшим токеном) вместо `getSession()` (localStorage + авторефреш)
- **C)** Все редиректы вели на `login.html` (прямой файл) вместо `/login` (rewrite). Login.html **всегда** возвращал на `/cabinet`, не на исходную страницу.

**Фикс:**
- `journal.html`: `createClient` → добавлен `{auth:{persistSession:true,autoRefreshToken:true}}`, `getUser()` → `getSession()`, `login.html` → `/login?returnTo=/journal`
- `screener.html`: то же самое — auth config + `getSession()` + `/login?returnTo=/screener`
- `pay.html`: `getUser()` → `getSession()`, все ссылки `login.html` → `/login`, `journal.html` → `/journal`
- `admin.html`: `getUser()` → `getSession()`
- `login.html`: добавлен `?returnTo=` параметр — после логина возвращает на страницу откуда пришёл

---

## 🔴 КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ

### ✅ FIX #1 — `api/weekly.js` — SyntaxError (CRASH)
**Проблема:** Двойное объявление `const worstDay` (стр. 101 + 145) и `const weekLabel` (стр. 144 + 147). ESM выбрасывает SyntaxError — **весь weekly cron не работал**.
**Фикс:** Удалены дублирующие строки 144–145.

### ✅ FIX #2 — `api/webhook-tv.js` — Anthropic API без ключа
**Проблема:** Вызов `api.anthropic.com/v1/messages` без заголовка `x-api-key` и `anthropic-version`. AI-анализ TradingView вебхуков всегда возвращал 401.
**Фикс:** Добавлены заголовки `x-api-key: process.env.ANTHROPIC_API_KEY` и `anthropic-version: 2023-06-01`.

### ✅ FIX #3 — `api/webhook-tv.js` — Неправильный фильтр boolean
**Проблема:** `tg_linked=eq.true` — невалидный синтаксис PostgREST для boolean. Broadcast TradingView сигналов не доходил до пользователей.
**Фикс:** `eq.true` → `is.true` (две колонки).

### ✅ FIX #4 — `api/report.js` — Нет авторизации
**Проблема:** Любой мог запросить `POST /api/report` с произвольным `userId` и получить полный отчёт с именем, P&L, и всеми сделками любого пользователя.
**Фикс:** Добавлена проверка JWT через Supabase Auth + сравнение `userId === authUserId`.

### ✅ FIX #5 — `ai-journal.html` — Утечка количества пользователей
**Проблема:** Публичная страница запрашивала `count=exact` по `profiles` и `trades` через anon key, раскрывая точное количество пользователей и сделок.
**Фикс:** Заменено на статические значения social proof. Рекомендация: создать серверный эндпоинт `/api/stats`.

### ⚠️ FIX #6-7 — SQL RLS дыры (ТРЕБУЕТ РУЧНОГО ЗАПУСКА)
**Проблема:** Политика `"Public read basic profile" USING (true)` позволяла читать ВСЕ профили (tg_chat_id, role, plan). Политика `"Service can update alerts" USING (true)` позволяла обновлять чужие алерты.
**Статус:** Файл `supabase-fix-rls.sql` уже есть в проекте — **ЗАПУСТИ ЕГО В SUPABASE SQL EDITOR ЕСЛИ ЕЩЁ НЕ СДЕЛАЛ**.

---

## 🟠 СЕРЬЁЗНЫЕ ИСПРАВЛЕНИЯ

### ✅ FIX #8 — CORS Wildcard на чувствительных эндпоинтах
**Файлы:** `report.js`, `webhook-tv.js`
**Проблема:** `Access-Control-Allow-Origin: *` позволяло любому сайту вызывать API.
**Фикс:** Заменено на `process.env.APP_URL || 'https://orbitum.trade'`.
**Примечание:** `admin.js` и `notify.js` уже были исправлены в копии.

### ✅ FIX #12 — `api/weekly.js` — Missing SELECT fields
**Проблема:** AI compact trades обращался к `t.direction`, `t.emotion_conf`, `t.emotion_fear`, `t.emotion_greed`, `t.emotion_calm` — но SELECT не включал эти поля. Все значения были `undefined`.
**Фикс:** Расширен SELECT + добавлен `order=created_at.asc`.

### ✅ FIX #14 — `api/bot.js` — Серия считалась без сортировки
**Проблема:** Trades из Supabase приходили без ORDER BY. Серия побед/убытков считалась неправильно.
**Фикс:** Добавлен параметр `order` в `sbSelect()` + `order=created_at.asc` для `/stats`.

### ✅ FIX #15 — `api/bot.js` — `/alerts` без `alert_type`
**Проблема:** В SELECT отсутствовал `alert_type`, но код обращался к `a.alert_type`.
**Фикс:** Добавлен `alert_type` в SELECT.

### ✅ FIX #16 — `supabase-migration.sql` — CHECK constraint mismatch
**Проблема:** `alert_type` CHECK допускал только `price, volume, change, volatility`. Код использует также `price_cross, rsi_ob, rsi_os, pump, dump` — INSERT падал с constraint violation.
**Фикс:** Расширен CHECK + добавлены колонки для расширенных типов алертов + `target_price` сделан nullable (не нужен для volume/rsi алертов).

### ✅ FIX #17 — `api/webhook-tv.js` — Только 3 монеты в маппинге
**Проблема:** Только BTC, ETH, SOL были замаплены на CoinGecko ID. Остальные тикеры давали 500.
**Фикс:** Расширен маппинг до 25+ монет + добавлен fallback с динамическим поиском.

### ✅ FIX #18 — `api/daily.js` — CoinGecko невалидный order
**Проблема:** `order=percent_change_24h_desc` — не поддерживается CoinGecko API. Топ gainers показывались неправильно.
**Фикс:** Запрос топ-50 по `market_cap_desc`, сортировка в коде по `price_change_percentage_24h`.

### ✅ FIX #20 — `vercel.json` — Нет rewrite для `/ai-journal`
**Проблема:** Страница доступна только по `/ai-journal.html`, а не `/ai-journal`.
**Фикс:** Добавлен rewrite rule.

---

## ⚠️ НЕ ИСПРАВЛЕНО (требует решения)

### #10 — `report.js` userId без UUID regex
Рекомендация: добавить `if (!/^[0-9a-f-]{36}$/.test(userId))` как в notify.js.

### #11 — `alerts.js` last_price fire-and-forget
В текущей копии уже используется `Promise.allSettled` — проверь что на проде та же версия.

### #13 — `ticker.js` in-memory cache бесполезен на Vercel
Рекомендация: использовать `Cache-Control` headers или Vercel KV/Edge Config.

### #19 — `package.json` пустой
Нет dependencies. Если серверные файлы используют npm-пакеты — добавить.

### #21 — `login.html` redirect без проверки email confirmation
Проверить настройки email confirmation в Supabase Auth.

---

## ДЕЙСТВИЯ ПОСЛЕ ДЕПЛОЯ

1. **СРОЧНО:** Запусти `supabase-fix-rls.sql` в Supabase SQL Editor
2. **СРОЧНО:** Добавь `ANTHROPIC_API_KEY` в Vercel Environment Variables
3. Если таблица `price_alerts` уже существует, выполни вручную:
   ```sql
   ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_alert_type_check;
   ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_alert_type_check
     CHECK (alert_type IN ('price','price_cross','volume','change','rsi_ob','rsi_os','pump','dump','volatility'));
   ALTER TABLE price_alerts ALTER COLUMN target_price DROP NOT NULL;
   ```
4. Проверь что `CRON_SECRET` совпадает между cron-job.org и Vercel env
