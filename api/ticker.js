// api/ticker.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const { type } = req.query;

  try {
    if (type === 'forex') {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
      const d = await r.json();
      return res.status(200).json(d);
    }

    if (type === 'crypto') {
      // CoinGecko — работает без API ключа, не блокирует по гео
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2,chainlink,pepe,the-open-network,sui';
      const r = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&per_page=20&sparkline=false`,
        { headers: { 'Accept': 'application/json' } }
      );
      const d = await r.json();
      return res.status(200).json(d);
    }

    res.status(400).json({ error: 'type required: forex|crypto' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
