// api/ticker.js — Vercel Serverless Function
// с retry-логикой и in-memory кешем против CoinGecko 429

const cache = {};
const CACHE_TTL = { crypto:30, forex:60, fng:300, market:60, trending:300, gl:60, screener:120 };

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.status === 429 && i < retries) {
        await new Promise(res => setTimeout(res, 1500 * (i + 1)));
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(res => setTimeout(res, 800));
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type required' });

  // Отдаём кеш если свежий
  const now = Date.now();
  const ttl = (CACHE_TTL[type] || 60) * 1000;
  if (cache[type] && (now - cache[type].ts) < ttl) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, s-maxage=' + CACHE_TTL[type]);
    return res.status(200).json(cache[type].data);
  }

  try {
    let data;
    if (type === 'crypto') {
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui';
      data = await fetchWithRetry(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&per_page=20&sparkline=false`);
    } else if (type === 'forex') {
      data = await fetchWithRetry('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
    } else if (type === 'fng') {
      const d = await fetchWithRetry('https://api.alternative.me/fng/?limit=1');
      data = d.data?.[0] || {};
    } else if (type === 'market') {
      data = await fetchWithRetry('https://api.coingecko.com/api/v3/global');
    } else if (type === 'trending') {
      data = await fetchWithRetry('https://api.coingecko.com/api/v3/search/trending');
    } else if (type === 'gl') {
      data = await fetchWithRetry('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false');
    } else if (type === 'screener') {
      data = await fetchWithRetry('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d');
    } else {
      return res.status(400).json({ error: 'unknown type' });
    }

    cache[type] = { ts: now, data };
    res.setHeader('Cache-Control', 'public, s-maxage=' + CACHE_TTL[type]);
    return res.status(200).json(data);

  } catch(e) {
    // Отдаём кеш даже если он устарел — лучше старые данные чем пустой экран
    if (cache[type]) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json(cache[type].data);
    }
    return res.status(500).json({ error: e.message });
  }
}
