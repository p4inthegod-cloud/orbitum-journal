// api/bot.js — Telegram Bot Webhook (Vercel Serverless)
// Без npm зависимостей — только fetch

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL        = process.env.SUPABASE_URL;
const SB_KEY        = process.env.SUPABASE_SERVICE_KEY;
const APP_URL       = process.env.APP_URL || 'https://ai-orbitum.vercel.app';

// ── Supabase REST helpers ────────────────────────────────────────
async function sbSelect(table, filters = {}, select = '*') {
  let url = `${SB_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for (const [k, v] of Object.entries(filters)) {
    url += `&${k}=eq.${encodeURIComponent(v)}`;
  }
  const r = await fetch(url, {
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Accept': 'application/json',
    }
  });
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function sbUpdate(table, filters, patch) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filters)) {
    url += `${k}=eq.${encodeURIComponent(v)}&`;
  }
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
}

async function sbInsert(table, row) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  return r.ok;
}

// ── Telegram helper ──────────────────────────────────────────────
async function tgSend(chat_id, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  });
}

// ── Handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const body    = req.body;
    const msg     = body.message || body.callback_query?.message;
    if (!msg) return res.status(200).send('OK');

    const chat_id  = msg.chat.id;
    const from     = body.message?.from || body.callback_query?.from;
    const text     = (body.message?.text || '').trim();
    const username = from?.username || '';

    // ── /start ───────────────────────────────────────────────────
    if (text === '/start' || text.startsWith('/start ')) {
      const deepLink = text.split(' ')[1] || '';

      if (deepLink.startsWith('link_')) {
        const code = deepLink.replace('link_', '');
        const rows = await sbSelect('profiles', { tg_link_code: code }, 'id,full_name,username');
        const profile = rows[0];

        if (!profile) {
          await tgSend(chat_id, '❌ Код привязки не найден или устарел.\n\nОткрой <b>Настройки → Telegram</b> в журнале и получи новый код.');
          return res.status(200).send('OK');
        }

        await sbUpdate('profiles', { id: profile.id }, {
          tg_chat_id: String(chat_id),
          tg_username: username,
          tg_linked: true,
          tg_link_code: null,
          tg_notify_trades: true,
          tg_notify_daily: true,
          tg_notify_alerts: true,
          tg_notify_tilt: true,
          tg_notify_weekly: false,
        });

        await tgSend(chat_id,
          `✅ <b>Аккаунт привязан!</b>\n\n` +
          `👤 Трейдер: <b>${profile.full_name || profile.username || 'Unknown'}</b>\n\n` +
          `Теперь ты будешь получать:\n` +
          `📊 Уведомления о записанных сделках\n` +
          `🔔 Алерты на цены монет\n` +
          `⚠️ Тильт-алерт (3 убытка подряд)\n\n` +
          `/help — список команд`
        );
        return res.status(200).send('OK');
      }

      // Обычный /start
      const rows = await sbSelect('profiles', { tg_chat_id: String(chat_id) }, 'id,full_name,tg_linked');
      const existing = rows[0];

      if (existing?.tg_linked) {
        await tgSend(chat_id,
          `👋 С возвращением, <b>${existing.full_name}</b>!\n\n` +
          `/stats — моя статистика\n` +
          `/alerts — мои алерты\n` +
          `/notify — настройки уведомлений\n` +
          `/stop — отвязать аккаунт`
        );
      } else {
        await tgSend(chat_id,
          `🔷 <b>ORBITUM Trading Journal</b>\n\n` +
          `Чтобы привязать аккаунт:\n` +
          `1. Открой журнал → <b>Настройки → Telegram</b>\n` +
          `2. Нажми «Привязать Telegram»\n` +
          `3. Перейди по ссылке\n\n` +
          `<a href="${APP_URL}/journal">Открыть журнал →</a>`
        );
      }
      return res.status(200).send('OK');
    }

    // Для остальных команд — ищем профиль
    const rows = await sbSelect('profiles', { tg_chat_id: String(chat_id) }, '*');
    const profile = rows[0];

    if (!profile?.tg_linked) {
      await tgSend(chat_id, `🔗 Сначала привяжи аккаунт.\n\n<a href="${APP_URL}/journal">Открыть журнал →</a>`);
      return res.status(200).send('OK');
    }

    // ── /stats ───────────────────────────────────────────────────
    if (text === '/stats') {
      const trades = await sbSelect('trades', { user_id: profile.id }, 'result,pnl_pct,pnl_usd,created_at');

      if (!trades.length) {
        await tgSend(chat_id, '📭 Сделок пока нет. Иди торгуй!');
        return res.status(200).send('OK');
      }

      const wins    = trades.filter(t => t.result === 'win').length;
      const wr      = Math.round(wins / trades.length * 100);
      const pnl     = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0).toFixed(1);
      const pnlUsd  = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0).toFixed(0);
      const pnlSign = parseFloat(pnl) >= 0 ? '+' : '';
      const emoji   = parseFloat(pnl) >= 0 ? '📈' : '📉';

      const today = new Date().toDateString();
      const todayT = trades.filter(t => new Date(t.created_at).toDateString() === today);
      const todayPnl = todayT.reduce((s, t) => s + (t.pnl_pct || 0), 0).toFixed(1);
      const todaySign = parseFloat(todayPnl) >= 0 ? '+' : '';

      await tgSend(chat_id,
        `${emoji} <b>Статистика</b>\n\n` +
        `📊 Сделок: <b>${trades.length}</b>\n` +
        `🎯 Винрейт: <b>${wr}%</b>\n` +
        `💰 P&L: <b>${pnlSign}${pnl}%</b> (${pnlSign}$${pnlUsd})\n\n` +
        `📅 Сегодня: <b>${todayT.length} сделок</b> / ${todaySign}${todayPnl}%\n\n` +
        `<a href="${APP_URL}/journal">→ Открыть журнал</a>`
      );
      return res.status(200).send('OK');
    }

    // ── /alerts ──────────────────────────────────────────────────
    if (text === '/alerts') {
      const alerts = await sbSelect('price_alerts', { user_id: profile.id, triggered: false }, 'symbol,condition,target_price');
      if (!alerts.length) {
        await tgSend(chat_id, `🔔 Активных алертов нет.\n\n<a href="${APP_URL}/screener">Открыть скринер →</a>`);
      } else {
        const list = alerts.slice(0, 10).map((a, i) =>
          `${i+1}. <b>${a.symbol}</b> ${a.condition === 'above' ? '▲ выше' : '▼ ниже'} $${Number(a.target_price).toLocaleString()}`
        ).join('\n');
        await tgSend(chat_id, `🔔 <b>Активные алерты (${alerts.length}):</b>\n\n${list}`);
      }
      return res.status(200).send('OK');
    }

    // ── /notify ──────────────────────────────────────────────────
    if (text === '/notify') {
      const t = profile.tg_notify_trades ? '✅' : '❌';
      const d = profile.tg_notify_daily  ? '✅' : '❌';
      const a = profile.tg_notify_alerts ? '✅' : '❌';
      const tl = profile.tg_notify_tilt  ? '✅' : '❌';
      const w = profile.tg_notify_weekly ? '✅' : '❌';
      await tgSend(chat_id,
        `⚙️ <b>Настройки уведомлений</b>\n\n` +
        `${t} Сделки — /toggle_trades\n` +
        `${a} Алерты — /toggle_alerts\n` +
        `${d} Утренний брифинг — /toggle_daily\n` +
        `${tl} Тильт-алерт — /toggle_tilt\n` +
        `${w} Недельный отчёт — /toggle_weekly`
      );
      return res.status(200).send('OK');
    }

    // ── /toggle_* ────────────────────────────────────────────────
    const toggleMap = {
      '/toggle_trades': ['tg_notify_trades', 'Уведомления о сделках'],
      '/toggle_alerts': ['tg_notify_alerts', 'Алерты'],
      '/toggle_daily':  ['tg_notify_daily',  'Утренний брифинг'],
      '/toggle_tilt':   ['tg_notify_tilt',   'Тильт-алерт'],
      '/toggle_weekly': ['tg_notify_weekly',  'Недельный отчёт'],
    };
    if (toggleMap[text]) {
      const [field, label] = toggleMap[text];
      const newVal = !profile[field];
      await sbUpdate('profiles', { id: profile.id }, { [field]: newVal });
      await tgSend(chat_id, `${newVal ? '✅' : '❌'} ${label} ${newVal ? 'включены' : 'выключены'}`);
      return res.status(200).send('OK');
    }

    // ── /stop ────────────────────────────────────────────────────
    if (text === '/stop') {
      await sbUpdate('profiles', { id: profile.id }, {
        tg_chat_id: null, tg_linked: false, tg_username: null,
        tg_notify_trades: false, tg_notify_alerts: false,
        tg_notify_daily: false, tg_notify_tilt: false, tg_notify_weekly: false,
      });
      await tgSend(chat_id, '🔕 Аккаунт отвязан. /start чтобы привязаться снова.');
      return res.status(200).send('OK');
    }

    // ── /help ────────────────────────────────────────────────────
    await tgSend(chat_id,
      `📖 <b>Команды ORBITUM</b>\n\n` +
      `/stats — моя статистика\n` +
      `/alerts — ценовые алерты\n` +
      `/notify — настройки уведомлений\n` +
      `/stop — отвязать аккаунт\n\n` +
      `<a href="${APP_URL}/journal">Открыть журнал →</a>`
    );
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Bot error:', err);
    return res.status(200).send('OK'); // всегда 200 для Telegram
  }
}
