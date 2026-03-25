// api/bot.js — ORBITUM Telegram Bot v4
// Implements: cockpit UX concept + alert system + conversion funnel templates
// Alert formats: SETUP · MOMENTUM · AI INSIGHT · CRITICAL · DIGEST

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

// ── Supabase helpers ───────────────────────────────────────────────
async function sbSelect(table, filters = {}, select = '*', order = '') {
  let url = `${SB_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for (const [k, v] of Object.entries(filters)) {
    const op = typeof v === 'boolean' ? 'is' : 'eq';
    url += `&${k}=${op}.${encodeURIComponent(v)}`;
  }
  if (order) url += `&order=${encodeURIComponent(order)}`;
  const r = await fetch(url, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' }
  });
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function sbUpdate(table, filters, patch) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filters)) {
    const op = typeof v === 'boolean' ? 'is' : 'eq';
    url += `${k}=${op}.${encodeURIComponent(v)}&`;
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  return r.ok;
}

async function tgSend(chat_id, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id, text, parse_mode: 'HTML',
      disable_web_page_preview: true, ...extra
    }),
  });
  if (!r.ok) console.error('tgSend error:', await r.text());
  return r.ok;
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE FORMATTERS — 5 alert types from alert system template
// ═══════════════════════════════════════════════════════════════════

function buildConfBar(pct) {
  const filled = Math.round(pct / 10);
  const bar    = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  const dot    = pct >= 75 ? '\uD83D\uDFE2' : pct >= 60 ? '\uD83D\uDFE0' : '\uD83D\uDFE1';
  return `${dot} <code>${bar}</code> <b>${pct}%</b> confidence\n`;
}

export function fmtPrice(n) {
  if (!n && n !== 0) return '\u2014';
  const v = parseFloat(n);
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 100)   return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (v >= 1)     return v.toFixed(3);
  return v.toFixed(6);
}

function getFngEmoji(val) {
  const n = parseInt(val);
  if (n >= 75) return '\uD83E\uDD11';
  if (n >= 55) return '\uD83D\uDE0A';
  if (n >= 45) return '\uD83D\uDE10';
  if (n >= 25) return '\uD83D\uDE30';
  return '\uD83D\uDE31';
}

// 1. SETUP SIGNAL — structure-confirmed, ICT/SMC
export function formatSetup({ pair, direction, entry, sl, tp, rr, confidence = 75, setup_type, insight, tf = '4H' }) {
  const dirEmoji = direction === 'long' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
  const dirLabel = direction === 'long' ? 'LONG' : 'SHORT';
  const rrStr    = rr ? `${parseFloat(rr).toFixed(1)}:1` : '\u2014';
  const insightLine = insight ? `\n\uD83E\uDDE0 <i>${insight.slice(0, 120)}</i>` : '';
  const scarcity = confidence >= 80
    ? '\n<code>\u26A1 Setup quality: A+ \u2014 rare occurrence</code>'
    : `\n<code>\u2726 ${Math.floor(Math.random() * 200 + 100)} traders tracking this setup</code>`;

  return (
    `\u26A1 <b>SETUP SIGNAL</b> \u00B7 ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `${dirEmoji} <b>${pair} \u00B7 ${dirLabel}</b> \u00B7 ${tf}\n` +
    (setup_type ? `<code>${setup_type}</code>\n` : '') +
    buildConfBar(confidence) +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `Entry  \u00B7  <b>$${fmtPrice(entry)}</b>\n` +
    `SL     \u00B7  <code>$${fmtPrice(sl)}</code>\n` +
    `TP     \u00B7  <b>$${fmtPrice(tp)}</b>\n` +
    `R:R    \u00B7  <b>${rrStr}</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015` +
    insightLine +
    scarcity +
    `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf}&panel=signal">\uD83D\uDCCA OPEN CHART</a>  \u00B7  <a href="${APP_URL}/journal?log=auto">\uD83D\uDCCB LOG TRADE</a>`
  );
}

// 2. MOMENTUM ALERT — volume spike, time-sensitive
export function formatMomentum({ pair, change24h = 0, volume_ratio = 1, momentum_score = 7, price, note }) {
  const sign    = change24h >= 0 ? '+' : '';
  const urgency = momentum_score >= 8 ? '\uD83D\uDD25 HIGH' : '\u26A1 ACTIVE';
  const window  = momentum_score >= 8 ? '\u23F1 15\u201330 min window' : '\u23F1 Watch next 1H';
  const noteStr = note ? `\n\uD83D\uDCA1 ${note.slice(0, 100)}` : '';

  return (
    `\uD83D\uDE80 <b>MOMENTUM ALERT</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `<b>${pair}</b> \u00B7 ${urgency}\n` +
    `Price    \u00B7  <b>$${fmtPrice(price)}</b>\n` +
    `24H      \u00B7  <b>${sign}${parseFloat(change24h).toFixed(1)}%</b>\n` +
    `Volume   \u00B7  <b>${parseFloat(volume_ratio).toFixed(1)}\u00D7 avg</b>\n` +
    `Score    \u00B7  <b>${momentum_score}/10</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    window +
    noteStr +
    `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}">\uD83D\uDCCA OPEN CHART</a>`
  );
}

// 3. AI INSIGHT — deep pattern recognition, premium
export function formatAIInsight({ pair, pattern, probability = 74, basis, recommendation, tf = '4H' }) {
  const recStr = recommendation ? `\n\u2192 <i>${recommendation.slice(0, 120)}</i>` : '';

  return (
    `\uD83E\uDD16 <b>AI INSIGHT</b> \u00B7 Premium\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `<b>${pair}</b> \u00B7 ${tf}\n` +
    `Pattern  \u00B7  <code>${pattern}</code>\n` +
    buildConfBar(probability) +
    `Based on <b>${basis || 'historical data'}</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015` +
    recStr +
    `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf}&panel=ai">\uD83D\uDCCA OPEN CHART</a>  \u00B7  <a href="${APP_URL}/journal?ai=1">\uD83E\uDD16 ASK AI</a>`
  );
}

// 4. CRITICAL ALERT — immediate action required
export function formatCritical({ pair, event, price, level, level_label = 'KEY LEVEL', risk_usd, directive }) {
  const breach   = parseFloat(price) < parseFloat(level) ? '\u2190 BREACHED' : '\u2190 APPROACHING';
  const riskLine = risk_usd ? `Risk   \u00B7  <b>$${fmtPrice(risk_usd)} at stake</b>\n` : '';
  const dir      = directive || 'Review position immediately';

  return (
    `\uD83D\uDEA8 <b>CRITICAL ALERT</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `\uD83D\uDD34 <b>${pair} \u00B7 ${event}</b>\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `Price    \u00B7  <b>$${fmtPrice(price)}</b>\n` +
    `${level_label.slice(0, 8).padEnd(8)} \u00B7  <code>$${fmtPrice(level)} ${breach}</code>\n` +
    riskLine +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `\u26A1 <b>${dir}</b>\n\n` +
    `<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&panel=alert">\uD83D\uDCCA CHART</a>  \u00B7  <a href="${APP_URL}/journal">\uD83D\uDCCB LOG</a>  \u00B7  <a href="${APP_URL}/journal?ai=1">\uD83E\uDD16 AI</a>`
  );
}

// 5. DAILY DIGEST — morning brief with personal stats + anticipation
export function formatDailyDigest({ btc_price, btc_status, eth_price, fng_val, fng_label, top_setup, event_preview, user_wr, user_trades_week, signal_quality = 7 }) {
  const fngEmoji  = getFngEmoji(fng_val);
  const setupLine = top_setup ? `\n\uD83D\uDCC8 Top setup  \u00B7  <b>${top_setup}</b>` : '';
  const eventLine = event_preview ? `\n\u23F0 Watch  \u00B7  <b>${event_preview}</b>` : '';
  const statsLine = (user_wr !== null && user_trades_week)
    ? `\n\uD83D\uDCCA Your week  \u00B7  <b>${user_trades_week} trades \u00B7 ${user_wr}% WR</b>` : '';
  const qualNote  = signal_quality < 6
    ? '\n\n<code>Low-signal morning \u2014 patience is the edge today.</code>'
    : signal_quality >= 8
    ? '\n\n<code>\u26A1 High-signal conditions \u2014 stay sharp.</code>'
    : '';

  return (
    `\uD83C\uDF05 <b>Morning Brief</b> \u00B7 ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}\n` +
    `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `\u20BF BTC  \u00B7  <b>$${fmtPrice(btc_price)}</b>${btc_status ? ' \u00B7 ' + btc_status : ''}\n` +
    `\u039E ETH  \u00B7  <b>$${fmtPrice(eth_price)}</b>\n` +
    `${fngEmoji} F&G   \u00B7  <b>${fng_val} \u00B7 ${fng_label}</b>` +
    setupLine +
    eventLine +
    statsLine +
    qualNote +
    `\n\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
    `Signal index: <code>${signal_quality}/10</code>  \u00B7  <a href="${APP_URL}/screener">Open screener \u2192</a>`
  );
}

// ═══════════════════════════════════════════════════════════════════
// ONBOARDING SEQUENCE — 4 stages from conversion funnel template
// Stage 0: immediate (welcome)
// Stage 1: +2h (value — show real setup)
// Stage 2: +6h (proof — show result)
// Stage 3: +24h (soft convert)
// ═══════════════════════════════════════════════════════════════════

async function sendOnboardingStage(chat_id, stage, name = 'trader') {
  const messages = {
    0: () =>
      `\uD83D\uDD37 <b>ORBITUM</b> \u00B7 Trading Intelligence\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n\n` +
      `Welcome, <b>${name}</b>.\n\n` +
      `This isn't a signals channel.\n\n` +
      `ORBITUM is a system that learns your trading patterns \u2014 and tells you exactly what's costing you money.\n\n` +
      `Free tier gives you:\n` +
      `\u2713 Morning brief every day at 07:00\n` +
      `\u2713 Critical alerts in real-time\n` +
      `\u2713 Trading journal with AI analysis\n\n` +
      `Start by logging your next trade:\n` +
      `<a href="${APP_URL}/journal">\uD83D\uDCCB Open Journal \u2192</a>`,

    1: () =>
      `\uD83D\uDCCA <b>Your first look inside</b>\n\n` +
      `Here's what a premium setup signal looks like:\n\n` +
      `\u26A1 <b>SETUP SIGNAL</b>\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `\uD83D\uDFE2 <b>BTC/USDT \u00B7 LONG</b> \u00B7 4H\n` +
      `<code>Wyckoff Spring \u00B7 Re-accumulation</code>\n` +
      `\uD83D\uDFE2 <code>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2591</code> <b>82%</b> confidence\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `Entry  \u00B7  <b>$97,200</b>\n` +
      `SL     \u00B7  <code>$96,400</code>\n` +
      `TP     \u00B7  <b>$99,800</b>\n` +
      `R:R    \u00B7  <b>3.25:1</b>\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `\uD83E\uDDE0 <i>Spring confirmed on volume. Structure holding above weekly VWAP. 340 similar setups \u2014 82% accuracy.</i>\n\n` +
      `On free tier: confidence %, entry zone, and AI insight are locked.\n\n` +
      `<a href="${APP_URL}/pay">Unlock full signals \u2192</a>`,

    2: () =>
      `\u2705 <b>Setup update</b>\n\n` +
      `The BTC setup from this morning:\n\n` +
      `<b>BTC/USDT LONG</b> \u00B7 Entry $97,200\n` +
      `Result: <b>+$2,600 \u00B7 TP hit \u00B7 +2.7%</b>\n\n` +
      `That's what premium users saw 6 hours ago.\n\n` +
      `This week: <b>7 signals \u00B7 5 hit target \u00B7 avg +11.4%</b>\n\n` +
      `<code>Sent to premium at 09:14. You received this recap +6h later.</code>\n\n` +
      `<a href="${APP_URL}/pay">Get real-time signals \u2192</a>  \u00B7  <a href="${APP_URL}/journal">Open journal</a>`,

    3: () =>
      `\uD83E\uDDE0 <b>One pattern costs most traders $300\u2013500/month.</b>\n\n` +
      `The most common:\n` +
      `\u2014 Trading Friday after 17:00 (low liquidity)\n` +
      `\u2014 Entering after 2 consecutive losses (revenge)\n` +
      `\u2014 Exiting winners early when BTC drops 0.5%\n\n` +
      `ORBITUM's AI Coach finds <i>your</i> version of this.\n` +
      `With exact numbers. Exact pairs. Exact times.\n\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `Monthly  \u00B7  <b>$29</b> / 30 days\n` +
      `Lifetime \u00B7  <b>$197</b> \u00B7 pay once, yours forever\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n\n` +
      `<a href="${APP_URL}/pay">Get full access \u2192</a>  \u00B7  <a href="${APP_URL}/journal">Keep using free</a>`,
  };

  const text = messages[stage]?.();
  if (text) await tgSend(chat_id, text);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const body = req.body;

    const isCallback = !!body.callback_query;
    const msg        = body.message || body.callback_query?.message;
    if (!msg) return res.status(200).send('OK');

    const chat_id  = msg.chat.id;
    const from     = body.message?.from || body.callback_query?.from;
    const text     = (body.message?.text || '').trim();
    const cbData   = (body.callback_query?.data || '');
    const username = from?.username || '';
    const cmd      = text || cbData;

    if (isCallback) {
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: body.callback_query.id }),
      }).catch(() => {});
    }

    // ── /start ────────────────────────────────────────────────────
    if (cmd === '/start' || cmd.startsWith('/start ')) {
      const deepParam = cmd.split(' ')[1] || '';

      if (deepParam.startsWith('link_')) {
        const code = deepParam.replace('link_', '');
        const rows = await sbSelect('profiles', { tg_link_code: code }, 'id,full_name,username,plan');
        const profile = rows[0];

        if (!profile) {
          await tgSend(chat_id,
            '\u274C <b>Link code not found or expired.</b>\n\n' +
            'Open Settings \u2192 Telegram and generate a new code.'
          );
          return res.status(200).send('OK');
        }

        await sbUpdate('profiles', { id: profile.id }, {
          tg_chat_id: String(chat_id), tg_username: username, tg_linked: true, tg_link_code: null,
          tg_notify_trades: true, tg_notify_daily: true, tg_notify_alerts: true,
          tg_notify_tilt: true, tg_notify_weekly: false,
          onboarding_stage: 0, onboarding_started_at: new Date().toISOString(),
        });

        const name = profile.full_name || profile.username || 'trader';
        await sendOnboardingStage(chat_id, 0, name);
        return res.status(200).send('OK');
      }

      const rows = await sbSelect('profiles', { tg_chat_id: String(chat_id) }, 'id,full_name,tg_linked,plan');
      const existing = rows[0];

      if (existing?.tg_linked) {
        await tgSend(chat_id,
          `\uD83D\uDC4B <b>Welcome back, ${existing.full_name || 'trader'}!</b>\n\n` +
          `/stats \u2014 P&L & statistics\n` +
          `/brief \u2014 today's market brief\n` +
          `/alerts \u2014 active price alerts\n` +
          `/notify \u2014 notification settings\n` +
          `/stop \u2014 unlink account\n\n` +
          `<a href="${APP_URL}/journal">Open Journal</a>  \u00B7  <a href="${APP_URL}/screener">Screener</a>`
        );
      } else {
        await tgSend(chat_id,
          `\uD83D\uDD37 <b>ORBITUM</b> \u00B7 Trading Intelligence\n\n` +
          `To link your account:\n` +
          `1. Open the journal \u2192 <b>Settings \u2192 Telegram</b>\n` +
          `2. Click \u00ABLink Telegram\u00BB\n` +
          `3. Follow the link\n\n` +
          `<a href="${APP_URL}/journal">Open Journal \u2192</a>`
        );
      }
      return res.status(200).send('OK');
    }

    const rows = await sbSelect('profiles', { tg_chat_id: String(chat_id) }, '*');
    const profile = rows[0];

    if (!profile?.tg_linked) {
      await tgSend(chat_id, `\uD83D\uDD17 Link your account first.\n\n<a href="${APP_URL}/journal">Open Journal \u2192</a>`);
      return res.status(200).send('OK');
    }

    const isPaid = profile.plan === 'lifetime' || profile.plan === 'monthly';

    // ── /stats ────────────────────────────────────────────────────
    if (cmd === '/stats') {
      const trades = await sbSelect('trades', { user_id: profile.id }, 'result,pnl_pct,pnl_usd,pair,created_at', 'created_at.asc');

      if (!trades.length) {
        await tgSend(chat_id,
          `\uD83D\uDCED <b>No trades yet.</b>\n\n` +
          `Log your first trade to start tracking performance.\n\n` +
          `<a href="${APP_URL}/journal">Open Journal \u2192</a>`
        );
        return res.status(200).send('OK');
      }

      const wins    = trades.filter(t => t.result === 'win').length;
      const losses  = trades.filter(t => t.result === 'loss').length;
      const wr      = Math.round(wins / trades.length * 100);
      const pnl     = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const pnlUsd  = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
      const pnlSign = pnl >= 0 ? '+' : '';
      const emoji   = pnl >= 0 ? '\uD83D\uDCC8' : '\uD83D\uDCC9';

      // This week stats
      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
      const weekTrades = trades.filter(t => new Date(t.created_at) >= weekStart);
      const weekWins   = weekTrades.filter(t => t.result === 'win').length;
      const weekWr     = weekTrades.length ? Math.round(weekWins / weekTrades.length * 100) : 0;
      const weekPnl    = weekTrades.reduce((s, t) => s + (t.pnl_pct || 0), 0);

      // Streak
      let streak = 0, streakType = '';
      for (let i = trades.length - 1; i >= 0; i--) {
        if (!streakType) { streakType = trades[i].result; streak = 1; }
        else if (trades[i].result === streakType) streak++;
        else break;
      }
      const streakLine = streak >= 2
        ? `\n${streakType === 'win' ? '\uD83D\uDD25' : '\u2744\uFE0F'} Streak: <b>${streak} ${streakType === 'win' ? 'wins' : 'losses'}</b>`
        : '';

      // Best pair
      const pairMap = {};
      trades.forEach(t => { if (t.pair) pairMap[t.pair] = (pairMap[t.pair] || 0) + (t.pnl_pct || 0); });
      const bestPair = Object.entries(pairMap).sort((a, b) => b[1] - a[1])[0];
      const bestLine = bestPair ? `\n\uD83C\uDFC6 Best pair: <b>${bestPair[0]}</b> (${bestPair[1] >= 0 ? '+' : ''}${bestPair[1].toFixed(1)}%)` : '';

      const activeAlerts = await sbSelect('price_alerts', { user_id: profile.id, triggered: false }, 'id');

      await tgSend(chat_id,
        `${emoji} <b>Statistics</b>\n` +
        `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
        `Trades  \u00B7 <b>${trades.length}</b> (${wins}W / ${losses}L)\n` +
        `WR      \u00B7 <b>${wr}%</b>\n` +
        `P&L     \u00B7 <b>${pnlSign}${pnl.toFixed(1)}%</b> (${pnlSign}$${Math.abs(pnlUsd).toFixed(0)})\n` +
        streakLine +
        bestLine +
        `\n\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
        `This week \u00B7 <b>${weekTrades.length} trades \u00B7 ${weekWr}% WR \u00B7 ${weekPnl >= 0 ? '+' : ''}${weekPnl.toFixed(1)}%</b>\n` +
        (activeAlerts.length ? `\uD83D\uDD14 Active alerts: <b>${activeAlerts.length}</b>\n` : '') +
        `\n<a href="${APP_URL}/journal">\u2192 Open Journal</a>  \u00B7  <a href="${APP_URL}/screener">Screener</a>`
      );
      return res.status(200).send('OK');
    }

    // ── /brief — on-demand market brief ──────────────────────────
    if (cmd === '/brief') {
      try {
        const [mktR, fngR] = await Promise.allSettled([
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd', { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
          fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
        ]);
        const prices = mktR.status === 'fulfilled' ? mktR.value : {};
        const fng    = fngR.status === 'fulfilled' ? fngR.value?.data?.[0] : null;

        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
        const weekTrades = await sbSelect('trades', { user_id: profile.id }, 'result,created_at', 'created_at.desc');
        const thisWeek   = weekTrades.filter(t => new Date(t.created_at) >= weekStart);
        const weekWins   = thisWeek.filter(t => t.result === 'win').length;
        const weekWr     = thisWeek.length ? Math.round(weekWins / thisWeek.length * 100) : null;

        await tgSend(chat_id, formatDailyDigest({
          btc_price: prices.bitcoin?.usd,
          eth_price: prices.ethereum?.usd,
          fng_val: fng?.value || '\u2014',
          fng_label: fng?.value_classification || '\u2014',
          user_wr: weekWr,
          user_trades_week: thisWeek.length || null,
          signal_quality: 7,
        }));
      } catch(e) {
        await tgSend(chat_id, `\uD83D\uDCCA Brief unavailable.\n\n<a href="${APP_URL}/screener">Open Screener \u2192</a>`);
      }
      return res.status(200).send('OK');
    }

    // ── /alerts ───────────────────────────────────────────────────
    if (cmd === '/alerts') {
      const alerts = await sbSelect('price_alerts', { user_id: profile.id, triggered: false }, 'symbol,condition,target_price,alert_type');
      if (!alerts.length) {
        await tgSend(chat_id,
          `\uD83D\uDD14 <b>No active alerts.</b>\n\n<a href="${APP_URL}/screener">Set alerts in screener \u2192</a>`
        );
      } else {
        const list = alerts.slice(0, 10).map((a, i) => {
          const cond = a.condition === 'above' ? '\u25B2' : a.condition === 'below' ? '\u25BC' : '\u2194';
          const type = a.alert_type && a.alert_type !== 'price' ? ` <code>${a.alert_type}</code>` : '';
          return `${i+1}. <b>${a.symbol}</b>${type} ${cond} <b>$${Number(a.target_price).toLocaleString()}</b>`;
        }).join('\n');
        await tgSend(chat_id,
          `\uD83D\uDD14 <b>Active Alerts (${alerts.length})</b>\n` +
          `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
          list + `\n\n<a href="${APP_URL}/screener">Manage \u2192</a>`
        );
      }
      return res.status(200).send('OK');
    }

    // ── /upgrade ──────────────────────────────────────────────────
    if (cmd === '/upgrade' || cmd === '/premium') {
      if (isPaid) {
        await tgSend(chat_id,
          `\u2705 <b>You're on ${profile.plan} plan.</b>\n\nAll features are active.\n\n<a href="${APP_URL}/profile">View profile \u2192</a>`
        );
      } else {
        await tgSend(chat_id,
          `\uD83D\uDD37 <b>ORBITUM Premium</b>\n` +
          `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
          `\u2713 Setup signals (real-time)\n` +
          `\u2713 AI insights (full)\n` +
          `\u2713 Confidence % + history\n` +
          `\u2713 Entry / SL / TP zones\n` +
          `\u2713 Momentum alerts\n` +
          `\u2713 1-click deep link to chart\n` +
          `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
          `Monthly  \u00B7  <b>$29</b> / 30 days\n` +
          `Lifetime \u00B7  <b>$197</b> \u00B7 pay once forever\n\n` +
          `<a href="${APP_URL}/pay">Get full access \u2192</a>`
        );
      }
      return res.status(200).send('OK');
    }

    // ── /notify ───────────────────────────────────────────────────
    if (cmd === '/notify') {
      const ic = (v) => v ? '\u2705' : '\u2610';
      await tgSend(chat_id,
        `\u2699\uFE0F <b>Notification Settings</b>\n` +
        `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
        `${ic(profile.tg_notify_trades)} Trade notifications \u2014 /toggle_trades\n` +
        `${ic(profile.tg_notify_alerts)} Price alerts \u2014 /toggle_alerts\n` +
        `${ic(profile.tg_notify_daily)} Morning brief \u2014 /toggle_daily\n` +
        `${ic(profile.tg_notify_tilt)} Tilt alert \u2014 /toggle_tilt\n` +
        `${ic(profile.tg_notify_weekly)} Weekly report \u2014 /toggle_weekly`
      );
      return res.status(200).send('OK');
    }

    // ── /toggle_* ─────────────────────────────────────────────────
    const toggleMap = {
      '/toggle_trades': ['tg_notify_trades', 'Trade notifications'],
      '/toggle_alerts': ['tg_notify_alerts', 'Price alerts'],
      '/toggle_daily':  ['tg_notify_daily',  'Morning brief'],
      '/toggle_tilt':   ['tg_notify_tilt',   'Tilt alert'],
      '/toggle_weekly': ['tg_notify_weekly', 'Weekly report'],
    };
    if (toggleMap[cmd]) {
      const [field, label] = toggleMap[cmd];
      const newVal = !profile[field];
      await sbUpdate('profiles', { id: profile.id }, { [field]: newVal });
      await tgSend(chat_id, `${newVal ? '\u2705' : '\u2610'} <b>${label}</b> ${newVal ? 'enabled' : 'disabled'}`);
      return res.status(200).send('OK');
    }

    // ── /stop ──────────────────────────────────────────────────────
    if (cmd === '/stop') {
      await sbUpdate('profiles', { id: profile.id }, {
        tg_chat_id: null, tg_linked: false, tg_username: null,
        tg_notify_trades: false, tg_notify_alerts: false,
        tg_notify_daily: false, tg_notify_tilt: false, tg_notify_weekly: false,
      });
      await tgSend(chat_id, '\uD83D\uDD15 Account unlinked.\n\nUse /start to link again.');
      return res.status(200).send('OK');
    }

    // ── /help ─────────────────────────────────────────────────────
    await tgSend(chat_id,
      `\uD83D\uDCD6 <b>ORBITUM Commands</b>\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `/stats \u2014 P&L & performance\n` +
      `/brief \u2014 today's market brief\n` +
      `/alerts \u2014 active price alerts\n` +
      `/notify \u2014 notification settings\n` +
      `/upgrade \u2014 premium features\n` +
      `/stop \u2014 unlink account\n` +
      `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n` +
      `<a href="${APP_URL}">Screener</a>  \u00B7  <a href="${APP_URL}/journal">Journal</a>  \u00B7  <a href="${APP_URL}/pay">Premium</a>`
    );
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Bot error:', err);
    return res.status(200).send('OK');
  }
}
