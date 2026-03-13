// api/notify.js — Отправка уведомлений в Telegram
// v2 — Rich formatting, expanded alert types

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;

async function tgSend(chat_id, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
  });
  if (!r.ok) console.error('tgSend error:', await r.text());
  return r.ok;
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtPct(p, showPlus = true) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  const sign = n >= 0 && showPlus ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtVol(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function now() {
  return new Date().toLocaleString('ru-RU', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Notify-User');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const userId = req.headers['x-notify-user'];
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, chat_id, data } = req.body;
  if (!chat_id || !type) return res.status(400).json({ error: 'Missing params' });

  const checkR = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${userId}&tg_chat_id=eq.${chat_id}&select=id,tg_linked`,
    { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
  );
  const profiles = await checkR.json();
  if (!profiles?.[0]?.tg_linked) {
    return res.status(403).json({ error: 'TG not linked for this user' });
  }

  try {

    // ── ALERT (ценовые и сигнальные уведомления) ──────────────────
    if (type === 'alert') {
      const {
        coin, symbol, condition, alert_type,
        target_price, current_price,
        change_24h, volume_24h, volume_ratio,
        rsi, rsi_period,
        change_pct, change_window,
        note,
        repeat_mode,
        app_url,
      } = data;

      const sym = symbol || coin || '?';

      // Заголовок по типу алерта
      const HEADERS = {
        price:        condition === 'above' ? '📈 Пробой вверх'    : '📉 Пробой вниз',
        price_cross:  '↔️ Пересечение уровня',
        volume:       '📊 Всплеск объёма',
        change:       parseFloat(change_pct) >= 0 ? '⚡ Резкий рост' : '⚡ Резкое падение',
        rsi_ob:       '🔴 RSI: перекупленность',
        rsi_os:       '🟢 RSI: перепроданность',
        volatility:   '🌊 Высокая волатильность',
        pump:         '🚀 Памп',
        dump:         '💣 Дамп',
      };

      const EMOJIS = {
        price: condition === 'above' ? '🟢' : '🔴',
        price_cross: '🔵',
        volume: '🔵',
        change: parseFloat(change_pct) >= 0 ? '🟢' : '🔴',
        rsi_ob: '🔴',
        rsi_os: '🟢',
        volatility: '🟡',
        pump: '🟢',
        dump: '🔴',
      };

      const header = HEADERS[alert_type] || '🔔 Алерт';
      const dot    = EMOJIS[alert_type]  || '⚪';

      const lines = [];
      lines.push(`${dot} <b>ORBITUM · ${sym}/USDT</b>`);
      lines.push(`<b>${header}</b>`);
      lines.push('━━━━━━━━━━━━━━━━━━━');

      // Текущая цена
      if (current_price != null) {
        const chgStr = change_24h != null ? `  <i>${fmtPct(change_24h)} 24ч</i>` : '';
        lines.push(`💰 Цена:       <b>${fmtPrice(current_price)}</b>${chgStr}`);
      }

      // Целевой уровень (для ценовых алертов)
      if (target_price != null && ['price','price_cross'].includes(alert_type)) {
        const diffPct = ((parseFloat(current_price) - parseFloat(target_price)) / parseFloat(target_price) * 100).toFixed(2);
        const diffStr = parseFloat(diffPct) >= 0 ? `+${diffPct}%` : `${diffPct}%`;
        lines.push(`🎯 Уровень:    <b>${fmtPrice(target_price)}</b>  <i>(${diffStr})</i>`);
      }

      // Объём
      if (volume_24h != null) {
        const ratioStr = volume_ratio != null ? `  <i>×${parseFloat(volume_ratio).toFixed(1)} от среднего</i>` : '';
        lines.push(`📊 Объём 24ч:  <b>${fmtVol(volume_24h)}</b>${ratioStr}`);
      }

      // RSI
      if (rsi != null) {
        const p = rsi_period || 14;
        const level = rsi >= 70 ? ' ⚠️ перекупл.' : rsi <= 30 ? ' ⚠️ перепродан' : '';
        lines.push(`📈 RSI (${p}):   <b>${Math.round(rsi)}</b>${level}`);
      }

      // Изменение за период (для change-алертов)
      if (change_pct != null && alert_type === 'change') {
        const win = change_window ? ` за ${change_window} мин` : '';
        lines.push(`⚡ Движение:   <b>${fmtPct(change_pct)}</b>${win}`);
      }

      lines.push(`⏱ Время:       <b>${now()}</b>`);

      // Заметка
      if (note) {
        lines.push('');
        lines.push(`💬 <i>${note}</i>`);
      }

      // Повтор
      const repeatLabel = { once: '', every: '🔁 Повторный алерт', daily: '📅 Ежедневный' }[repeat_mode] || '';
      if (repeatLabel) lines.push(repeatLabel);

      // Ссылка на приложение
      if (app_url) {
        lines.push('');
        lines.push(`<a href="${app_url}">🔗 Открыть ${sym} в Orbitum</a>`);
      }

      await tgSend(chat_id, lines.join('\n'));
    }

    // ── TRADE ──────────────────────────────────────────────────────
    if (type === 'trade') {
      const { pair, direction, result, pnl_pct, pnl_usd, setup_type, entry_price, exit_price, rr, duration } = data;
      const isWin    = result === 'win';
      const isLoss   = result === 'loss';
      const dot      = isWin ? '🟢' : isLoss ? '🔴' : '🟡';
      const dirLabel = direction === 'long' ? '▲ LONG' : '▼ SHORT';
      const pnlEmoji = parseFloat(pnl_pct) >= 0 ? '📈' : '📉';
      const resultStr = isWin ? 'ПРОФИТ' : isLoss ? 'УБЫТОК' : 'БЕЗУБЫТОК';
      const usdStr   = pnl_usd != null ? ` (${parseFloat(pnl_usd) >= 0 ? '+' : ''}$${Math.abs(parseFloat(pnl_usd)).toFixed(0)})` : '';

      const lines = [];
      lines.push(`${dot} <b>${pair} · ${dirLabel}</b>`);
      lines.push(`${pnlEmoji} <b>${resultStr}: ${fmtPct(pnl_pct)}${usdStr}</b>`);
      lines.push('━━━━━━━━━━━━━━━━━━━');
      if (entry_price) lines.push(`📥 Вход:    <b>${fmtPrice(entry_price)}</b>`);
      if (exit_price)  lines.push(`📤 Выход:   <b>${fmtPrice(exit_price)}</b>`);
      if (rr)          lines.push(`⚖️ R:R:     <b>1:${parseFloat(rr).toFixed(1)}</b>`);
      if (setup_type)  lines.push(`🔷 Сетап:   <b>${setup_type}</b>`);
      if (duration)    lines.push(`⏱ Время:    <b>${duration}</b>`);
      else             lines.push(`⏱ Закрыта: <b>${now()}</b>`);

      await tgSend(chat_id, lines.join('\n'));
    }

    // ── TILT ───────────────────────────────────────────────────────
    if (type === 'tilt') {
      const { losses_count, total_loss_pct, last_pairs } = data;
      const pairsStr = last_pairs?.length ? `\nПоследние: ${last_pairs.join(', ')}` : '';
      await tgSend(chat_id,
        `🚨 <b>ТИЛЬТ — СТОП ТОРГОВЛЯ</b>\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📉 ${losses_count} убытка подряд\n` +
        `💸 Суммарно: <b>${fmtPct(total_loss_pct)}</b>${pairsStr}\n\n` +
        `🛑 <b>Закрой терминал. Выйди подышать.\nРынок будет и завтра.</b>`
      );
    }

    // ── DAILY BRIEFING ─────────────────────────────────────────────
    if (type === 'daily') {
      const { market_cap, btc_dom, fear_greed, fg_label, top_gainers, top_losers, events_today } = data;
      const fgEmoji = fear_greed >= 75 ? '🤑' : fear_greed >= 55 ? '😊' : fear_greed >= 45 ? '😐' : fear_greed >= 25 ? '😨' : '😱';

      const gainers = (top_gainers || []).slice(0, 3)
        .map(g => `  • <b>${g.symbol}</b> ${fmtPct(g.change)}`).join('\n');
      const losers = (top_losers || []).slice(0, 3)
        .map(g => `  • <b>${g.symbol}</b> ${fmtPct(g.change)}`).join('\n');
      const eventsStr = (events_today || []).slice(0, 2)
        .map(e => `  📌 ${e}`).join('\n');

      const lines = [
        `🌅 <b>Утренний брифинг · ${new Date().toLocaleDateString('ru-RU', {day:'2-digit',month:'long'})}</b>`,
        '━━━━━━━━━━━━━━━━━━━',
        `🌍 Market Cap:  <b>$${market_cap}</b>`,
        `₿ BTC Dom:     <b>${parseFloat(btc_dom)?.toFixed(1)}%</b>`,
        `${fgEmoji} Страх/Жадность: <b>${fear_greed} — ${fg_label}</b>`,
      ];
      if (gainers) { lines.push(''); lines.push('🔥 <b>Лидеры роста:</b>'); lines.push(gainers); }
      if (losers)  { lines.push(''); lines.push('❄️ <b>Лидеры падения:</b>'); lines.push(losers); }
      if (eventsStr) { lines.push(''); lines.push('📅 <b>События сегодня:</b>'); lines.push(eventsStr); }
      lines.push(''); lines.push('Удачной торговли! 📊');

      await tgSend(chat_id, lines.join('\n'));
    }

    // ── WEEKLY REPORT ──────────────────────────────────────────────
    if (type === 'weekly') {
      const { trades_count, wr, pnl_pct, pnl_usd, best_setup, worst_day, best_pair, avg_rr, max_streak_win, max_streak_loss } = data;
      const pnlEmoji = parseFloat(pnl_pct) >= 0 ? '📈' : '📉';
      const usdStr   = pnl_usd != null ? ` (~${parseFloat(pnl_usd) >= 0 ? '+' : ''}$${Math.abs(parseFloat(pnl_usd)).toFixed(0)})` : '';

      const lines = [
        `${pnlEmoji} <b>Недельный отчёт</b>`,
        `<i>${new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' })}</i>`,
        '━━━━━━━━━━━━━━━━━━━',
        `📊 Сделок:     <b>${trades_count}</b>`,
        `🎯 Винрейт:    <b>${wr}%</b>`,
        `💰 P&L:        <b>${fmtPct(pnl_pct)}${usdStr}</b>`,
      ];
      if (avg_rr)          lines.push(`⚖️ Avg R:R:    <b>1:${parseFloat(avg_rr).toFixed(2)}</b>`);
      if (max_streak_win)  lines.push(`🔥 Серия побед: <b>${max_streak_win}</b>`);
      if (max_streak_loss) lines.push(`❄️ Серия убытков: <b>${max_streak_loss}</b>`);
      lines.push('');
      if (best_pair)  lines.push(`🏆 Лучшая пара:  <b>${best_pair}</b>`);
      if (best_setup) lines.push(`🔷 Лучший сетап: <b>${best_setup}</b>`);
      if (worst_day)  lines.push(`⚠️ Худший день:  <b>${worst_day}</b>`);

      await tgSend(chat_id, lines.join('\n'));
    }

    // ── RAW ────────────────────────────────────────────────────────
    if (type === 'raw') {
      if (data?.text) await tgSend(chat_id, data.text);
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('Notify error:', e);
    return res.status(500).json({ error: e.message });
  }
}
