// api/finnhub.js — Finnhub proxy (keeps API key server-side)
// Used by: screener.html for economic calendar + crypto news

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || 'https://orbitum.trade');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  if (!FINNHUB_KEY) return res.status(500).json({ error: 'Finnhub not configured' });

  const { type, from, to } = req.query;

  try {
    let url;
    if (type === 'calendar') {
      if (!from || !to) return res.status(400).json({ error: 'from/to required' });
      // Sanitize date params
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    } else if (type === 'news') {
      url = `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`;
    } else {
      return res.status(400).json({ error: 'type must be calendar or news' });
    }

    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: 'Finnhub error', status: r.status });

    const data = await r.json();
    // Cache for 5 minutes
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (e) {
    console.error('[finnhub]', e.message);
    res.status(500).json({ error: e.message });
  }
}
