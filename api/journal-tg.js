// api/journal-tg.js — minimal Telegram bridge for the standalone journal.
// Two actions:
//   test   — send a one-off confirmation message to the supplied chat_id and
//            verify the chat is reachable (returns Telegram username if any).
//   notify — send a trade notification to the supplied chat_id.
// Stateless: no DB. The journal stores the chat_id in localStorage and includes
// it on every request. Auth is by the bot token (server side) + light rate
// limiting per IP via a process-local Map (best-effort on warm Vercel
// functions; not a hard guarantee across cold starts).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

const RATE = new Map(); // ip -> [timestamps]
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

function rateOk(ip) {
  const now = Date.now();
  const arr = (RATE.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  RATE.set(ip, arr);
  return arr.length <= RATE_LIMIT;
}

async function tgApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.ok !== false, status: r.status, data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  if (!rateOk(ip)) return res.status(429).json({ ok: false, error: 'Too many requests' });

  const { action, chat_id, text } = req.body || {};
  if (!chat_id || !/^-?\d{5,15}$/.test(String(chat_id))) {
    return res.status(400).json({ ok: false, error: 'invalid chat_id' });
  }
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text required' });
  }
  if (text.length > 3500) {
    return res.status(400).json({ ok: false, error: 'text too long' });
  }
  if (action !== 'test' && action !== 'notify') {
    return res.status(400).json({ ok: false, error: 'invalid action' });
  }

  try {
    const send = await tgApi('sendMessage', {
      chat_id,
      text,
      disable_web_page_preview: true,
    });
    if (!send.ok) {
      const desc = send.data?.description || ('HTTP ' + send.status);
      return res.status(400).json({ ok: false, error: desc });
    }
    let username = null;
    if (action === 'test') {
      const chat = await tgApi('getChat', { chat_id });
      if (chat.ok) username = chat.data?.result?.username || null;
    }
    return res.status(200).json({ ok: true, username });
  } catch (e) {
    console.error('[journal-tg]', e);
    return res.status(500).json({ ok: false, error: e.message || 'send failed' });
  }
}
