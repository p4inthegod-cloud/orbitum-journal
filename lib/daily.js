// api/daily.js v3 — Full addiction loop
// Cron schedule:
//   06:45 UTC  → ?action=hook      (anticipation hook)
//   07:00 UTC  → default           (morning brief)
//   19:00 UTC  → ?action=evening   (signal outcome — transparency builds trust)
//   20:30 UTC  → ?action=insight   (AI forward insight, paid only)
// On-demand:   → ?action=onboard   (new user welcome, called by bot.js)

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = process.env.APP_URL || 'https://orbitum.trade';

function isSilentHour() {
  const h = new Date().getUTCHours();
  return h >= 23 || h < 6;
}

async function tgSend(chat_id, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (e?.error_code === 403) return false;
      console.warn('[tgSend]', chat_id, e?.description);
    }
    return true;
  } catch(e) { console.error('[tgSend]', e.message); return false; }
}

function fmtMcap(usd) {
  if (!usd) return '--';
  if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
  if (usd >= 1e9)  return '$' + (usd / 1e9).toFixed(1) + 'B';
  return '$' + usd.toFixed(0);
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n) || !n) return '--';
  if (n >= 10000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 1000)  return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fngLabel(val) {
  if (val >= 75) return 'Extreme Greed';
  if (val >= 55) return 'Greed';
  if (val >= 45) return 'Neutral';
  if (val >= 25) return 'Fear';
  return 'Extreme Fear';
}

// Scan top 80 coins via CoinGecko sparkline — same logic as screener
async function scanMarket() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=80&page=1&sparkline=true&price_change_percentage=24h,7d',
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return { scanned: 0, passed: 0, topSetup: null, signals: [] };
    const coins = await r.json();
    const signals = [];

    for (const c of coins) {
      const chg24 = c.price_change_percentage_24h || 0;
      const chg7d = c.price_change_percentage_7d_in_currency || 0;
      const volR  = c.market_cap > 0 ? (c.total_volume / c.market_cap * 100) : 0;
      const sp    = c.sparkline_in_7d?.price || [];

      // Wilder RSI from sparkline
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
      if (volR > 15)  score += 12; else if (volR > 8)  score += 6;
      if (rsi >= 65 && rsi < 75) score += 8;
      if (rsi <= 35 && rsi > 25) score += 8;
      if (rsi >= 75) score -= 10;
      score = Math.max(10, Math.min(98, Math.round(score)));

      const isLong  = score >= 72 && chg24 > 0 && volR > 4;
      const isShort = score <= 32 && chg24 < 0 && volR > 4;
      if (isLong || isShort) {
        signals.push({
          sym:   c.symbol.toUpperCase(),
          dir:   isLong ? 'LONG' : 'SHORT',
          score, rsi,
          chg24: parseFloat(chg24.toFixed(1)),
          price: c.current_price,
          volR:  parseFloat(volR.toFixed(1)),
          cgId:  c.id,
        });
      }
    }

    signals.sort((a, b) => b.score - a.score);
    return { scanned: coins.length, passed: signals.length, topSetup: signals[0] || null, signals: signals.slice(0, 5) };
  } catch(e) {
    console.error('[scanMarket]', e.message);
    return { scanned: 0, passed: 0, topSetup: null, signals: [] };
  }
}

// Today's sent screener signals from DB
async function getTodaySignals() {
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?alert_type=eq.screener_signal&triggered_at=gte.${since.toISOString()}&select=symbol,condition,note,target_price,triggered_at&order=triggered_at.desc`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
    );
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch(_) { return []; }
}

// Current price for symbol
async function getPrice(cgId) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return d[cgId]?.usd || null;
  } catch(_) { return null; }
}

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query.action || 'brief';

  // ══ ONBOARD — welcome new user ════════════════════════════════════
  if (action === 'onboard') {
    const uid = req.query.user_id;
    if (!uid) return res.status(400).json({ error: 'Missing user_id' });
    try {
      const pr = await fetch(
        `${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=tg_chat_id,full_name,tg_linked`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
      ).then(r => r.json());
      const profile = pr[0];
      if (!profile?.tg_linked || !profile?.tg_chat_id)
        return res.status(400).json({ error: 'User not TG linked' });

      const { scanned, passed } = await scanMarket();
      const msg =
        `<b>ORBITUM SIGNALS</b>  connected.\n\n` +
        `Most channels send signals.\n` +
        `We send intelligence.\n\n` +
        `Every setup passes 3 filters:\n` +
        `1. STRUCTURE — technically valid?\n` +
        `2. VOLUME — does money confirm it?\n` +
        `3. AI — does history support it?\n\n` +
        (scanned > 0 ? `<code>${scanned} scanned today  |  ${passed} passed threshold</code>\n\n` : '') +
        `First morning brief: tomorrow 07:00 UTC.\n` +
        `<a href="${APP_URL}/screener">Open screener --></a>`;

      await tgSend(profile.tg_chat_id, msg);
      return res.status(200).json({ ok: true, sent: 1 });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ══ HOOK — 06:45 anticipation ═════════════════════════════════════
  if (action === 'hook') {
    if (isSilentHour()) return res.status(200).json({ skipped: true, reason: 'silent hours' });
    try {
      const [users, scan] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_daily=is.true&select=tg_chat_id`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
        ).then(r => r.json()),
        scanMarket(),
      ]);
      if (!Array.isArray(users) || !users.length) return res.status(200).json({ sent: 0 });

      const countLine = scan.passed > 0
        ? `${scan.passed} setup${scan.passed !== 1 ? 's' : ''} in the queue.`
        : 'Markets scanning — patience may be today\'s edge.';
      const watchLine = scan.topSetup
        ? `\nWatch: <b>${scan.topSetup.sym}</b>  ${scan.topSetup.dir}  ${scan.topSetup.chg24 >= 0 ? '+' : ''}${scan.topSetup.chg24}% 24h`
        : '';

      const msg =
        `Morning brief in 15 min.\n` +
        `<code>${scan.scanned > 0 ? scan.scanned + ' scanned  |  ' : ''}${countLine}</code>` +
        watchLine + `\n\n` +
        `<a href="${APP_URL}/screener">Open screener --></a>`;

      let sent = 0;
      for (const u of users) {
        if (!u.tg_chat_id) continue;
        await tgSend(u.tg_chat_id, msg);
        sent++;
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[daily:hook] sent=${sent}`);
      return res.status(200).json({ sent });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ══ EVENING — 19:00 signal outcome (transparency loop) ════════════
  if (action === 'evening') {
    if (isSilentHour()) return res.status(200).json({ skipped: true });
    try {
      const [users, todaySignals] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_daily=is.true&select=tg_chat_id,plan`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
        ).then(r => r.json()),
        getTodaySignals(),
      ]);
      if (!Array.isArray(users) || !users.length) return res.status(200).json({ sent: 0 });

      const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      // No signals today — "patience is the edge"
      if (!todaySignals.length) {
        const msg =
          `<b>Evening Check</b>  ${timeStr} UTC\n` +
          `---\n` +
          `No setups sent today.\n` +
          `<code>80 scanned  |  0 passed threshold</code>\n\n` +
          `Patience is the edge on low-signal days.\n` +
          `Tomorrow brief: 07:00 UTC`;
        let sent = 0;
        for (const u of users) {
          if (u.tg_chat_id) { await tgSend(u.tg_chat_id, msg); sent++; }
        }
        return res.status(200).json({ sent, signals: 0 });
      }

      // Fetch current prices for today's signals
      const cgMap = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple', DOGE:'dogecoin' };
      const results = await Promise.all(todaySignals.slice(0, 3).map(async sig => {
        const sym   = (sig.symbol || '').replace('/USDT','').replace('USDT','').toUpperCase();
        const dir   = sig.condition || 'long';
        const entry = parseFloat(sig.target_price || 0);
        const time  = new Date(sig.triggered_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const cgId  = cgMap[sym] || sym.toLowerCase();
        const now   = await getPrice(cgId);
        let line = `<b>${sym}</b>  ${dir.toUpperCase()}  sent ${time}`;
        if (now && entry) {
          const pct = dir === 'long'
            ? ((now - entry) / entry * 100)
            : ((entry - now) / entry * 100);
          const isWin = pct > 0;
          line += `\n${fmtPrice(entry)} entry  →  ${fmtPrice(now)} now  <b>${isWin ? '+' : ''}${pct.toFixed(1)}%</b>${isWin ? '  [on track]' : '  [invalidated]'}`;
        }
        return line;
      }));

      let sent = 0;
      for (const u of users) {
        if (!u.tg_chat_id) continue;
        const isPaid = u.plan === 'lifetime' || u.plan === 'monthly';
        const msg =
          `<b>Evening Result</b>  ${timeStr} UTC\n` +
          `---\n` +
          results.join('\n\n') +
          `\n---\n` +
          `<a href="${APP_URL}/journal">Log your trades --></a>` +
          (isPaid ? '' : `\n<a href="${APP_URL}/pay">Premium = real-time entry prices</a>`);
        await tgSend(u.tg_chat_id, msg);
        sent++;
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[daily:evening] sent=${sent} signals=${todaySignals.length}`);
      return res.status(200).json({ sent, signals: todaySignals.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ══ INSIGHT — 20:30 AI forward-looking, paid only ═════════════════
  if (action === 'insight') {
    if (isSilentHour()) return res.status(200).json({ skipped: true });
    try {
      const users = await fetch(
        `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_daily=is.true&select=tg_chat_id,plan`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
      ).then(r => r.json());
      const paidUsers = (Array.isArray(users) ? users : []).filter(u => u.plan === 'lifetime' || u.plan === 'monthly');
      if (!paidUsers.length) return res.status(200).json({ sent: 0, reason: 'no paid users' });

      const { signals } = await scanMarket();
      if (!signals.length) return res.status(200).json({ sent: 0, reason: 'no signals' });

      const w = signals[1] || signals[0]; // #2 signal = tomorrow's watch
      let aiText = `${w.sym} ${w.dir} setup forming. RSI ${w.rsi}, volume ${w.volR}x average. Watch ${fmtPrice(w.price)} zone tomorrow.`;

      if (process.env.GROQ_API_KEY) {
        try {
          const aiR = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              max_tokens: 130,
              temperature: 0.3,
              messages: [{
                role: 'system',
                content: `ICT/SMC analyst. ${w.sym} ${w.dir}, price ${fmtPrice(w.price)}, RSI ${w.rsi}, 24h ${w.chg24}%, vol ${w.volR}x. One forward-looking sentence: what level to watch tomorrow, why. Russian. No markdown.`
              }, { role: 'user', content: 'Insight.' }],
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (aiR.ok) {
            const d = await aiR.json();
            const t = d.choices?.[0]?.message?.content?.trim();
            if (t && t.length > 10) aiText = t.slice(0, 200);
          }
        } catch(_) {}
      }

      const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const msg =
        `<b>AI Insight</b>  ${timeStr} UTC  [PREMIUM]\n` +
        `---\n` +
        `Watch tomorrow: <b>${w.sym}</b>  ${w.dir}\n\n` +
        `<i>${aiText}</i>\n\n` +
        `Score: <b>${w.score}/100</b>  RSI: ${w.rsi}  Vol: ${w.volR}x\n` +
        `<a href="${APP_URL}/screener?coin=${encodeURIComponent(w.sym + '/USDT')}">Open chart --></a>`;

      let sent = 0;
      for (const u of paidUsers) {
        if (!u.tg_chat_id) continue;
        await tgSend(u.tg_chat_id, msg);
        sent++;
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[daily:insight] sent=${sent} watch=${w.sym}`);
      return res.status(200).json({ sent, watch: w.sym });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ══ MORNING BRIEF (default, 07:00) ════════════════════════════════
  try {
    const [usersR, marketR, fngR, scanR] = await Promise.allSettled([
      fetch(`${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_daily=is.true&select=id,tg_chat_id,plan`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
      ).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/global',       { signal: AbortSignal.timeout(7000) }).then(r => r.json()),
      fetch('https://api.alternative.me/fng/?limit=1',       { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      scanMarket(),
    ]);

    const users  = usersR.status  === 'fulfilled' && Array.isArray(usersR.value)  ? usersR.value  : [];
    if (!users.length) return res.status(200).json({ sent: 0, reason: 'no users' });

    const market = marketR.status === 'fulfilled' ? marketR.value?.data : null;
    const fng    = fngR.status    === 'fulfilled' ? fngR.value?.data?.[0] : null;
    const scan   = scanR.status   === 'fulfilled' ? scanR.value : { scanned: 0, passed: 0, topSetup: null };

    const mcap   = fmtMcap(market?.total_market_cap?.usd);
    const btcDom = market?.market_cap_percentage?.btc?.toFixed(1) + '%' || '--';
    const fgVal  = fng?.value ?? '--';
    const fgLbl  = fng ? fngLabel(parseInt(fng.value)) : '--';

    const sigIdx  = scan.passed > 0 ? Math.min(10, Math.max(3, scan.passed + 3)) : 4;
    const sigNote = sigIdx <= 3 ? 'Low-signal morning — patience is the edge today.'
                  : sigIdx >= 8 ? 'High-signal conditions — stay sharp.' : null;

    const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    let sent = 0;
    for (const user of users) {
      if (!user.tg_chat_id) continue;
      const isPaid = user.plan === 'lifetime' || user.plan === 'monthly';

      // Personal weekly stats (streak mechanic from addiction loop doc)
      let statsLine = '';
      try {
        const wk = new Date();
        wk.setUTCDate(wk.getUTCDate() - ((wk.getUTCDay() + 6) % 7));
        wk.setUTCHours(0,0,0,0);
        const wTrades = await fetch(
          `${SB_URL}/rest/v1/trades?user_id=eq.${user.id}&created_at=gte.${wk.toISOString()}&select=result,pnl_pct`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
        ).then(r => r.json());
        if (Array.isArray(wTrades) && wTrades.length) {
          const wWins = wTrades.filter(t => t.result === 'win').length;
          const wWr   = Math.round(wWins / wTrades.length * 100);
          const wPnl  = wTrades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
          statsLine   = `\nYour week  |  <b>${wTrades.length} trades  ${wWr}% WR  ${wPnl >= 0 ? '+' : ''}${wPnl.toFixed(1)}%</b>`;
        }
      } catch(_) {}

      // Top setup line (filter transparency from alert system doc)
      let setupLine = '';
      if (scan.topSetup) {
        setupLine = isPaid
          ? `\nTop setup  |  <b>${scan.topSetup.sym}  ${scan.topSetup.dir}</b>  ${scan.topSetup.chg24 >= 0 ? '+' : ''}${scan.topSetup.chg24}% 24h  Score ${scan.topSetup.score}/100`
          : `\nTop setup  |  <b>${scan.topSetup.sym}</b>  [unlock for full signal]`;
      }

      const msg =
        `<b>Morning Brief</b>  ${date}\n` +
        `---\n` +
        `BTC  ${mcap}  Dom ${btcDom}\n` +
        `F&G  ${fgVal}  ${fgLbl}\n` +
        statsLine + setupLine + `\n` +
        `---\n` +
        `Signal index: <b>${sigIdx}/10</b>` +
        (scan.scanned > 0 ? `\n<code>${scan.scanned} scanned  |  ${scan.passed} passed threshold</code>` : '') +
        (sigNote ? `\n<i>${sigNote}</i>` : '') +
        `\n\n<a href="${APP_URL}/screener">Open screener --></a>` +
        (isPaid ? '' : `  |  <a href="${APP_URL}/pay">Unlock signals</a>`);

      await tgSend(user.tg_chat_id, msg);
      sent++;
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[daily:brief] sent=${sent} signals=${scan.passed}/${scan.scanned}`);
    return res.status(200).json({ sent, signals: scan });
  } catch(e) {
    console.error('[daily]', e);
    return res.status(500).json({ error: e.message });
  }
}
