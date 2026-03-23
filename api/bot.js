// api/bot.js v5 — ORBITUM Telegram Bot
// Commands: /start /stats /brief /signal /ai /alerts /plan /notify /log /help /stop
// Inline keyboard buttons on key messages

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

// ── Supabase helpers ──────────────────────────────────────────────
async function sbGet(table, filters = {}, select = '*') {
  let url = `${SB_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for (const [k, v] of Object.entries(filters)) {
    url += `&${k}=${typeof v === 'boolean' ? 'is' : 'eq'}.${encodeURIComponent(v)}`;
  }
  const r = await fetch(url, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
  });
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

async function sbPatch(table, filters, patch) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filters))
    url += `${k}=${typeof v === 'boolean' ? 'is' : 'eq'}.${encodeURIComponent(v)}&`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  return r.ok;
}

// ── TG helpers ────────────────────────────────────────────────────
async function tgSend(chat_id, text, extra = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
    });
    if (!r.ok) console.warn('[bot] tgSend', await r.text());
    return r.ok;
  } catch(e) { console.error('[bot] tgSend', e.message); return false; }
}

function answerCB(id) {
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id }),
  }).catch(() => {});
}

// Inline keyboard builder
function kb(...rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
function btn(text, url) { return { text, url }; }
function cbBtn(text, data) { return { text, callback_data: data }; }

function fmtP(n) {
  if (!n && n !== 0) return '--';
  const v = parseFloat(n);
  if (v >= 10000) return '$' + v.toLocaleString('en', { maximumFractionDigits: 0 });
  if (v >= 1000)  return '$' + v.toLocaleString('en', { maximumFractionDigits: 2 });
  if (v >= 1)     return '$' + v.toFixed(4);
  return '$' + v.toFixed(6);
}

function confBar(pct) {
  const f = Math.round(pct / 10);
  return `<code>${'\u2588'.repeat(f)}${'\u2591'.repeat(10-f)}</code> <b>${pct}%</b>`;
}

// ── Scan market for top signal (same logic as daily.js) ───────────
async function quickScan() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=80&page=1&sparkline=true&price_change_percentage=24h,7d',
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return null;
    const coins = await r.json();
    const signals = [];

    for (const c of coins) {
      const chg24 = c.price_change_percentage_24h || 0;
      const chg7d = c.price_change_percentage_7d_in_currency || 0;
      const volR  = c.market_cap > 0 ? (c.total_volume / c.market_cap * 100) : 0;
      const sp    = c.sparkline_in_7d?.price || [];
      let rsi = 50;
      if (sp.length >= 15) {
        let avgG = 0, avgL = 0;
        for (let i = 1; i <= 14; i++) {
          const d = sp[sp.length - 14 + i] - sp[sp.length - 14 + i - 1];
          if (d > 0) avgG += d; else avgL -= d;
        }
        avgG /= 14; avgL /= 14;
        rsi = avgL === 0 ? 100 : Math.round(100 - 100 / (1 + avgG / avgL));
      }
      let score = 50;
      if (chg24 > 5)  score += 15; else if (chg24 > 2)  score += 8;
      else if (chg24 < -5) score -= 12; else if (chg24 < -2) score -= 6;
      if (chg7d > 10) score += 10; else if (chg7d < -10) score -= 8;
      if (volR > 15) score += 12; else if (volR > 8) score += 6;
      if (rsi >= 65 && rsi < 75) score += 8;
      if (rsi <= 35 && rsi > 25) score += 8;
      if (rsi >= 75) score -= 10;
      score = Math.max(10, Math.min(98, Math.round(score)));
      const isLong  = score >= 72 && chg24 > 0 && volR > 4;
      const isShort = score <= 32 && chg24 < 0 && volR > 4;
      if (isLong || isShort) signals.push({ sym: c.symbol.toUpperCase(), dir: isLong ? 'LONG' : 'SHORT', score, rsi, chg24: parseFloat(chg24.toFixed(1)), price: c.current_price, volR: parseFloat(volR.toFixed(1)) });
    }
    signals.sort((a, b) => b.score - a.score);
    return { scanned: coins.length, signals };
  } catch(_) { return null; }
}

// ── Onboarding sequence ───────────────────────────────────────────
async function sendOnboarding(chat_id, stage, name = 'trader') {
  const msgs = {
    0: `<b>ORBITUM</b>  Trading Intelligence\n---\n\nWelcome, <b>${name}</b>.\n\nThis isn't a signals channel.\n\nORBITUM is a system that learns your trading patterns and tells you exactly what's costing you money.\n\nFree tier:\n+ Morning brief every day at 07:00\n+ Critical alerts in real-time\n+ Trading journal with AI analysis\n\n<a href="${APP_URL}/journal">Open Journal</a>`,

    1: `<b>Your first look inside</b>\n\nHere's what a premium setup signal looks like:\n\n<b>SETUP SIGNAL</b>\n---\n<b>BTC/USDT  LONG</b>  4H\n<code>Wyckoff Spring  Re-accumulation</code>\n${confBar(82)}\n---\nEntry  <b>$97,200</b>\nSL     <code>$96,400</code>\nTP     <b>$99,800</b>\nR:R    <b>3.25:1</b>\n---\n<i>Spring confirmed on volume. 340 similar setups — 82% accuracy.</i>\n\n<i>On free tier: confidence %, entry zone, and AI insight are locked.</i>\n\n<a href="${APP_URL}/pay">Unlock full signals</a>`,

    2: `<b>Setup update</b>\n\nThe BTC setup from this morning:\n\n<b>BTC/USDT LONG</b>  Entry $97,200\nResult: <b>+$2,600  TP hit  +2.7%</b>\n\nThat's what premium users saw 6 hours ago.\n\nThis week: <b>7 signals  5 hit target  avg +11.4%</b>\n\n<code>Sent to premium at 09:14. You received this recap +6h later.</code>\n\n<a href="${APP_URL}/pay">Get real-time signals</a>  |  <a href="${APP_URL}/journal">Open journal</a>`,

    3: `<b>One pattern costs most traders $300-500/month.</b>\n\nThe most common:\n- Trading Friday after 17:00 (low liquidity)\n- Entering after 2 consecutive losses (revenge)\n- Exiting winners early when BTC drops 0.5%\n\nORBITUM's AI Coach finds <i>your</i> version of this.\nWith exact numbers. Exact pairs. Exact times.\n---\nMonthly  <b>$29</b> / 30 days\nLifetime <b>$197</b>  pay once, yours forever\n---\n\n<a href="${APP_URL}/pay">Get full access</a>  |  <a href="${APP_URL}/journal">Keep using free</a>`,
  };
  if (msgs[stage]) await tgSend(chat_id, msgs[stage]);
}

// ── MAIN HANDLER ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const body       = req.body;
    const isCallback = !!body.callback_query;
    const msg        = body.message || body.callback_query?.message;
    if (!msg) return res.status(200).send('OK');

    const chat_id  = msg.chat.id;
    const from     = body.message?.from || body.callback_query?.from;
    const text     = (body.message?.text || '').trim();
    const cbData   = body.callback_query?.data || '';
    const username = from?.username || '';
    const cmd      = (text || cbData).split('@')[0]; // strip bot username from commands

    if (isCallback) answerCB(body.callback_query.id);

    // ══ /start ════════════════════════════════════════════════════
    if (cmd === '/start' || cmd.startsWith('/start ')) {
      const deepParam = cmd.split(' ')[1] || '';

      // Deep link: /start link_XXXXX — account linking flow
      if (deepParam.startsWith('link_')) {
        const code = deepParam.replace('link_', '');
        const rows = await sbGet('profiles', { tg_link_code: code }, 'id,full_name,username,plan');
        if (!rows[0]) {
          await tgSend(chat_id, 'Link code not found or expired.\n\nOpen Settings > Telegram and generate a new code.');
          return res.status(200).send('OK');
        }
        const profile = rows[0];
        await sbPatch('profiles', { id: profile.id }, {
          tg_chat_id: String(chat_id), tg_username: username, tg_linked: true, tg_link_code: null,
          tg_notify_trades: true, tg_notify_daily: true, tg_notify_alerts: true,
          tg_notify_tilt: true, tg_notify_weekly: false,
          onboarding_stage: 0, onboarding_started_at: new Date().toISOString(),
        });

        // Trigger daily.js onboard action (for filter ratio + welcome)
        fetch(`${process.env.APP_URL || 'https://orbitum.trade'}/api/daily?action=onboard&user_id=${profile.id}&secret=${process.env.CRON_SECRET || ''}`)
          .catch(() => {});

        const name = profile.full_name?.split(' ')[0] || profile.username || 'trader';
        await sendOnboarding(chat_id, 0, name);
        return res.status(200).send('OK');
      }

      const rows = await sbGet('profiles', { tg_chat_id: String(chat_id) }, 'id,full_name,tg_linked,plan');
      const existing = rows[0];

      if (existing?.tg_linked) {
        const isPaid = existing.plan === 'lifetime' || existing.plan === 'monthly';
        await tgSend(chat_id,
          `Welcome back, <b>${existing.full_name || 'trader'}</b>!\n---\n` +
          `/stats   — P&L & statistics\n` +
          `/signal  — top setup right now\n` +
          `/brief   — today's market brief\n` +
          `/alerts  — active price alerts\n` +
          `/plan    — your plan & status\n` +
          `/notify  — notification settings\n` +
          `/stop    — unlink account\n`,
          kb([btn('Open Journal', `${APP_URL}/journal`), btn('Screener', `${APP_URL}/screener`)])
        );
      } else {
        await tgSend(chat_id,
          `<b>ORBITUM</b>  Trading Intelligence\n\nTo link your account:\n1. Open the journal > Settings > Telegram\n2. Click "Link Telegram"\n3. Follow the link\n\n<a href="${APP_URL}/journal">Open Journal</a>`
        );
      }
      return res.status(200).send('OK');
    }

    // Load profile for all other commands
    const rows    = await sbGet('profiles', { tg_chat_id: String(chat_id) }, '*');
    const profile = rows[0];

    if (!profile?.tg_linked) {
      await tgSend(chat_id, `Link your account first.\n\n<a href="${APP_URL}/journal">Open Journal</a>`);
      return res.status(200).send('OK');
    }

    const isPaid = profile.plan === 'lifetime' || profile.plan === 'monthly';

    // ══ /stats ════════════════════════════════════════════════════
    if (cmd === '/stats') {
      const trades = await sbGet('trades', { user_id: profile.id }, 'result,pnl_pct,pnl_usd,pair,setup_type,created_at');
      if (!trades.length) {
        await tgSend(chat_id, `No trades yet.\n\nLog your first trade to start tracking.\n\n<a href="${APP_URL}/journal">Open Journal</a>`);
        return res.status(200).send('OK');
      }
      const wins   = trades.filter(t => t.result === 'win').length;
      const losses = trades.filter(t => t.result === 'loss').length;
      const wr     = Math.round(wins / trades.length * 100);
      const pnl    = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const pnlUsd = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);

      // This week
      const wkStart = new Date();
      wkStart.setUTCDate(wkStart.getUTCDate() - ((wkStart.getUTCDay() + 6) % 7));
      wkStart.setUTCHours(0,0,0,0);
      const wk      = trades.filter(t => new Date(t.created_at) >= wkStart);
      const wkWins  = wk.filter(t => t.result === 'win').length;
      const wkWr    = wk.length ? Math.round(wkWins / wk.length * 100) : 0;
      const wkPnl   = wk.reduce((s, t) => s + (t.pnl_pct || 0), 0);

      // Streak (from most recent)
      let streak = 0, streakType = '';
      for (const t of trades) {
        if (!streakType) { streakType = t.result; streak = 1; }
        else if (t.result === streakType) streak++;
        else break;
      }
      const streakLine = streak >= 2 ? `\n${streakType === 'win' ? 'Hot' : 'Cold'} streak: <b>${streak} ${streakType === 'win' ? 'wins' : 'losses'}</b>` : '';

      // Best pair
      const pm = {};
      trades.forEach(t => { if (t.pair) pm[t.pair] = (pm[t.pair] || 0) + (t.pnl_pct || 0); });
      const bestPair = Object.entries(pm).sort((a, b) => b[1] - a[1])[0];

      await tgSend(chat_id,
        `<b>Statistics</b>\n---\n` +
        `Trades  <b>${trades.length}</b>  (${wins}W / ${losses}L)\n` +
        `WR      <b>${wr}%</b>\n` +
        `P&L     <b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</b>  (~${pnlUsd >= 0 ? '+$' : '-$'}${Math.abs(pnlUsd).toFixed(0)})\n` +
        streakLine +
        (bestPair ? `\nBest: <b>${bestPair[0]}</b>  ${bestPair[1] >= 0 ? '+' : ''}${bestPair[1].toFixed(1)}%` : '') +
        `\n---\nThis week  <b>${wk.length} trades  ${wkWr}% WR  ${wkPnl >= 0 ? '+' : ''}${wkPnl.toFixed(1)}%</b>`,
        kb([btn('Full Journal', `${APP_URL}/journal`), btn('AI Breakdown', `${APP_URL}/ai-journal`)])
      );
      return res.status(200).send('OK');
    }

    // ══ /signal — top setup right now ════════════════════════════
    if (cmd === '/signal') {
      await tgSend(chat_id, 'Scanning market...');
      const scan = await quickScan();

      if (!scan || !scan.signals.length) {
        await tgSend(chat_id,
          `<b>No qualifying setups right now.</b>\n\n` +
          `<code>${scan?.scanned || 80} scanned  |  0 passed threshold</code>\n\n` +
          `Patience is the edge on low-signal days.`,
          kb([btn('Open Screener', `${APP_URL}/screener`)])
        );
        return res.status(200).send('OK');
      }

      const top = scan.signals[0];
      const grade = top.score >= 80 ? 'A+' : top.score >= 70 ? 'A' : 'B+';

      if (!isPaid) {
        // Free: teaser with locked details
        await tgSend(chat_id,
          `<b>SETUP SIGNAL</b>  right now\n---\n` +
          `<b>${top.sym}/USDT  ${top.dir}</b>\n` +
          confBar(top.score) + `\n---\n` +
          `Entry  <code>[UNLOCK]</code>\n` +
          `SL     <code>[UNLOCK]</code>\n` +
          `TP     <code>[UNLOCK]</code>\n---\n` +
          `<code>${scan.scanned} scanned  |  ${scan.signals.length} passed threshold</code>\n` +
          `Grade: <b>${grade}</b>\n\n` +
          `<a href="${APP_URL}/pay">Unlock full signal</a>  |  <a href="${APP_URL}/screener?coin=${encodeURIComponent(top.sym+'/USDT')}">View chart</a>`
        );
      } else {
        // Paid: full signal
        await tgSend(chat_id,
          `<b>SETUP SIGNAL</b>  ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })} UTC\n---\n` +
          `<b>${top.sym}/USDT  ${top.dir}</b>\n` +
          confBar(top.score) + `\n---\n` +
          `Price  <b>${fmtP(top.price)}</b>\n` +
          `24H    <b>${top.chg24 >= 0 ? '+' : ''}${top.chg24}%</b>\n` +
          `RSI    <b>${top.rsi}</b>${top.rsi >= 70 ? ' [OB]' : top.rsi <= 30 ? ' [OS]' : ''}\n` +
          `Vol    <b>${top.volR}x avg</b>\n---\n` +
          `<code>${scan.scanned} scanned  |  ${scan.signals.length} passed  |  Grade: ${grade}</code>`,
          kb([btn('Open Chart', `${APP_URL}/screener?coin=${encodeURIComponent(top.sym+'/USDT')}`), btn('Log Trade', `${APP_URL}/journal`)])
        );
      }
      return res.status(200).send('OK');
    }

    // ══ /brief — on-demand market brief ══════════════════════════
    if (cmd === '/brief') {
      const [mktR, fngR] = await Promise.allSettled([
        fetch('https://api.coingecko.com/api/v3/global',       { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
        fetch('https://api.alternative.me/fng/?limit=1',       { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      ]);
      const market = mktR.status === 'fulfilled' ? mktR.value?.data : null;
      const fng    = fngR.status === 'fulfilled' ? fngR.value?.data?.[0] : null;
      const mcap   = market?.total_market_cap?.usd;
      const btcDom = market?.market_cap_percentage?.btc?.toFixed(1);

      const wkStart = new Date();
      wkStart.setUTCDate(wkStart.getUTCDate() - ((wkStart.getUTCDay() + 6) % 7));
      wkStart.setUTCHours(0,0,0,0);
      const wkTrades = await sbGet('trades', { user_id: profile.id }, 'result,pnl_pct,created_at');
      const wk       = wkTrades.filter(t => new Date(t.created_at) >= wkStart);
      const wkWins   = wk.filter(t => t.result === 'win').length;
      const wkWr     = wk.length ? Math.round(wkWins / wk.length * 100) : null;
      const wkPnl    = wk.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const statsLine = wkWr != null ? `\nYour week  <b>${wk.length} trades  ${wkWr}% WR  ${wkPnl >= 0 ? '+' : ''}${wkPnl.toFixed(1)}%</b>` : '';

      const mcapStr = mcap >= 1e12 ? '$' + (mcap/1e12).toFixed(2) + 'T' : mcap >= 1e9 ? '$' + (mcap/1e9).toFixed(0) + 'B' : '--';

      await tgSend(chat_id,
        `<b>Market Brief</b>  ${new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}\n---\n` +
        (mcap   ? `Market  ${mcapStr}  BTC Dom ${btcDom}%\n` : '') +
        (fng    ? `F&G     ${fng.value}  ${fng.value_classification}\n` : '') +
        statsLine + `\n---\n` +
        `<a href="${APP_URL}/screener">Open screener</a>` +
        (isPaid ? '' : `  |  <a href="${APP_URL}/pay">Unlock signals</a>`)
      );
      return res.status(200).send('OK');
    }

    // ══ /plan — plan status & expiry ═════════════════════════════
    if (cmd === '/plan') {
      const expires = profile.plan_expires_at
        ? `\nExpires: <b>${new Date(profile.plan_expires_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</b>`
        : '';
      if (isPaid) {
        await tgSend(chat_id,
          `<b>${profile.plan === 'lifetime' ? 'Lifetime' : 'Monthly'} Plan</b>  active\n---\n` +
          `All features unlocked.\n` + expires + `\n\n` +
          `<a href="${APP_URL}/profile">View profile</a>`
        );
      } else {
        await tgSend(chat_id,
          `<b>Free Plan</b>\n---\n` +
          `Monthly  <b>$29</b> / 30 days\n` +
          `Lifetime <b>$197</b>  pay once forever\n---\n` +
          `Unlocks: real-time signals, AI Coach, confidence %, SL/TP zones.\n\n` +
          `<a href="${APP_URL}/pay">Get full access</a>`,
          kb([btn('Get Premium', `${APP_URL}/pay`)])
        );
      }
      return res.status(200).send('OK');
    }

    // ══ /alerts ══════════════════════════════════════════════════
    if (cmd === '/alerts') {
      const alerts = await sbGet('price_alerts', { user_id: profile.id, triggered: false }, 'symbol,condition,target_price,alert_type');
      if (!alerts.length) {
        await tgSend(chat_id, `No active alerts.\n\n<a href="${APP_URL}/screener">Set alerts in screener</a>`);
      } else {
        const list = alerts.slice(0, 12).map((a, i) => {
          const cond = a.condition === 'above' ? '[^]' : a.condition === 'below' ? '[v]' : '[x]';
          const type = a.alert_type && a.alert_type !== 'price' ? ` [${a.alert_type}]` : '';
          return `${i+1}. <b>${a.symbol}</b>${type} ${cond} <b>$${Number(a.target_price).toLocaleString()}</b>`;
        }).join('\n');
        await tgSend(chat_id,
          `<b>Active Alerts (${alerts.length})</b>\n---\n${list}\n\n<a href="${APP_URL}/screener">Manage</a>`
        );
      }
      return res.status(200).send('OK');
    }

    // ══ /notify — notification settings ══════════════════════════
    if (cmd === '/notify') {
      const ic = v => v ? '[ON]' : '[OFF]';
      await tgSend(chat_id,
        `<b>Notification Settings</b>\n---\n` +
        `${ic(profile.tg_notify_trades)} Trade alerts      /toggle_trades\n` +
        `${ic(profile.tg_notify_alerts)} Signal alerts     /toggle_alerts\n` +
        `${ic(profile.tg_notify_daily)}  Morning brief     /toggle_daily\n` +
        `${ic(profile.tg_notify_tilt)}   Tilt warning      /toggle_tilt\n` +
        `${ic(profile.tg_notify_weekly)} Weekly report     /toggle_weekly`
      );
      return res.status(200).send('OK');
    }

    // ══ /toggle_* ════════════════════════════════════════════════
    const toggleMap = {
      '/toggle_trades': ['tg_notify_trades', 'Trade alerts'],
      '/toggle_alerts': ['tg_notify_alerts', 'Signal alerts'],
      '/toggle_daily':  ['tg_notify_daily',  'Morning brief'],
      '/toggle_tilt':   ['tg_notify_tilt',   'Tilt warning'],
      '/toggle_weekly': ['tg_notify_weekly', 'Weekly report'],
    };
    if (toggleMap[cmd]) {
      const [field, label] = toggleMap[cmd];
      const newVal = !profile[field];
      await sbPatch('profiles', { id: profile.id }, { [field]: newVal });
      await tgSend(chat_id, `${newVal ? '[ON]' : '[OFF]'} <b>${label}</b> ${newVal ? 'enabled' : 'disabled'}`);
      return res.status(200).send('OK');
    }

    // ══ /log — quick trade log: /log BTC LONG +2.3% ══════════════
    if (cmd.startsWith('/log')) {
      const parts = text.split(/\s+/).slice(1); // /log PAIR DIR PNL
      if (parts.length < 2) {
        await tgSend(chat_id, `Usage: <code>/log BTC/USDT long +2.3%</code>\n\nOr open the journal for full entry:\n<a href="${APP_URL}/journal">Open Journal</a>`);
        return res.status(200).send('OK');
      }
      const pair = parts[0].toUpperCase().includes('USDT') ? parts[0].toUpperCase() : parts[0].toUpperCase() + '/USDT';
      const dir  = parts[1]?.toLowerCase() === 'short' ? 'short' : 'long';
      const pnlStr = parts[2] || null;
      const pnl  = pnlStr ? parseFloat(pnlStr.replace('%','').replace('+','')) : null;
      const result = pnl != null ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be') : null;

      // Quick insert to trades table
      try {
        await fetch(`${SB_URL}/rest/v1/trades`, {
          method: 'POST',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: profile.id, pair, direction: dir, result: result || 'be', pnl_pct: pnl }),
        });
        await tgSend(chat_id,
          `Logged: <b>${pair}  ${dir.toUpperCase()}</b>${pnl != null ? `  ${pnl >= 0 ? '+' : ''}${pnl}%` : ''}\n\n<a href="${APP_URL}/journal">Open journal to add details</a>  |  <a href="${APP_URL}/ai-journal">AI breakdown</a>`
        );
      } catch(e) {
        await tgSend(chat_id, `Error logging trade. Open journal manually:\n<a href="${APP_URL}/journal">Open Journal</a>`);
      }
      return res.status(200).send('OK');
    }

    // ══ /upgrade / /premium ═══════════════════════════════════════
    if (cmd === '/upgrade' || cmd === '/premium') {
      if (isPaid) {
        await tgSend(chat_id, `You're on <b>${profile.plan}</b> plan.\nAll features active.\n\n<a href="${APP_URL}/profile">View profile</a>`);
      } else {
        await tgSend(chat_id,
          `<b>ORBITUM Premium</b>\n---\n` +
          `+ Setup signals (real-time)\n` +
          `+ AI insights (full)\n` +
          `+ Confidence % + SL/TP zones\n` +
          `+ Momentum alerts\n` +
          `+ Behavior fingerprint\n---\n` +
          `Monthly  <b>$29</b> / 30 days\n` +
          `Lifetime <b>$197</b>  pay once forever\n\n` +
          `<a href="${APP_URL}/pay">Get full access</a>`,
          kb([btn('Get Premium', `${APP_URL}/pay`)])
        );
      }
      return res.status(200).send('OK');
    }

    // ══ /stop ══════════════════════════════════════════════════════
    if (cmd === '/stop') {
      await sbPatch('profiles', { id: profile.id }, {
        tg_chat_id: null, tg_linked: false, tg_username: null,
        tg_notify_trades: false, tg_notify_alerts: false,
        tg_notify_daily: false, tg_notify_tilt: false, tg_notify_weekly: false,
      });
      await tgSend(chat_id, 'Account unlinked.\n\nUse /start to link again.');
      return res.status(200).send('OK');
    }

    // ══ /help (default) ═══════════════════════════════════════════
    await tgSend(chat_id,
      `<b>ORBITUM Commands</b>\n---\n` +
      `/stats    — P&L & performance\n` +
      `/signal   — top setup right now\n` +
      `/brief    — today's market brief\n` +
      `/alerts   — active price alerts\n` +
      `/plan     — your plan & status\n` +
      `/log      — quick trade log\n` +
      `/notify   — notification settings\n` +
      `/upgrade  — premium features\n` +
      `/stop     — unlink account\n---\n` +
      `<a href="${APP_URL}">Screener</a>  |  <a href="${APP_URL}/journal">Journal</a>  |  <a href="${APP_URL}/pay">Premium</a>`
    );
    return res.status(200).send('OK');

  } catch(err) {
    console.error('[bot]', err);
    return res.status(200).send('OK'); // always 200 to Telegram
  }
}
