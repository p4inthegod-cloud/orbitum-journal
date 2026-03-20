export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { symbol, price, signal } = req.body;

    const entry = parseFloat(price);
    const riskPercent = 3;
    const balance = 1000;

    let sl, tp;

    if (signal === 'LONG') {
      sl = entry * 0.99;
      tp = entry * 1.02;
    } else {
      sl = entry * 1.01;
      tp = entry * 0.98;
    }

    const riskAmount = balance * (riskPercent / 100);
    const rr = Math.abs((tp - entry) / (entry - sl));

    const message = `
🚀 ORBITUM SIGNAL

Pair: ${symbol}
Type: ${signal}

Entry: ${entry}
SL: ${sl.toFixed(2)}
TP: ${tp.toFixed(2)}

RR: ${rr.toFixed(2)}
Risk: $${riskAmount}
    `;

    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: message
      })
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}