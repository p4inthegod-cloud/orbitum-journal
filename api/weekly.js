// api/weekly.js — private weekly statistics delivered to the user's Telegram.
// Trade and emotion data stays inside Orbitum; no external AI provider receives it.

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
          `${SB_URL}/rest/v1/trades?user_id=eq.${user.id}&created_at=gte.${weekStartIso}&order=created_at.desc&select=result,pnl_pct,pnl_usd,pair,setup_type,direction,created_at`,
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
            `<a href="${APP_URL}/#contact">Записаться на бесплатную встречу --></a>`;
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

      // ── FREE USER: EDUCATIONAL CONTEXT ────────────────────────────
      if (!isPaid && weekSignals.length > 0) {
        const topSig = weekSignals[0];
        const sym    = (topSig.symbol || '').toUpperCase();
        msg += `\n---\n` +
          `<b>Контекст для разбора</b>\n` +
          `На этой неделе система отметила ситуацию по <b>${sym}</b>. Не оценивай её только по результату. Запиши, какое условие было видно до движения, где идея отменялась и какой риск был допустим.\n` +
          `<i>Цель — проверить порядок решения, а не догонять ушедшую цену.</i>`;
      }

      // ── FREE USER: SIGNAL SYSTEM STATS (filter transparency) ──────
      if (!isPaid && signalCount > 0) {
        msg += `\n\n<code>Система отметила ситуаций: ${signalCount}` +
          (avgSignalScore ? `  |  avg score ${avgSignalScore}/100` : '') +
          `</code>`;
      }

      // ── SOFT SELL — Sunday only, always at END ─────────────────────
      // Rule from funnel doc: "upgrade mention at end — never mid-message"
      if (!isPaid && isSunday) {
        msg +=
          `\n\n---\n` +
          `Хочешь собрать один понятный план перед сделкой? 3 августа в 19:00 МСК пройдёт бесплатная встреча Orbitum.\n\n` +
          `<a href="${APP_URL}/#contact">Записаться бесплатно --></a>`;
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
