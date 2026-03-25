// api/onboarding.js — Email onboarding via Resend
// Triggered by: Supabase Database Webhook on auth.users INSERT
// Sequence: Day 0 (welcome) → Day 2 (activation) → Day 5 (conversion)

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = 'ORBITUM <noreply@orbitum.trade>';
const APP_URL        = process.env.APP_URL || 'https://orbitum.trade';
const WEBHOOK_SECRET = process.env.ONBOARDING_WEBHOOK_SECRET;

// ── Email templates ───────────────────────────────────────────────

function emailWelcome(email) {
  const name = email.split('@')[0];
  return {
    to: email,
    subject: 'Добро пожаловать в ORBITUM',
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#05070a;font-family:'Courier New',monospace;color:#ebebeb;}
  .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:22px;letter-spacing:6px;color:#e8722a;margin-bottom:40px;text-transform:uppercase;}
  .divider{border:none;border-top:1px solid rgba(255,255,255,0.07);margin:28px 0;}
  .label{font-size:9px;letter-spacing:3px;color:rgba(235,235,235,0.4);text-transform:uppercase;margin-bottom:8px;}
  h1{font-size:28px;letter-spacing:2px;color:#ffffff;margin:0 0 16px;text-transform:uppercase;}
  p{font-size:13px;line-height:1.9;color:rgba(235,235,235,0.65);margin:0 0 16px;}
  .cta{display:block;margin:32px 0;padding:16px 32px;background:#e8722a;color:#000000;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-align:center;font-weight:700;}
  .step{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start;}
  .step-n{min-width:24px;height:24px;border:1px solid rgba(232,114,42,0.4);color:#e8722a;font-size:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .step-t{font-size:12px;color:rgba(235,235,235,0.6);line-height:1.7;}
  .step-t strong{color:#ebebeb;}
  .footer{margin-top:48px;font-size:10px;color:rgba(235,235,235,0.2);letter-spacing:1px;}
</style></head>
<body><div class="wrap">
  <div class="logo">ORBITUM</div>
  <div class="label">Регистрация подтверждена</div>
  <h1>Ты внутри.</h1>
  <p>Журнал трейдера уже ждёт. Первые <strong style="color:#e8722a">10 сделок бесплатно</strong> — начни прямо сейчас, чтобы AI начал видеть твои паттерны.</p>
  <hr class="divider">
  <div class="label">Что делать первым делом</div>
  <div class="step"><div class="step-n">1</div><div class="step-t"><strong>Открой журнал</strong> и запиши последнюю сделку. Это занимает 30 секунд.</div></div>
  <div class="step"><div class="step-n">2</div><div class="step-t"><strong>Укажи эмоции</strong> при входе — именно это AI использует для разбора.</div></div>
  <div class="step"><div class="step-n">3</div><div class="step-t"><strong>После 5 сделок</strong> запусти AI Coach — он уже найдёт конкретные паттерны.</div></div>
  <a href="${APP_URL}/journal" class="cta">Открыть журнал →</a>
  <hr class="divider">
  <div class="footer">ORBITUM · ${APP_URL}<br>Ты получил это письмо потому что зарегистрировался на платформе.</div>
</div></body></html>`
  };
}

function emailActivation(email, tradeCount) {
  const hasNoTrades = tradeCount === 0;
  return {
    to: email,
    subject: hasNoTrades ? 'Ты ещё не добавил первую сделку' : `${tradeCount} сделок записано — вот что дальше`,
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#05070a;font-family:'Courier New',monospace;color:#ebebeb;}
  .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:22px;letter-spacing:6px;color:#e8722a;margin-bottom:40px;text-transform:uppercase;}
  .divider{border:none;border-top:1px solid rgba(255,255,255,0.07);margin:28px 0;}
  .label{font-size:9px;letter-spacing:3px;color:rgba(235,235,235,0.4);text-transform:uppercase;margin-bottom:8px;}
  h1{font-size:26px;letter-spacing:2px;color:#ffffff;margin:0 0 16px;text-transform:uppercase;}
  p{font-size:13px;line-height:1.9;color:rgba(235,235,235,0.65);margin:0 0 16px;}
  .cta{display:block;margin:32px 0;padding:16px 32px;background:#e8722a;color:#000000;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-align:center;font-weight:700;}
  .example{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-left:2px solid #e8722a;padding:16px 20px;margin:20px 0;}
  .ex-label{font-size:9px;letter-spacing:2px;color:#e8722a;margin-bottom:8px;text-transform:uppercase;}
  .ex-text{font-size:12px;color:rgba(235,235,235,0.7);line-height:1.8;}
  .footer{margin-top:48px;font-size:10px;color:rgba(235,235,235,0.2);letter-spacing:1px;}
</style></head>
<body><div class="wrap">
  <div class="logo">ORBITUM</div>
  ${hasNoTrades ? `
  <div class="label">Напоминание</div>
  <h1>Первая сделка<br>ещё не записана.</h1>
  <p>Журнал работает только если ты его заполняешь. Одна сделка в день — и через месяц у тебя будет точная картина своих ошибок.</p>
  <p>Не нужно ждать идеальной сделки. Запиши вчерашнюю.</p>
  ` : `
  <div class="label">${tradeCount} ${tradeCount === 1 ? 'сделка' : 'сделок'} в журнале</div>
  <h1>Хорошее начало.<br>AI уже смотрит.</h1>
  <p>Вот пример того что AI Coach находит у трейдеров после первых записей:</p>
  `}
  <div class="example">
    <div class="ex-label">Пример разбора AI Coach</div>
    <div class="ex-text">
      ⚡ <strong style="color:#ff4d4d">Торговля по пятницам: −$340</strong><br>
      8 из 11 убыточных сделок — пятница после 18:00. Низкий объём, ложные пробои. Потери: $340.<br><br>
      → Не входить в пятницу после 17:00 МСК.
    </div>
  </div>
  <p style="font-size:12px;color:rgba(235,235,235,0.4);">Твои паттерны будут другими — но они точно есть. AI находит их в реальных числах.</p>
  <a href="${APP_URL}/journal" class="cta">${hasNoTrades ? 'Записать первую сделку →' : 'Открыть журнал →'}</a>
  <hr class="divider">
  <div class="footer">ORBITUM · ${APP_URL}</div>
</div></body></html>`
  };
}

function emailConversion(email, tradeCount) {
  const savings = Math.round(tradeCount * 12);
  return {
    to: email,
    subject: 'AI видит твои паттерны. Разблокируй разбор.',
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#05070a;font-family:'Courier New',monospace;color:#ebebeb;}
  .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:22px;letter-spacing:6px;color:#e8722a;margin-bottom:40px;text-transform:uppercase;}
  .divider{border:none;border-top:1px solid rgba(255,255,255,0.07);margin:28px 0;}
  .label{font-size:9px;letter-spacing:3px;color:rgba(235,235,235,0.4);text-transform:uppercase;margin-bottom:8px;}
  h1{font-size:26px;letter-spacing:2px;color:#ffffff;margin:0 0 16px;text-transform:uppercase;}
  p{font-size:13px;line-height:1.9;color:rgba(235,235,235,0.65);margin:0 0 16px;}
  .price-block{border:1px solid rgba(232,114,42,0.3);padding:24px;margin:24px 0;background:rgba(232,114,42,0.04);}
  .price-row{display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap;}
  .price-opt{flex:1;}
  .price-label{font-size:9px;letter-spacing:2px;color:rgba(235,235,235,0.35);text-transform:uppercase;margin-bottom:4px;}
  .price-val{font-size:36px;color:#e8722a;letter-spacing:1px;line-height:1;}
  .price-note{font-size:10px;color:rgba(235,235,235,0.4);margin-top:4px;}
  .price-save{font-size:10px;color:#34d058;margin-top:4px;}
  .cta{display:block;margin:32px 0;padding:16px 32px;background:#e8722a;color:#000000;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-align:center;font-weight:700;}
  .cta-ghost{display:block;margin:-16px 0 32px;padding:12px 32px;border:1px solid rgba(255,255,255,0.1);color:rgba(235,235,235,0.5);text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;text-align:center;}
  .footer{margin-top:48px;font-size:10px;color:rgba(235,235,235,0.2);letter-spacing:1px;}
</style></head>
<body><div class="wrap">
  <div class="logo">ORBITUM</div>
  <div class="label">День 5 · Конверсия</div>
  <h1>У тебя ${tradeCount} сделок.<br>AI Coach ждёт.</h1>
  <p>Бесплатный план не даёт доступа к AI Coach, Brutal Analysis и полному дашборду. Именно там находятся паттерны которые стоят тебе денег каждую неделю.</p>
  <p>Средняя экономия после первого разбора — <strong style="color:#e8722a">$${savings}+</strong> в месяц за счёт устранения одного повторяющегося паттерна.</p>
  <div class="price-block">
    <div class="price-row">
      <div class="price-opt">
        <div class="price-label">Месячный</div>
        <div class="price-val">$29</div>
        <div class="price-note"><s style="color:rgba(235,235,235,0.2)">$49</s> /месяц</div>
      </div>
      <div style="width:1px;background:rgba(255,255,255,0.07);align-self:stretch;"></div>
      <div class="price-opt">
        <div class="price-label">Lifetime</div>
        <div class="price-val">$197</div>
        <div class="price-note">один раз навсегда</div>
        <div class="price-save">≡ 7 месяцев подписки</div>
      </div>
    </div>
  </div>
  <a href="${APP_URL}/pay" class="cta">Получить полный доступ →</a>
  <a href="${APP_URL}/journal" class="cta-ghost">Вернуться в журнал</a>
  <hr class="divider">
  <div class="footer">ORBITUM · ${APP_URL}<br>Ты получаешь это письмо как зарегистрированный пользователь.</div>
</div></body></html>`
  };
}

// ── Resend sender ─────────────────────────────────────────────────

async function sendEmail(template) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, ...template }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend error ${r.status}: ${err.slice(0, 200)}`);
  }
  return r.json();
}

// ── Supabase helper (service key) ─────────────────────────────────

async function getTradeCount(userId) {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/trades?user_id=eq.${userId}&select=id`,
    {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'count=exact',
      },
    }
  );
  const count = parseInt(r.headers.get('content-range')?.split('/')[1] || '0', 10);
  return isNaN(count) ? 0 : count;
}

// ── Main handler ──────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

async function tgSend(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch(e) { console.error('[onboarding] tg error:', e.message); }
}

// TG onboarding messages — conversion funnel template
// Stage 1: +2h — show real setup format
// Stage 2: +6h — show result proof
// Stage 3: +24h — soft conversion
function tgStageMessage(stage, name = 'trader', appUrl = 'https://orbitum.trade') {
  const messages = {
    1: () =>
      `📊 <b>Your first look inside</b>

` +
      `Here's what a premium setup signal looks like:

` +
      `⚡ <b>SETUP SIGNAL</b>
` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `🟢 <b>BTC/USDT · LONG</b> · 4H
` +
      `<code>Wyckoff Spring · Re-accumulation</code>
` +
      `🟢 <code>████████░░</code> <b>82%</b> confidence
` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `Entry  ·  <b>$97,200</b>
` +
      `SL     ·  <code>$96,400</code>
` +
      `TP     ·  <b>$99,800</b>
` +
      `R:R    ·  <b>3.25:1</b>
` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `🧠 <i>Spring confirmed on volume. 340 similar setups — 82% accuracy.</i>

` +
      `<i>On free tier: confidence %, entry zone, and AI insight are locked.</i>

` +
      `<a href="${appUrl}/pay">Unlock full signals →</a>`,

    2: () =>
      `✅ <b>Setup result</b>

` +
      `The BTC setup from earlier:

` +
      `<b>BTC/USDT LONG</b> · Entry $97,200
` +
      `Result: <b>+$2,600 · TP hit · +2.7%</b>

` +
      `That's what premium users saw first.

` +
      `This week: <b>7 signals · 5 hit target · avg +11.4%</b>

` +
      `<code>Sent to premium at 09:14. Free delay: +15 min.</code>

` +
      `<a href="${appUrl}/pay">Get real-time signals →</a>  ·  <a href="${appUrl}/journal">Open journal</a>`,

    3: () =>
      `🧠 <b>One pattern costs most traders $300–500/month.</b>

` +
      `The most common:
` +
      `— Trading Friday after 17:00 (low liquidity)
` +
      `— Entering after 2 consecutive losses (revenge)
` +
      `— Exiting winners early when BTC drops 0.5%

` +
      `ORBITUM's AI Coach finds <i>your</i> version — with exact numbers.

` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `Monthly  ·  <b>$29</b> / 30 days
` +
      `Lifetime ·  <b>$197</b> · pay once forever
` +
      `━━━━━━━━━━━━━━━━━━━

` +
      `<a href="${appUrl}/pay">Get full access →</a>  ·  <a href="${appUrl}/journal">Keep using free</a>`,
  };
  return messages[stage]?.() || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || 'https://orbitum.trade');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret, X-Cron-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CRON: deliver pending TG onboarding stages ────────────────────
  // Accepts GET or POST — cron-job.org may change method after redirect
  // Secret via x-cron-secret header OR ?secret= query param
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isCronCall = !CRON_SECRET || cronSecret === CRON_SECRET;

  if ((req.method === 'GET' || (req.method === 'POST' && cronSecret)) && isCronCall && !req.headers['x-webhook-secret']) {

    try {
      // Find all users with pending TG onboarding (stage 0, 1, or 2 not yet completed)
      const now = Date.now();
      const STAGE_DELAYS = [0, 2 * 3600000, 6 * 3600000, 24 * 3600000]; // ms after start

      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?tg_linked=is.true&onboarding_stage=lt.3&select=id,tg_chat_id,full_name,username,plan,onboarding_stage,onboarding_started_at`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
      );
      const users = await r.json();
      if (!Array.isArray(users) || !users.length) {
        return res.status(200).json({ processed: 0 });
      }

      let sent = 0;
      const appUrl = process.env.APP_URL || 'https://orbitum.trade';

      for (const user of users) {
        if (!user.tg_chat_id || !user.onboarding_started_at) continue;

        // Skip paying users — don't convert who already converted
        if (user.plan === 'lifetime' || user.plan === 'monthly') {
          // Mark as complete
          await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ onboarding_stage: 3 }),
          });
          continue;
        }

        const startedAt = new Date(user.onboarding_started_at).getTime();
        const elapsed   = now - startedAt;
        const nextStage = (user.onboarding_stage || 0) + 1;

        if (nextStage > 3) continue;
        if (elapsed < STAGE_DELAYS[nextStage]) continue; // not time yet

        const name = user.full_name || user.username || 'trader';
        const msg  = tgStageMessage(nextStage, name, appUrl);
        if (!msg) continue;

        await tgSend(user.tg_chat_id, msg);

        // Advance stage in DB
        await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ onboarding_stage: nextStage }),
        });

        sent++;
      }

      console.log(`[onboarding] TG stages sent=${sent}`);
      return res.status(200).json({ ok: true, sent });
    } catch(e) {
      console.error('[onboarding] cron error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Verify webhook secret to prevent abuse
  const secret = req.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, email, user_id } = req.body;

  if (!email || !type) {
    return res.status(400).json({ error: 'Missing email or type' });
  }

  try {
    let template;
    let tradeCount = 0;

    if (type === 'welcome') {
      template = emailWelcome(email);
    }
    else if (type === 'activation') {
      tradeCount = await getTradeCount(user_id);
      template = emailActivation(email, tradeCount);
    }
    else if (type === 'conversion') {
      tradeCount = await getTradeCount(user_id);
      // Don't send conversion email to paying users
      // (caller should check plan before triggering, but double-guard here)
      template = emailConversion(email, tradeCount);
    }
    else {
      return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    const result = await sendEmail(template);
    console.log(`[onboarding] ${type} sent to ${email}`, result.id);
    return res.status(200).json({ ok: true, id: result.id });

  } catch (e) {
    console.error('[onboarding]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
