# Настройка cron-job.org для ORBITUM

## 1. Добавить env переменную в Vercel

В Vercel Dashboard → Settings → Environment Variables добавь:

| Key | Value |
|-----|-------|
| `CRON_SECRET` | любая случайная строка, напр. `orb_cron_xK9mP2qL` |

---

## 2. Зарегистрироваться на cron-job.org

Бесплатный аккаунт: https://cron-job.org  
Лимит: 5 cron jobs, каждые 1 минуту — бесплатно.

---

## 3. Создать 3 задачи

### Задача 1 — Проверка алертов (каждые 5 минут)

| Поле | Значение |
|------|---------|
| **Title** | ORBITUM — Price Alerts |
| **URL** | `https://ai-orbitum.vercel.app/api/alerts` |
| **Schedule** | Every 5 minutes |
| **Request method** | GET |
| **Headers** | `X-Cron-Secret: orb_cron_xK9mP2qL` |

---

### Задача 2 — Утренний брифинг (каждый день в 10:00 МСК = 07:00 UTC)

| Поле | Значение |
|------|---------|
| **Title** | ORBITUM — Daily Briefing |
| **URL** | `https://ai-orbitum.vercel.app/api/daily` |
| **Schedule** | Every day, 07:00 UTC |
| **Request method** | GET |
| **Headers** | `X-Cron-Secret: orb_cron_xK9mP2qL` |

---

### Задача 3 — Недельный отчёт (воскресенье в 09:00 UTC = 12:00 МСК)

| Поле | Значение |
|------|---------|
| **Title** | ORBITUM — Weekly Report |
| **URL** | `https://ai-orbitum.vercel.app/api/weekly` |
| **Schedule** | Every Sunday, 09:00 UTC |
| **Request method** | GET |
| **Headers** | `X-Cron-Secret: orb_cron_xK9mP2qL` |

---

## 4. Как добавить header в cron-job.org

1. Создай новый cron job
2. Раскрой секцию **"Advanced"**
3. Найди **"Request headers"**
4. Нажми **"+ Add header"**
5. Key: `X-Cron-Secret`, Value: `orb_cron_xK9mP2qL`

---

## 5. Проверить что всё работает

После создания задач нажми **"Run now"** рядом с каждой — должно вернуть `200 OK`.

В Vercel Dashboard → Functions → Logs проверь что запросы приходят.

---

## 6. Порядок действий при деплое

```
1. git push → Vercel деплоит автоматически
2. Добавить CRON_SECRET в Vercel env vars
3. Зарегистрировать webhook (один раз):
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://ai-orbitum.vercel.app/api/bot"
4. Запустить supabase-migration.sql в Supabase SQL Editor
5. Настроить 3 cron jobs на cron-job.org
```
