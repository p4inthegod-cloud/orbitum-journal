// api/bot.js — Telegram Bot Webhook (Vercel Serverless)
// Команды: /start, /link <code>, /stats, /journal, /alerts, /stop

import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role ключ
const BASE_URL   = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.APP_URL;

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function tgSend(chat_id, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', ...extra })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const body = req.body;
  const msg  = body.message || body.callback_query?.message;
  if (!msg) return res.status(200).send('OK');

  const chat_id  = msg.chat.id;
  const from     = body.message?.from || body.callback_query?.from;
  const text     = (body.message?.text || '').trim();
  const username = from?.username || '';
  const tg_name  = from?.first_name || 'Трейдер';

  const db = sb();

  // ── /start ──────────────────────────────────────────────────────
  if (text === '/start' || text.startsWith('/start ')) {
    const deepLink = text.split(' ')[1]; // /start link_XXXXX

    if (deepLink && deepLink.startsWith('link_')) {
      const code = deepLink.replace('link_', '');
      const { data: profile } = await db
        .from('profiles')
        .select('id, full_name, username')
        .eq('tg_link_code', code)
        .single();

      if (!profile) {
        return tgSend(chat_id, '❌ Код привязки не найден или устарел.\n\nОткрой <b>Настройки → Telegram</b> в журнале и получи новый код.');
      }

      await db.from('profiles').update({
        tg_chat_id: String(chat_id),
        tg_username: username,
        tg_linked: true,
        tg_link_code: null,
        tg_notify_trades: true,
        tg_notify_daily: true,
        tg_notify_alerts: true,
      }).eq('id', profile.id);

      await tgSend(chat_id,
        `✅ <b>Аккаунт привязан!</b>\n\n` +
        `👤 Трейдер: <b>${profile.full_name || profile.username}</b>\n` +
        `🤖 Бот: @aiorbitum_bot\n\n` +
        `Теперь ты будешь получать:\n` +
        `📊 Уведомления о записанных сделках\n` +
        `🌅 Утренний брифинг рынка\n` +
        `🔔 Алерты на цены монет\n` +
        `📈 Еженедельный AI-отчёт\n\n` +
        `Используй /help для списка команд`
      );
      return res.status(200).send('OK');
    }

    // Обычный /start без кода
    const { data: existing } = await db
      .from('profiles')
      .select('id, full_name, tg_linked')
      .eq('tg_chat_id', String(chat_id))
      .single();

    if (existing?.tg_linked) {
      return tgSend(chat_id,
        `👋 С возвращением, <b>${existing.full_name}</b>!\n\n` +
        `/stats — моя статистика\n` +
        `/journal — открыть журнал\n` +
        `/alerts — мои алерты\n` +
        `/notify — настройки уведомлений\n` +
        `/help — все команды`
      );
    }

    return tgSend(chat_id,
      `🔷 <b>ORBITUM Trading Journal</b>\n\n` +
      `Чтобы привязать аккаунт:\n` +
      `1. Открой журнал → <b>Настройки → Telegram</b>\n` +
      `2. Нажми «Привязать Telegram»\n` +
      `3. Перейди по ссылке\n\n` +
      `Или отправь: <code>/link КОД</code>`
    );
  }

  // Проверяем привязан ли аккаунт для остальных команд
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('tg_chat_id', String(chat_id))
    .single();

  if (!profile?.tg_linked) {
    return tgSend(chat_id,
      `🔗 Сначала привяжи аккаунт.\n\nОткрой журнал → <b>Настройки → Telegram</b>`
    );
  }

  // ── /link <code> ────────────────────────────────────────────────
  if (text.startsWith('/link ')) {
    const code = text.replace('/link ', '').trim();
    const { data: target } = await db
      .from('profiles')
      .select('id, full_name, username')
      .eq('tg_link_code', code)
      .single();

    if (!target) return tgSend(chat_id, '❌ Неверный или устаревший код.');

    await db.from('profiles').update({
      tg_chat_id: String(chat_id),
      tg_username: username,
      tg_linked: true,
      tg_link_code: null,
    }).eq('id', target.id);

    return tgSend(chat_id, `✅ Аккаунт <b>${target.full_name || target.username}</b> привязан!`);
  }

  // ── /stats ───────────────────────────────────────────────────────
  if (text === '/stats') {
    const { data: trades } = await db
      .from('trades')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (!trades?.length) {
      return tgSend(chat_id, '📭 Сделок пока нет. Иди торгуй!');
    }

    const wins   = trades.filter(t => t.result === 'win').length;
    const losses = trades.filter(t => t.result === 'loss').length;
    const wr     = Math.round(wins / trades.length * 100);
    const pnl    = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0).toFixed(1);
    const pnlUsd = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0).toFixed(0);

    // Серия
    let streak = 0;
    const last  = trades[0]?.result;
    for (const t of trades) {
      if (t.result === last) streak++; else break;
    }

    // Сегодня
    const today = new Date().toDateString();
    const todayTrades = trades.filter(t => new Date(t.created_at).toDateString() === today);
    const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl_pct || 0), 0).toFixed(1);

    const pnlSign  = parseFloat(pnl) >= 0 ? '+' : '';
    const pnlEmoji = parseFloat(pnl) >= 0 ? '📈' : '📉';
    const todaySign = parseFloat(todayPnl) >= 0 ? '+' : '';

    return tgSend(chat_id,
      `${pnlEmoji} <b>Статистика ${profile.full_name || profile.username}</b>\n\n` +
      `📊 Всего сделок: <b>${trades.length}</b>\n` +
      `✅ Побед: <b>${wins}</b>  ❌ Убытков: <b>${losses}</b>\n` +
      `🎯 Винрейт: <b>${wr}%</b>\n` +
      `💰 P&L: <b>${pnlSign}${pnl}%</b> (${pnlSign}$${pnlUsd})\n\n` +
      `📅 Сегодня: <b>${todayTrades.length} сделок</b> / ${todaySign}${todayPnl}%\n` +
      `🔥 Серия: <b>${streak} ${last === 'win' ? 'побед подряд' : 'убытков подряд'}</b>\n\n` +
      `<a href="${BASE_URL}/journal">→ Открыть журнал</a>`
    );
  }

  // ── /journal ─────────────────────────────────────────────────────
  if (text === '/journal') {
    return tgSend(chat_id,
      `📋 <b>Твой журнал ORBITUM</b>\n\n` +
      `<a href="${BASE_URL}/journal">Открыть журнал →</a>`,
      { reply_markup: { inline_keyboard: [[
        { text: '📋 Открыть журнал', url: `${BASE_URL}/journal` },
        { text: '📊 Аналитика', url: `${BASE_URL}/journal#dashboard` }
      ]]}}
    );
  }

  // ── /alerts ──────────────────────────────────────────────────────
  if (text === '/alerts') {
    const { data: alerts } = await db
      .from('price_alerts')
      .select('*')
      .eq('user_id', profile.id)
      .eq('triggered', false)
      .order('created_at', { ascending: false });

    if (!alerts?.length) {
      return tgSend(chat_id,
        `🔔 Активных алертов нет.\n\n` +
        `Открой <b>Скринер</b> → кликни на монету → «Поставить алерт»\n\n` +
        `<a href="${BASE_URL}/screener">Открыть скринер →</a>`
      );
    }

    const list = alerts.slice(0, 10).map((a, i) =>
      `${i + 1}. <b>${a.symbol}</b> ${a.condition === 'above' ? '▲ выше' : '▼ ниже'} $${a.target_price}`
    ).join('\n');

    return tgSend(chat_id, `🔔 <b>Активные алерты (${alerts.length}):</b>\n\n${list}\n\n/alerts_del — удалить алерт`);
  }

  // ── /notify ──────────────────────────────────────────────────────
  if (text === '/notify') {
    const t = profile.tg_notify_trades ? '✅' : '❌';
    const d = profile.tg_notify_daily  ? '✅' : '❌';
    const a = profile.tg_notify_alerts ? '✅' : '❌';
    const w = profile.tg_notify_weekly ? '✅' : '❌';

    return tgSend(chat_id,
      `⚙️ <b>Настройки уведомлений</b>\n\n` +
      `${t} Сделки — /toggle_trades\n` +
      `${d} Утренний брифинг — /toggle_daily\n` +
      `${a} Ценовые алерты — /toggle_alerts\n` +
      `${w} Недельный отчёт — /toggle_weekly\n\n` +
      `Нажми команду чтобы включить/выключить`
    );
  }

  // ── /toggle_* ────────────────────────────────────────────────────
  const toggles = {
    '/toggle_trades': 'tg_notify_trades',
    '/toggle_daily':  'tg_notify_daily',
    '/toggle_alerts': 'tg_notify_alerts',
    '/toggle_weekly': 'tg_notify_weekly',
  };

  if (toggles[text]) {
    const field   = toggles[text];
    const newVal  = !profile[field];
    await db.from('profiles').update({ [field]: newVal }).eq('id', profile.id);
    const labels = {
      tg_notify_trades: 'Уведомления о сделках',
      tg_notify_daily:  'Утренний брифинг',
      tg_notify_alerts: 'Ценовые алерты',
      tg_notify_weekly: 'Недельный отчёт',
    };
    return tgSend(chat_id, `${newVal ? '✅' : '❌'} ${labels[field]} ${newVal ? 'включены' : 'выключены'}`);
  }

  // ── /stop ────────────────────────────────────────────────────────
  if (text === '/stop') {
    await db.from('profiles').update({
      tg_chat_id: null, tg_linked: false,
      tg_notify_trades: false, tg_notify_daily: false,
      tg_notify_alerts: false, tg_notify_weekly: false,
    }).eq('id', profile.id);
    return tgSend(chat_id, '🔕 Уведомления отключены. Аккаунт отвязан.\n\nДо встречи! /start чтобы снова привязаться.');
  }

  // ── /help ────────────────────────────────────────────────────────
  return tgSend(chat_id,
    `📖 <b>Команды ORBITUM Bot</b>\n\n` +
    `/stats — моя статистика\n` +
    `/journal — открыть журнал\n` +
    `/alerts — мои ценовые алерты\n` +
    `/notify — настройки уведомлений\n` +
    `/stop — отвязать аккаунт\n\n` +
    `<a href="${BASE_URL}/journal">Открыть журнал →</a>`
  );
}
