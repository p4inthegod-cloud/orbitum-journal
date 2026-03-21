// api/weekly.js v3 — Full conversion funnel
// Sunday 20:00 UTC (optimal from funnel doc: user is calm, not trading)
//
// FREE users get:
//   - Personal stats
//   - "YOU ALMOST HAD IT" — exact entry time comparison (hard sell)
//   - Win attribution: "Premium entered at X. Your alert at X+15min."
//   - Soft sell at END only (rule: never mid-message)
//
// PAID users get:
//   - Full stats + AI coach insight
//   - Behavior fingerprint (after 10+ trades)
//   - "That's N in a row. Keep it up."  (positive reinforcement)
//   - Zero upsell

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = process.env.APP_URL || 'https://orbitum.trade';

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
    }
    return true;
  } catch(e) { console.error('[tgSend]', e.message); return false; }
}

// AI weekly coach + behavior fingerprint via Groq
async function getAIInsight(trades, wr, pnl, isPaid) {
  if (!process.env.GROQ_API_KEY || trades.length < 3) return null;
  try {
    const compact = trades.slice(0, 20).map(t => ({
      pair: t.pair, dir: t.direction, result: t.result,
      pnl: t.pnl_pct, setup: t.setup_type,
      conf: t.emotion_conf, fear: t.emotion_fear, greed: t.emotion_greed, calm: t.emotion_calm,
    }));

    // Behavior fingerprint prompt (only for paid with enough data)
    const fingerprint = isPaid && trades.length >= 10;
    const systemMsg = fingerprint
      ? `ICT/SMC trading coach. ${trades.length} trades, WR ${wr}%, P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%. Data: ${JSON.stringify(compact).slice(0,2500)}. Give 2 parts: 1) main performance pattern this week with numbers. 2) behavioral fingerprint — ONE specific behavior pattern (like revenge trading after losses, overtrading on certain days, emotion-performance correlation). Russian. No markdown.`
      : `ICT/SMC trading coach. ${trades.length} trades, WR ${wr}%, P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%. Data: ${JSON.stringify(compact).slice(0,2500)}. Give 2-3 sentences: main pattern + one concrete improvement with numbers. Russian. No markdown.`;

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: fingerprint ? 400 : 280,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: 'Weekly analysis.' },
        ],
      }),
      signal: AbortSignal.timeout(14000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content?.trim() || '';
    return text.length > 10 ? text.slice(0, 420) : null;
  } catch(_) { return null; }
}

// Get this week's premium signals from DB for win attribution
async function getWeekSignals(weekStartIso) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?alert_type=eq.screener_signal&triggered=is.true&triggered_at=gte.${weekStartIso}&select=symbol,condition,note,target_price,triggered_at&order=triggered_at.desc&limit=10`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
    );
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch(_) { return []; }
}

// Calculate current streak (consecutive wins)
function calcStreak(trades) {
  let streak = 0;
  for (const t of trades) {
    if (t.result === 'win') streak++;
    else break;
  }
  return streak;
}

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const users = await fetch(
      `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_weekly=is.true&select=id,tg_chat_id,full_name,plan`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
    ).then(r => r.json());

    if (!Array.isArray(users) || !users.length)
      return res.status(200).json({ sent: 0, reason: 'no users' });

    // Week boundaries: Mon 00:00 — Sun 23:59 UTC
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekStartIso = weekStart.toISOString();
    const weekLabel    = weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    const isSunday     = now.getUTCDay() === 0;

    // Load this week's premium signals (for win attribution)
    const weekSignals  = await getWeekSignals(weekStartIso);
    const signalCount  = weekSignals.length;

    // Signal performance stats from note field ("Score:82 Setup:...")
    const signalStats = weekSignals.reduce((acc, s) => {
      const scoreMatch = (s.note || '').match(/Score:(\d+)/);
      if (scoreMatch) {
        acc.totalScore += parseInt(scoreMatch[1]);
        acc.count++;
      }
      return acc;
    }, { totalScore: 0, count: 0 });

    const avgSignalScore = signalStats.count > 0
      ? Math.round(signalStats.totalScore / signalStats.count)
      : null;

    let sent = 0;

    for (const user of users) {
      if (!user.tg_chat_id) continue;
      const isPaid = user.plan === 'lifetime' || user.plan === 'monthly';

      // Load user's trades this week
      let trades = [];
      try {
        trades = await fetch(
          `${SB_URL}/rest/v1/trades?user_id=eq.${user.id}&created_at=gte.${weekStartIso}&order=created_at.desc&select=result,pnl_pct,pnl_usd,pair,setup_type,direction,emotion_conf,emotion_fear,emotion_greed,emotion_calm,created_at`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
        ).then(r => r.json()) || [];
      } catch(_) {}

      // ── NO TRADES this week ──────────────────────────────────────
      if (!Array.isArray(trades) || !trades.length) {
        let noTradeMsg =
          `<b>Weekly Report</b>  week of ${weekLabel}\n` +
          `---\n` +
          `No trades recorded this week.\n`;

        if (signalCount > 0) {
          const topSig = weekSignals[0];
          const sym = (topSig.symbol || '').toUpperCase();
          noTradeMsg +=
            `\n${signalCount} signal${signalCount !== 1 ? 's' : ''} sent this week.\n` +
            (avgSignalScore ? `Avg score: <b>${avgSignalScore}/100</b>\n` : '') +
            `\nMarket was moving. <a href="${APP_URL}/screener">Check what you missed --></a>`;
        }

        if (!isPaid && isSunday) {
          noTradeMsg +=
            `\n\n---\n` +
            `<a href="${APP_URL}/pay">Start next week with real-time signals --></a>`;
        }

        await tgSend(user.tg_chat_id, noTradeMsg);
        sent++;
        continue;
      }

      // ── COMPUTE STATS ────────────────────────────────────────────
      const wins    = trades.filter(t => t.result === 'win').length;
      const losses  = trades.filter(t => t.result === 'loss').length;
      const be      = trades.filter(t => t.result === 'be').length;
      const wr      = Math.round(wins / trades.length * 100);
      const pnl     = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const pnlUsd  = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
      const pnlSign = pnl >= 0 ? '+' : '';
      const streak  = calcStreak(trades); // consecutive wins from most recent

      // Best pair
      const pairMap = {};
      for (const t of trades) {
        if (!t.pair) continue;
        if (!pairMap[t.pair]) pairMap[t.pair] = { pnl: 0, n: 0, w: 0 };
        pairMap[t.pair].pnl += (t.pnl_pct || 0);
        pairMap[t.pair].n++;
        if (t.result === 'win') pairMap[t.pair].w++;
      }
      const pairs    = Object.entries(pairMap).sort((a, b) => b[1].pnl - a[1].pnl);
      const bestPair = pairs[0];
      const worstPair = pairs[pairs.length - 1];

      // Best setup
      const setupMap = {};
      for (const t of trades) {
        if (!t.setup_type) continue;
        if (!setupMap[t.setup_type]) setupMap[t.setup_type] = { pnl: 0, n: 0, w: 0 };
        setupMap[t.setup_type].pnl += (t.pnl_pct || 0);
        setupMap[t.setup_type].n++;
        if (t.result === 'win') setupMap[t.setup_type].w++;
      }
      const setups    = Object.entries(setupMap).sort((a, b) => b[1].pnl - a[1].pnl);
      const bestSetup = setups[0];

      // ── AI INSIGHT ────────────────────────────────────────────────
      const aiText = await getAIInsight(trades, wr, pnl, isPaid);

      // ── BUILD MESSAGE ─────────────────────────────────────────────
      const pnlEmoji = pnl >= 0 ? '[+]' : '[-]';

      let msg =
        `${pnlEmoji} <b>Weekly Report</b>  week of ${weekLabel}\n` +
        `---\n` +
        `Trades: <b>${trades.length}</b>  (${wins}W / ${losses}L${be > 0 ? ' / ' + be + 'BE' : ''})\n` +
        `Win rate: <b>${wr}%</b>\n` +
        `P&amp;L: <b>${pnlSign}${pnl.toFixed(1)}%</b>${pnlUsd ? `  (~${pnlUsd >= 0 ? '+$' : '-$'}${Math.abs(pnlUsd).toFixed(0)})` : ''}\n`;

      // Best pair / setup
      if (bestPair) {
        const bp = bestPair[1];
        msg += `Best pair: <b>${bestPair[0]}</b>  ${bp.pnl >= 0 ? '+' : ''}${bp.pnl.toFixed(1)}%  ${Math.round(bp.w/bp.n*100)}% WR\n`;
      }
      if (bestSetup) {
        const bs = bestSetup[1];
        msg += `Best setup: <b>${bestSetup[0]}</b>  ${Math.round(bs.w/bs.n*100)}% WR  (${bs.n} trades)\n`;
      }

      // Streak reinforcement (from addiction loop doc: personal score builds identity)
      if (streak >= 2) {
        msg += `\n[!] ${streak} wins in a row.`;
        if (isPaid && streak >= 3) {
          msg += ` That's ${streak} in a row. Consistent.`;
        }
        msg += '\n';
      }

      msg += `---\n`;

      // AI Coach block (paid)
      if (aiText && isPaid) {
        msg += `\n<b>AI Coach</b>\n<i>${aiText}</i>\n`;
      }

      // ── FREE USER: WIN ATTRIBUTION + MISSED OPPORTUNITY ───────────
      // "BTC hit target. Premium entered at $97,240. Your alert arrived at $97,810."
      // From conversion funnel doc: "precise comparison makes the cost tangible"
      if (!isPaid && weekSignals.length > 0) {
        const topSig = weekSignals[0];
        const sym    = (topSig.symbol || '').toUpperCase();
        const dir    = topSig.condition || 'long';
        const entry  = parseFloat(topSig.target_price || 0);
        const sentAt = new Date(topSig.triggered_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // Estimate free tier received +15 min later
        const freeAt = new Date(new Date(topSig.triggered_at).getTime() + 15 * 60000)
          .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // Simple price difference estimate: 0.5-2% gap is realistic in 15 min
        const entryFree = entry > 0 ? (dir === 'long' ? entry * 1.008 : entry * 0.992) : 0;

        msg += `\n---\n` +
          `<b>YOU ALMOST HAD IT</b>\n` +
          `${sym} setup sent: <b>${sentAt}</b>\n` +
          `Your alert arrived: <b>${freeAt} (+15 min)</b>\n` +
          (entry > 0 ? `Premium entry: $${entry.toLocaleString()}\nYour entry: ~$${entryFree.toLocaleString('en', { maximumFractionDigits: 0 })} (already moved)\n` : '') +
          `\n15 minutes cost you the entry.\n` +
          `<b>Premium = real-time. Always.</b>`;
      }

      // ── FREE USER: SIGNAL SYSTEM STATS (filter transparency) ──────
      if (!isPaid && signalCount > 0) {
        msg += `\n\n<code>This week: ${signalCount} signal${signalCount !== 1 ? 's' : ''} sent` +
          (avgSignalScore ? `  |  avg score ${avgSignalScore}/100` : '') +
          `</code>` +
          (signalCount > 3 ? `\nFree tier received: <b>${Math.floor(signalCount * 0.43)} of ${signalCount} (delayed)</b>` : '');
      }

      // ── SOFT SELL — Sunday only, always at END ─────────────────────
      // Rule from funnel doc: "upgrade mention at end — never mid-message"
      if (!isPaid && isSunday) {
        const weekSummary = pnl >= 0
          ? `This week: <b>${pnlSign}${pnl.toFixed(1)}%</b>.`
          : `Tough week: <b>${pnl.toFixed(1)}%</b>.`;
        msg +=
          `\n\n---\n` +
          `${weekSummary} AI Coach shows which patterns cost you.\n\n` +
          `Monthly  <b>$29</b>  |  Lifetime  <b>$197</b>\n` +
          `<a href="${APP_URL}/pay">See what you're missing --></a>`;
      } else if (!isPaid) {
        // Non-Sunday: just a link, no pressure
        msg += `\n\n<a href="${APP_URL}/journal">Full journal --></a>  |  <a href="${APP_URL}/screener">Screener --></a>`;
      } else {
        // Paid: clean close
        msg += `\n<a href="${APP_URL}/journal">Full journal --></a>  |  <a href="${APP_URL}/ai-journal">AI Breakdown --></a>`;
      }

      await tgSend(user.tg_chat_id, msg);
      sent++;
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[weekly] sent=${sent} users=${users.length} signals=${signalCount}`);
    return res.status(200).json({ sent, users: users.length, signals: signalCount });

  } catch(e) {
    console.error('[weekly]', e);
    return res.status(500).json({ error: e.message });
  }
}
