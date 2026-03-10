// api/ticker.js — Vercel Serverless Function
// Endpoints: ?type=crypto|forex|fng|market|trending|gl

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  const { type } = req.query;

  try {
    // ── CRYPTO prices (CoinGecko) ──
    if (type === 'crypto') {
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui';
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&per_page=20&sparkline=false`);
      return res.status(200).json(await r.json());
    }

    // ── FOREX (Frankfurter) ──
    if (type === 'forex') {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
      return res.status(200).json(await r.json());
    }

    // ── FEAR & GREED (alternative.me) ──
    if (type === 'fng') {
      const r = await fetch('https://api.alternative.me/fng/?limit=1');
      const d = await r.json();
      return res.status(200).json(d.data?.[0] || {});
    }

    // ── GLOBAL MARKET (CoinGecko) ──
    if (type === 'market') {
      const r = await fetch('https://api.coingecko.com/api/v3/global');
      return res.status(200).json(await r.json());
    }

    // ── TRENDING (CoinGecko) ──
    if (type === 'trending') {
      const r = await fetch('https://api.coingecko.com/api/v3/search/trending');
      return res.status(200).json(await r.json());
    }

    // ── GAINERS / LOSERS — топ 100 по mcap, сортируем клиентски ──
    if (type === 'gl') {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false');
      return res.status(200).json(await r.json());
    }

    res.status(400).json({ error: 'type required' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
