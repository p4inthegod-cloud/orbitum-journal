// api/alerts.js — Vercel Cron Job: проверка ценовых алертов
// Запускается каждые 5 минут через vercel.json crons

import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function tgSend(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('TG send error:', e); }
}

export default async function handler(req, res) {
  // Только cron или GET с секретом
  const authHeader = req.headers['authorization'];
  if (req.method !== 'GET' && !authHeader?.includes(process.env.CRON_SECRET || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Берём все активные алерты с данными пользователя
  const { data: alerts, error } = await db
    .from('price_alerts')
    .select('*, profiles(tg_chat_id, tg_linked, tg_notify_alerts, full_name)')
    .eq('triggered', false)
    .eq('profiles.tg_notify_alerts', true);

  if (error || !alerts?.length) {
    return res.status(200).json({ checked: 0 });
  }

  // Получаем уникальные символы для запроса цен
  const symbols = [...new Set(alerts.map(a => a.coingecko_id).filter(Boolean))];
  if (!symbols.length) return res.status(200).json({ checked: 0 });

  // Запрашиваем текущие цены одним вызовом
  let prices = {};
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    prices = d;
  } catch(e) {
    return res.status(200).json({ error: 'Price fetch failed' });
  }

  const triggered = [];
  const now = new Date().toISOString();

  for (const alert of alerts) {
    const profile = alert.profiles;
    if (!profile?.tg_linked || !profile?.tg_chat_id) continue;

    const priceData = prices[alert.coingecko_id];
    if (!priceData) continue;

    const currentPrice = priceData.usd;
    const change24h = priceData.usd_24h_change?.toFixed(2);

    let shouldTrigger = false;
    if (alert.condition === 'above' && currentPrice >= alert.target_price) shouldTrigger = true;
    if (alert.condition === 'below' && currentPrice <= alert.target_price) shouldTrigger = true;

    if (!shouldTrigger) continue;

    // Отправляем уведомление
    const direction = alert.condition === 'above' ? '▲ ПРОБИЛ ВВЕРХ' : '▼ ПРОБИЛ ВНИЗ';
    const emoji = alert.condition === 'above' ? '🚀' : '📉';
    const changeStr = parseFloat(change24h) >= 0 ? `+${change24h}%` : `${change24h}%`;

    await tgSend(profile.tg_chat_id,
      `${emoji} <b>АЛЕРТ: ${alert.symbol}</b>\n\n` +
      `${direction} $${alert.target_price.toLocaleString()}\n\n` +
      `💵 Текущая цена: <b>$${currentPrice.toLocaleString('en', { maximumFractionDigits: 6 })}</b>\n` +
      `📊 За 24ч: <b>${changeStr}</b>\n\n` +
      `⏰ ${new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    );

    triggered.push(alert.id);
  }

  // Помечаем сработавшие алерты
  if (triggered.length) {
    await db.from('price_alerts')
      .update({ triggered: true, triggered_at: now })
      .in('id', triggered);
  }

  return res.status(200).json({ checked: alerts.length, triggered: triggered.length });
}
