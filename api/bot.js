import { handleLead } from '../lib/lead-handler.js';
import { publishMarketDaily } from '../lib/market-daily-runtime.js';
import { escapeHtml, formatP2PMessage, P2P_WALLET_URL, scanWalletP2P } from '../lib/p2p-scanner.js';

// api/bot.js v5 — ORBITUM Telegram Bot
// Commands: /start /p2p /stats /brief /markettest /signal /ai /alerts /plan /notify /log /help /stop
// Inline keyboard buttons on key messages

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';
const P2P_DEDUPE = globalThis.__orbitumP2PDedupe || new Map();
globalThis.__orbitumP2PDedupe = P2P_DEDUPE;

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

function isP2PCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = String(req.headers?.authorization || '').replace(/^Bearer\\s+/i, '');
  return bearer === secret ||
    req.headers?.['x-cron-secret'] === secret ||
    req.query?.secret === secret;
}

async function handleP2PCron(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isP2PCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const chatId = process.env.P2P_CHAT_ID;
  if (!BOT_TOKEN || !chatId) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN or P2P_CHAT_ID is not configured' });
  }

  try {
    const scan = await scanWalletP2P();
    const best = scan.qualifying[0];
    if (!best) {
      return res.status(200).json({
        ok: true,
        notified: false,
        scanned: scan.scanned,
        eligible: scan.offers.length,
        bestDiscountPct: scan.best?.discountPct ?? null,
      });
    }

    const configuredRepeat = Number(process.env.P2P_REPEAT_MINUTES || 30);
    const repeatMinutes = Number.isFinite(configuredRepeat)
      ? Math.max(5, configuredRepeat)
      : 30;
    const fingerprint = `${best.id}:${best.price}`;
    const lastSentAt = P2P_DEDUPE.get(fingerprint) || 0;
    if (Date.now() - lastSentAt < repeatMinutes * 60_000) {
      return res.status(200).json({ ok: true, notified: false, reason: 'duplicate', adId: best.id });
    }

    const sent = await tgSend(
      chatId,
      formatP2PMessage({ ...scan, best }, { automatic: true }),
      kb([btn('Открыть Wallet', P2P_WALLET_URL)])
    );
    if (!sent) throw new Error('Telegram delivery failed');

    P2P_DEDUPE.clear();
    P2P_DEDUPE.set(fingerprint, Date.now());
    return res.status(200).json({
      ok: true,
      notified: true,
      adId: best.id,
      price: best.price,
      discountPct: Number(best.discountPct.toFixed(3)),
    });
  } catch (error) {
    console.error('[bot:p2p-cron]', error);
    return res.status(500).json({ error: error.message });
  }
}

// ── Onboarding sequence ───────────────────────────────────────────
async function sendOnboarding(chat_id, stage, name = 'trader') {
  const msgs = {
    0: `<b>ORBITUM</b>\n---\n\nПривет, <b>${name}</b>. Аккаунт подключён.\n\nOrbitum помогает не искать очередной сигнал, а проверять собственный порядок действий: почему вы вошли, где идея отменяется и соблюдали ли вы риск.\n\n<a href="${APP_URL}/journal">Открыть журнал</a>`,

    1: `<b>Четыре ответа до сделки</b>\n\n1. Что сейчас происходит с ценой?\n2. Какое условие я жду?\n3. Где моя идея станет неверной?\n4. Какую небольшую потерю я допускаю?\n\nЕсли на один вопрос нет ответа, сделку лучше пропустить.\n\n<a href="${APP_URL}/#example">Посмотреть понятный пример</a>`,

    2: `<b>Как проверить себя после сделки</b>\n\nНе начинайте с вопроса «сколько я заработал». Сначала проверьте:\n— был ли вход по заранее записанному условию;\n— не изменили ли вы риск в процессе;\n— закрыли ли сделку там, где идея стала неверной.\n\nТак становится видно, подвёл план или вы сами его нарушили.\n\n<a href="${APP_URL}/journal">Записать сделку</a>`,

    3: `<b>Бесплатная встреча Orbitum</b>\n\n3 августа в 19:00 МСК Данил покажет на реальных графиках, как собрать понятный порядок перед сделкой.\n\nБез сигналов, обещаний прибыли и обязательной покупки. После встречи можно при желании пройти 7-дневный Orbitum Reset за $50 с личной проверкой.\n\n<a href="${APP_URL}/#contact">Записаться бесплатно</a>`,
  };
  if (msgs[stage]) await tgSend(chat_id, msgs[stage]);
}

// ── MAIN HANDLER ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.query?.action === 'p2p-cron') return handleP2PCron(req, res);
  if (req.query?.action === 'lead') return handleLead(req, res);
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

    // ══ /p2p [fiat amount] — Wallet P2P scan ═════════════════════
    // Kept before the Orbitum profile gate so the private P2P bot works
    // without linking or using the old trading screener.
    if (cmd === '/p2p' || cmd.startsWith('/p2p ')) {
      const allowedChatId = process.env.P2P_CHAT_ID;
      if (!allowedChatId) {
        await tgSend(chat_id,
          `<b>P2P-скринер ещё не настроен.</b>\n\n` +
          `Добавьте в Vercel:\n` +
          `P2P_CHAT_ID = <code>${chat_id}</code>\n` +
          `P2P_WALLET_API_KEY = ключ из Wallet P2P`
        );
        return res.status(200).send('OK');
      }
      if (String(chat_id) !== String(allowedChatId)) {
        await tgSend(chat_id, 'Эта команда доступна только владельцу P2P-скринера.');
        return res.status(200).send('OK');
      }

      const amountArg = text.split(/\s+/)[1];
      const requestedAmount = amountArg ? Number(amountArg.replace(',', '.')) : undefined;
      if (amountArg && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
        await tgSend(chat_id, 'Формат: <code>/p2p 5000</code>');
        return res.status(200).send('OK');
      }

      await tgSend(chat_id, 'Сканирую Wallet P2P...');
      try {
        const scan = await scanWalletP2P(requestedAmount ? { fiatAmount: requestedAmount } : {});
        await tgSend(
          chat_id,
          formatP2PMessage(scan),
          kb([btn('Открыть Wallet', P2P_WALLET_URL)])
        );
      } catch (error) {
        console.error('[bot:p2p]', error);
        const hint = /P2P_WALLET_API_KEY/.test(error.message)
          ? '\n\nДобавьте P2P_WALLET_API_KEY в Vercel.'
          : '';
        await tgSend(chat_id, `Не удалось проверить P2P: <code>${escapeHtml(String(error.message).slice(0, 180))}</code>${hint}`);
      }
      return res.status(200).send('OK');
    }

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
          `/p2p     — Wallet P2P prices\n` +
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

    // ══ /markettest — full public-style market overview in DM ══════
    if (cmd === '/markettest') {
      await tgSend(chat_id, '⏳ <b>Собираю актуальный обзор BTC…</b>');
      return publishMarketDaily(req, res, { testChatId: chat_id });
    }

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
          `<a href="${APP_URL}/#contact">Начать с бесплатной встречи</a>  |  <a href="${APP_URL}/screener?coin=${encodeURIComponent(top.sym+'/USDT')}">Открыть график</a>`
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
        (isPaid ? '' : `  |  <a href="${APP_URL}/#contact">Бесплатная встреча</a>`)
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
          `<b>Бесплатный доступ</b>\n---\n` +
          `Журнал можно использовать для записи и проверки своих решений.\n\n` +
          `Новые инструменты Orbitum не продаются как отдельный набор сигналов. Сначала пройдите бесплатную встречу и соберите собственный порядок действий.\n\n` +
          `<a href="${APP_URL}/#contact">Записаться бесплатно</a>`,
          kb([btn('О программе', `${APP_URL}/pay`)])
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

    // ══ /upgrade / /premium — legacy aliases for the learning path ═
    if (cmd === '/upgrade' || cmd === '/premium') {
      if (isPaid) {
        await tgSend(chat_id, `You're on <b>${profile.plan}</b> plan.\nAll features active.\n\n<a href="${APP_URL}/profile">View profile</a>`);
      } else {
        await tgSend(chat_id,
          `<b>Как проходит Orbitum</b>\n---\n` +
          `1. Бесплатная встреча — понять причину хаоса.\n` +
          `2. Orbitum Reset за $50 — собрать один план за 7 дней.\n` +
          `3. Практикум — научиться соблюдать план; доплата $250.\n\n` +
          `Никаких сигналов и обещаний прибыли.\n\n` +
          `<a href="${APP_URL}/#contact">Записаться на бесплатную встречу</a>`,
          kb([btn('Посмотреть программу', `${APP_URL}/pay`)])
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
      `/p2p      — Wallet P2P prices; /p2p 5000 for amount\n` +
      `/stats    — P&L & performance\n` +
      `/signal   — top setup right now\n` +
      `/brief    — today's market brief\n` +
      `/alerts   — active price alerts\n` +
      `/plan     — your plan & status\n` +
      `/log      — quick trade log\n` +
      `/notify   — notification settings\n` +
      `/upgrade  — как проходит программа\n` +
      `/stop     — unlink account\n---\n` +
      `<a href="${APP_URL}">Главная</a>  |  <a href="${APP_URL}/journal">Журнал</a>  |  <a href="${APP_URL}/pay">Программа</a>`
    );
    return res.status(200).send('OK');

  } catch(err) {
    console.error('[bot]', err);
    return res.status(200).send('OK'); // always 200 to Telegram
  }
}
