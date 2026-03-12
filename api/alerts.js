// api/alerts.js — Vercel Cron: проверка ценовых алертов каждые 5 минут
// FIXED BUG 4: triggered=is.false (boolean), JOIN через user_id FK

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;

async function tgSend(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
    });
  } catch(e) { console.error('TG error:', e.message); }
}

export default async function handler(req, res) {
  try {
    // FIX BUG 4: triggered=is.false (boolean), не eq.false
    // JOIN profiles через foreign key price_alerts.user_id → profiles.id
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?select=*,profiles(tg_chat_id,tg_linked,tg_notify_alerts)&triggered=is.false`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const alerts = await r.json();
    if (!Array.isArray(alerts) || !alerts.length) return res.status(200).json({ checked: 0 });

    // Уникальные CoinGecko IDs
    const ids = [...new Set(alerts.map(a => a.coingecko_id).filter(Boolean))];
    if (!ids.length) return res.status(200).json({ checked: 0 });

    // Цены одним запросом
    let prices = {};
    try {
      const pr = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      prices = await pr.json();
    } catch(e) {
      console.error('Price fetch failed:', e.message);
      return res.status(200).json({ error: 'price fetch failed' });
    }

    const triggered = [];

    for (const alert of alerts) {
      const p = alert.profiles;
      // FIX: проверяем флаги перед отправкой
      if (!p?.tg_linked || !p?.tg_chat_id || !p?.tg_notify_alerts) continue;

      const priceData = prices[alert.coingecko_id];
      if (!priceData?.usd) continue;

      const current = priceData.usd;
      const hit = (alert.condition === 'above' && current >= alert.target_price) ||
                  (alert.condition === 'below' && current <= alert.target_price);
      if (!hit) continue;

      const emoji  = alert.condition === 'above' ? '🚀' : '📉';
      const dir    = alert.condition === 'above' ? '▲ ПРОБИЛ ВВЕРХ' : '▼ ПРОБИЛ ВНИЗ';
      const chg    = priceData.usd_24h_change?.toFixed(2) ?? '0.00';
      const chgStr = parseFloat(chg) >= 0 ? `+${chg}%` : `${chg}%`;

      await tgSend(p.tg_chat_id,
        `${emoji} <b>АЛЕРТ: ${alert.symbol}</b>\n\n` +
        `${dir} $${Number(alert.target_price).toLocaleString()}\n\n` +
        `💵 Цена: <b>$${current.toLocaleString('en', { maximumFractionDigits: 4 })}</b>\n` +
        `📊 24ч: <b>${chgStr}</b>`
      );
      triggered.push(alert.id);
    }

    // Помечаем сработавшие — FIX: id=in.(a,b,c) синтаксис
    if (triggered.length) {
      await fetch(`${SB_URL}/rest/v1/price_alerts?id=in.(${triggered.join(',')})`, {
        method: 'PATCH',
        headers: {
          'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ triggered: true, triggered_at: new Date().toISOString() }),
      });
    }

    return res.status(200).json({ checked: alerts.length, triggered: triggered.length });
  } catch(e) {
    console.error('Alerts cron error:', e);
    return res.status(200).json({ error: e.message });
  }
}
