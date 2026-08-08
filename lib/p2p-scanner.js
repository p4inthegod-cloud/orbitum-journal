const WALLET_P2P_URL = 'https://p2p.walletbot.me/p2p/integration-api/v1/item/online';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function paymentNames(payments) {
  return (Array.isArray(payments) ? payments : [])
    .map((payment) => {
      if (typeof payment === 'string') return payment;
      return payment?.name || payment?.code || payment?.title || '';
    })
    .map((payment) => text(payment).toLowerCase())
    .filter(Boolean);
}

function executionRate(value) {
  const rate = number(value);
  return rate > 0 && rate <= 1 ? rate * 100 : rate;
}

export function getP2PConfig(env = process.env, overrides = {}) {
  const paymentMethods = text(overrides.paymentMethods ?? env.P2P_PAYMENT_METHODS)
    .split(',')
    .map((method) => method.trim().toLowerCase())
    .filter(Boolean);

  return {
    apiKey: text(overrides.apiKey ?? env.P2P_WALLET_API_KEY),
    cryptoCurrency: text(overrides.cryptoCurrency ?? env.P2P_CRYPTO, 'USDT').toUpperCase(),
    fiatCurrency: text(overrides.fiatCurrency ?? env.P2P_FIAT, 'RUB').toUpperCase(),
    side: text(overrides.side ?? env.P2P_SIDE, 'SELL').toUpperCase(),
    fiatAmount: Math.max(0, number(overrides.fiatAmount ?? env.P2P_FIAT_AMOUNT, 2000)),
    minDiscountPct: Math.max(0, number(overrides.minDiscountPct ?? env.P2P_MIN_DISCOUNT_PCT, 0.5)),
    minExecutionRate: Math.max(0, number(overrides.minExecutionRate ?? env.P2P_MIN_EXECUTION_RATE, 95)),
    minOrders: Math.max(0, number(overrides.minOrders ?? env.P2P_MIN_ORDERS, 20)),
    paymentMethods,
    pageSize: Math.min(50, Math.max(10, number(overrides.pageSize ?? env.P2P_PAGE_SIZE, 50))),
  };
}

export function analyzeP2PAds(rawAds, config) {
  const ads = (Array.isArray(rawAds) ? rawAds : [])
    .map((ad) => {
      const price = number(ad.price);
      const minAmount = number(ad.minAmount);
      const maxAmount = number(ad.maxAmount, Number.POSITIVE_INFINITY);
      const availableCrypto = number(ad.lastQuantity);
      const payments = paymentNames(ad.payments);

      return {
        id: text(ad.id || ad.number),
        number: text(ad.number),
        nickname: text(ad.nickname, 'Без имени'),
        price,
        minAmount,
        maxAmount,
        availableCrypto,
        availableFiat: availableCrypto * price,
        payments,
        orders: number(ad.orderNum),
        executeRate: executionRate(ad.executeRate),
        merchantLevel: text(ad.merchantLevel),
        paymentPeriod: number(ad.paymentPeriod),
        isAutoAccept: Boolean(ad.isAutoAccept),
        isOnline: ad.isOnline !== false,
      };
    })
    .filter((ad) => ad.id && ad.price > 0 && ad.isOnline)
    .filter((ad) => config.fiatAmount <= 0 || (
      config.fiatAmount >= ad.minAmount &&
      config.fiatAmount <= ad.maxAmount &&
      (ad.availableFiat <= 0 || config.fiatAmount <= ad.availableFiat)
    ))
    .filter((ad) => ad.executeRate >= config.minExecutionRate)
    .filter((ad) => ad.orders >= config.minOrders)
    .filter((ad) => !config.paymentMethods.length ||
      config.paymentMethods.some((wanted) =>
        ad.payments.some((actual) => actual.includes(wanted) || wanted.includes(actual))
      )
    );

  const referencePrice = median(ads.map((ad) => ad.price));
  const ranked = ads
    .map((ad) => ({
      ...ad,
      discountPct: referencePrice > 0
        ? ((referencePrice - ad.price) / referencePrice) * 100
        : 0,
    }))
    .sort((a, b) => a.price - b.price || b.executeRate - a.executeRate);

  return {
    referencePrice,
    offers: ranked,
    best: ranked[0] || null,
    qualifying: ranked.filter((ad) => ad.discountPct >= config.minDiscountPct),
  };
}

export async function scanWalletP2P(overrides = {}, dependencies = {}) {
  const config = getP2PConfig(dependencies.env || process.env, overrides);
  if (!config.apiKey) throw new Error('P2P_WALLET_API_KEY is not configured');
  if (!['BUY', 'SELL'].includes(config.side)) throw new Error('P2P_SIDE must be BUY or SELL');

  const fetchImpl = dependencies.fetch || fetch;
  const response = await fetchImpl(WALLET_P2P_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify({
      cryptoCurrency: config.cryptoCurrency,
      fiatCurrency: config.fiatCurrency,
      side: config.side,
      page: 1,
      pageSize: config.pageSize,
    }),
    signal: AbortSignal.timeout(9000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === 'ERROR') {
    const reason = payload?.message || payload?.error || `Wallet P2P API: HTTP ${response.status}`;
    throw new Error(reason);
  }

  return {
    config,
    ...analyzeP2PAds(payload?.data, config),
    scanned: Array.isArray(payload?.data) ? payload.data.length : 0,
    scannedAt: new Date().toISOString(),
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatNumber(value, maxDigits = 2) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: maxDigits });
}

export function formatP2PMessage(scan, options = {}) {
  const { config, best, referencePrice, scanned, offers } = scan;
  const automatic = Boolean(options.automatic);

  if (!best) {
    return `<b>P2P ${config.cryptoCurrency}/${config.fiatCurrency}</b>\n\n` +
      `Подходящих объявлений нет. Проверено: <b>${scanned}</b>.\n` +
      `Сумма: <b>${formatNumber(config.fiatAmount, 0)} ${config.fiatCurrency}</b>`;
  }

  const qualifying = best.discountPct >= config.minDiscountPct;
  const header = qualifying
    ? '⚡ <b>Выгодное P2P-объявление</b>'
    : '<b>P2P: текущая лучшая цена</b>';
  const paymentLine = best.payments.length
    ? best.payments.map(escapeHtml).join(', ')
    : 'не указаны';
  const available = Math.min(best.maxAmount, best.availableFiat || best.maxAmount);
  const statusLine = qualifying
    ? `Ниже медианы на <b>${best.discountPct.toFixed(2)}%</b>`
    : `Отклонение: <b>${best.discountPct.toFixed(2)}%</b> · порог ${config.minDiscountPct.toFixed(2)}%`;

  return `${header}\n` +
    `— — —\n` +
    `<b>${config.cryptoCurrency}/${config.fiatCurrency}</b> · ${config.side === 'SELL' ? 'покупка' : 'продажа'}\n` +
    `Цена: <b>${formatNumber(best.price, 4)} ${config.fiatCurrency}</b>\n` +
    `Медиана: ${formatNumber(referencePrice, 4)} ${config.fiatCurrency}\n` +
    `${statusLine}\n` +
    `— — —\n` +
    `Сумма: <b>${formatNumber(config.fiatAmount, 0)} ${config.fiatCurrency}</b>\n` +
    `Лимиты: ${formatNumber(best.minAmount, 0)}–${formatNumber(available, 0)} ${config.fiatCurrency}\n` +
    `Оплата: ${paymentLine}\n` +
    `Продавец: <b>${escapeHtml(best.nickname)}</b>\n` +
    `Исполнение: ${best.executeRate.toFixed(1)}% · ${best.orders} сделок` +
    (best.isAutoAccept ? '\nАвтоприём: да' : '') +
    `\n\nПроверено объявлений: ${scanned}, подошло по фильтрам: ${offers.length}` +
    (automatic ? '\n<i>Перед оплатой перепроверь цену и реквизиты в Wallet.</i>' : '');
}

export const P2P_WALLET_URL = 'https://t.me/wallet';
