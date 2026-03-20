// api/alerts.js — проверка алертов (cron каждые 5 мин)
// v2 — расширенные типы: price, volume, change%, rsi, pump, dump, volatility

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = process.env.APP_URL || 'https://orbitum.trade';

// ── Helpers ───────────────────────────────────────────────────────

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtVol(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function nowStr() {
  return new Date().toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
}

async function tgSend(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch(e) { console.error('TG error:', e.message); }
}

// Строим богатое TG-сообщение для алерта
function buildAlertMessage(alert, priceData, extraData = {}) {
  const sym = (alert.symbol || '?').toUpperCase();
  const type = alert.alert_type || 'price';
  const cond = alert.condition || 'above';
  const current = priceData.usd;
  const change24 = priceData.usd_24h_change ?? null;
  const vol24    = priceData.usd_24h_vol   ?? null;

  // ── заголовок ──────────────────────────────────────────────────
  const HEADERS = {
    price:       cond === 'above' ? '📈 Пробой вверх'        : '📉 Пробой вниз',
    price_cross: '↔️ Пересечение уровня',
    volume:      '📊 Всплеск объёма',
    change:      parseFloat(extraData.change_pct) >= 0 ? '⚡ Резкий рост' : '⚡ Резкое падение',
    rsi_ob:      '🔴 RSI: перекупленность',
    rsi_os:      '🟢 RSI: перепроданность',
    pump:        '🚀 Памп',
    dump:        '💣 Дамп',
    volatility:  '🌊 Высокая волатильность',
  };

  const DOTS = {
    price:       cond === 'above' ? '🟢' : '🔴',
    price_cross: '🔵',
    volume:      '🔵',
    change:      parseFloat(extraData.change_pct) >= 0 ? '🟢' : '🔴',
    rsi_ob:      '🔴',
    rsi_os:      '🟢',
    pump:        '🟢',
    dump:        '🔴',
    volatility:  '🟡',
  };

  const header = HEADERS[type] || '🔔 Алерт';
  const dot    = DOTS[type]    || '⚪';

  const lines = [];
  lines.push(`${dot} <b>ORBITUM · ${sym}/USDT</b>`);
  lines.push(`<b>${header}</b>`);
  lines.push('━━━━━━━━━━━━━━━━━━━');

  // Цена
  const chgStr = change24 != null ? `  <i>${fmtPct(change24)} 24ч</i>` : '';
  lines.push(`💰 Цена:      <b>${fmtPrice(current)}</b>${chgStr}`);

  // Целевой уровень (price/price_cross)
  if (alert.target_price && ['price','price_cross'].includes(type)) {
    const diff = ((current - parseFloat(alert.target_price)) / parseFloat(alert.target_price) * 100).toFixed(2);
    lines.push(`🎯 Уровень:   <b>${fmtPrice(alert.target_price)}</b>  <i>(${diff >= 0 ? '+' : ''}${diff}%)</i>`);
  }

  // Объём
  if (vol24 != null) {
    const ratioStr = extraData.vol_ratio != null ? `  <i>×${parseFloat(extraData.vol_ratio).toFixed(1)} от среднего</i>` : '';
    lines.push(`📊 Объём 24ч: <b>${fmtVol(vol24)}</b>${ratioStr}`);
  }

  // RSI
  if (extraData.rsi != null) {
    const rsiVal = Math.round(extraData.rsi);
    const rsiNote = rsiVal >= 70 ? ' ⚠️ перекупл.' : rsiVal <= 30 ? ' ⚠️ перепродан' : '';
    lines.push(`📈 RSI (14):  <b>${rsiVal}</b>${rsiNote}`);
  }

  // Изменение за период (change-алерт)
  if (extraData.change_pct != null && type === 'change') {
    const win = alert.change_window ? ` за ${alert.change_window} мин` : '';
    lines.push(`⚡ Движение:  <b>${fmtPct(extraData.change_pct)}</b>${win}`);
  }

  // Амплитуда (volatility)
  if (extraData.amplitude != null && type === 'volatility') {
    lines.push(`🌊 Амплитуда: <b>${fmtPct(extraData.amplitude)}</b>`);
  }

  lines.push(`⏱ Время:      <b>${nowStr()}</b>`);

  if (alert.note) {
    lines.push('');
    lines.push(`💬 <i>${alert.note}</i>`);
  }

  const repeatLabel = { once: '', every: '🔁 Повторный алерт', daily: '📅 Ежедневный' }[alert.repeat_mode] || '';
  if (repeatLabel) lines.push(repeatLabel);

  lines.push('');
  lines.push(`<a href="${APP_URL}">🔗 Открыть в Orbitum</a>`);

  return lines.join('\n');
}

// Рассчитывает RSI по массиву цен (period = 14)
function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── Проверка условий алертов ──────────────────────────────────────

function checkAlert(alert, priceData, history) {
  const current = priceData.usd;
  const change24 = priceData.usd_24h_change ?? 0;
  const vol24    = priceData.usd_24h_vol    ?? 0;
  const type = alert.alert_type || 'price';
  const cond = alert.condition  || 'above';

  const extraData = {};

  switch (type) {

    // ── Цена выше/ниже уровня ─────────────────────────────────────
    case 'price': {
      const target = parseFloat(alert.target_price);
      const prev   = parseFloat(alert.last_price ?? (cond === 'above' ? target - 1 : target + 1));
      if (cond === 'above' && prev < target && current >= target) return { fired: true, extraData };
      if (cond === 'below' && prev > target && current <= target) return { fired: true, extraData };
      return { fired: false };
    }

    // ── Пересечение уровня (в любую сторону) ──────────────────────
    case 'price_cross': {
      const target = parseFloat(alert.target_price);
      const prev   = parseFloat(alert.last_price);
      if (prev == null) return { fired: false };
      const crossed = (prev < target && current >= target) || (prev > target && current <= target);
      return { fired: crossed, extraData };
    }

    // ── Всплеск объёма (объём > N × средний за 7 дней) ───────────
    case 'volume': {
      const threshold = parseFloat(alert.volume_multiplier ?? alert.target_value ?? 2);
      // vol_avg_7d хранится в алерте при создании
      const avgVol = parseFloat(alert.vol_avg_7d ?? 0);
      if (!avgVol) return { fired: false };
      const ratio = vol24 / avgVol;
      extraData.vol_ratio = ratio;
      return { fired: ratio >= threshold, extraData };
    }

    // ── % изменение за период ─────────────────────────────────────
    case 'change': {
      // change_window в минутах, threshold в %
      const threshold = parseFloat(alert.change_threshold ?? alert.target_value ?? 3);
      const prices = history?.prices ?? [];
      if (prices.length < 2) {
        // Fallback: 24h change
        extraData.change_pct = change24;
        return { fired: Math.abs(change24) >= threshold, extraData };
      }
      const first = prices[0];
      const last  = prices[prices.length - 1];
      const pct   = ((last - first) / first) * 100;
      extraData.change_pct = pct;
      const dir = alert.condition === 'above' ? pct >= threshold : alert.condition === 'below' ? pct <= -threshold : Math.abs(pct) >= threshold;
      return { fired: dir, extraData };
    }

    // ── RSI перекупленность ───────────────────────────────────────
    case 'rsi_ob': {
      const threshold = parseFloat(alert.rsi_threshold ?? 70);
      const prices = history?.closes ?? [];
      const rsi = calcRSI(prices);
      if (rsi == null) return { fired: false };
      extraData.rsi = rsi;
      return { fired: rsi >= threshold, extraData };
    }

    // ── RSI перепроданность ───────────────────────────────────────
    case 'rsi_os': {
      const threshold = parseFloat(alert.rsi_threshold ?? 30);
      const prices = history?.closes ?? [];
      const rsi = calcRSI(prices);
      if (rsi == null) return { fired: false };
      extraData.rsi = rsi;
      return { fired: rsi <= threshold, extraData };
    }

    // ── Памп (большой рост за 24ч) ────────────────────────────────
    case 'pump': {
      const threshold = parseFloat(alert.change_threshold ?? alert.target_value ?? 10);
      extraData.change_pct = change24;
      return { fired: change24 >= threshold, extraData };
    }

    // ── Дамп (большое падение за 24ч) ────────────────────────────
    case 'dump': {
      const threshold = parseFloat(alert.change_threshold ?? alert.target_value ?? 10);
      extraData.change_pct = change24;
      return { fired: change24 <= -threshold, extraData };
    }

    // ── Волатильность (амплитуда high-low за 24ч) ─────────────────
    case 'volatility': {
      const threshold = parseFloat(alert.change_threshold ?? alert.target_value ?? 8);
      const high = priceData.usd_24h_high ?? current;
      const low  = priceData.usd_24h_low  ?? current;
      const amplitude = ((high - low) / low) * 100;
      extraData.amplitude = amplitude;
      return { fired: amplitude >= threshold, extraData };
    }

    default:
      return { fired: false };
  }
}

// ── MAIN ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Все активные алерты
    const r = await fetch(
      `${SB_URL}/rest/v1/price_alerts?select=*,profiles(tg_chat_id,tg_linked,tg_notify_alerts)&triggered=is.false`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const alerts = await r.json();
    if (!Array.isArray(alerts) || !alerts.length) {
      return res.status(200).json({ checked: 0, triggered: 0 });
    }

    // Уникальные CoinGecko IDs
    const ids = [...new Set(alerts.map(a => a.coingecko_id).filter(Boolean))];
    if (!ids.length) return res.status(200).json({ checked: 0, triggered: 0 });

    // Цены (+ high/low для волатильности)
    let prices = {};
    try {
      const pr = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd` +
        `&include_24hr_change=true&include_24hr_vol=true&include_24hr_high=true&include_24hr_low=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!pr.ok) throw new Error('CoinGecko HTTP ' + pr.status);
      prices = await pr.json();
    } catch(e) {
      console.error('Price fetch failed:', e.message);
      return res.status(200).json({ error: 'price fetch failed', detail: e.message });
    }

    // История цен для RSI/change алертов (нужна только если такие есть)
    const needHistory = alerts.some(a => ['rsi_ob','rsi_os','change'].includes(a.alert_type));
    const histories = {};
    if (needHistory) {
      const histIds = [...new Set(alerts
        .filter(a => ['rsi_ob','rsi_os','change'].includes(a.alert_type))
        .map(a => a.coingecko_id)
      )];
      await Promise.allSettled(histIds.map(async cgId => {
        try {
          const hr = await fetch(
            `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=1&interval=hourly`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (!hr.ok) return;
          const hd = await hr.json();
          const closes = (hd.prices || []).map(p => p[1]);
          histories[cgId] = { closes, prices: closes };
        } catch(e) { /* ignore */ }
      }));
    }

    const triggeredIds = [];

    for (const alert of alerts) {
      const p = alert.profiles;
      if (!p?.tg_linked || !p?.tg_chat_id || !p?.tg_notify_alerts) continue;

      const priceData = prices[alert.coingecko_id];
      if (!priceData?.usd) continue;

      // Cooldown для repeat алертов (не чаще чем раз в 30 мин)
      if (alert.repeat_mode !== 'once' && alert.triggered_at) {
        const lastFired = new Date(alert.triggered_at).getTime();
        const cooldownMs = alert.repeat_mode === 'daily' ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
        if (Date.now() - lastFired < cooldownMs) continue;
      }

      const history = histories[alert.coingecko_id] || null;
      const { fired, extraData } = checkAlert(alert, priceData, history);
      if (!fired) continue;

      const msg = buildAlertMessage(alert, priceData, extraData);
      await tgSend(p.tg_chat_id, msg);
      triggeredIds.push(alert.id);
    }

    // Обновляем статус сработавших алертов
    if (triggeredIds.length) {
      const onceIds   = triggeredIds.filter(id => alerts.find(a => a.id === id)?.repeat_mode !== 'every' && alerts.find(a => a.id === id)?.repeat_mode !== 'daily');
      const repeatIds = triggeredIds.filter(id => {
        const a = alerts.find(x => x.id === id);
        return a?.repeat_mode === 'every' || a?.repeat_mode === 'daily';
      });

      if (onceIds.length) {
        await fetch(`${SB_URL}/rest/v1/price_alerts?id=in.(${onceIds.join(',')})`, {
          method: 'PATCH',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ triggered: true, triggered_at: new Date().toISOString() }),
        });
      }
      if (repeatIds.length) {
        await fetch(`${SB_URL}/rest/v1/price_alerts?id=in.(${repeatIds.join(',')})`, {
          method: 'PATCH',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ triggered: false, triggered_at: new Date().toISOString() }),
        });
      }
    }

    // Обновляем last_price для всех проверенных
    for (const alert of alerts) {
      const cur = prices[alert.coingecko_id]?.usd;
      if (!cur) continue;
      fetch(`${SB_URL}/rest/v1/price_alerts?id=eq.${alert.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ last_price: cur }),
      }).catch(() => {});
    }

    console.log(`[alerts] checked=${alerts.length} triggered=${triggeredIds.length}`);
    return res.status(200).json({ checked: alerts.length, triggered: triggeredIds.length });

  } catch(e) {
    console.error('Alerts error:', e);
    return res.status(500).json({ error: e.message });
  }
}
