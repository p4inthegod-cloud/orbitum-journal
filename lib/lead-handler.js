// lib/lead-handler.js — public lead form -> private Orbitum Telegram group

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const LEADS_CHAT_ID = process.env.LEADS_CHAT_ID || '-5347298431';
let activeLeadsChatId = LEADS_CHAT_ID;
const APP_URL = process.env.APP_URL || 'https://orbitum.trade';

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 4;
const rateBuckets = new Map();

const EXPERIENCE_LABELS = {
  never: 'Ещё не торговал(а)',
  less_6m: 'Меньше 6 месяцев',
  '6_12m': '6–12 месяцев',
  '1_3y': '1–3 года',
  '3y_plus': 'Больше 3 лет',
};

const INTEREST_LABELS = {
  event: 'Бесплатный разбор',
  orbitum_reset: 'Orbitum Reset — $50',
  'orbitum-reset': 'Orbitum Reset — $50',
  reset: 'Orbitum Reset — $50',
  practicum: 'Практикум — $300',
  practice: 'Практикум — $300',
};

const ALLOWED_INTERESTS = new Set([
  ...Object.values(INTEREST_LABELS),
  'Стартовый спринт за $50',
  'Практикум за $300',
  // Keep previous landing-page values valid during cached-page rollouts.
  'Попробовать Orbitum',
  'Практикум за $299',
  'Другое',
]);

const ALLOWED_EXPERIENCE = new Set([
  ...Object.values(EXPERIENCE_LABELS),
  'Не указан',
  'До 1 года',
  '1–3 года',
  'Более 3 лет',
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function normalizeTelegram(value) {
  const raw = cleanText(value, 80);
  const direct = raw.match(/^@?([A-Za-z0-9_]{5,32})$/);
  const link = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{5,32})\/?$/i);
  const username = direct?.[1] || link?.[1];
  return username ? `@${username}` : null;
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX) {
    rateBuckets.set(ip, recent);
    return true;
  }

  recent.push(now);
  rateBuckets.set(ip, recent);

  if (rateBuckets.size > 500) {
    for (const [key, timestamps] of rateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }

  return false;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' ? forwardedHost : req.headers.host) || '';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto : 'https';
  const sameOrigin = origin === `${proto}://${host}`;

  const configuredOrigins = String(APP_URL)
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return sameOrigin || configuredOrigins.includes(origin.replace(/\/$/, ''));
}

function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export async function handleLead(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req)) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', APP_URL);

  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(req)) return res.status(403).end();
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 12_000) {
    return res.status(413).json({ ok: false, error: 'Request too large' });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'Некорректный формат заявки.' });
  }

  // Honeypot: bots receive a success response without sending anything to Telegram.
  if (cleanText(body.company || body.website, 120)) {
    return res.status(200).json({ ok: true });
  }

  const name = cleanText(body.name, 80);
  const telegram = normalizeTelegram(body.telegram);
  const interestKey = cleanText(body.interest, 80);
  const experienceKey = cleanText(body.experience, 80);
  const interest = INTEREST_LABELS[interestKey] || interestKey;
  const experience = EXPERIENCE_LABELS[experienceKey] || experienceKey || 'Не указан';
  const goal = cleanText(body.description || body.goal, 1200);
  const page = cleanText(body.source || body.page, 500);

  if (name.length < 2) {
    return res.status(400).json({ ok: false, error: 'Укажите имя.' });
  }

  if (!telegram) {
    return res.status(400).json({
      ok: false,
      error: 'Укажите Telegram в формате @username или t.me/username.',
    });
  }

  if (!ALLOWED_INTERESTS.has(interest)) {
    return res.status(400).json({ ok: false, error: 'Выберите интерес из списка.' });
  }

  if (!ALLOWED_EXPERIENCE.has(experience)) {
    return res.status(400).json({ ok: false, error: 'Выберите опыт из списка.' });
  }

  if (goal.length < 10) {
    return res.status(400).json({ ok: false, error: 'Опишите задачу чуть подробнее.' });
  }

  // Only valid submissions consume the anti-spam quota. Typing mistakes should not lock the form.
  const ip = requestIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({
      ok: false,
      error: 'Слишком много заявок. Попробуйте снова через несколько минут.',
    });
  }

  if (!BOT_TOKEN) {
    console.error('[lead] TELEGRAM_BOT_TOKEN is not configured');
    return res.status(503).json({ ok: false, error: 'Форма временно недоступна.' });
  }

  const username = telegram.slice(1);
  const timestamp = new Date().toISOString();
  const lines = [
    '🔥 <b>Новая заявка Orbitum</b>',
    '',
    `👤 <b>Имя:</b> ${escapeHtml(name)}`,
    `✈️ <b>Telegram:</b> <a href="https://t.me/${encodeURIComponent(username)}">${escapeHtml(telegram)}</a>`,
    `🎯 <b>Интерес:</b> ${escapeHtml(interest)}`,
    `📊 <b>Опыт:</b> ${escapeHtml(experience)}`,
    '',
    '<b>Главная задача:</b>',
    escapeHtml(goal),
    '',
    page ? `🔗 <b>Источник:</b> ${escapeHtml(page)}` : null,
    `🕒 <b>Получено:</b> ${escapeHtml(timestamp)}`,
  ].filter(Boolean);

  try {
    const telegramPayload = {
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    const sendToTelegram = async (chatId) => {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            chat_id: chatId,
            ...telegramPayload,
          }),
        }
      );

      const result = await response.json().catch(() => ({}));
      return { response, result };
    };

    let delivery = await sendToTelegram(activeLeadsChatId);
    const migratedChatId = delivery.result?.parameters?.migrate_to_chat_id;

    if ((!delivery.response.ok || !delivery.result.ok) && migratedChatId) {
      activeLeadsChatId = String(migratedChatId);
      console.info('[lead] Telegram group migrated; retrying with the new supergroup chat ID');
      delivery = await sendToTelegram(activeLeadsChatId);
    }

    if (!delivery.response.ok || !delivery.result.ok) {
      console.warn(
        '[lead] Telegram rejected message:',
        delivery.result.description || delivery.response.status
      );
      return res.status(502).json({
        ok: false,
        error: 'Не удалось доставить заявку. Попробуйте ещё раз.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[lead] Telegram request failed:', error?.name || 'unknown');
    return res.status(502).json({
      ok: false,
      error: 'Не удалось доставить заявку. Попробуйте ещё раз.',
    });
  }
}
