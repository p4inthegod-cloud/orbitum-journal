Orbitum Vercel Variant B package

Upload this package root to Vercel.

Serverless functions kept in /api:
- admin.js
- ai.js
- bot.js
- engage.js
- market.js
- report.js
- ticker.js
- webhook-tv.js

Delegates moved to /lib:
- daily.js
- weekly.js
- notify.js
- onboarding.js
- alerts.js
- finnhub.js

This keeps the project within 8 Vercel functions.
Old frontend calls like /api/daily and /api/notify continue to work through rewrites in vercel.json.
