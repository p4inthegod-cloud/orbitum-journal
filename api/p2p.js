import {
  formatP2PMessage,
  P2P_WALLET_URL,
  scanWalletP2P,
} from '../lib/p2p-scanner.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.P2P_CHAT_ID;

const dedupe = globalThis.__orbitumP2PDedupe || new Map();
globalThis.__orbitumP2PDedupe = dedupe;

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  return bearer === secret || req.headers?.['x-cron-secret'] === secret || req.query?.secret === secret;
}

async function tgSend(chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть Wallet', url: P2P_WALLET_URL }]] },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.description || `Telegram API: HTTP ${response.status}`);
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!BOT_TOKEN || !CHAT_ID) {
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
    const lastSentAt = dedupe.get(fingerprint) || 0;
    if (Date.now() - lastSentAt < repeatMinutes * 60_000) {
      return res.status(200).json({ ok: true, notified: false, reason: 'duplicate', adId: best.id });
    }

    await tgSend(CHAT_ID, formatP2PMessage({ ...scan, best }, { automatic: true }));
    dedupe.clear();
    dedupe.set(fingerprint, Date.now());

    return res.status(200).json({
      ok: true,
      notified: true,
      adId: best.id,
      price: best.price,
      discountPct: Number(best.discountPct.toFixed(3)),
    });
  } catch (error) {
    console.error('[p2p]', error);
    return res.status(500).json({ error: error.message });
  }
}
