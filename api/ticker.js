// api/ticker.js — Vercel Serverless Function
// FIXES:
//   1. Content-Type: application/json на всех ответах (исправляет SyntaxError в браузере)
//   2. screener теперь запрашивает 1h,7d,30d изменения (нужны для фильтров в screener.html)
//   3. Улучшен retry: экспоненциальная задержка + jitter против CoinGecko 429
//   4. Явный res.json() заменён на sendJSON() который всегда ставит Content-Type

const cache = {};
const CACHE_TTL = {
  crypto:   30,
  forex:    60,
  fng:      300,
  market:   60,
  trending: 300,
  gl:       60,
  screener: 120,
};

// ── Хелпер: всегда ставит Content-Type ──────────────────────────
function sendJSON(res, status, data, extra = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(data);
}

// ── Retry с экспоненциальной задержкой + jitter ──────────────────
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000) });

      if (r.status === 429 && i < retries) {
        // Exponential backoff + jitter: 1.5s, 3s + random up to 500ms
        const delay = 1500 * Math.pow(2, i) + Math.random() * 500;
        await new Promise(res => setTimeout(res, delay));
        continue;
      }

      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();

    } catch(e) {
      if (i === retries) throw e;
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
  }
}

// ── CoinGecko URLs ───────────────────────────────────────────────
const CG_BASE = 'https://api.coingecko.com/api/v3';

const ENDPOINTS = {
  crypto: () => {
    const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui';
    return `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h,24h,7d&per_page=20&sparkline=false`;
  },
  forex: () => 'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD',
  fng:   () => 'https://api.alternative.me/fng/?limit=1',
  market:   () => `${CG_BASE}/global`,
  trending: () => `${CG_BASE}/search/trending`,
  gl:       () => `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false`,

  // FIX: добавлены 1h и 30d — нужны для переключателей таймфреймов в screener.html
  screener: () => `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d`,
};

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;

  if (!type) {
    return sendJSON(res, 400, { error: 'type required. Available: ' + Object.keys(ENDPOINTS).join(', ') });
  }

  if (!ENDPOINTS[type]) {
    return sendJSON(res, 400, { error: `unknown type: "${type}"` });
  }

  const now = Date.now();
  const ttl = (CACHE_TTL[type] || 60) * 1000;

  // ── Свежий кеш ──
  if (cache[type] && (now - cache[type].ts) < ttl) {
    return sendJSON(res, 200, cache[type].data, {
      'X-Cache':       'HIT',
      'Cache-Control': `public, s-maxage=${CACHE_TTL[type]}`,
    });
  }

  try {
    const url = ENDPOINTS[type]();
    let raw = await fetchWithRetry(url);

    // fng: распаковываем data[0]
    if (type === 'fng') {
      raw = raw.data?.[0] || {};
    }

    cache[type] = { ts: now, data: raw };

    return sendJSON(res, 200, raw, {
      'Cache-Control': `public, s-maxage=${CACHE_TTL[type]}`,
    });

  } catch(e) {
    console.error(`[ticker] ${type} error:`, e.message);

    // Stale кеш лучше чем пустой экран
    if (cache[type]) {
      return sendJSON(res, 200, cache[type].data, {
        'X-Cache':    'STALE',
        'X-Error':    e.message,
      });
    }

    return sendJSON(res, 500, { error: e.message });
  }
}
