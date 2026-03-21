// @charset utf-8
// api/webhook-tv.js - TradingView Alert Webhook v2
// Payload: {"action":"buy/sell","ticker":"BTCUSDT","close":"103450","interval":"1h","sl":"102000","tp":"106000","user_id":"optional"}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const WH_SECRET = process.env.TV_WEBHOOK_SECRET || '';
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

// -- Dedup cache - prevent duplicate signals within 5 min ----------
const _recentSignals = new Map(); // key -> timestamp
const DEDUP_MS = 5 * 60 * 1000;

function isDuplicate(key) {
  const last = _recentSignals.get(key);
  if (last && Date.now() - last < DEDUP_MS) return true;
  _recentSignals.set(key, Date.now());
  // Cleanup old entries
  if (_recentSignals.size > 200) {
    const cutoff = Date.now() - DEDUP_MS;
    for (const [k, t] of _recentSignals) if (t < cutoff) _recentSignals.delete(k);
  }
  return false;
}

// -- CoinGecko symbol map ------------------------------------------
const CG_MAP = {
  btcusdt:'bitcoin', ethusdt:'ethereum', solusdt:'solana',
  bnbusdt:'binancecoin', xrpusdt:'ripple', dogeusdt:'dogecoin',
  adausdt:'cardano', avaxusdt:'avalanche-2', linkusdt:'chainlink',
  dotusdt:'polkadot', maticusdt:'matic-network', atomusdt:'cosmos',
  nearusdt:'near', aptusdt:'aptos', suiusdt:'sui',
  arbusdt:'arbitrum', opusdt:'optimism', injusdt:'injective-protocol',
  tonusdt:'the-open-network', pepeusdt:'pepe', ltcusdt:'litecoin',
  uniusdt:'uniswap', aaveusdt:'aave', filusdt:'filecoin',
  ftmusdt:'fantom', runeusdt:'thorchain', shibusdt:'shiba-inu',
  trxusdt:'tron', xlmusdt:'stellar', hbarusdt:'hedera-hashgraph',
  wifusdt:'dogwifcoin', fetusdt:'fetch-ai', renderusdt:'render-token',
  wldusdt:'worldcoin-wld', tiausdt:'celestia', jupusdt:'jupiter-exchange-solana',
};

// -- Fetch candles via Binance (real OHLCV, up to 200 candles) ------
// Falls back to CoinGecko if Binance fails
async function fetchCandles(symbol, interval = '1h', limit = 100) {
  const sym = symbol.replace('.P', '').toUpperCase();

  // Normalize interval for Binance: 1h -> 1h, 4h -> 4h, 1d -> 1d, 15 -> 15m
  const ivMap = { '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
                  '60':'1h','1h':'1h','2h':'2h','4h':'4h','6h':'6h',
                  '12h':'12h','1d':'1d','d':'1d','w':'1w','1w':'1w' };
  const iv = ivMap[interval.toLowerCase()] || interval.toLowerCase();

  // Try Binance first
  try {
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${iv}&limit=${limit}`;
    const r = await fetch(binanceUrl, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length > 5) {
        return raw.map(k => ({
          time:   Math.floor(k[0] / 1000),
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
      }
    }
  } catch(_) { /* fall through to CoinGecko */ }

  // CoinGecko fallback (less granular - 1 day of OHLC)
  const symLow = symbol.replace('.P','').toLowerCase();
  const cgId = CG_MAP[symLow] || symLow.replace('usdt','').replace('usd','');
  const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=1`;
  const cr = await fetch(cgUrl, { signal: AbortSignal.timeout(7000) });
  if (!cr.ok) throw new Error(`CoinGecko HTTP ${cr.status} for ${cgId}`);
  const raw = await cr.json();
  if (!Array.isArray(raw) || !raw.length) throw new Error(`No candle data for ${symbol}`);
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000), open: k[1], high: k[2], low: k[3], close: k[4], volume: 0
  }));
}

// -- RSI - Wilder's smoothed (correct) ----------------------------
function computeRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const cl = candles.map(c => c.close);
  let avgG = 0, avgL = 0;

  // First period
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) avgG += d; else avgL -= d;
  }
  avgG /= period;
  avgL /= period;

  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }

  if (avgL === 0) return 100;
  return Math.round(100 - 100 / (1 + avgG / avgL));
}

// -- ATR ----------------------------------------------------------
function computeATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  // Wilder smoothing
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// -- Market Structure (BOS / CHoCH detection) --------------------
function computeStructure(candles) {
  const n = candles.length;
  if (n < 10) return null;

  // Find swing highs/lows with variable lookback
  const swH = [], swL = [];
  const lb = Math.min(3, Math.floor(n / 10));
  for (let i = lb; i < n - lb; i++) {
    const leftH  = candles.slice(i - lb, i).every(c => c.high <= candles[i].high);
    const rightH = candles.slice(i + 1, i + lb + 1).every(c => c.high <= candles[i].high);
    if (leftH && rightH) swH.push({ price: candles[i].high, idx: i });

    const leftL  = candles.slice(i - lb, i).every(c => c.low >= candles[i].low);
    const rightL = candles.slice(i + 1, i + lb + 1).every(c => c.low >= candles[i].low);
    if (leftL && rightL) swL.push({ price: candles[i].low, idx: i });
  }

  let trend = 'NEUTRAL', bos = null, choch = null;

  if (swH.length >= 2 && swL.length >= 2) {
    const hh = swH[swH.length - 1].price > swH[swH.length - 2].price;
    const hl = swL[swL.length - 1].price > swL[swL.length - 2].price;
    const lh = swH[swH.length - 1].price < swH[swH.length - 2].price;
    const ll = swL[swL.length - 1].price < swL[swL.length - 2].price;

    if (hh && hl)  trend = 'BULLISH (HH+HL)';
    else if (lh && ll) trend = 'BEARISH (LH+LL)';
    else if (hh && ll) { trend = 'CHOPPY'; choch = 'Diverging'; }
    else if (lh && hl) { trend = 'CHOPPY'; choch = 'Converging'; }

    // BOS: last candle broke above prev swing high (bull) or below prev swing low (bear)
    const lastClose = candles[n - 1].close;
    if (lastClose > swH[swH.length - 1].price) bos = 'bull';
    if (lastClose < swL[swL.length - 1].price) bos = 'bear';
  }

  return {
    trend,
    bos,
    choch,
    lastHigh: swH[swH.length - 1]?.price,
    lastLow:  swL[swL.length - 1]?.price,
    prevHigh: swH[swH.length - 2]?.price,
    prevLow:  swL[swL.length - 2]?.price,
  };
}

// -- Order Blocks ------------------------------------------------
function computeOrderBlocks(candles) {
  const obs = [];
  const n = candles.length;
  for (let i = 2; i < n - 2; i++) {
    const c = candles[i], c1 = candles[i + 1], c2 = candles[i + 2];
    const move1 = Math.abs(c1.close - c1.open) / c1.open * 100;

    // Bullish OB: bearish candle -> strong bullish impulse
    if (c.close < c.open && c1.close > c1.open && move1 > 0.3 && c2.close > c2.open) {
      const mitigated = candles.slice(i + 3).some(x => x.low <= c.low);
      if (!mitigated) obs.push({ type: 'bull', high: c.high, low: c.low, idx: i });
    }

    // Bearish OB: bullish candle -> strong bearish impulse
    if (c.close > c.open && c1.close < c1.open && move1 > 0.3 && c2.close < c2.open) {
      const mitigated = candles.slice(i + 3).some(x => x.high >= c.high);
      if (!mitigated) obs.push({ type: 'bear', high: c.high, low: c.low, idx: i });
    }
  }
  // Return most recent 3, prefer ones closest to current price
  const lastClose = candles[n - 1].close;
  return obs
    .sort((a, b) => Math.abs((a.high + a.low) / 2 - lastClose) - Math.abs((b.high + b.low) / 2 - lastClose))
    .slice(0, 3);
}

// -- Fair Value Gaps ----------------------------------------------
function computeFVG(candles) {
  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const p = candles[i - 1], nx = candles[i + 1];

    if (nx.low > p.high && (nx.low - p.high) / p.high * 100 > 0.1) {
      const filled = candles.slice(i + 2).some(c => c.low <= p.high);
      if (!filled) fvgs.push({ type: 'bull', high: nx.low, low: p.high, idx: i });
    }

    if (nx.high < p.low && (p.low - nx.high) / p.low * 100 > 0.1) {
      const filled = candles.slice(i + 2).some(c => c.high >= p.low);
      if (!filled) fvgs.push({ type: 'bear', high: p.low, low: nx.high, idx: i });
    }
  }
  const lastClose = candles[candles.length - 1].close;
  return fvgs
    .sort((a, b) => Math.abs((a.high + a.low) / 2 - lastClose) - Math.abs((b.high + b.low) / 2 - lastClose))
    .slice(0, 3);
}

// -- Liquidity levels (equal highs/lows) --------------------------
function computeLiquidity(candles) {
  const n = candles.length;
  if (n < 20) return null;
  const recent = candles.slice(-30);

  // Find equal highs (sell-side liquidity above) within 0.1%
  const highs = recent.map(c => c.high).sort((a, b) => b - a);
  const lows  = recent.map(c => c.low).sort((a, b) => a - b);

  // Cluster detection - highs within 0.1% of each other
  const sslAbove = highs.find((h, i) => {
    return highs.slice(i + 1).some(h2 => Math.abs(h - h2) / h < 0.001);
  });
  const bslBelow = lows.find((l, i) => {
    return lows.slice(i + 1).some(l2 => Math.abs(l - l2) / l < 0.001);
  });

  return { sslAbove: sslAbove || null, bslBelow: bslBelow || null };
}

// -- Compute SL/TP if not provided in payload ----------------------
function computeLevels(candles, direction, price, atr) {
  if (!atr) return { sl: null, tp: null, rr: null };

  const ms       = computeStructure(candles);
  const isBull   = direction === 'long';
  const n        = candles.length;

  // SL: below/above recent swing + ATR buffer
  const swingRef = isBull
    ? Math.min(...candles.slice(-10).map(c => c.low))
    : Math.max(...candles.slice(-10).map(c => c.high));

  const sl = isBull
    ? Math.min(swingRef - atr * 0.2, price - atr * 1.2)
    : Math.max(swingRef + atr * 0.2, price + atr * 1.2);

  const slDist = Math.abs(price - sl);

  // TP: nearest structure level at 2R minimum
  let tp = isBull ? price + slDist * 2 : price - slDist * 2;

  // Use swing structure targets if available
  if (ms) {
    if (isBull && ms.lastHigh && ms.lastHigh > price + slDist) {
      tp = ms.lastHigh * 0.995; // just below resistance
    } else if (!isBull && ms.lastLow && ms.lastLow < price - slDist) {
      tp = ms.lastLow * 1.005; // just above support
    }
  }

  const rr = slDist > 0 ? (Math.abs(tp - price) / slDist).toFixed(1) : null;
  return { sl, tp, rr };
}

// -- Confidence score ----------------------------------------------
function computeConfidence(direction, ms, rsi, obs, fvgs, atr, candles) {
  let score = 50;
  const isBull = direction === 'long';
  const n = candles.length;
  const lastClose = candles[n - 1].close;

  // Structure alignment (10 to +20)
  if (ms?.trend) {
    if ((isBull && ms.trend.includes('')) || (!isBull && ms.trend.includes(''))) score += 20;
    else if (ms.trend === 'CHOPPY') score -= 10;
    else score -= 5; // against trend
  }

  // BOS confirmation (+10)
  if (ms?.bos === (isBull ? 'bull' : 'bear')) score += 10;

  // RSI zone (10 to +12)
  if (rsi != null) {
    if (isBull && rsi < 40)       score += 12; // oversold -> long
    else if (!isBull && rsi > 60) score += 12; // overbought -> short
    else if (isBull && rsi > 70)  score -= 10; // overbought -> risky long
    else if (!isBull && rsi < 30) score -= 10; // oversold -> risky short
    else if (isBull && rsi > 50 && rsi <= 65) score += 5; // neutral-bullish
    else if (!isBull && rsi < 50 && rsi >= 35) score += 5;
  }

  // OB confluence (+8 each, max +16)
  const alignedOBs = obs.filter(o =>
    ((isBull && o.type === 'bull') || (!isBull && o.type === 'bear')) &&
    (isBull ? lastClose >= o.low && lastClose <= o.high * 1.02
            : lastClose <= o.high && lastClose >= o.low * 0.98)
  );
  score += Math.min(16, alignedOBs.length * 8);

  // FVG confluence (+7 each, max +14)
  const alignedFVGs = fvgs.filter(f =>
    ((isBull && f.type === 'bull') || (!isBull && f.type === 'bear')) &&
    (isBull ? lastClose >= f.low && lastClose <= f.high * 1.02
            : lastClose <= f.high && lastClose >= f.low * 0.98)
  );
  score += Math.min(14, alignedFVGs.length * 7);

  // Volume on last candle (+5 if above average)
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  if (avgVol > 0 && candles[n - 1].volume > avgVol * 1.5) score += 5;

  return Math.max(25, Math.min(95, Math.round(score)));
}

// -- AI analysis --------------------------------------------------
async function aiAnalyze(pair, interval, direction, price, ms, rsi, obs, fvgs, confidence, sl, tp, rr) {
  const obStr  = obs.length  ? obs.map(o  => `${o.type} OB ${fmtP(o.low)}${fmtP(o.high)}`).join(', ')  : 'none';
  const fvgStr = fvgs.length ? fvgs.map(f => `${f.type} FVG ${fmtP(f.low)}${fmtP(f.high)}`).join(', ') : 'none';
  const bosStr = ms?.bos ? `BOS ${ms.bos}` : '';
  const slStr  = sl ? `SL: ${fmtP(sl)}` : 'not set';
  const tpStr  = tp ? `TP: ${fmtP(tp)}` : 'not set';

  const prompt =
    `You are an ICT/SMC trader. Give a brief signal analysis (3 sentences max).

Pair: ${pair} | TF: ${interval} | Signal: ${direction.toUpperCase()} | Price: ${fmtP(price)}
Structure: ${ms?.trend || '-'} ${bosStr} | RSI(14): ${rsi != null ? rsi : '-'}
OB: ${obStr} | FVG: ${fvgStr}
Levels: ${slStr}, ${tpStr}${rr ? `, R:R ${rr}` : ''} | Confidence: ${confidence}%

Reply in Russian: does structure confirm entry, what is the setup, main risk. No intro, just the point.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // faster + cheaper for webhook
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    return d.content?.[0]?.text?.trim() || '';
  } catch (_) {
    return '';
  }
}

// -- Format price ------------------------------------------------
function fmtP(p) {
  const n = parseFloat(p);
  if (isNaN(n) || !n) return '-';
  if (n >= 10000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 1000)  return '$' + n.toLocaleString('en', { maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

// -- Send TG message (with error handling per user) --------------
async function tgSend(chat_id, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      // User blocked bot - not an error worth logging loudly
      if (err?.error_code === 403) return false;
      console.warn(`[tgSend] ${chat_id} HTTP ${r.status}`, err?.description);
    }
    return true;
  } catch (e) {
    console.warn(`[tgSend] ${chat_id}`, e.message);
    return false;
  }
}

// -- Build TG message --------------------------------------------
function buildMessage({ pair, direction, interval, price, sl, tp, rr, confidence, ms, rsi, obs, fvgs, aiText, isPaid }) {
  const isBull   = direction === 'long';
  const dirEmoji = isBull ? '[LONG]' : '[SHORT]';
  const dirLabel = isBull ? 'LONG' : 'SHORT';
  const confFill = Math.round(confidence / 10);
  const confBar  = ''.repeat(confFill) + ''.repeat(10 - confFill);
  const confDot  = confidence >= 75 ? '[LONG]' : confidence >= 60 ? '[~]' : '[?]';
  const tf       = interval.toUpperCase().replace('60', '1H').replace('240', '4H');
  const timeStr  = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // -- Lines --------------------------------
  const structLine = ms?.trend
    ? `Structure . <code>${ms.trend}${ms.bos ? ' . BOS ' + ms.bos.toUpperCase() : ''}</code>\n`
    : '';

  const rsiLine = rsi != null
    ? `RSI(14)   . <b>${rsi}</b>${rsi >= 70 ? '  OB' : rsi <= 30 ? '  OS' : ''}\n`
    : '';

  const alignedOBs  = obs.filter(o  => (isBull && o.type === 'bull') || (!isBull && o.type === 'bear'));
  const alignedFVGs = fvgs.filter(f => (isBull && f.type === 'bull') || (!isBull && f.type === 'bear'));

  const obLine  = alignedOBs.length
    ? `OB nearby . ${alignedOBs.map(o => `${fmtP(o.low)}${fmtP(o.high)}`).join(', ')}\n`
    : '';
  const fvgLine = alignedFVGs.length
    ? `FVG open  . ${alignedFVGs.map(f => `${fmtP(f.low)}${fmtP(f.high)}`).join(', ')}\n`
    : '';

  // -- Levels block (paid only gets full detail) ------------------
  const entryLine = `Entry     . <b>${fmtP(price)}</b>\n`;
  const slLine    = sl   ? `SL        . <code>${fmtP(sl)}</code>\n`      : '';
  const tpLine    = tp   ? `TP        . <b>${fmtP(tp)}</b>\n`            : '';
  const rrLine    = rr   ? `R:R       . <b>1:${rr}</b>\n`               : '';

  // -- AI insight ------------------------------------------------
  const insightBlock = aiText
    ? `\n[AI] <i>${aiText.slice(0, 280)}</i>`
    : '';

  // -- Grade ----------------------------------------------------
  const grade = confidence >= 80 ? 'A+' : confidence >= 70 ? 'A' : confidence >= 60 ? 'B+' : 'B';
  const gradeBlock = `\n<code>Grade: ${grade} . Confluence: ${[
    ms?.trend && !ms.trend.includes('') ? 'Structure' : '',
    alignedOBs.length ? 'OB' : '',
    alignedFVGs.length ? 'FVG' : '',
    ms?.bos ? 'BOS' : '',
  ].filter(Boolean).join(' + ') || '-'}</code>`;

  // -- Free tier teaser ------------------------------------------
  const freeTease = !isPaid
    ? `\n<code>[LOCK] SL/TP + full AI insight - Premium only</code>\n<a href="${APP_URL}/pay">Unlock -></a>`
    : '';

  const dirTag = direction === 'long' ? 'LONG' : 'SHORT';
  return (
    `<b>** TV SIGNAL **</b>  ${timeStr} UTC\n` +
    `<b>${pair}  ${dirTag}  ${tf}</b>\n` +
    `Confidence: <code>${confBar}</code> <b>${confidence}%</b>\n` +
    `---\n` +
    entryLine +
    (isPaid ? slLine + tpLine + rrLine : '') +
    structLine + rsiLine + obLine + fvgLine +
    `---` +
    (isPaid ? insightBlock : '') +
    gradeBlock +
    freeTease +
    `\n\n<a href="${APP_URL}/screener?coin=${encodeURIComponent(pair)}&tf=${tf.toLowerCase()}">Open Chart</a>  |  <a href="${APP_URL}/journal">Log Trade</a>`
  );
}

// -- Main handler ------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  if (WH_SECRET && req.query.secret !== WH_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  const action   = (body.action || body.signal || '').toLowerCase();
  const ticker   = (body.ticker || body.symbol || 'BTCUSDT').toUpperCase().replace(/[/\-_]/g, '');
  const price    = parseFloat(body.close || body.price || '0');
  const interval = body.interval || body.tf || '1h';
  const userId   = body.user_id   || null;
  const extSL    = body.sl ? parseFloat(body.sl) : null;
  const extTP    = body.tp ? parseFloat(body.tp) : null;
  const extRR    = body.rr ? String(body.rr)     : null;

  if (!action || !ticker || !price)
    return res.status(400).json({ error: 'Missing action / ticker / close' });

  const direction = (action.includes('buy') || action.includes('long')) ? 'long' : 'short';

  // Dedup: same ticker+direction within 5 min = skip
  const dedupKey = `${ticker}_${direction}`;
  if (isDuplicate(dedupKey)) {
    console.log(`[webhook-tv] dedup skip: ${dedupKey}`);
    return res.status(200).json({ ok: true, skipped: true, reason: 'duplicate' });
  }

  try {
    // -- 1. Fetch candles & compute indicators ------------------
    const candles = await fetchCandles(ticker, interval, 100);
    const rsi     = computeRSI(candles);
    const atr     = computeATR(candles);
    const ms      = computeStructure(candles);
    const obs     = computeOrderBlocks(candles);
    const fvgs    = computeFVG(candles);

    // -- 2. SL / TP - use payload values or compute ------------
    let sl = extSL, tp = extTP, rr = extRR;
    if (!sl || !tp) {
      const computed = computeLevels(candles, direction, price, atr);
      if (!sl) sl = computed.sl;
      if (!tp) tp = computed.tp;
      if (!rr) rr = computed.rr;
    }

    // -- 3. Confidence ------------------------------------------
    const confidence = computeConfidence(direction, ms, rsi, obs, fvgs, atr, candles);

    // -- 4. AI analysis ----------------------------------------
    const aiText = await aiAnalyze(ticker, interval, direction, price, ms, rsi, obs, fvgs, confidence, sl, tp, rr);

    // -- 5. Get recipients from Supabase ------------------------
    let recipients = [];
    if (userId) {
      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=tg_chat_id,tg_linked,tg_notify_alerts,plan`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
      );
      const profiles = await r.json();
      if (profiles?.[0]?.tg_linked) recipients = profiles;
    } else {
      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_alerts=is.true&select=tg_chat_id,plan`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' } }
      );
      recipients = (await r.json()) || [];
    }

    if (!Array.isArray(recipients)) recipients = [];

    // -- 6. Build pair name ------------------------------------
    const pair = ticker.includes('USDT') ? ticker.replace('USDT', '/USDT') : ticker + '/USDT';

    // -- 7. Send to each recipient ------------------------------
    let sent = 0, failed = 0;
    for (const p of recipients) {
      if (!p.tg_chat_id) continue;
      const isPaid = p.plan === 'lifetime' || p.plan === 'monthly';
      const msg = buildMessage({ pair, direction, interval, price, sl, tp, rr, confidence, ms, rsi, obs, fvgs, aiText, isPaid });
      const ok = await tgSend(p.tg_chat_id, msg);
      if (ok) sent++; else failed++;
      // Throttle at 30/sec (Telegram limit)
      if ((sent + failed) % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[webhook-tv] ${ticker} ${direction} conf=${confidence}% -> sent=${sent} failed=${failed}`);
    return res.status(200).json({ ok: true, ticker, direction, price, confidence, sent, failed });

  } catch (e) {
    console.error('[webhook-tv]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
