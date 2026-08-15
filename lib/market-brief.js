const MSK_TIME_ZONE = 'Europe/Moscow';

function toNumber(value, fallback = null) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function formatPrice(value) {
  const price = toNumber(value);
  if (price == null) return '—';
  const digits = price >= 1_000 ? 0 : price >= 1 ? 2 : 6;
  return '$' + new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(price);
}

export function formatMoney(value) {
  const amount = toNumber(value);
  if (amount == null) return '—';
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (Math.abs(amount) >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

export function formatPct(value, digits = 2) {
  const number = toNumber(value);
  if (number == null) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}%`;
}

export function parseKlines(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      start: toNumber(row?.[0], 0),
      open: toNumber(row?.[1], 0),
      high: toNumber(row?.[2], 0),
      low: toNumber(row?.[3], 0),
      close: toNumber(row?.[4], 0),
      volume: toNumber(row?.[5], 0),
    }))
    .filter((candle) => candle.start && candle.high && candle.low && candle.close)
    .sort((a, b) => a.start - b.start);
}

export function ema(values, period) {
  const clean = values.map((value) => toNumber(value)).filter((value) => value != null);
  if (clean.length < period) return null;
  let result = clean.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  for (const value of clean.slice(period)) {
    result = (value - result) * multiplier + result;
  }
  return result;
}

export function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return trueRanges.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function completedCandles(candles, intervalMs, nowMs) {
  return candles.filter((candle) => candle.start + intervalMs <= nowMs);
}

function getSession(now) {
  const hour = now.getUTCHours();
  if (hour < 7) return { emoji: '🌏', label: 'азиатская' };
  if (hour < 13) return { emoji: '🇪🇺', label: 'европейская' };
  if (hour < 16) return { emoji: '⚡️', label: 'Европа / США' };
  if (hour < 21) return { emoji: '🇺🇸', label: 'американская' };
  return { emoji: '🌙', label: 'поздняя американская' };
}

function getMoscowStamp(now) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('day')} ${part('month')} · ${part('hour')}:${part('minute')} МСК`;
}

function getFearGreedLabel(value) {
  if (value == null) return 'данных нет';
  if (value >= 75) return 'крайняя жадность';
  if (value >= 55) return 'жадность';
  if (value >= 45) return 'нейтрально';
  if (value >= 25) return 'страх';
  return 'крайний страх';
}

function getTrend(price, ema20, ema50) {
  if (ema20 == null || ema50 == null) {
    return { key: 'unknown', label: 'данных недостаточно', emoji: '⚪️' };
  }
  if (price > ema20 && ema20 > ema50) {
    return { key: 'bullish', label: 'восходящий', emoji: '🟢' };
  }
  if (price < ema20 && ema20 < ema50) {
    return { key: 'bearish', label: 'нисходящий', emoji: '🔴' };
  }
  return { key: 'range', label: 'смешанный / диапазон', emoji: '🟡' };
}

function describeContext(trend, price, ema20, ema50) {
  if (trend.key === 'bullish') {
    return `Цена выше EMA20 и EMA50. Покупатель сохраняет преимущество, пока рынок удерживается выше ${formatPrice(ema20)}.`;
  }
  if (trend.key === 'bearish') {
    return `Цена ниже EMA20 и EMA50. Давление продавца сохраняется, пока рынок не вернётся выше ${formatPrice(ema20)}.`;
  }
  if (trend.key === 'range') {
    return `EMA20 и EMA50 не дают чистого направления. Рынок лучше читать от границ, а не из середины диапазона.`;
  }
  return `Текущая цена — ${formatPrice(price)}. Для подтверждения направления пока недостаточно истории.`;
}

function describeDerivatives(oiChangePct, priceChangePct, fundingPct) {
  let oiText = 'Открытый интерес существенно не изменился.';
  if (oiChangePct != null && oiChangePct >= 1 && priceChangePct >= 0) {
    oiText = 'Открытый интерес растёт вместе с ценой: в движение заходят новые позиции.';
  } else if (oiChangePct != null && oiChangePct >= 1 && priceChangePct < 0) {
    oiText = 'Открытый интерес растёт на снижении: давление продавца усиливается.';
  } else if (oiChangePct != null && oiChangePct <= -1) {
    oiText = 'Открытый интерес сокращается: часть позиций закрывается, импульс требует подтверждения.';
  }

  let fundingText = 'Funding близок к нейтральному.';
  if (fundingPct > 0.01) fundingText = 'Funding положительный: лонги платят шортам.';
  if (fundingPct < -0.01) fundingText = 'Funding отрицательный: шорты платят лонгам.';
  return `${oiText} ${fundingText}`;
}

function describeVolume(volumeRatio) {
  if (volumeRatio == null) return 'данных недостаточно';
  if (volumeRatio >= 1.3) return `повышенный · ${volumeRatio.toFixed(1)}× среднего`;
  if (volumeRatio <= 0.7) return `пониженный · ${volumeRatio.toFixed(1)}× среднего`;
  return `обычный · ${volumeRatio.toFixed(1)}× среднего`;
}

function selectOiChange(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const sorted = rows
    .map((row) => ({ timestamp: toNumber(row?.timestamp, 0), value: toNumber(row?.openInterest) }))
    .filter((row) => row.timestamp && row.value != null)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return null;
  const previous = sorted.at(-2).value;
  const current = sorted.at(-1).value;
  return previous ? ((current - previous) / previous) * 100 : null;
}

export function analyzeMarket({ symbol, ticker, dailyRows, openInterestRows = [], fearGreed = null, now = new Date() }) {
  const nowMs = now.getTime();
  const daily = completedCandles(parseKlines(dailyRows), 24 * 60 * 60 * 1000, nowMs);
  if (daily.length < 21) throw new Error('Недостаточно дневных свечей для расчёта обзора');

  const price = toNumber(ticker?.lastPrice);
  if (price == null) throw new Error('Bybit не вернул текущую цену');

  const previousDay = daily.at(-1);
  const previousVolumeWindow = daily.slice(-21, -1);
  const averageVolume = previousVolumeWindow.reduce((sum, candle) => sum + candle.volume, 0) / previousVolumeWindow.length;
  const volumeRatio = averageVolume ? previousDay.volume / averageVolume : null;
  const rolling20 = daily.slice(-20);
  const high20 = Math.max(...rolling20.map((candle) => candle.high));
  const low20 = Math.min(...rolling20.map((candle) => candle.low));
  const closeValues = daily.map((candle) => candle.close);
  const ema20 = ema(closeValues, 20);
  const ema50 = ema(closeValues, 50);
  const atr14 = atr(daily, 14);
  const trend = getTrend(price, ema20, ema50);
  const change24Pct = toNumber(ticker?.price24hPcnt, 0) * 100;
  const fundingPct = toNumber(ticker?.fundingRate, 0) * 100;
  const oiChangePct = selectOiChange(openInterestRows);
  const previousRange = previousDay.high - previousDay.low;
  const rangePosition = previousRange ? (price - previousDay.low) / previousRange : 0.5;

  const fallbackLongTarget = previousDay.high + (atr14 || previousRange) * 0.75;
  const longCandidates = [fallbackLongTarget, high20]
    .filter((level) => level > Math.max(price, previousDay.high));
  const longTarget = longCandidates.length
    ? Math.min(...longCandidates)
    : Math.max(price, previousDay.high) + (atr14 || previousRange) * 0.75;

  const fallbackShortTarget = Math.max(0, previousDay.low - (atr14 || previousRange) * 0.75);
  const shortCandidates = [fallbackShortTarget, low20]
    .filter((level) => level < Math.min(price, previousDay.low));
  const shortTarget = shortCandidates.length
    ? Math.max(...shortCandidates)
    : Math.max(0, Math.min(price, previousDay.low) - (atr14 || previousRange) * 0.75);

  let decision = `Рабочая зона сейчас — между ${formatPrice(previousDay.low)} и ${formatPrice(previousDay.high)}.`;
  if (rangePosition >= 0.35 && rangePosition <= 0.65) {
    decision = 'Цена находится в средней части вчерашнего диапазона. Здесь хуже соотношение риска к потенциалу — лучше ждать подхода к границе.';
  } else if (price > previousDay.high) {
    decision = `Цена вышла выше максимума прошлого дня. Важен не сам пробой, а удержание ${formatPrice(previousDay.high)} после возврата.`;
  } else if (price < previousDay.low) {
    decision = `Цена ниже минимума прошлого дня. Продолжение требует принятия цены под ${formatPrice(previousDay.low)}.`;
  }

  return {
    symbol: symbol.replace('USDT', ''),
    now,
    stamp: getMoscowStamp(now),
    session: getSession(now),
    price,
    change24Pct,
    high24: toNumber(ticker?.highPrice24h),
    low24: toNumber(ticker?.lowPrice24h),
    turnover24h: toNumber(ticker?.turnover24h),
    openInterestValue: toNumber(ticker?.openInterestValue),
    oiChangePct,
    fundingPct,
    fearGreed: toNumber(fearGreed),
    fearGreedLabel: getFearGreedLabel(toNumber(fearGreed)),
    trend,
    context: describeContext(trend, price, ema20, ema50),
    derivatives: describeDerivatives(oiChangePct, change24Pct, fundingPct),
    volumeLabel: describeVolume(volumeRatio),
    atrPct: atr14 ? (atr14 / price) * 100 : null,
    previousHigh: previousDay.high,
    previousLow: previousDay.low,
    high20,
    low20,
    longTarget,
    shortTarget,
    decision,
    economicEvents: [],
    calendarAvailable: false,
  };
}

export function attachEconomicCalendar(analysis, events, calendarAvailable = true) {
  const importantEvents = (Array.isArray(events) ? events : [])
    .filter((event) => ['high', 'medium'].includes(event?.impact))
    .filter((event) => ['USD', 'US', '—'].includes(String(event?.country || '').toUpperCase()))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(0, 3);
  return { ...analysis, economicEvents: importantEvents, calendarAvailable };
}

function formatEventTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'время не указано';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(Number(timestamp)));
}

function translateEventTitle(title) {
  const original = String(title || 'Экономическое событие');
  const normalized = original.toLowerCase();
  const translations = [
    [/nonfarm|non-farm|nfp/, 'Количество занятых вне сельского хозяйства (NFP)'],
    [/consumer price|\bcpi\b/, 'Индекс потребительских цен (CPI)'],
    [/producer price|\bppi\b/, 'Индекс цен производителей (PPI)'],
    [/fomc.*rate|federal funds rate|interest rate decision/, 'Решение ФРС по ставке'],
    [/fomc.*minute/, 'Протокол заседания FOMC'],
    [/powell/, 'Выступление главы ФРС Пауэлла'],
    [/gross domestic product|\bgdp\b/, 'ВВП США'],
    [/unemployment rate/, 'Уровень безработицы в США'],
    [/jobless claims|unemployment claims/, 'Заявки на пособие по безработице'],
    [/retail sales/, 'Розничные продажи в США'],
    [/\bpce\b|personal consumption expenditures/, 'Индекс расходов на личное потребление (PCE)'],
  ];
  return translations.find(([pattern]) => pattern.test(normalized))?.[1] || original;
}

function buildCalendarBlock(analysis) {
  if (!analysis.calendarAvailable) {
    return 'Календарь временно недоступен — перед входом проверьте время публикации данных по США.';
  }
  if (!analysis.economicEvents?.length) {
    return 'Значимых событий по США на сегодня не найдено.';
  }
  return analysis.economicEvents.map((event) => {
    const marker = event.impact === 'high' ? '🔴' : '🟠';
    return `${marker} ${formatEventTime(event.timestamp)} МСК · ${escapeHtml(translateEventTitle(event.title))}`;
  }).join('\n');
}

export function buildChannelMessage(analysis) {
  const symbol = escapeHtml(analysis.symbol);
  const fearGreed = analysis.fearGreed == null
    ? '—'
    : `${analysis.fearGreed}/100 · ${analysis.fearGreedLabel}`;
  const oiChange = analysis.oiChangePct == null ? '—' : formatPct(analysis.oiChangePct);

  return (
    `👁 <b>EYE Eternity</b>\n` +
    `📊 <b>ЕЖЕДНЕВНЫЙ ОБЗОР — ${symbol}</b>\n` +
    `<code>${escapeHtml(analysis.stamp)}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 <b>Рынок сейчас</b>\n` +
    `Цена · <b>${formatPrice(analysis.price)}</b>  ${formatPct(analysis.change24Pct)}\n` +
    `24ч диапазон · ${formatPrice(analysis.low24)} — ${formatPrice(analysis.high24)}\n` +
    `Оборот · ${formatMoney(analysis.turnover24h)}\n` +
    `Сессия · ${analysis.session.emoji} ${escapeHtml(analysis.session.label)}\n\n` +
    `🧭 <b>Контекст</b>\n` +
    `${analysis.trend.emoji} Дневной контекст · <b>${escapeHtml(analysis.trend.label)}</b>\n` +
    `${escapeHtml(analysis.context)}\n\n` +
    `📍 <b>Ключевые уровни</b>\n` +
    `Максимум вчера · <b>${formatPrice(analysis.previousHigh)}</b>\n` +
    `Минимум вчера · <b>${formatPrice(analysis.previousLow)}</b>\n` +
    `Границы 20 дней · ${formatPrice(analysis.low20)} — ${formatPrice(analysis.high20)}\n\n` +
    `📦 <b>Объём и деривативы</b>\n` +
    `Объём · ${escapeHtml(analysis.volumeLabel)}\n` +
    `ATR · ${formatPct(analysis.atrPct)} от цены\n` +
    `Открытый интерес · ${formatMoney(analysis.openInterestValue)}  ${oiChange}\n` +
    `Funding · ${formatPct(analysis.fundingPct, 3)}\n` +
    `Настроение · ${escapeHtml(fearGreed)}\n` +
    `<i>${escapeHtml(analysis.derivatives)}</i>\n\n` +
    `🗓 <b>События дня</b>\n` +
    `${buildCalendarBlock(analysis)}\n\n` +
    `🟢 <b>Сценарий вверх</b>\n` +
    `Закрепление выше ${formatPrice(analysis.previousHigh)} и удержание уровня после возврата. Следующая зона внимания — ${formatPrice(analysis.longTarget)}.\n\n` +
    `🔴 <b>Сценарий вниз</b>\n` +
    `Принятие цены ниже ${formatPrice(analysis.previousLow)}. Следующая зона внимания — ${formatPrice(analysis.shortTarget)}.\n\n` +
    `⚠️ <b>Что важно сегодня</b>\n` +
    `${escapeHtml(analysis.decision)}\n\n` +
    `<i>Это сценарий работы с рынком, а не команда на вход.</i>`
  );
}

export function buildChatMessage(analysis) {
  const eventLine = analysis.economicEvents?.[0]
    ? `\n🗓 ${formatEventTime(analysis.economicEvents[0].timestamp)} МСК · ${escapeHtml(translateEventTitle(analysis.economicEvents[0].title))}\n`
    : '';
  return (
    `👁 <b>EYE Eternity</b>\n` +
    `🗣 <b>${escapeHtml(analysis.symbol)}: сценарий на день</b>\n\n` +
    `${analysis.trend.emoji} Контекст · <b>${escapeHtml(analysis.trend.label)}</b>\n` +
    `Цена · <b>${formatPrice(analysis.price)}</b>  ${formatPct(analysis.change24Pct)}\n\n` +
    `🟢 Выше ${formatPrice(analysis.previousHigh)} — смотрим на удержание уровня.\n` +
    `🔴 Ниже ${formatPrice(analysis.previousLow)} — смотрим на принятие цены.\n\n` +
    `⚠️ ${escapeHtml(analysis.decision)}\n` +
    eventLine + `\n` +
    `<b>Какой сценарий рассматриваете на сегодня?</b>`
  );
}
