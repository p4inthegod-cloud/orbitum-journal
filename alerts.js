// api/alerts.js — v3 — Alerts + Screener Auto-Signals
// Runs every 5 min via cron-job.org
// ?action=signals — screener AI signal scan → TG
// ?action=missed  — free user delay messages
// default         — price/rsi/volume alerts check

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = process.env.APP_URL || 'https://orbitum.trade';

// ── Helpers ──────────────────────────────────────────────────────────
function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}
function fmtPct(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtVol(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}
function nowStr() {
  return new Date().toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
}
function timeStr() {
  return new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

async function tgSend(chat_id, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) console.error('tgSend error:', await r.text());
  } catch(e) { console.error('TG error:', e.message); }
}

function buildConfBar(pct) {
  const filled = Math.round(pct / 10);
  const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const dot    = pct >= 80 ? '🟢' : pct >= 65 ? '🟠' : '🟡';
  return `${dot} <code>${bar}</code> <b>${pct}%</b>`;
}

// ── RSI Calculation ──────────────────────────────────────────────────
function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

// ── AI Score (same logic as screener.html) ───────────────────────────
function computeAIScore(c) {
  let score = 50;
  const chg24    = c.price_change_percentage_24h || 0;
  const chg7d    = c.price_change_percentage_7d_in_currency || 0;
  const volRatio = c.market_cap > 0 ? (c.total_volume / c.market_cap * 100) : 0;
  const sp       = c.sparkline_in_7d?.price || [];
  const rsi      = calcRSI(sp);
  const athDrop  = Math.abs(c.ath_change_percentage || 0);

  if (chg24 > 5)  score += 15; else if (chg24 > 2) score += 8;
  else if (chg24 < -5) score -= 12; else if (chg24 < -2) score -= 6;
  if (chg7d > 10) score += 10; else if (chg7d < -10) score -= 8;
  if (volRatio > 15) score += 12; else if (volRatio > 8) score += 6;
  else if (volRatio < 2) score -= 5;
  if (rsi != null) {
    if (rsi >= 65 && rsi < 75) score += 8;
    if (rsi <= 35 && rsi > 25) score += 8;
    if (rsi >= 75) score -= 10;
    if (rsi <= 25) score -= 5;
  }
  if (athDrop < 10) score += 6;
  if (athDrop > 60) score -= 8;

  return Math.max(10, Math.min(98, Math.round(score)));
}

function computeSignal(c, score) {
  const chg24    = c.price_change_percentage_24h || 0;
  const chg7d    = c.price_change_percentage_7d_in_currency || 0;
  const volRatio = c.market_cap > 0 ? (c.total_volume / c.market_cap * 100) : 0;

  if (score >= 75 && chg24 > 0 && (volRatio > 8 || chg7d > 5)) return 'long';
  if (score <= 38 && chg24 < 0 && (volRatio > 6 || chg7d < -5)) return 'short';
  return null; // no signal worth sending
}

function computeSetup(c) {
  const chg24    = c.price_change_percentage_24h || 0;
  const volRatio = c.market_cap > 0 ? (c.total_volume / c.market_cap * 100) : 0;
  const sp       = c.sparkline_in_7d?.price || [];
  const rsi      = calcRSI(sp) || 50;
  const tags     = [];

  if (volRatio > 12) tags.push('Vol Surge');
  if (chg24 > 5)     tags.push('Breakout');
  if (chg24 < -4 && (c.price_change_percentage_7d_in_currency || 0) > 2) tags.push('Reversal');
  if (rsi > 55 && (c.price_change_percentage_7d_in_currency || 0) > 5) tags.push('Trend');
  if (Math.abs(c.ath_change_percentage || 0) < 8) tags.push('ATH Zone');
  if (rsi > 68) tags.push('RSI OB');
  if (rsi < 34) tags.push('RSI OS');

  return tags.slice(0, 3);
}

function computeKeyLevels(c) {
  const price  = c.current_price;
  const sp     = c.sparkline_in_7d?.price || [];
  const high7d = sp.length ? Math.max(...sp) : price * 1.05;
  const low7d  = sp.length ? Math.min(...sp) : price * 0.95;
  const signal = c._signal;
  const entry  = signal === 'long'  ? price * 0.999 : price * 1.001;
  const sl     = signal === 'long'  ? low7d  * 0.98  : high7d * 1.02;
  const tp1    = signal === 'long'  ? price + (price - sl) * 2   : price - (sl - price) * 2;
  const tp2    = signal === 'long'  ? price + (price - sl) * 3.5 : price - (sl - price) * 3.5;
  const rr     = Math.abs((tp1 - entry) / (entry - sl));
  return { entry, sl, tp1, tp2, rr };
}

// ── Build signal TG message ──────────────────────────────────────────
function buildSignalMessage(c, score, signal, setup, lvl, rsi) {
  const sym      = (c.symbol || '').toUpperCase();
  const pair     = `${sym}/USDT`;
  const dirEmoji = signal === 'long' ? '🟢' : '🔴';
  const dirLabel = signal === 'long' ? 'LONG' : 'SHORT';
  const chg24    = (c.price_change_percentage_24h || 0).toFixed(1);
  const chg24s   = parseFloat(chg24) >= 0 ? `+${chg24}%` : `${chg24}%`;
  const confBar  = buildConfBar(score);
  const setupStr = setup.join(' · ') || '—';
  const rsiLine  = rsi != null ? `RSI      ·  <b>${rsi}${rsi >= 70 ? ' ⚠️OB' : rsi <= 30 ? ' ⚠️OS' : ''}</b>\n` : '';
  const rrStr    = lvl.rr ? lvl.rr.toFixed(1) : '—';

  return (
    `⚡ <b>SIGNAL</b> · ${timeStr()} UTC\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${dirEmoji} <b>${pair} · ${dirLabel}</b>\n` +
    `${confBar}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Price    ·  <b>${fmtPrice(c.current_price)}</b>  <i>${chg24s} 24h</i>\n` +
    `Entry    ·  <b>${fmtPrice(lvl.entry)}</b>\n` +
    `SL       ·  <code>${fmtPrice(lvl.sl)}</code>\n` +
    `TP       ·  <b>${fmtPrice(lvl.tp1)}</b>\n` +
    `R:R      ·  <b>1:${rrStr}</b>\n` +
    rsiLine +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Setup    ·  <i>${setupStr}</i>\n` +
    `MCap     ·  <b>${fmtVol(c.market_cap)}</b>\n` +
    `\n` +
    `<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}">📊 CHART</a>  ·  ` +
    `<a href="${APP_URL}/journal?symbol=${sym}&price=${c.current_price}">📓 LOG TRADE</a>`
  );
}

// ── SCREENER SIGNALS ACTION ──────────────────────────────────────────
// Scans top 80 coins, finds high-score signals, broadcasts to subscribed users
async function runScreenerSignals(res) {
  try {
    // 1. Fetch coins with sparklines
    const coinsR = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=80&page=1&sparkline=true&price_change_percentage=24h,7d`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!coinsR.ok) throw new Error('CoinGecko HTTP ' + coinsR.status);
    const coins = await coinsR.json();

    // 2. Score + filter — only HIGH QUALITY signals
    const signals = [];
    for (const c of coins) {
      const score  = computeAIScore(c);
      const signal = computeSignal(c, score);
      if (!signal) continue; // no clear signal

      const sp    = c.sparkline_in_7d?.price || [];
      const rsi   = calcRSI(sp);
      const setup = computeSetup(c);
      c._signal   = signal;
      const lvl   = computeKeyLevels(c);

      signals.push({ coin: c, score, signal, setup, lvl, rsi });
    }

    // Sort by score, take top 5
    signals.sort((a, b) => b.score - a.score);
    const topSignals = signals.slice(0, 5);

    if (!topSignals.length) {
      console.log('[alerts:signals] no signals above threshold');
      return res.status(200).json({ signals: 0, sent: 0 });
    }

    // 3. Get users with tg_notify_alerts enabled + lifetime/monthly plan
    const usersR = await fetch(
      `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_alerts=is.true&select=id,tg_chat_id,plan`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const users = await usersR.json();
    const paidUsers = Array.isArray(users)
      ? users.filter(u => u.plan === 'lifetime' || u.plan === 'monthly')
      : [];

    if (!paidUsers.length) {
      return res.status(200).json({ signals: topSignals.length, sent: 0, reason: 'no paid users' });
    }

    // 4. Check dedup — don't resend same signal within 4 hours
    // Use a simple in-memory approach + DB flag via price_alerts table
    // Store sent signals in a dedicated 'signal_log' or reuse price_alerts with alert_type='screener_signal'
    const sentKey = topSignals.map(s => (s.coin.symbol||'').toUpperCase() + s.signal).join(',');

    // Check if we already sent these in last 4 hours
    const cutoff = new Date(Date.now() - 4 * 3600000).toISOString();
    const dupR = await fetch(
      `${SB_URL}/rest/v1/price_alerts?alert_type=eq.screener_signal&created_at=gte.${cutoff}&select=symbol,condition`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    ).catch(() => ({ json: async () => [] }));
    const recentSent = await dupR.json().catch(() => []);
    const sentSet = new Set(
      Array.isArray(recentSent)
        ? recentSent.map(r => (r.symbol || '').toUpperCase() + (r.condition || ''))
        : []
    );

    // Filter out already-sent signals
    const newSignals = topSignals.filter(s => {
      const key = (s.coin.symbol || '').toUpperCase() + s.signal;
      return !sentSet.has(key);
    });

    if (!newSignals.length) {
      console.log('[alerts:signals] all top signals already sent recently');
      return res.status(200).json({ signals: topSignals.length, new: 0, sent: 0, reason: 'dedup' });
    }

    // 5. Send to all paid users
    let sent = 0;
    for (const sig of newSignals) {
      const msg = buildSignalMessage(sig.coin, sig.score, sig.signal, sig.setup, sig.lvl, sig.rsi);

      for (const user of paidUsers) {
        if (!user.tg_chat_id) continue;
        await tgSend(user.tg_chat_id, msg);
        sent++;
      }

      // Log to price_alerts for dedup tracking
      await fetch(`${SB_URL}/rest/v1/price_alerts`, {
        method: 'POST',
        headers: {
          'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          alert_type:   'screener_signal',
          symbol:       (sig.coin.symbol || '').toUpperCase(),
          condition:    sig.signal,
          target_price: sig.lvl.entry,
          triggered:    true,
          triggered_at: new Date().toISOString(),
          user_id:      null, // system signal
          note:         `Score:${sig.score} Setup:${sig.setup.join(',')}`,
        }),
      }).catch(() => {});

      // Throttle between signals
      await new Promise(r => setTimeout(r, 300));
    }

    // 6. Free users: send "missed signal" teaser for top signal
    const freeUsers = Array.isArray(users)
      ? users.filter(u => u.plan !== 'lifetime' && u.plan !== 'monthly')
      : [];

    if (freeUsers.length && newSignals.length) {
      const top = newSignals[0];
      const sym = (top.coin.symbol || '').toUpperCase();
      const teaser =
        `📌 <b>Signal fired — ${sym}/USDT</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `<b>${top.signal === 'long' ? '▲ LONG' : '▼ SHORT'}</b> · Score <b>${top.score}/100</b>\n` +
        `Entry: <code>+15 min delay on free plan</code>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Premium users got this signal in real-time.\n\n` +
        `<a href="${APP_URL}/pay">Remove the delay →</a>  ·  <a href="${APP_URL}/screener">View chart</a>`;

      for (const user of freeUsers) {
        if (!user.tg_chat_id) continue;
        await tgSend(user.tg_chat_id, teaser);
      }
    }

    console.log(`[alerts:signals] new=${newSignals.length} sent=${sent} paid=${paidUsers.length} free=${freeUsers.length}`);
    return res.status(200).json({
      signals: topSignals.length,
      new: newSignals.length,
      sent,
      paid_users: paidUsers.length,
    });

  } catch(e) {
    console.error('[alerts:signals]', e);
    return res.status(500).json({ error: e.message });
  }
}

// ── MISSED SIGNAL ACTION ─────────────────────────────────────────────
async function runMissedSignals(res) {
  try {
    const since = new Date(Date.now() - 2 * 3600000).toISOString();
    const tr = await fetch(
      `${SB_URL}/rest/v1/price_alerts?triggered=is.true&triggered_at=gte.${since}&select=symbol,alert_type,target_price,triggered_at`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const triggered = await tr.json();
    if (!Array.isArray(triggered) || !triggered.length) {
      return res.status(200).json({ sent: 0, reason: 'no recent triggers' });
    }

    const ur = await fetch(
      `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_alerts=is.true&select=id,tg_chat_id,plan`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const users = await ur.json();
    const freeUsers = Array.isArray(users)
      ? users.filter(u => u.plan !== 'lifetime' && u.plan !== 'monthly')
      : [];

    if (!freeUsers.length) return res.status(200).json({ sent: 0, reason: 'no free users' });

    const best    = triggered[0];
    const sym     = (best.symbol || 'UNKNOWN').toUpperCase();
    const pair    = sym.includes('USDT') ? sym : `${sym}/USDT`;
    const firedAt = new Date(best.triggered_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

    const msg =
      `📌 <b>Signal fired — ${pair}</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Premium alert:  <b>${firedAt} UTC</b>\n` +
      `Your alert:     <code>${firedAt} +15 min delay</code>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `15 minutes = wrong entry price.\n` +
      `<i>Real-time signals are premium only.</i>\n\n` +
      `<a href="${APP_URL}/pay">Remove the delay →</a>  ·  <a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}">View chart</a>`;

    let sent = 0;
    for (const user of freeUsers) {
      if (!user.tg_chat_id) continue;
      await tgSend(user.tg_chat_id, msg);
      sent++;
      if (sent % 20 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[alerts:missed] sent=${sent}`);
    return res.status(200).json({ sent, triggered: triggered.length });
  } catch(e) {
    console.error('[alerts:missed]', e);
    return res.status(500).json({ error: e.message });
  }
}

// ── ALERT CHECK LOGIC (original v2) ──────────────────────────────────
function checkAlert(alert, priceData, history) {
  const current  = priceData.usd;
  const change24 = priceData.usd_24h_change ?? 0;
  const vol24    = priceData.usd_24h_vol    ?? 0;
  const type     = alert.alert_type || 'price';
  const cond     = alert.condition  || 'above';
  const extra    = {};

  switch (type) {
    case 'price': {
      const target = parseFloat(alert.target_price);
      const prev   = parseFloat(alert.last_price ?? (cond === 'above' ? target - 1 : target + 1));
      return { fired: cond === 'above' ? prev < target && current >= target : prev > target && current <= target, extraData: extra };
    }
    case 'price_cross': {
      const target = parseFloat(alert.target_price);
      const prev   = parseFloat(alert.last_price ?? current);
      return { fired: (prev < target && current >= target) || (prev > target && current <= target), extraData: extra };
    }
    case 'volume': {
      const threshold = parseFloat(alert.volume_threshold || 0);
      const mcap      = priceData.usd_market_cap || 1;
      const ratio     = vol24 / (mcap * 0.01);
      extra.vol_ratio = ratio.toFixed(1);
      return { fired: ratio >= (threshold || 10), extraData: extra };
    }
    case 'change': {
      const threshold  = Math.abs(parseFloat(alert.change_threshold || 5));
      extra.change_pct = change24;
      return { fired: cond === 'above' ? change24 >= threshold : change24 <= -threshold, extraData: extra };
    }
    case 'rsi_ob': {
      if (!history?.closes?.length) return { fired: false };
      const rsi = calcRSI(history.closes);
      if (rsi == null) return { fired: false };
      extra.rsi = rsi;
      return { fired: rsi >= (parseFloat(alert.rsi_threshold) || 70), extraData: extra };
    }
    case 'rsi_os': {
      if (!history?.closes?.length) return { fired: false };
      const rsi = calcRSI(history.closes);
      if (rsi == null) return { fired: false };
      extra.rsi = rsi;
      return { fired: rsi <= (parseFloat(alert.rsi_threshold) || 30), extraData: extra };
    }
    case 'pump': {
      const threshold = parseFloat(alert.change_threshold || 8);
      extra.change_pct = change24;
      return { fired: change24 >= threshold, extraData: extra };
    }
    case 'dump': {
      const threshold = parseFloat(alert.change_threshold || 8);
      extra.change_pct = change24;
      return { fired: change24 <= -threshold, extraData: extra };
    }
    case 'volatility': {
      const high  = priceData.usd_24h_high || current;
      const low   = priceData.usd_24h_low  || current;
      const ampl  = low > 0 ? (high - low) / low * 100 : 0;
      const threshold = parseFloat(alert.change_threshold || 8);
      extra.amplitude = ampl.toFixed(1);
      return { fired: ampl >= threshold, extraData: extra };
    }
    default: return { fired: false };
  }
}

function buildAlertMessage(alert, priceData, extraData = {}) {
  const sym      = (alert.symbol || '?').toUpperCase();
  const type     = alert.alert_type || 'price';
  const cond     = alert.condition  || 'above';
  const current  = priceData.usd;
  const change24 = priceData.usd_24h_change ?? 0;
  const vol24    = priceData.usd_24h_vol    ?? 0;
  const pair     = sym.includes('USDT') ? sym : `${sym}/USDT`;
  const deepLink = `${APP_URL}/screener?coin=${encodeURIComponent(pair)}&panel=alert`;

  if (['volume', 'pump', 'change', 'volatility'].includes(type)) {
    const mScore  = extraData.vol_ratio
      ? Math.min(10, Math.max(5, Math.round(parseFloat(extraData.vol_ratio) * 2.5)))
      : Math.min(10, Math.max(5, Math.round(Math.abs(parseFloat(extraData.change_pct || change24)) / 2)));
    const urgency = mScore >= 8 ? '🔥 HIGH' : '⚡ ACTIVE';
    const timeWin = mScore >= 8 ? '⏱ 15–30 min window' : '⏱ Watch next 1H';
    const sign    = change24 >= 0 ? '+' : '';
    const extraLine = extraData.vol_ratio
      ? `\nVolume   ·  <b>${parseFloat(extraData.vol_ratio).toFixed(1)}× avg</b>`
      : extraData.amplitude
      ? `\nAmplitude·  <b>${fmtPct(extraData.amplitude)}</b>`
      : extraData.change_pct != null
      ? `\nMove     ·  <b>${fmtPct(extraData.change_pct)}</b>`
      : '';
    return (
      `🚀 <b>MOMENTUM ALERT</b> · ${timeStr()} UTC\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `<b>${pair}</b> · ${urgency}\n` +
      `Price    ·  <b>${fmtPrice(current)}</b>  <i>${sign}${parseFloat(change24).toFixed(1)}% 24h</i>` +
      extraLine + `\nScore    ·  <b>${mScore}/10</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      timeWin + (alert.note ? `\n💡 ${alert.note}` : '') +
      `\n\n<a href="${deepLink}">📊 OPEN CHART</a>`
    );
  }

  const EVENTS = { price:'BREAKOUT', price_cross:'LEVEL CROSS', rsi_ob:'RSI OVERBOUGHT', rsi_os:'RSI OVERSOLD', dump:'SHARP DUMP' };
  const event    = EVENTS[type] || 'PRICE ALERT';
  const levelLine = alert.target_price
    ? `LEVEL   ·  <code>${fmtPrice(alert.target_price)} ← TRIGGERED</code>\n` : '';
  const rsiLine  = extraData.rsi != null
    ? `RSI     ·  <b>${Math.round(extraData.rsi)}</b>${extraData.rsi >= 70 ? ' ⚠️ extreme' : extraData.rsi <= 30 ? ' ⚠️ extreme' : ''}\n` : '';
  const dot      = cond === 'below' || type === 'dump' ? '🔴' : type === 'rsi_os' ? '🟢' : '🟡';

  return (
    `🚨 <b>ALERT</b> · ${timeStr()} UTC\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${dot} <b>${pair} · ${event}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Price   ·  <b>${fmtPrice(current)}</b>  <i>${change24 >= 0 ? '+' : ''}${parseFloat(change24).toFixed(1)}% 24h</i>\n` +
    levelLine + rsiLine +
    `━━━━━━━━━━━━━━━━━━\n` +
    ({ once:'', every:'🔁 Repeat alert', daily:'📅 Daily' }[alert.repeat_mode] || '') +
    (alert.note ? `\n💬 <i>${alert.note}</i>` : '') +
    `\n<a href="${deepLink}">📊 CHART</a>  ·  <a href="${APP_URL}/journal">📓 LOG</a>`
  );
}

// ── SA SCORE ──────────────────────────────────────────────────────────
async function calcSAScore() {
  const [fngR, mktR] = await Promise.allSettled([
    fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(7000) }).then(r => r.json()),
  ]);
  const fng     = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
  const mktData = mktR.status === 'fulfilled' ? mktR.value?.data : null;
  const btcDom  = mktData?.market_cap_percentage?.btc || 50;
  const mktChg  = mktData?.market_cap_change_percentage_24h_usd || 0;
  const total   = Math.min(100, Math.max(0,
    Math.round(fng / 4) +
    Math.min(25, Math.max(0, Math.round(12.5 + mktChg * 2.5))) +
    (btcDom < 40 || btcDom > 65 ? 20 : Math.round(25 - Math.abs(btcDom - 52) / 2)) +
    Math.round((fng < 25 ? 25 : fng > 75 ? 20 : Math.round(fng / 4)) * 0.4)
  ));
  return {
    score: total,
    label: total >= 80 ? 'EXTREME' : total >= 65 ? 'HIGH' : total >= 45 ? 'ELEVATED' : total >= 25 ? 'MODERATE' : 'LOW',
    color: total >= 80 ? '#ff4040' : total >= 65 ? '#e8722a' : total >= 45 ? '#f5c842' : '#2dce5c',
    fng, btcDom: parseFloat(btcDom).toFixed(1), mktChg: parseFloat(mktChg).toFixed(2),
  };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Route by action
  if (req.query.action === 'signals')  return runScreenerSignals(res);
  if (req.query.action === 'missed')   return runMissedSignals(res);
  if (req.query.action === 'sa_score') return res.status(200).json(await calcSAScore());

  // ── DEFAULT: price_alerts check ──────────────────────────────────
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?select=*,profiles(tg_chat_id,tg_linked,tg_notify_alerts)&triggered=is.false&alert_type=neq.screener_signal`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const alerts = await r.json();
    if (!Array.isArray(alerts) || !alerts.length) {
      return res.status(200).json({ checked: 0, triggered: 0 });
    }

    const ids = [...new Set(alerts.map(a => a.coingecko_id).filter(Boolean))];
    if (!ids.length) return res.status(200).json({ checked: 0, triggered: 0 });

    let prices = {};
    try {
      const pr = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd` +
        `&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true&include_24hr_high=true&include_24hr_low=true`,
        { signal: AbortSignal.timeout(9000) }
      );
      if (!pr.ok) throw new Error('CoinGecko ' + pr.status);
      prices = await pr.json();
    } catch(e) {
      return res.status(200).json({ error: 'price fetch failed', detail: e.message });
    }

    const needHistory = alerts.some(a => ['rsi_ob','rsi_os','change'].includes(a.alert_type));
    const histories   = {};
    if (needHistory) {
      const histIds = [...new Set(alerts.filter(a => ['rsi_ob','rsi_os','change'].includes(a.alert_type)).map(a => a.coingecko_id))];
      await Promise.allSettled(histIds.map(async cgId => {
        try {
          const hr  = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=1&interval=hourly`, { signal: AbortSignal.timeout(8000) });
          if (!hr.ok) return;
          const hd  = await hr.json();
          const closes = (hd.prices || []).map(p => p[1]);
          histories[cgId] = { closes, prices: closes };
        } catch(e) {}
      }));
    }

    const triggeredIds = [];
    for (const alert of alerts) {
      const p = alert.profiles;
      if (!p?.tg_linked || !p?.tg_chat_id || !p?.tg_notify_alerts) continue;
      const priceData = prices[alert.coingecko_id];
      if (!priceData?.usd) continue;
      if (alert.repeat_mode !== 'once' && alert.triggered_at) {
        const cooldown = alert.repeat_mode === 'daily' ? 86400000 : 1800000;
        if (Date.now() - new Date(alert.triggered_at).getTime() < cooldown) continue;
      }
      const { fired, extraData } = checkAlert(alert, priceData, histories[alert.coingecko_id] || null);
      if (!fired) continue;
      await tgSend(p.tg_chat_id, buildAlertMessage(alert, priceData, extraData));
      triggeredIds.push(alert.id);
    }

    if (triggeredIds.length) {
      const onceIds   = triggeredIds.filter(id => {
        const a = alerts.find(x => x.id === id);
        return !a || (a.repeat_mode !== 'every' && a.repeat_mode !== 'daily');
      });
      const repeatIds = triggeredIds.filter(id => {
        const a = alerts.find(x => x.id === id);
        return a && (a.repeat_mode === 'every' || a.repeat_mode === 'daily');
      });
      if (onceIds.length) {
        await fetch(`${SB_URL}/rest/v1/price_alerts?id=in.(${onceIds.join(',')})`, {
          method: 'PATCH',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ triggered: true, triggered_at: new Date().toISOString() }),
        });
      }
      if (repeatIds.length) {
        await fetch(`${SB_URL}/rest/v1/price_alerts?id=in.(${repeatIds.join(',')})`, {
          method: 'PATCH',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ triggered: false, triggered_at: new Date().toISOString() }),
        });
      }
    }

    // Update last_price
    await Promise.allSettled(alerts
      .filter(a => prices[a.coingecko_id]?.usd)
      .map(a => fetch(`${SB_URL}/rest/v1/price_alerts?id=eq.${a.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ last_price: prices[a.coingecko_id].usd }),
      }).catch(() => {}))
    );

    console.log(`[alerts] checked=${alerts.length} triggered=${triggeredIds.length}`);
    return res.status(200).json({ checked: alerts.length, triggered: triggeredIds.length });

  } catch(e) {
    console.error('Alerts error:', e);
    return res.status(500).json({ error: e.message });
  }
}
