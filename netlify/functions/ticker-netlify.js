// netlify/functions/ticker.js
// Netlify Functions — endpoint: /.netlify/functions/ticker?type=crypto|forex

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=10',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const type = event.queryStringParameters?.type;

  try {
    if (type === 'forex') {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD');
      const d = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(d) };
    }

    if (type === 'crypto') {
      const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
                       'DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','PEPEUSDT',
                       'TONUSDT','SUIUSDT'];
      const qs = encodeURIComponent(JSON.stringify(symbols));
      const r  = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${qs}`);
      const d  = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(d) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type required: forex|crypto' }) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
