# Проверка работоспособности `journal.html` и подключения к Supabase (2026-05-19)

## Результаты живой проверки через Supabase MCP

### Проект и подключение
- Проект `orbitum-journal` (ref `kgutmsosfyyxnlnhucaa`), регион `ap-southeast-2`, статус `ACTIVE_HEALTHY`.
- URL `https://kgutmsosfyyxnlnhucaa.supabase.co` и встроенный в `journal.html` anon-key совпадают с фактическими значениями проекта; ключ JWT валиден (exp 2036), не disabled.
- Аутентификация работает: в API-логах сотни `GET /auth/v1/user → 200` и `POST /auth/v1/token (refresh) → 200`.
- В БД 18 пользователей в `auth.users`, 18 строк в `public.trades` от 5 разных юзеров (последняя 2026-05-03).
- RLS на `trades` настроена корректно (`auth.uid() = user_id` для SELECT/INSERT/UPDATE/DELETE, отдельный admin-override).

### Критический баг — был найден и устранён
В bootstrap-скрипте `journal.html` (внутри `<head>`) клиент обращался к таблице `public.trades` так:

```js
fetch(SB_URL + '/rest/v1/trades?...&select=client_id,payload,created_at&...')
fetch(SB_URL + '/rest/v1/trades?on_conflict=user_id,client_id', { POST, body: [{ client_id, payload, ... }] })
```

В реальной схеме БД колонок `client_id` и `payload` **не было** — таблица хранила «развёрнутые» поля (`pair`, `direction`, `result`, `pnl_pct`, `entry_price`, …). Также отсутствовал уникальный индекс на `(user_id, client_id)`, необходимый для `ON CONFLICT user_id,client_id`.

Подтверждение из прод-логов API за последние сутки (выборка):
- `GET /rest/v1/trades?...&select=client_id,payload,created_at → 400` — десятки записей, разные user_id.
- `POST /rest/v1/trades?on_conflict=user_id,client_id → 400` — попытки upsert падали для всех клиентов.

Следствие: история сделок не подгружалась из облака и новые сделки не синхронизировались — данные оставались только в `localStorage['orbitum.trades.v3']`.

### Применённая миграция
Имя миграции: `journal_html_sync_compat`.

```sql
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS payload   jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS trades_user_client_id_uniq
  ON public.trades (user_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.trades ALTER COLUMN pair      DROP NOT NULL;
ALTER TABLE public.trades ALTER COLUMN direction DROP NOT NULL;
ALTER TABLE public.trades ALTER COLUMN result    DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
```

Почему DROP NOT NULL: bundle отправляет `pair`, `direction`, `result` как `null`, когда соответствующее поле в локальной сделке пустое (например, статус ещё не WIN/LOSS/BE). Без послабления NOT NULL даже после добавления `client_id`/`payload` INSERT всё равно падал бы. Существующие CHECK-констрейнты на `direction ∈ {long,short}` и `result ∈ {win,loss,be}` сохранены — они корректно пропускают NULL.

### Что проверить в браузере после деплоя
- Логин → редирект `journal.html` отрабатывает, не уходит обратно на `/login`.
- В DevTools нет 400-х на `/rest/v1/trades` (ни на hydrate-select, ни на upsert).
- Добавить сделку → она появляется в `public.trades` с заполненным `client_id` и `payload`.
- Удалить сделку локально → DELETE с фильтром `client_id=in.(...)` отрабатывает 204.

### Найденные, но не блокирующие замечания безопасности (advisors)
- `view public.public_profiles` — `SECURITY DEFINER` (level ERROR).
- Функции `handle_new_user`, `schedule_onboarding`, `process_onboarding_queue` — `SECURITY DEFINER` + executable анонимом + mutable `search_path` (WARN).
- `follows.follows_all` и `notifications.notifs_insert` — overly permissive RLS (`USING true` / `WITH CHECK true`).
- Bucket `trade-screenshots` — публичный с broad SELECT, позволяет листинг.
- В Auth выключена защита от утёкших паролей (HaveIBeenPwned).

Эти пункты не влияют на работу журнала, но имеет смысл пройтись отдельно.
