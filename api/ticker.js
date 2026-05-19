// api/ticker.js — Vercel Serverless Function
// Route: GET /api/ticker?type=screener|crypto|forex|fng|market|trending|gl

const cache = {};
const CACHE_TTL = {
  crypto:   30,
  forex:    60,
  fng:      300,
  market:   60,
  trending: 300,
  gl:       60,
  screener: 45,
  sa_score: 120,  // Situational Awareness Score — refresh every 2 min
};

function sendJSON(res, status, data, extra = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(data);
}

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(9000),
        headers: { 'Accept': 'application/json' }
      });
      if (r.status === 429 && i < retries) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2, i) + Math.random() * 500));
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
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
  screener: (page=1) => `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d,30d`,
  sa_score: null, // computed, not a direct URL
};

async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const { type } = req.query;

  if (!type) return sendJSON(res, 400, { error: 'type required', available: Object.keys(ENDPOINTS) });
  if (!ENDPOINTS[type] && type !== 'sa_score') return sendJSON(res, 400, { error: `unknown type: "${type}"` });

  const now = Date.now();
  const ttl = (CACHE_TTL[type] || 60) * 1000;

  if (cache[type] && (now - cache[type].ts) < ttl) {
    return sendJSON(res, 200, cache[type].data, { 'X-Cache': 'HIT' });
  }

  // ── Situational Awareness Score (computed from multiple sources) ──
  if (type === 'sa_score') {
    try {
      const [fngR, mktR] = await Promise.allSettled([
        fetchWithRetry('https://api.alternative.me/fng/?limit=1'),
        fetchWithRetry(`${CG}/global`),
      ]);
      const fng    = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
      const mktData = mktR.status === 'fulfilled' ? mktR.value?.data : null;
      const btcDom  = mktData?.market_cap_percentage?.btc || 50;
      const mktChg  = mktData?.market_cap_change_percentage_24h_usd || 0;

      const sentimentScore = Math.round(fng / 4);
      const trendScore     = Math.min(25, Math.max(0, Math.round(12.5 + mktChg * 2.5)));
      const domScore       = btcDom < 40 || btcDom > 65 ? 20 : Math.round(25 - Math.abs(btcDom - 52) / 2);
      const phaseScore     = fng < 25 ? 25 : fng > 75 ? 20 : Math.round(fng / 4);
      const total          = Math.min(100, Math.max(0, sentimentScore + trendScore + domScore + Math.round(phaseScore * 0.4)));

      const label  = total >= 80 ? 'EXTREME' : total >= 65 ? 'HIGH' : total >= 45 ? 'ELEVATED' : total >= 25 ? 'MODERATE' : 'LOW';
      const color  = total >= 80 ? '#ff4040' : total >= 65 ? '#e8722a' : total >= 45 ? '#f5c842' : '#2dce5c';
      const raw    = { score: total, label, color, fng, btcDom: parseFloat(btcDom).toFixed(1), mktChg: parseFloat(mktChg).toFixed(2) };
      cache[type]  = { ts: now, data: raw };
      return sendJSON(res, 200, raw, { 'Cache-Control': `public, s-maxage=${CACHE_TTL.sa_score}` });
    } catch(e) {
      if (cache[type]) return sendJSON(res, 200, cache[type].data, { 'X-Cache': 'STALE' });
      return sendJSON(res, 200, { score: 50, label: 'MODERATE', color: '#f5c842' });
    }
  }

  try {
    let raw;
    if (type === 'screener') {
      // Fetch 2 pages (200 coins) and merge for full screener coverage
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
    if (cache[type]) return sendJSON(res, 200, cache[type].data, { 'X-Cache': 'STALE', 'X-Error': e.message });
    return sendJSON(res, 500, { error: e.message });
  }
}

// Support both ESM (Vercel default) and CommonJS
export default handler;
