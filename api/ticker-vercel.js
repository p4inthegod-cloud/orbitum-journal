// api/ticker.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  const { type } = req.query;

  try {
    if (type === 'forex') {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
      const d = await r.json();
      return res.status(200).json(d);
    }
    if (type === 'crypto') {
      const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
                       'DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','PEPEUSDT',
                       'TONUSDT','SUIUSDT'];
      const qs = encodeURIComponent(JSON.stringify(symbols));
      const r  = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${qs}`);
      const d  = await r.json();
      return res.status(200).json(d);
    }
    res.status(400).json({ error: 'type required' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
