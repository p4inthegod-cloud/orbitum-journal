// api/notify.js — Отправка уведомлений в Telegram
// SECURITY FIX: проверяем X-Notify-User (Supabase UUID) вместо статичного секрета
// BUG 7 FIX: клиент (journal.html) должен проверять tg_notify_* перед вызовом этого endpoint

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;

async function tgSend(chat_id, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', ...extra })
  });
  if (!r.ok) console.error('tgSend error:', await r.text());
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Notify-User');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // SECURITY: проверяем что пользователь реально существует в Supabase
  const userId = req.headers['x-notify-user'];
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, chat_id, data } = req.body;
  if (!chat_id || !type) return res.status(400).json({ error: 'Missing params' });

  // Доп. проверка: chat_id должен принадлежать этому user_id
  const checkR = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${userId}&tg_chat_id=eq.${chat_id}&select=id,tg_linked`,
    { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
  );
  const profiles = await checkR.json();
  if (!profiles?.[0]?.tg_linked) {
    return res.status(403).json({ error: 'TG not linked for this user' });
  }

  try {
    // ── TRADE ──────────────────────────────────────────────────────
    if (type === 'trade') {
      const { pair, direction, result, pnl_pct, pnl_usd, setup_type, entry_price } = data;
      const resultEmoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '🔶';
      const dirLabel    = direction === 'long' ? '📈 LONG' : '📉 SHORT';
      const pnlSign     = parseFloat(pnl_pct) >= 0 ? '+' : '';
      const pnlStr      = pnl_pct != null ? `${pnlSign}${parseFloat(pnl_pct).toFixed(2)}%` : '—';
      const usdStr      = pnl_usd != null ? ` (${parseFloat(pnl_usd) >= 0 ? '+' : ''}$${parseFloat(pnl_usd).toFixed(0)})` : '';
      const setupStr    = setup_type ? `\n🔷 Сетап: <b>${setup_type}</b>` : '';
      const entryStr    = entry_price ? `\n💵 Вход: <b>$${entry_price}</b>` : '';
      const timeStr     = new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      await tgSend(chat_id,
        `${resultEmoji} <b>${pair}</b> ${dirLabel}\n` +
        `💰 P&L: <b>${pnlStr}${usdStr}</b>${setupStr}${entryStr}\n` +
        `⏰ ${timeStr}`
      );
    }

    // ── SIGNAL ALERT ──────────────────────────────────────────────
    if (type === 'alert') {
      const { coin, signal, value, text, time } = data;
      await tgSend(chat_id,
        `${signal} <b>${coin}</b>\n` +
        `📌 ${text || ''}\n` +
        `💵 ${value || ''}  ·  ⏰ ${time || new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`
      );
    }

    // ── RAW (прямой текст) ────────────────────────────────────────
    if (type === 'raw') {
      const { text } = data;
      if(text) await tgSend(chat_id, text);
    }

    // ── TILT ───────────────────────────────────────────────────────
    if (type === 'tilt') {
      const { losses_count, total_loss_pct } = data;
      await tgSend(chat_id,
        `⚠️ <b>ОСТОРОЖНО — ТИЛЬТ</b>\n\n` +
        `${losses_count} убытка подряд (${total_loss_pct?.toFixed(1)}%)\n\n` +
        `🛑 Сделай перерыв. Рынок никуда не денется.`
      );
    }

    // ── DAILY ──────────────────────────────────────────────────────
    if (type === 'daily') {
      const { market_cap, btc_dom, fear_greed, fg_label, top_gainers } = data;
      const gainers = (top_gainers || []).slice(0, 3)
        .map(g => `  • ${g.symbol} <b>${g.change >= 0 ? '+' : ''}${g.change?.toFixed(1)}%</b>`)
        .join('\n');
      await tgSend(chat_id,
        `🌅 <b>Утренний брифинг</b> ${new Date().toLocaleDateString('ru-RU')}\n\n` +
        `🌍 Market Cap: <b>$${market_cap}</b>\n` +
        `₿ BTC Dom: <b>${btc_dom?.toFixed(1)}%</b>\n` +
        `😱 Страх/Жадность: <b>${fear_greed} — ${fg_label}</b>\n\n` +
        (gainers ? `🔥 Топ роста:\n${gainers}\n\n` : '') +
        `Удачной торговли! 📊`
      );
    }

    // ── WEEKLY ─────────────────────────────────────────────────────
    if (type === 'weekly') {
      const { trades_count, wr, pnl_pct, pnl_usd, best_setup, worst_day, best_pair } = data;
      const pnlSign  = parseFloat(pnl_pct) >= 0 ? '+' : '';
      const pnlEmoji = parseFloat(pnl_pct) >= 0 ? '📈' : '📉';
      await tgSend(chat_id,
        `${pnlEmoji} <b>Недельный отчёт</b>\n\n` +
        `📊 Сделок: <b>${trades_count}</b>\n` +
        `🎯 Винрейт: <b>${wr}%</b>\n` +
        `💰 P&L: <b>${pnlSign}${parseFloat(pnl_pct).toFixed(1)}%</b> (~$${pnlSign}${parseFloat(pnl_usd).toFixed(0)})\n` +
        (best_pair  ? `\n🏆 Лучшая пара: <b>${best_pair}</b>` : '') +
        (best_setup ? `\n🔷 Лучший сетап: <b>${best_setup}</b>` : '') +
        (worst_day  ? `\n⚠️ Плохой день: <b>${worst_day}</b>` : '')
      );
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('Notify error:', e);
    return res.status(500).json({ error: e.message });
  }
}
