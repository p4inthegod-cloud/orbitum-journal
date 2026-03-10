// api/ticker.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  const { type } = req.query;

  try {
    if (type === 'crypto') {
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui';
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&per_page=20&sparkline=false`);
      return res.status(200).json(await r.json());
    }
    if (type === 'forex') {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
      return res.status(200).json(await r.json());
    }
    if (type === 'fng') {
      const r = await fetch('https://api.alternative.me/fng/?limit=1');
      const d = await r.json();
      return res.status(200).json(d.data?.[0] || {});
    }
    if (type === 'market') {
      const r = await fetch('https://api.coingecko.com/api/v3/global');
      return res.status(200).json(await r.json());
    }
    if (type === 'trending') {
      const r = await fetch('https://api.coingecko.com/api/v3/search/trending');
      return res.status(200).json(await r.json());
    }
    if (type === 'gl') {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false');
      return res.status(200).json(await r.json());
    }
    // SCREENER — топ 100 со sparkline 7д
    if (type === 'screener') {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d');
      return res.status(200).json(await r.json());
    }
    res.status(400).json({ error: 'type required' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
