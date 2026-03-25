Vercel Hobby merge plan for Orbitum

What changed:
- api/daily.js + api/weekly.js + api/notify.js + api/onboarding.js -> api/engage.js
- api/alerts.js + api/finnhub.js -> api/market.js
- Original route compatibility preserved through vercel.json rewrites:
  /api/daily      -> /api/engage?__flow=daily
  /api/weekly     -> /api/engage?__flow=weekly
  /api/notify     -> /api/engage?__flow=notify
  /api/onboarding -> /api/engage?__flow=onboarding
  /api/alerts     -> /api/market?__flow=alerts
  /api/finnhub    -> /api/market?__flow=finnhub

Important for deployment:
1. Keep ONLY these files inside /api:
   admin.js
   ai.js
   bot.js
   engage.js
   market.js
   report.js
   ticker.js
   webhook-tv.js

2. Move these files OUT of /api and into /lib (already prepared here):
   daily.js
   weekly.js
   notify.js
   onboarding.js
   alerts.js
   finnhub.js

3. Do NOT keep ai-memory.js, autopilot.js, orbitum-premium.js, telegram-premium.js inside /api.
   They are not serverless endpoints.

Result:
- 8 serverless functions total
- existing frontend fetch('/api/...') calls continue to work
