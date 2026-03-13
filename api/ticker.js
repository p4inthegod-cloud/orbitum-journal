// api/ticker.js — Vercel Serverless Function
// Route: GET /api/ticker?type=screener|crypto|forex|fng|market|trending|gl

const CACHE_TTL = {
  crypto:   30,
  forex:    60,
  fng:      300,
  market:   60,
  trending: 300,
  gl:       60,
  screener: 45,
};

// Vercel serverless — глобальный кэш живёт пока инстанс тёплый (best-effort)
const cache = globalThis._tickerCache || (globalThis._tickerCache = {});

function sendJSON(res, status, data, extra = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(data);
}

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    let resp;
    try {
      resp = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'Accept': 'application/json' }
      });
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(resolve => setTimeout(resolve, 800 * (i + 1)));
      continue;
    }

    if (resp.status === 429) {
      if (i === retries) throw new Error('Rate limited (429)');
      await new Promise(resolve => setTimeout(resolve, 1500 * Math.pow(2, i) + Math.random() * 500));
      continue;
    }

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }
}

const CG = 'https://api.coingecko.com/api/v3';
const ENDPOINTS = {
  crypto:   () => `${CG}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui&price_change_percentage=1h,24h,7d&per_page=20&sparkline=false`,
  forex:    () => 'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD',
  fng:      () => 'https://api.alternative.me/fng/?limit=1',
  market:   () => `${CG}/global`,
  trending: () => `${CG}/search/trending`,
  gl:       () => `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false`,
  screener: (page = 1) => `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d,30d`,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const { type } = req.query;

  if (!type) return sendJSON(res, 400, { error: 'type required', available: Object.keys(ENDPOINTS) });
  if (!ENDPOINTS[type]) return sendJSON(res, 400, { error: `unknown type: "${type}"` });

  const now = Date.now();
  const ttl = (CACHE_TTL[type] || 60) * 1000;

  if (cache[type] && (now - cache[type].ts) < ttl) {
    return sendJSON(res, 200, cache[type].data, { 'X-Cache': 'HIT' });
  }

  try {
    let raw;
    if (type === 'screener') {
      const [p1, p2] = await Promise.all([
        fetchWithRetry(ENDPOINTS.screener(1)),
        fetchWithRetry(ENDPOINTS.screener(2)),
      ]);
      raw = [...(Array.isArray(p1) ? p1 : []), ...(Array.isArray(p2) ? p2 : [])];
    } else {
      raw = await fetchWithRetry(ENDPOINTS[type]());
      if (type === 'fng') raw = raw.data?.[0] || {};
    }

    cache[type] = { ts: now, data: raw };
    return sendJSON(res, 200, raw, { 'Cache-Control': `public, s-maxage=${CACHE_TTL[type]}` });
  } catch(e) {
    console.error(`[ticker] ${type}:`, e.message);
    // Отдаём устаревший кэш если есть — лучше старые данные чем пустота
    if (cache[type]) {
      return sendJSON(res, 200, cache[type].data, { 'X-Cache': 'STALE', 'X-Error': e.message });
    }
    return sendJSON(res, 500, { error: e.message });
  }
}
