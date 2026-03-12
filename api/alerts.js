// api/alerts.js — проверка ценовых алертов
// Вызывается cron-job.org каждые 5 минут через HTTP GET/POST
// Защита: CRON_SECRET header

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET; // задай в Vercel env vars

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
  // Защита от случайных вызовов — проверяем секрет
  // cron-job.org шлёт его в header: X-Cron-Secret
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Разрешаем GET и POST (cron-job.org умеет оба)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Берём все активные алерты + данные пользователей через FK join
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?select=*,profiles(tg_chat_id,tg_linked,tg_notify_alerts)&triggered=is.false`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const alerts = await r.json();
    if (!Array.isArray(alerts) || !alerts.length) {
      return res.status(200).json({ checked: 0, triggered: 0 });
    }

    // Уникальные CoinGecko IDs для батч-запроса цен
    const ids = [...new Set(alerts.map(a => a.coingecko_id).filter(Boolean))];
    if (!ids.length) return res.status(200).json({ checked: 0, triggered: 0 });

    // Текущие цены одним запросом
    let prices = {};
    try {
      const pr = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!pr.ok) throw new Error('CoinGecko HTTP ' + pr.status);
      prices = await pr.json();
    } catch(e) {
      console.error('Price fetch failed:', e.message);
      return res.status(200).json({ error: 'price fetch failed', detail: e.message });
    }

    const triggered = [];

    for (const alert of alerts) {
      const p = alert.profiles;
      if (!p?.tg_linked || !p?.tg_chat_id || !p?.tg_notify_alerts) continue;

      const priceData = prices[alert.coingecko_id];
      if (!priceData?.usd) continue;

      const current = priceData.usd;
      const hit =
        (alert.condition === 'above' && current >= alert.target_price) ||
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

    // Помечаем сработавшие
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

    console.log(`[alerts] checked=${alerts.length} triggered=${triggered.length}`);
    return res.status(200).json({ checked: alerts.length, triggered: triggered.length });

  } catch(e) {
    console.error('Alerts error:', e);
    return res.status(500).json({ error: e.message });
  }
}
