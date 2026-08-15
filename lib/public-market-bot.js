const BYBIT_API = 'https://api.bybit.com';
const COINBASE_API = 'https://api.exchange.coinbase.com';
const QUICKCHART_API = 'https://quickchart.io/chart';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const TIMEFRAMES = {
  '5m': { bybit: '5', coinbase: 300, label: '5 минут', unit: 'minute' },
  '15m': { bybit: '15', coinbase: 900, label: '15 минут', unit: 'hour' },
  '1h': { bybit: '60', coinbase: 3600, label: '1 час', unit: 'hour' },
  '4h': { bybit: '240', coinbase: 3600, aggregate: 4, label: '4 часа', unit: 'day' },
  '1d': { bybit: 'D', coinbase: 86400, label: '1 день', unit: 'day' },
};

export function normalizeSymbol(value = 'BTC') {
  const raw = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9/_-]+$/.test(raw)) return null;
  const normalized = raw
    .replace(/(?:\/|-)?(?:USDT|USDC|USD)$/i, '')
    .replace(/[^A-Z0-9]/g, '');
  const symbol = normalized === 'XBT' ? 'BTC' : normalized;
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) return null;
  return symbol;
}

export function normalizeTimeframe(value = '1h') {
  const aliases = {
    '5': '5m', '5m': '5m', '5м': '5m',
    '15': '15m', '15m': '15m', '15м': '15m',
    '60': '1h', '1h': '1h', '1ч': '1h',
    '240': '4h', '4h': '4h', '4ч': '4h',
    d: '1d', '1d': '1d', '1д': '1d', 'день': '1d',
  };
  return aliases[String(value).trim().toLowerCase()] || null;
}

async function fetchJson(url, timeoutMs = 9_000) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'EYE-Eternity-Bot/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return payload;
}

function validCandle(candle) {
  return ['x', 'o', 'h', 'l', 'c'].every((key) => Number.isFinite(candle[key]));
}

export function aggregateCandles(candles, size = 1) {
  if (size <= 1) return candles;
  const result = [];
  for (let index = 0; index < candles.length; index += size) {
    const group = candles.slice(index, index + size);
    if (group.length < size) continue;
    result.push({
      x: group[0].x,
      o: group[0].o,
      h: Math.max(...group.map((item) => item.h)),
      l: Math.min(...group.map((item) => item.l)),
      c: group[group.length - 1].c,
      v: group.reduce((sum, item) => sum + (item.v || 0), 0),
    });
  }
  return result;
}

async function fetchBybitCandles(symbol, timeframe) {
  const config = TIMEFRAMES[timeframe];
  const url = new URL('/v5/market/kline', BYBIT_API);
  url.searchParams.set('category', 'linear');
  url.searchParams.set('symbol', `${symbol}USDT`);
  url.searchParams.set('interval', config.bybit);
  url.searchParams.set('limit', '100');
  const payload = await fetchJson(url.toString());
  if (payload?.retCode !== 0) throw new Error(payload?.retMsg || 'Bybit не вернул свечи');
  const candles = (payload?.result?.list || []).map((row) => ({
    x: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  })).filter(validCandle).sort((a, b) => a.x - b.x);
  if (candles.length < 20) throw new Error('Недостаточно свечей');
  return { candles, source: 'Bybit', quote: 'USDT' };
}

async function fetchCoinbaseCandles(symbol, timeframe) {
  const config = TIMEFRAMES[timeframe];
  const url = new URL(`/products/${symbol}-USD/candles`, COINBASE_API);
  url.searchParams.set('granularity', String(config.coinbase));
  const rows = await fetchJson(url.toString());
  if (!Array.isArray(rows)) throw new Error('Coinbase не вернул свечи');
  let candles = rows.map((row) => ({
    x: Number(row[0]) * 1000,
    l: Number(row[1]),
    h: Number(row[2]),
    o: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  })).filter(validCandle).sort((a, b) => a.x - b.x);
  candles = aggregateCandles(candles, config.aggregate || 1).slice(-100);
  if (candles.length < 20) throw new Error('Недостаточно свечей');
  return { candles, source: 'Coinbase', quote: 'USD' };
}

export async function getCandles(symbol, timeframe) {
  let firstError;
  try {
    return await fetchBybitCandles(symbol, timeframe);
  } catch (error) {
    firstError = error;
  }
  try {
    return await fetchCoinbaseCandles(symbol, timeframe);
  } catch (error) {
    throw new Error(`Пара ${symbol}/USDT не найдена или временно недоступна (${firstError?.message}; ${error.message})`);
  }
}

export function summarizeCandles(candles) {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const changePct = first?.o ? ((last.c - first.o) / first.o) * 100 : 0;
  const high = Math.max(...candles.map((item) => item.h));
  const low = Math.min(...candles.map((item) => item.l));
  return { price: last.c, changePct, high, low };
}

export function buildChartConfig(symbol, timeframe, candles) {
  const timeframeConfig = TIMEFRAMES[timeframe];
  return {
    type: 'candlestick',
    data: {
      datasets: [{
        label: `${symbol}/USDT`,
        data: candles.slice(-80),
        color: { up: '#20c997', down: '#ff5c7a', unchanged: '#94a3b8' },
        borderColor: { up: '#20c997', down: '#ff5c7a', unchanged: '#94a3b8' },
      }],
    },
    options: {
      parsing: false,
      animation: false,
      layout: { padding: { left: 18, right: 24, top: 8, bottom: 12 } },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `EYE Eternity  ·  ${symbol}/USDT  ·  ${timeframeConfig.label}`,
          color: '#f8fafc',
          font: { size: 22, weight: 'bold' },
          padding: { top: 14, bottom: 20 },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: timeframeConfig.unit },
          grid: { color: 'rgba(148,163,184,0.10)' },
          ticks: { color: '#94a3b8', maxTicksLimit: 9 },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(148,163,184,0.12)' },
          ticks: { color: '#cbd5e1', maxTicksLimit: 8 },
        },
      },
    },
  };
}

export async function renderChartPng(symbol, timeframe, candles) {
  const response = await fetch(QUICKCHART_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '4',
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
      format: 'png',
      backgroundColor: '#0b1020',
      chart: buildChartConfig(symbol, timeframe, candles),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Не удалось отрисовать график: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10_000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (value >= 100) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(5)}`;
}

export function buildChartCaption(symbol, timeframe, candles, source) {
  const summary = summarizeCandles(candles);
  const direction = summary.changePct >= 0 ? '🟢' : '🔴';
  return (
    `👁 <b>EYE Eternity</b> · <b>${escapeHtml(symbol)}/USDT</b>\n` +
    `⏱ Таймфрейм · <b>${TIMEFRAMES[timeframe].label}</b>\n\n` +
    `💰 Цена · <b>${formatPrice(summary.price)}</b>\n` +
    `${direction} Изменение на графике · <b>${summary.changePct >= 0 ? '+' : ''}${summary.changePct.toFixed(2)}%</b>\n` +
    `↕️ Диапазон · ${formatPrice(summary.low)} — ${formatPrice(summary.high)}\n\n` +
    `<i>Источник котировок: ${escapeHtml(source)}. Не является торговой рекомендацией.</i>`
  );
}

export async function getFearAndMarket() {
  const [globalResult, fearResult] = await Promise.allSettled([
    fetchJson('https://api.coingecko.com/api/v3/global', 7_000),
    fetchJson('https://api.alternative.me/fng/?limit=1', 7_000),
  ]);
  const global = globalResult.status === 'fulfilled' ? globalResult.value?.data : null;
  const fear = fearResult.status === 'fulfilled' ? fearResult.value?.data?.[0] : null;
  return {
    fearValue: Number(fear?.value),
    fearLabel: fear?.value_classification || null,
    btcDominance: Number(global?.market_cap_percentage?.btc),
    marketCap: Number(global?.total_market_cap?.usd),
    marketChangePct: Number(global?.market_cap_change_percentage_24h_usd),
  };
}

export async function getMarketLeaders() {
  const rows = await fetchJson(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h',
    9_000,
  );
  const valid = (Array.isArray(rows) ? rows : []).filter((coin) => Number.isFinite(coin.price_change_percentage_24h));
  return {
    gainers: [...valid].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 5),
    losers: [...valid].sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h).slice(0, 5),
  };
}

export function getTradingSession(now = new Date()) {
  const hour = now.getUTCHours();
  if (hour >= 0 && hour < 7) return { name: 'Азиатская', emoji: '🌏', note: 'Чаще формируется диапазон и ликвидность для следующих сессий.' };
  if (hour >= 7 && hour < 12) return { name: 'Лондонская', emoji: '🇬🇧', note: 'Растёт ликвидность; часто появляется первое направленное движение дня.' };
  if (hour >= 12 && hour < 16) return { name: 'Пересечение Лондона и Нью-Йорка', emoji: '⚡', note: 'Самое ликвидное окно дня. Повышается вероятность импульсов и ложных выносов.' };
  if (hour >= 16 && hour < 21) return { name: 'Нью-Йоркская', emoji: '🇺🇸', note: 'Американский поток определяет, удержится ли дневное движение.' };
  return { name: 'Поздняя американская', emoji: '🌙', note: 'Ликвидность снижается; новые позиции требуют особенно строгого отбора.' };
}
