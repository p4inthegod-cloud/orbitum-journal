// api/finnhub.js — server-side market context proxy.
// Finnhub remains the primary source. The public Fair Economy weekly feed is
// used when Economic Calendar is unavailable on the configured Finnhub plan.

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FAIR_ECONOMY_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function fetchJson(url, timeout = 8000) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Eternity-Trade/1.0' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const error = new Error(`Upstream HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function impact(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('high') || raw === '3') return 'high';
  if (raw.includes('med') || raw === '2') return 'medium';
  return 'low';
}

function normalizeEvent(event, index) {
  const rawDate = event.date || event.time || event.datetime || '';
  const timestamp = Date.parse(rawDate);
  return {
    id: String(event.id || `${Number.isFinite(timestamp) ? timestamp : 'na'}-${index}`),
    title: String(event.title || event.event || event.indicator || 'Economic event'),
    country: String(event.country || event.currency || '—').toUpperCase(),
    impact: impact(event.impact || event.importance),
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : rawDate,
    forecast: String(event.forecast ?? event.estimate ?? ''),
    previous: String(event.previous ?? event.prev ?? ''),
    actual: String(event.actual ?? '')
  };
}

function inRange(event, from, to) {
  if (!Number.isFinite(event.timestamp)) return false;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T23:59:59Z`);
  return event.timestamp >= start && event.timestamp <= end;
}

async function economicCalendar(from, to) {
  const attempts = [];
  if (FINNHUB_KEY) {
    try {
      const url = `https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
      const data = await fetchJson(url);
      const source = Array.isArray(data) ? data : (data.economicCalendar || []);
      if (source.length) return { source: 'Finnhub', events: source.map(normalizeEvent).filter(event => inRange(event, from, to)) };
      attempts.push('Finnhub returned no events');
    } catch (error) {
      attempts.push(`Finnhub ${error.status || error.message}`);
    }
  }

  try {
    const data = await fetchJson(FAIR_ECONOMY_URL);
    const events = (Array.isArray(data) ? data : []).map(normalizeEvent).filter(event => inRange(event, from, to));
    return { source: 'Fair Economy weekly feed', events };
  } catch (error) {
    attempts.push(`Fair Economy ${error.status || error.message}`);
  }

  const error = new Error('Economic calendar sources unavailable');
  error.details = attempts;
  throw error;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { type, from, to, category } = req.query;
  try {
    if (type === 'calendar') {
      if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return res.status(400).json({ error: 'from/to must use YYYY-MM-DD' });
      const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
      if (end < start || end - start > 14 * 86400000) return res.status(400).json({ error: 'calendar range must be 0–14 days' });
      const result = await economicCalendar(from, to);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json({ ...result, updatedAt: new Date().toISOString() });
    }

    if (type === 'news') {
      if (!FINNHUB_KEY) return res.status(503).json({ error: 'Finnhub not configured' });
      const newsCategory = category === 'general' ? 'general' : 'crypto';
      const data = await fetchJson(`https://finnhub.io/api/v1/news?category=${newsCategory}&token=${encodeURIComponent(FINNHUB_KEY)}`);
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ category: newsCategory, news: data, updatedAt: new Date().toISOString() });
    }

    return res.status(400).json({ error: 'type must be calendar or news' });
  } catch (error) {
    console.error('[market-context]', error.message, error.details || '');
    return res.status(502).json({ error: error.message, details: error.details || [] });
  }
}
