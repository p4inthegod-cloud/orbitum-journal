// api/notify.js v4 — Redesigned alerts with RU/EN localization + custom TG emoji
// Custom emoji render as animated stickers for Premium TG users, plain fallback for others

// ── Custom emoji (tg-emoji tags) ─────────────────────────────────
// Premium TG users see animated stickers, others see fallback Unicode
const E = {
  signal:   '<tg-emoji emoji-id="5226928895189598791">⚡</tg-emoji>',
  long:     '<tg-emoji emoji-id="5463274047771000031">🟢</tg-emoji>',
  short:    '<tg-emoji emoji-id="5463054218459884779">🔴</tg-emoji>',
  ai:       '<tg-emoji emoji-id="5463122435425448565">🧠</tg-emoji>',
  diamond:  '<tg-emoji emoji-id="5375099322666859339">💎</tg-emoji>',
  fire:     '<tg-emoji emoji-id="5256047523620995497">🔥</tg-emoji>',
  warn:     '⚠️',
  ok:       '✅',
  chart:    '📊',
  journal:  '📝',
  tilt:     '🚨',
  critical: '🚨',
  momentum: '🚀',
  sa:       '📡',
  morning:  '🌅',
  coach:    '🤖',
  fomo:     '⏱',
  lock:     '🔒',
};


const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

const CRITICAL_TYPES = new Set(['signal_critical', 'tilt', 'raw']);
function isSilent() { const h = new Date().getUTCHours(); return h >= 23 || h < 6; }

const NOTIFY_GATE = {
  alert:             'tg_notify_alerts',
  signal_setup:      'tg_notify_alerts',
  signal_momentum:   'tg_notify_alerts',
  signal_ai:         'tg_notify_alerts',
  signal_critical:   null,
  fomo:              'tg_notify_alerts',
  sa_score:          'tg_notify_alerts',
  trade:             'tg_notify_trades',
  tilt:              'tg_notify_tilt',
  daily:             'tg_notify_daily',
  ai_coach_feedback: 'tg_notify_trades',
  raw:               null,
};

async function tgSend(chat_id, text, extra = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (e?.error_code === 403) return false;
      console.warn('[notify] tgSend', chat_id, e?.description);
    }
    return true;
  } catch(e) { console.error('[notify] tgSend', e.message); return false; }
}

function fmtP(p) {
  const n = parseFloat(p);
  if (isNaN(n) || !n) return '--';
  if (n >= 10000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 1000)  return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtPct(p, plus = true) {
  const n = parseFloat(p);
  if (isNaN(n)) return '--';
  return `${n >= 0 && plus ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtVol(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function timeUTC() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' UTC';
}

function confBar(pct) {
  const f = Math.round(pct / 10);
  const dot = pct >= 75 ? E.long : pct >= 60 ? '🟡' : E.short;
  return `${dot} <code>${'█'.repeat(f)}${'░'.repeat(10-f)}</code> <b>${pct}%</b>`;
}

// ── i18n helpers ──────────────────────────────────────────────────
const i18n = {
  en: {
    // Alert types
    alert_price_above:  'Breakout Up',
    alert_price_below:  'Breakdown',
    alert_price_cross:  'Level Cross',
    alert_volume:       'Volume Spike',
    alert_change_up:    'Sharp Rise',
    alert_change_down:  'Sharp Drop',
    alert_rsi_ob:       'RSI Overbought',
    alert_rsi_os:       'RSI Oversold',
    alert_volatility:   'High Volatility',
    alert_pump:         'Pump',
    alert_dump:         'Dump',
    // Fields
    price:    'Price',
    level:    'Level',
    volume:   'Volume',
    move:     'Move',
    setup:    'Setup',
    entry:    'Entry',
    sl:       'SL',
    tp:       'TP',
    rr:       'R:R',
    result:   'Result',
    pair:     'Pair',
    grade:    'Grade',
    // Trade results
    profit:   'PROFIT',
    loss:     'LOSS',
    be:       'BREAKEVEN',
    // Tilt
    tilt_title: '🚨 TILT WARNING',
    tilt_body:  (n, pct) => `${n} ${E.warn} losses in a row · Total <b>${pct}</b>\n\n<b>Close the terminal. Step away.\nThe market will still be here tomorrow.</b>`,
    // Sections
    signal_header:    '⚡ SETUP SIGNAL',
    momentum_header:  '🚀 MOMENTUM',
    ai_header:        '🧠 AI INSIGHT  [PREMIUM]',
    critical_header:  '🚨 CRITICAL',
    coach_header:     '🤖 AI Coach',
    fomo_header:      E.fomo + ' MISSED SIGNAL',
    sa_header:        '📡 Market Awareness',
    daily_header:     '🌅 Morning Brief',
    // Misc
    scanned:      (n, p) => `${n} scanned  ·  ${p} passed threshold`,
    your_week:    'Your week',
    open_chart:   '📊 Open Chart',
    log_trade:    '📝 Log Trade',
    ask_ai:       '🤖 Ask AI',
    upgrade:      E.diamond + ' Unlock Premium',
    locked_entry: (t) => `${t} → [unlock]`,
    window:       (n) => `⏱ ${n} min window`,
    overbought:   '⚠️ OB',
    oversold:     '💚 OS',
    rare:         () => E.signal + ' Grade A+ — rare occurrence',
    grade_label:  (g) => `Grade: <b>${g}</b>`,
    confluence:   'Confluence',
  },
  ru: {
    alert_price_above:  'Пробой вверх',
    alert_price_below:  'Пробой вниз',
    alert_price_cross:  'Пересечение уровня',
    alert_volume:       'Всплеск объёма',
    alert_change_up:    'Резкий рост',
    alert_change_down:  'Резкое падение',
    alert_rsi_ob:       'RSI: перекупленность',
    alert_rsi_os:       'RSI: перепроданность',
    alert_volatility:   'Высокая волатильность',
    alert_pump:         'Памп',
    alert_dump:         'Дамп',
    price:    'Цена',
    level:    'Уровень',
    volume:   'Объём',
    move:     'Движение',
    setup:    'Сетап',
    entry:    'Вход',
    sl:       'Стоп',
    tp:       'Тейк',
    rr:       'R:R',
    result:   'Результат',
    pair:     'Пара',
    grade:    'Оценка',
    profit:   'ПРОФИТ',
    loss:     'УБЫТОК',
    be:       'БЕЗУБЫТОК',
    tilt_title: '🚨 ТИЛЬТ — СТОП',
    tilt_body:  (n, pct) => `${n} ${E.warn} убытков подряд · Итого <b>${pct}</b>\n\n<b>Закрой терминал. Выйди подышать.\nРынок будет и завтра.</b>`,
    signal_header:    '⚡ СИГНАЛ',
    momentum_header:  '🚀 МОМЕНТУМ',
    ai_header:        '🧠 AI АНАЛИЗ  [PREMIUM]',
    critical_header:  '🚨 КРИТИЧЕСКИЙ',
    coach_header:     '🤖 AI Коуч',
    fomo_header:      E.fomo + ' ПРОПУЩЕННЫЙ СИГНАЛ',
    sa_header:        '📡 Осведомлённость о рынке',
    daily_header:     '🌅 Утренний брифинг',
    scanned:      (n, p) => `${n} просканировано  ·  ${p} прошло фильтр`,
    your_week:    'Твоя неделя',
    open_chart:   '📊 Открыть график',
    log_trade:    '📝 Записать',
    ask_ai:       '🤖 AI Разбор',
    upgrade:      E.diamond + ' Разблокировать Premium',
    locked_entry: (t) => `${t} → [разблокировать]`,
    window:       (n) => `⏱ окно ${n} мин`,
    overbought:   '⚠️ ПК',
    oversold:     '💚 ПП',
    rare:         () => E.signal + ' Оценка A+ — редкое появление',
    grade_label:  (g) => `Оценка: <b>${g}</b>`,
    confluence:   'Конфлюенс',
  },
};

function L(lang, key, ...args) {
  const v = (i18n[lang] ?? i18n.en)[key] ?? i18n.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Notify-User');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const userId = req.headers['x-notify-user'];
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId))
    return res.status(401).json({ error: 'Unauthorized' });

  const { type, data } = req.body;
  if (!type) return res.status(400).json({ error: 'Missing type' });

  // Load profile
  const profileR = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=id,tg_linked,tg_chat_id,plan,lang,tg_notify_trades,tg_notify_alerts,tg_notify_daily,tg_notify_tilt`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
  );
  const profiles = await profileR.json();
  const profile  = profiles?.[0];
  if (!profile?.tg_linked || !profile?.tg_chat_id)
    return res.status(403).json({ error: 'TG not linked' });

  const chat_id = profile.tg_chat_id;
  const isPaid  = profile.plan === 'lifetime' || profile.plan === 'monthly';
  const lang    = profile.lang === 'ru' ? 'ru' : 'en';

  // Check gate
  const gate = NOTIFY_GATE[type];
  if (gate && profile[gate] === false)
    return res.status(200).json({ ok: true, skipped: true, reason: 'preference' });
  if (isSilent() && !CRITICAL_TYPES.has(type))
    return res.status(200).json({ ok: true, skipped: true, reason: 'silent hours' });

  const div = '──────────────────';

  try {

    // ══ PRICE / VOLUME / RSI ALERT ═══════════════════════════════
    if (type === 'alert') {
      const {
        symbol, condition, alert_type = 'price',
        target_price, current_price, change_24h,
        volume_24h, volume_ratio, rsi, rsi_period,
        change_pct, change_window, note, repeat_mode, app_url,
      } = data;
      const sym = (symbol || '?').toUpperCase();

      const typeKey = {
        price:       condition === 'above' ? 'alert_price_above' : 'alert_price_below',
        price_cross: 'alert_price_cross',
        volume:      'alert_volume',
        change:      parseFloat(change_pct) >= 0 ? 'alert_change_up' : 'alert_change_down',
        rsi_ob:      'alert_rsi_ob',
        rsi_os:      'alert_rsi_os',
        volatility:  'alert_volatility',
        pump:        'alert_pump',
        dump:        'alert_dump',
      }[alert_type] || 'alert_price_above';

      const dirDot = ['alert_price_above','alert_rsi_os','alert_pump','alert_change_up'].includes(typeKey) ? E.long :
                     ['alert_volatility'].includes(typeKey) ? '🟡' : E.short;

      const lines = [
        `${dirDot} <b>ORBITUM · ${sym}/USDT</b>`,
        `<b>${L(lang, typeKey)}</b>`,
        div,
      ];

      if (current_price != null) {
        const chg = change_24h != null ? `  <i>${fmtPct(change_24h)} 24h</i>` : '';
        lines.push(`${L(lang, 'price').padEnd(8)} <b>${fmtP(current_price)}</b>${chg}`);
      }
      if (target_price != null && ['price','price_cross'].includes(alert_type)) {
        const diff = ((parseFloat(current_price) - parseFloat(target_price)) / parseFloat(target_price) * 100).toFixed(2);
        lines.push(`${L(lang, 'level').padEnd(8)} <b>${fmtP(target_price)}</b>  <i>(${parseFloat(diff) >= 0 ? '+' : ''}${diff}%)</i>`);
      }
      if (volume_24h != null)
        lines.push(`${L(lang, 'volume').padEnd(8)} <b>${fmtVol(volume_24h)}</b>${volume_ratio ? `  ×${parseFloat(volume_ratio).toFixed(1)} avg` : ''}`);
      if (rsi != null)
        lines.push(`RSI (${rsi_period||14})  <b>${Math.round(rsi)}</b>${rsi >= 70 ? ' ' + L(lang,'overbought') : rsi <= 30 ? ' ' + L(lang,'oversold') : ''}`);
      if (change_pct != null && alert_type === 'change')
        lines.push(`${L(lang, 'move').padEnd(8)} <b>${fmtPct(change_pct)}</b>${change_window ? ` ${lang === 'ru' ? 'за' : 'in'} ${change_window}min` : ''}`);

      if (note) lines.push('', `<i>${note}</i>`);
      if (repeat_mode && repeat_mode !== 'once')
        lines.push(repeat_mode === 'daily' ? (lang === 'ru' ? '📅 Ежедневный' : '📅 Daily') : (lang === 'ru' ? '🔁 Повторный' : '🔁 Repeat'));

      lines.push('', `<a href="${(app_url || APP_URL) + '/screener?coin=' + encodeURIComponent(sym+'/USDT')}">${L(lang,'open_chart')}</a>`);
      await tgSend(chat_id, lines.filter(l => l !== undefined).join('\n'));
    }

    // ══ TRADE LOGGED ══════════════════════════════════════════════
    if (type === 'trade') {
      const { pair, direction, result, pnl_pct, pnl_usd, setup_type, entry_price, exit_price, rr } = data;
      const isWin   = result === 'win';
      const isLoss  = result === 'loss';
      const resEmoji = isWin ? '💚' : isLoss ? '🔴' : '🟡';
      const dirLabel = direction === 'long' ? '▲ LONG' : '▼ SHORT';
      const resLabel = isWin ? L(lang, 'profit') : isLoss ? L(lang, 'loss') : L(lang, 'be');
      const pnlSign  = parseFloat(pnl_pct) >= 0 ? '+' : '';
      const usd      = pnl_usd != null ? `  (~${pnl_usd >= 0 ? '+$' : '-$'}${Math.abs(pnl_usd).toFixed(0)})` : '';

      const lines = [
        `${resEmoji} <b>${pair}  ${dirLabel}</b>`,
        `<b>${resLabel}: ${fmtPct(pnl_pct)}${usd}</b>`,
        div,
      ];
      if (entry_price) lines.push(`${L(lang,'entry').padEnd(6)} <b>${fmtP(entry_price)}</b>`);
      if (exit_price)  lines.push(`${lang === 'ru' ? 'Выход' : 'Exit'} <b>${fmtP(exit_price)}</b>`);
      if (rr)          lines.push(`${L(lang,'rr').padEnd(6)} <b>1:${parseFloat(rr).toFixed(1)}</b>`);
      if (setup_type)  lines.push(`${L(lang,'setup').padEnd(6)} <b>${setup_type}</b>`);

      lines.push('', `<a href="${APP_URL}/journal">${L(lang,'log_trade')}</a>  ·  <a href="${APP_URL}/ai-journal">${L(lang,'ask_ai')}</a>`);
      await tgSend(chat_id, lines.join('\n'));
    }

    // ══ AI COACH FEEDBACK ══════════════════════════════════════════
    if (type === 'ai_coach_feedback') {
      const { pair, direction, insight, pattern_note, consistency_score } = data;
      if (!insight) return res.status(200).json({ ok: true, skipped: true });

      const dir = direction === 'long' ? '▲ LONG' : '▼ SHORT';
      const scoreStr = consistency_score != null
        ? `\n${lang === 'ru' ? 'Оценка паттерна' : 'Pattern score'}: <b>${consistency_score > 0 ? '+' : ''}${consistency_score}</b>`
        : '';

      await tgSend(chat_id,
        `${E.coach + ' <b>' + (lang === 'ru' ? 'AI Коуч' : 'AI Coach') + '</b>'}  <b>${pair}  ${dir}</b>\n${div}\n` +
        `<i>${insight.slice(0, 280)}</i>` +
        (pattern_note ? `\n\n<b>${lang === 'ru' ? 'Паттерн' : 'Pattern'}:</b> ${pattern_note.slice(0, 120)}` : '') +
        scoreStr +
        `\n\n<a href="${APP_URL}/ai-journal">${L(lang,'ask_ai')}</a>`
      );
    }

    // ══ TILT ══════════════════════════════════════════════════════
    if (type === 'tilt') {
      const { losses_count, total_loss_pct, last_pairs } = data;
      const pairsStr = last_pairs?.length ? `\n${lang === 'ru' ? 'Последние' : 'Last trades'}: ${last_pairs.join(', ')}` : '';
      await tgSend(chat_id,
        `${E.tilt + ' <b>' + (lang === 'ru' ? 'ТИЛЬТ — СТОП' : 'TILT WARNING') + '</b>'}\n${div}\n` +
        L(lang, 'tilt_body', losses_count, fmtPct(total_loss_pct)) +
        pairsStr
      );
    }

    // ══ SETUP SIGNAL ══════════════════════════════════════════════
    if (type === 'signal_setup') {
      const { pair, direction, entry, sl, tp, rr, confidence = 75, setup_type, insight, tf = '4H' } = data;
      const dir    = direction === 'long' ? E.long + ' LONG' : E.short + ' SHORT';
      const rrStr  = rr ? `1:${parseFloat(rr).toFixed(1)}` : '--';
      const grade  = confidence >= 80 ? 'A+' : confidence >= 70 ? 'A' : confidence >= 60 ? 'B+' : 'B';
      const scarcity = confidence >= 80
        ? `\n<code>${(typeof (i18n[lang] ?? i18n.en).rare === 'function' ? (i18n[lang] ?? i18n.en).rare() : (i18n[lang] ?? i18n.en).rare)}</code>`
        : `\n${L(lang, 'grade_label', grade)}`;
      const insightLine = insight ? `\n\n🧠 <i>${insight.slice(0, 200)}</i>` : '';

      await tgSend(chat_id,
        `${E.signal + ' <b>' + (lang === 'ru' ? 'СИГНАЛ' : 'SETUP SIGNAL') + '</b>'}  ${timeUTC()}\n${div}\n` +
        `${dir}  <b>${pair}</b>  ${tf.toUpperCase()}\n` +
        (setup_type ? `<code>${setup_type}</code>\n` : '') +
        confBar(confidence) + `\n${div}\n` +
        `${L(lang,'entry').padEnd(6)} <b>${fmtP(entry)}</b>\n` +
        `${L(lang,'sl').padEnd(6)} <code>${fmtP(sl)}</code>\n` +
        `${L(lang,'tp').padEnd(6)} <b>${fmtP(tp)}</b>\n` +
        `${L(lang,'rr').padEnd(6)} <b>${rrStr}</b>\n` +
        div +
        insightLine + scarcity +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf.toLowerCase()}&panel=signal">${L(lang,'open_chart')}</a>  ·  <a href="${APP_URL}/journal">${L(lang,'log_trade')}</a>`
      );
    }

    // ══ MOMENTUM ══════════════════════════════════════════════════
    if (type === 'signal_momentum') {
      const { pair, change24h = 0, volume_ratio = 1, momentum_score = 7, price, note } = data;
      const isHigh  = momentum_score >= 8;
      const urgency = isHigh ? (lang === 'ru' ? E.fire + ' ВЫСОКИЙ' : E.fire + ' HIGH') : (lang === 'ru' ? '⚡ АКТИВНЫЙ' : '⚡ ACTIVE');
      const window  = isHigh
        ? L(lang, 'window', lang === 'ru' ? '15–30' : '15-30')
        : (lang === 'ru' ? '⏱ Следить следующий 1H' : '⏱ Watch next 1H');

      await tgSend(chat_id,
        `${E.momentum + ' <b>' + (lang === 'ru' ? 'МОМЕНТУМ' : 'MOMENTUM') + '</b>'}  ${timeUTC()}\n${div}\n` +
        `<b>${pair}</b>  ${urgency}\n${div}\n` +
        `${L(lang,'price').padEnd(8)} <b>${fmtP(price)}</b>\n` +
        `24H      <b>${change24h >= 0 ? '+' : ''}${parseFloat(change24h).toFixed(1)}%</b>\n` +
        `${L(lang,'volume').padEnd(8)} <b>${parseFloat(volume_ratio).toFixed(1)}× avg</b>\n` +
        `Score    <b>${momentum_score}/10</b>\n${div}\n` +
        window + (note ? `\n<i>${note.slice(0,100)}</i>` : '') +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}">${L(lang,'open_chart')}</a>`
      );
    }

    // ══ AI INSIGHT (premium) ══════════════════════════════════════
    if (type === 'signal_ai') {
      const { pair, pattern, probability = 74, basis, recommendation, tf = '4H' } = data;
      const recLine = recommendation ? `\n\n→ <i>${recommendation.slice(0, 200)}</i>` : '';

      await tgSend(chat_id,
        `${E.ai + ' <b>' + (lang === 'ru' ? 'AI АНАЛИЗ  [PREMIUM]' : 'AI INSIGHT  [PREMIUM]') + '</b>'}\n${div}\n` +
        `<b>${pair}</b>  ${tf.toUpperCase()}\n` +
        `${lang === 'ru' ? 'Паттерн' : 'Pattern'}  <code>${pattern}</code>\n` +
        confBar(probability) + `\n` +
        `${lang === 'ru' ? 'Основано на' : 'Based on'} <b>${basis || (lang === 'ru' ? 'исторических данных' : 'historical data')}</b>\n` +
        div + recLine +
        `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf.toLowerCase()}&panel=ai">${L(lang,'open_chart')}</a>`
      );
    }

    // ══ CRITICAL ══════════════════════════════════════════════════
    if (type === 'signal_critical') {
      const { pair, event, price, level, level_label = 'KEY LEVEL', risk_usd, directive } = data;
      const breach  = parseFloat(price) < parseFloat(level)
        ? (lang === 'ru' ? '← ПРОБИТ' : '← BREACHED')
        : (lang === 'ru' ? '← ПРИБЛИЖАЕТСЯ' : '← APPROACHING');
      const riskLine = risk_usd ? `${lang === 'ru' ? 'Риск' : 'Risk'}   <b>$${Math.abs(parseFloat(risk_usd)).toFixed(0)} ${lang === 'ru' ? 'под угрозой' : 'at stake'}</b>\n` : '';
      const dir = directive || (lang === 'ru' ? 'Немедленно проверь позицию' : 'Review position immediately');

      await tgSend(chat_id,
        `${E.critical + ' <b>' + (lang === 'ru' ? 'КРИТИЧЕСКИЙ' : 'CRITICAL') + '</b>'}\n${div}\n` +
        `🔴 <b>${pair}  ${event}</b>\n${div}\n` +
        `${L(lang,'price').padEnd(8)} <b>${fmtP(price)}</b>\n` +
        `${level_label.slice(0,8).padEnd(8)} <code>${fmtP(level)} ${breach}</code>\n` +
        riskLine + div + '\n' +
        `⚡ <b>${dir}</b>\n\n` +
        `<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&panel=alert">${L(lang,'open_chart')}</a>  ·  <a href="${APP_URL}/journal">${L(lang,'log_trade')}</a>`
      );
    }

    // ══ FOMO / MISSED OPPORTUNITY ══════════════════════════════════
    if (type === 'fomo') {
      const { pair, premium_time, delay_min = 15, result_pct, premium_entry, free_entry } = data;
      const youAlmost = lang === 'ru' ? E.fomo + ' ТЫ ПОЧТИ УСПЕЛ' : E.fomo + ' YOU ALMOST HAD IT';
      const resultLine = result_pct != null
        ? `${lang === 'ru' ? 'Результат' : 'Result'}:  <b>${result_pct >= 0 ? '+' : ''}${parseFloat(result_pct).toFixed(1)}%</b>\n`
        : '';
      const priceComp = premium_entry && free_entry
        ? `${lang === 'ru' ? 'Вход Premium' : 'Premium entry'}: <b>${fmtP(premium_entry)}</b>\n${lang === 'ru' ? 'Твой вход' : 'Your entry'}:    <code>${fmtP(free_entry)} ${lang === 'ru' ? '(уже двинулось)' : '(already moved)'}</code>\n`
        : '';

      await tgSend(chat_id,
        `${E.fomo + ' <b>' + (lang === 'ru' ? 'ТЫ ПОЧТИ УСПЕЛ' : 'YOU ALMOST HAD IT') + '</b>'}\n${div}\n` +
        `${pair || (lang === 'ru' ? 'Сетап' : 'Setup')} ${lang === 'ru' ? 'отправлен' : 'sent'}: <b>${premium_time || (lang === 'ru' ? 'реальное время' : 'real-time')}</b>\n` +
        `${lang === 'ru' ? 'Твой алерт' : 'Your alert'}:   <code>+${delay_min} min ${lang === 'ru' ? 'задержка' : 'delay'}</code>\n${div}\n` +
        priceComp + resultLine +
        `${lang === 'ru' ? '15 минут стоили тебе входа.' : '15 minutes cost you the entry.'}\n` +
        `<b>Premium = ${lang === 'ru' ? 'реальное время. Всегда.' : 'real-time. Always.'}</b>\n\n` +
        `<a href="${APP_URL}/pay">${lang === 'ru' ? E.diamond + ' Убрать задержку' : E.diamond + ' Remove the delay'}</a>`
      );
    }

    // ══ SA SCORE ══════════════════════════════════════════════════
    if (type === 'sa_score') {
      const { score, label, fng, btcDom, mktChg } = data;
      const bar   = '█'.repeat(Math.round(score/10)) + '░'.repeat(10 - Math.round(score/10));
      const dot   = score >= 75 ? '🔴' : score >= 55 ? '🟡' : '🟢';

      await tgSend(chat_id,
        `${dot} ${E.sa + ' <b>' + (lang === 'ru' ? 'Осведомлённость о рынке' : 'Market Awareness') + '</b>'}\n${div}\n` +
        `<code>${bar}</code> <b>${score}/100</b>  ${label}\n${div}\n` +
        `F&G        <b>${fng}</b>\n` +
        `BTC Dom    <b>${btcDom}%</b>\n` +
        `${lang === 'ru' ? 'Рынок 24H' : 'Market 24H'} <b>${parseFloat(mktChg) >= 0 ? '+' : ''}${mktChg}%</b>\n\n` +
        `<a href="${APP_URL}/screener">${L(lang,'open_chart')}</a>`
      );
    }

    // ══ DAILY BRIEF (manual trigger) ══════════════════════════════
    if (type === 'daily') {
      const { date, fng_val, fng_label, market_cap, btc_dom, signal_quality, top_gainer, user_wr, user_trades, scanned, passed } = data;
      const statsLine = user_wr != null
        ? `\n${L(lang,'your_week')}  <b>${user_trades} ${lang === 'ru' ? 'сделок' : 'trades'}  ${user_wr}% WR</b>`
        : '';
      const filterLine = scanned > 0
        ? `\n<code>${L(lang, 'scanned', scanned, passed)}</code>`
        : '';

      await tgSend(chat_id,
        `${E.morning + ' <b>' + (lang === 'ru' ? 'Утренний брифинг' : 'Morning Brief') + '</b>'}  ${date || new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday:'short', day:'numeric', month:'short' })}\n${div}\n` +
        (market_cap ? `BTC  $${market_cap}  Dom ${btc_dom}%\n` : '') +
        (fng_val    ? `F&G  ${fng_val}  ${fng_label}\n` : '') +
        (top_gainer ? `${lang === 'ru' ? 'Топ 24H' : 'Top 24H'}  ${top_gainer}\n` : '') +
        statsLine + `\n${div}\n` +
        `${lang === 'ru' ? 'Сигнал-индекс' : 'Signal index'}: <b>${signal_quality}/10</b>` +
        filterLine + `\n\n` +
        `<a href="${APP_URL}/screener">${L(lang,'open_chart')} →</a>`
      );
    }

    // ══ RAW ═══════════════════════════════════════════════════════
    if (type === 'raw') {
      if (data?.text) await tgSend(chat_id, data.text);
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('[notify]', type, e.message);
    return res.status(500).json({ error: e.message });
  }
}
