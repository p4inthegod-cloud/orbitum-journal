// api/weekly.js — Еженедельный отчёт для всех пользователей
// Вызывается cron-job.org каждое воскресенье в 09:00 UTC

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
    // Все юзеры с включённым weekly
    const ur = await fetch(
      `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_weekly=is.true&select=id,tg_chat_id,full_name`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const users = await ur.json();
    if (!Array.isArray(users) || !users.length) {
      return res.status(200).json({ sent: 0, reason: 'no users' });
    }

    // Дата начала текущей недели (пн 00:00 UTC)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    weekStart.setUTCHours(0, 0, 0, 0);

    let sent = 0;

    for (const user of users) {
      if (!user.tg_chat_id) continue;

      // Сделки юзера за неделю
      const tr = await fetch(
        `${SB_URL}/rest/v1/trades?user_id=eq.${user.id}&created_at=gte.${weekStart.toISOString()}&select=result,pnl_pct,pnl_usd,pair,setup_type,created_at`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
      );
      const trades = await tr.json();

      if (!Array.isArray(trades) || trades.length === 0) {
        await tgSend(user.tg_chat_id,
          `📊 <b>Недельный отчёт</b>\n\n` +
          `За эту неделю сделок нет.\n\n` +
          `Рынок ждёт тебя! 💪`
        );
        sent++;
        continue;
      }

      const wins    = trades.filter(t => t.result === 'win').length;
      const losses  = trades.filter(t => t.result === 'loss').length;
      const wr      = Math.round(wins / trades.length * 100);
      const pnl     = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const pnlUsd  = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
      const pnlSign = pnl >= 0 ? '+' : '';
      const pnlEmoji = pnl >= 0 ? '📈' : '📉';

      // Лучшая пара
      const pairMap = {};
      for (const t of trades) {
        if (!t.pair) continue;
        if (!pairMap[t.pair]) pairMap[t.pair] = 0;
        pairMap[t.pair] += (t.pnl_pct || 0);
      }
      const bestPair = Object.entries(pairMap).sort((a, b) => b[1] - a[1])[0];

      // Лучший сетап
      const setupMap = {};
      for (const t of trades) {
        if (!t.setup_type) continue;
        if (!setupMap[t.setup_type]) setupMap[t.setup_type] = { pnl: 0, count: 0 };
        setupMap[t.setup_type].pnl += (t.pnl_pct || 0);
        setupMap[t.setup_type].count++;
      }
      const bestSetup = Object.entries(setupMap).sort((a, b) => b[1].pnl - a[1].pnl)[0];

      // Худший день
      const dayMap = {};
      for (const t of trades) {
        const day = new Date(t.created_at).toLocaleDateString('ru-RU', { weekday: 'long' });
        if (!dayMap[day]) dayMap[day] = 0;
        dayMap[day] += (t.pnl_pct || 0);
      }
      const worstDay = Object.entries(dayMap).sort((a, b) => a[1] - b[1])[0];

      const weekLabel = weekStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

      await tgSend(user.tg_chat_id,
        `${pnlEmoji} <b>Недельный отчёт</b> · с ${weekLabel}\n\n` +
        `📊 Сделок: <b>${trades.length}</b> (${wins}W / ${losses}L)\n` +
        `🎯 Винрейт: <b>${wr}%</b>\n` +
        `💰 P&L: <b>${pnlSign}${pnl.toFixed(1)}%</b> (~${pnlSign}$${pnlUsd.toFixed(0)})\n` +
        (bestPair  ? `\n🏆 Лучшая пара: <b>${bestPair[0]}</b> (${bestPair[1] >= 0 ? '+' : ''}${bestPair[1].toFixed(1)}%)` : '') +
        (bestSetup ? `\n🔷 Лучший сетап: <b>${bestSetup[0]}</b> (${bestSetup[1].count} сд.)` : '') +
        (worstDay && worstDay[1] < 0 ? `\n⚠️ Худший день: <b>${worstDay[0]}</b> (${worstDay[1].toFixed(1)}%)` : '') +
        `\n\nХорошей недели! 💪`
      );
      sent++;

      // Пауза между юзерами
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[weekly] sent=${sent} users=${users.length}`);
    return res.status(200).json({ sent, users: users.length });

  } catch(e) {
    console.error('Weekly cron error:', e);
    return res.status(500).json({ error: e.message });
  }
}
