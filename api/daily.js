// api/daily.js — Утренний брифинг для всех подключённых пользователей
// Вызывается cron-job.org каждый день в 07:00 UTC

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

async function tgSend(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch(e) { console.error('TG error:', e.message); }
}

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Все юзеры с включённым daily брифингом
    const ur = await fetch(
      `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_daily=is.true&select=id,tg_chat_id,full_name`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const users = await ur.json();
    if (!Array.isArray(users) || !users.length) {
      return res.status(200).json({ sent: 0, reason: 'no users' });
    }

    // 2. Рыночные данные параллельно
    const [marketR, fngR, cryptoR] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(7000) }).then(r => r.json()),
      fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h', { signal: AbortSignal.timeout(7000) }).then(r => r.json()),
    ]);

    // 3. Парсим данные
    const market   = marketR.status === 'fulfilled' ? marketR.value?.data : null;
    const fng      = fngR.status === 'fulfilled' ? fngR.value?.data?.[0] : null;
    const allCoins = cryptoR.status === 'fulfilled' && Array.isArray(cryptoR.value) ? cryptoR.value : [];

    // Sort by 24h change to find actual top gainers
    const gainers  = [...allCoins]
      .filter(g => g.price_change_percentage_24h != null)
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);

    const mcap     = market ? formatMcap(market.total_market_cap?.usd) : '—';
    const btcDom   = market ? market.market_cap_percentage?.btc?.toFixed(1) + '%' : '—';
    const fgVal    = fng?.value ?? '—';
    const fgLabel  = fng?.value_classification ?? '—';
    const fgEmoji  = getFgEmoji(parseInt(fng?.value ?? 0));

    const gainersStr = gainers.slice(0, 3)
      .filter(g => g.price_change_percentage_24h != null)
      .map(g => {
        const ch = g.price_change_percentage_24h;
        return `  • <b>${g.symbol.toUpperCase()}</b> ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`;
      })
      .join('\n');

    // 4. Строим текст брифинга
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
    const text =
      `🌅 <b>Утренний брифинг</b> · ${date}\n\n` +
      `🌍 Market Cap: <b>$${mcap}</b>\n` +
      `₿ BTC Dominance: <b>${btcDom}</b>\n` +
      `${fgEmoji} Fear &amp; Greed: <b>${fgVal} — ${fgLabel}</b>\n` +
      (gainersStr ? `\n🔥 Топ роста 24ч:\n${gainersStr}\n` : '') +
      `\n💡 Торгуй по плану. Удачи! 📊`;

    // 5. Шлём всем
    let sent = 0;
    for (const user of users) {
      if (!user.tg_chat_id) continue;
      await tgSend(user.tg_chat_id, text);
      sent++;
      // Небольшая пауза чтобы не флудить Telegram API
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[daily] sent=${sent} users=${users.length}`);
    return res.status(200).json({ sent, users: users.length });

  } catch(e) {
    console.error('Daily cron error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function formatMcap(usd) {
  if (!usd) return '—';
  if (usd >= 1e12) return (usd / 1e12).toFixed(2) + 'T';
  if (usd >= 1e9)  return (usd / 1e9).toFixed(0) + 'B';
  return usd.toFixed(0);
}

function getFgEmoji(val) {
  if (val >= 75) return '🤑';
  if (val >= 55) return '😊';
  if (val >= 45) return '😐';
  if (val >= 25) return '😰';
  return '😱';
}
