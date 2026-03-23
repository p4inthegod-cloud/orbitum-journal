// api/notify.js v3 — Telegram notification dispatcher
// All types verify tg_notify_* preference + respect silent hours
// New type: ai_coach_feedback (post-trade AI loop)

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

// Silent hours: 23:00–06:00 UTC (non-critical suppressed)
const CRITICAL_TYPES = new Set(['signal_critical', 'tilt', 'raw']);
function isSilent() {
  const h = new Date().getUTCHours();
  return h >= 23 || h < 6;
}

// Per-type → which profile field gates it
const NOTIFY_GATE = {
  alert:             'tg_notify_alerts',
  signal_setup:      'tg_notify_alerts',
  signal_momentum:   'tg_notify_alerts',
  signal_ai:         'tg_notify_alerts',
  signal_critical:   null, // always send
  fomo:              'tg_notify_alerts',
  sa_score:          'tg_notify_alerts',
  trade:             'tg_notify_trades',
  tilt:              'tg_notify_tilt',
  daily:             'tg_notify_daily',
  ai_coach_feedback: 'tg_notify_trades',
  raw:               null,
};

async function tgSend(chat_id, text, extra = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (e?.error_code === 403) return false; // user blocked bot — not an error
      console.warn('[notify] tgSend', chat_id, e?.description);
    }
    return true;
  } catch(e) {
    console.error('[notify] tgSend', e.message);
    return false;
  }
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n) || !n) return '--';
  if (n >= 10000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 1000)  return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtPct(p, plus = true) {
  const n = parseFloat(p);
  if (isNaN(n)) return '--';
  return `${n >= 0 && plus ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtVol(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function timeStr() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function confBar(pct) {
  const f = Math.round(pct / 10);
  const bar = '\u2588'.repeat(f) + '\u2591'.repeat(10 - f);
  const dot = pct >= 75 ? '\uD83D\uDFE2' : pct >= 60 ? '\uD83D\uDFE0' : '\uD83D\uDFE1';
  return `${dot} <code>${bar}</code> <b>${pct}%</b>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Notify-User');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const userId = req.headers['x-notify-user'];
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId))
    return res.status(401).json({ error: 'Unauthorized' });

  const { type, data } = req.body;
  if (!type) return res.status(400).json({ error: 'Missing type' });

  // Load profile — verify TG linked + notification preferences
  const profileR = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=id,tg_linked,tg_chat_id,plan,tg_notify_trades,tg_notify_alerts,tg_notify_daily,tg_notify_tilt`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
  );
  const profiles = await profileR.json();
  const profile  = profiles?.[0];

  if (!profile?.tg_linked || !profile?.tg_chat_id)
    return res.status(403).json({ error: 'TG not linked' });

  const chat_id  = profile.tg_chat_id;
  const isPaid   = profile.plan === 'lifetime' || profile.plan === 'monthly';

  // Check notification gate
  const gate = NOTIFY_GATE[type];
  if (gate && profile[gate] === false)
    return res.status(200).json({ ok: true, skipped: true, reason: 'user preference' });

  // Silent hours — suppress non-critical
  if (isSilent() && !CRITICAL_TYPES.has(type))
    return res.status(200).json({ ok: true, skipped: true, reason: 'silent hours' });

  try {

    // ── PRICE / RSI / VOLUME ALERT ────────────────────────────────
    if (type === 'alert') {
      const {
        symbol, condition, alert_type = 'price',
        target_price, current_price, change_24h,
        volume_24h, volume_ratio, rsi, rsi_period,
        change_pct, change_window, note, repeat_mode, app_url,
      } = data;
      const sym = symbol || '?';

      const HEADERS = {
        price:       condition === 'above' ? 'Breakout Up'    : 'Breakdown',
        price_cross: 'Level Cross',
        volume:      'Volume Spike',
        change:      parseFloat(change_pct) >= 0 ? 'Sharp Rise' : 'Sharp Drop',
        rsi_ob:      'RSI: Overbought',
        rsi_os:      'RSI: Oversold',
        volatility:  'High Volatility',
        pump:        'Pump',
        dump:        'Dump',
      };
      const dot = (alert_type === 'rsi_os' || (alert_type === 'price' && condition === 'above') || alert_type === 'pump')
        ? '[LONG]' : (alert_type === 'rsi_ob' || alert_type === 'volatility') ? '[!]' : '[SHORT]';

      const lines = [
        `<b>ALERT</b>  ${timeStr()} UTC`,
        `---`,
        `${dot} <b>${sym}/USDT  ${HEADERS[alert_type] || 'Alert'}</b>`,
        `---`,
      ];
      if (current_price != null) lines.push(`Price    ${fmtPrice(current_price)}${change_24h != null ? `  ${fmtPct(change_24h)} 24h` : ''}`);
      if (target_price  != null && ['price','price_cross'].includes(alert_type)) {
        const diff = ((parseFloat(current_price) - parseFloat(target_price)) / parseFloat(target_price) * 100).toFixed(2);
        lines.push(`Level    <b>${fmtPrice(target_price)}</b>  (${parseFloat(diff) >= 0 ? '+' : ''}${diff}%)`);
      }
      if (volume_24h    != null) lines.push(`Volume   <b>${fmtVol(volume_24h)}</b>${volume_ratio ? `  x${parseFloat(volume_ratio).toFixed(1)} avg` : ''}`);
      if (rsi           != null) lines.push(`RSI(${rsi_period||14})  <b>${Math.round(rsi)}</b>${rsi >= 70 ? ' [OB]' : rsi <= 30 ? ' [OS]' : ''}`);
      if (change_pct    != null && alert_type === 'change') lines.push(`Move     <b>${fmtPct(change_pct)}</b>${change_window ? ` in ${change_window}min` : ''}`);
      if (note)          lines.push(`\n${note}`);
      if (repeat_mode && repeat_mode !== 'once') lines.push(repeat_mode === 'daily' ? '[daily]' : '[repeat]');
      lines.push(`\n<a href="${app_url || APP_URL}/screener?coin=${encodeURIComponent(sym+'/USDT')}">Open chart</a>`);
      await tgSend(chat_id, lines.join('\n'));
    }

    // ── TRADE LOGGED ──────────────────────────────────────────────
    if (type === 'trade') {
      const { pair, direction, result, pnl_pct, pnl_usd, setup_type, entry_price, exit_price, rr } = data;
      const isWin    = result === 'win';
      const isLoss   = result === 'loss';
      const dir      = direction === 'long' ? 'LONG' : 'SHORT';
      const res_str  = isWin ? 'PROFIT' : isLoss ? 'LOSS' : 'BREAKEVEN';
      const pnlSign  = parseFloat(pnl_pct) >= 0 ? '+' : '';
      const usdStr   = pnl_usd != null ? `  (~${pnl_usd >= 0 ? '+$' : '-$'}${Math.abs(pnl_usd).toFixed(0)})` : '';

      const lines = [
        `<b>${pair}  ${dir}</b>`,
        `<b>${res_str}: ${fmtPct(pnl_pct)}${usdStr}</b>`,
        `---`,
      ];
      if (entry_price) lines.push(`Entry  <b>${fmtPrice(entry_price)}</b>`);
      if (exit_price)  lines.push(`Exit   <b>${fmtPrice(exit_price)}</b>`);
      if (rr)          lines.push(`R:R    <b>1:${parseFloat(rr).toFixed(1)}</b>`);
      if (setup_type)  lines.push(`Setup  <b>${setup_type}</b>`);
      lines.push(`\n<a href="${APP_URL}/journal">View journal</a>  |  <a href="${APP_URL}/ai-journal">AI breakdown</a>`);
      await tgSend(chat_id, lines.join('\n'));
    }

    // ── AI COACH FEEDBACK — within 60s of trade close (WOW feature) ─
    // "You exited 8 min early. Based on your last 12 trades, you do this when BTC drops 0.5%."
    if (type === 'ai_coach_feedback') {
      const { pair, direction, result, pnl_pct, insight, pattern_note, consistency_score } = data;
      if (!insight) return res.status(200).json({ ok: true, skipped: true, reason: 'no insight' });

      const scoreStr = consistency_score != null
        ? `\nPattern score: <b>${consistency_score > 0 ? '+' : ''}${consistency_score}</b>`
        : '';

      await tgSend(chat_id,
        `<b>AI Coach</b>  ${pair}  ${direction === 'long' ? 'LONG' : 'SHORT'}\n` +
        `---\n` +
        `<i>${insight.slice(0, 280)}</i>` +
        (pattern_note ? `\n\n<b>Pattern:</b> ${pattern_note.slice(0, 120)}` : '') +
        scoreStr +
        `\n\n<a href="${APP_URL}/ai-journal">Full breakdown</a>`
      );
    }

    // ── TILT ALERT ────────────────────────────────────────────────
    if (type === 'tilt') {
      const { losses_count, total_loss_pct, last_pairs } = data;
      const pairsStr = last_pairs?.length ? `\nLast trades: ${last_pairs.join(', ')}` : '';
      await tgSend(chat_id,
        `<b>TILT WARNING</b>\n---\n` +
        `${losses_count} losses in a row\n` +
        `Total: <b>${fmtPct(total_loss_pct)}</b>${pairsStr}\n\n` +
        `<b>Close the terminal. Step away.\nThe market will still be here tomorrow.</b>`
      );
    }

    // ── SETUP SIGNAL ──────────────────────────────────────────────
    if (type === 'signal_setup') {
      const { pair, direction, entry, sl, tp, rr, confidence = 75, setup_type, insight, tf = '4H' } = data;
      const dir    = direction === 'long' ? 'LONG' : 'SHORT';
      const rrStr  = rr ? `1:${parseFloat(rr).toFixed(1)}` : '--';
      // Filter ratio line — earns trust through transparency (alert system doc)
      const grade  = confidence >= 80 ? 'A+' : confidence >= 70 ? 'A' : 'B+';
      const scarcityLine = confidence >= 80
        ? `\n<code>Grade: ${grade} — rare occurrence</code>`
        : `\n<code>Grade: ${grade}</code>`;
      const insightLine = insight ? `\n<i>${insight.slice(0, 200)}</i>` : '';

      const msg =
        `<b>SETUP SIGNAL</b>  ${timeStr()} UTC\n---\n` +
        `<b>${pair}  ${dir}</b>  ${tf}\n` +
        (setup_type ? `<code>${setup_type}</code>\n` : '') +
        confBar(confidence) + `\n---\n` +
        `Entry  <b>${fmtPrice(entry)}</b>\n` +
        `SL     <code>${fmtPrice(sl)}</code>\n` +
        `TP     <b>${fmtPrice(tp)}</b>\n` +
        `R:R    <b>${rrStr}</b>\n---` +
        insightLine + scarcityLine +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf}&panel=signal">Open chart</a>  |  <a href="${APP_URL}/journal">Log trade</a>`;

      await tgSend(chat_id, msg);
    }

    // ── MOMENTUM ALERT ────────────────────────────────────────────
    if (type === 'signal_momentum') {
      const { pair, change24h = 0, volume_ratio = 1, momentum_score = 7, price, note } = data;
      const sign    = change24h >= 0 ? '+' : '';
      const urgency = momentum_score >= 8 ? 'HIGH' : 'ACTIVE';
      const window  = momentum_score >= 8 ? '15-30 min window' : 'Watch next 1H';

      await tgSend(chat_id,
        `<b>MOMENTUM</b>  ${timeStr()} UTC\n---\n` +
        `<b>${pair}</b>  [${urgency}]\n` +
        `Price    <b>${fmtPrice(price)}</b>\n` +
        `24H      <b>${sign}${parseFloat(change24h).toFixed(1)}%</b>\n` +
        `Volume   <b>${parseFloat(volume_ratio).toFixed(1)}x avg</b>\n` +
        `Score    <b>${momentum_score}/10</b>\n---\n` +
        window + (note ? `\n${note.slice(0,100)}` : '') +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}">Open chart</a>`
      );
    }

    // ── AI INSIGHT (premium) ──────────────────────────────────────
    if (type === 'signal_ai') {
      const { pair, pattern, probability = 74, basis, recommendation, tf = '4H' } = data;
      const recStr = recommendation ? `\n${recommendation.slice(0, 200)}` : '';

      await tgSend(chat_id,
        `<b>AI INSIGHT</b>  ${timeStr()} UTC  [PREMIUM]\n---\n` +
        `<b>${pair}</b>  ${tf}\n` +
        `Pattern  <code>${pattern}</code>\n` +
        confBar(probability) + `\n` +
        `Based on <b>${basis || 'historical data'}</b>\n---` +
        recStr +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf}&panel=ai">Open chart</a>`
      );
    }

    // ── CRITICAL ALERT ────────────────────────────────────────────
    if (type === 'signal_critical') {
      const { pair, event, price, level, level_label = 'KEY LEVEL', risk_usd, directive } = data;
      const breach   = parseFloat(price) < parseFloat(level) ? '[BREACHED]' : '[APPROACHING]';
      const riskLine = risk_usd ? `Risk   <b>$${Math.abs(parseFloat(risk_usd)).toFixed(0)} at stake</b>\n` : '';
      const dir_str  = directive || 'Review position immediately';

      await tgSend(chat_id,
        `<b>CRITICAL</b>  ${timeStr()} UTC\n---\n` +
        `<b>${pair}  ${event}</b>\n---\n` +
        `Price    <b>${fmtPrice(price)}</b>\n` +
        `${level_label.slice(0,8).padEnd(8)} <code>${fmtPrice(level)} ${breach}</code>\n` +
        riskLine + `---\n` +
        `<b>${dir_str}</b>\n\n` +
        `<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&panel=alert">Chart</a>  |  <a href="${APP_URL}/journal">Log</a>`
      );
    }

    // ── FOMO / MISSED OPPORTUNITY ─────────────────────────────────
    if (type === 'fomo') {
      const { pair, premium_time, delay_min = 15, result_pct, premium_entry, free_entry } = data;
      const resultLine = result_pct != null
        ? `Result:  <b>${result_pct >= 0 ? '+' : ''}${parseFloat(result_pct).toFixed(1)}%</b>\n`
        : '';
      const priceComp = (premium_entry && free_entry)
        ? `Premium entry: <b>${fmtPrice(premium_entry)}</b>\nYour entry:    <code>${fmtPrice(free_entry)} (already moved)</code>\n`
        : '';

      await tgSend(chat_id,
        `<b>YOU ALMOST HAD IT</b>\n---\n` +
        `${pair || 'Setup'} sent: <b>${premium_time || 'real-time'}</b>\n` +
        `Your alert:   <code>+${delay_min} min delay</code>\n---\n` +
        priceComp +
        resultLine +
        `15 minutes cost you the entry.\n` +
        `<b>Premium = real-time. Always.</b>\n\n` +
        `<a href="${APP_URL}/pay">Remove the delay</a>`
      );
    }

    // ── SA SCORE ──────────────────────────────────────────────────
    if (type === 'sa_score') {
      const { score, label, fng, btcDom, mktChg } = data;
      const bar  = '\u2588'.repeat(Math.round(score/10)) + '\u2591'.repeat(10 - Math.round(score/10));
      const dot  = score >= 80 ? '[EXTREME]' : score >= 65 ? '[HIGH]' : score >= 45 ? '[ELEVATED]' : '[LOW]';

      await tgSend(chat_id,
        `${dot} <b>Market Awareness</b>\n---\n` +
        `<code>${bar}</code> <b>${score}/100</b>  ${label}\n---\n` +
        `F&G        <b>${fng}</b>\n` +
        `BTC Dom    <b>${btcDom}%</b>\n` +
        `Market 24H <b>${parseFloat(mktChg) >= 0 ? '+' : ''}${mktChg}%</b>\n\n` +
        `<a href="${APP_URL}/screener">Open screener</a>`
      );
    }

    // ── DAILY BRIEF (manual trigger from journal) ─────────────────
    if (type === 'daily') {
      const { date, fng_val, fng_label, market_cap, btc_dom, signal_quality, top_gainer, user_wr, user_trades } = data;
      const statsLine = user_wr != null ? `\nYour week  <b>${user_trades} trades  ${user_wr}% WR</b>` : '';

      await tgSend(chat_id,
        `<b>Morning Brief</b>  ${date || new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}\n---\n` +
        (market_cap ? `Market  $${market_cap}  BTC Dom ${btc_dom}%\n` : '') +
        (fng_val   ? `F&G     ${fng_val}  ${fng_label}\n` : '') +
        (top_gainer ? `Top 24H ${top_gainer}\n` : '') +
        statsLine +
        `\n---\nSignal index: <b>${signal_quality}/10</b>\n` +
        `<a href="${APP_URL}/screener">Open screener</a>` +
        (isPaid ? '' : `  |  <a href="${APP_URL}/pay">Unlock signals</a>`)
      );
    }

    // ── RAW ───────────────────────────────────────────────────────
    if (type === 'raw') {
      if (data?.text) await tgSend(chat_id, data.text);
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('[notify]', type, e.message);
    return res.status(500).json({ error: e.message });
  }
}
