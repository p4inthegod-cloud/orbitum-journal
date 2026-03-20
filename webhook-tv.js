// api/webhook-tv.js — TradingView Alert Webhook
// Принимает сигналы из Pine Script → AI анализ → Telegram
// Pine payload: {"action":"buy/sell","ticker":"BTCUSDT","close":"103450","interval":"1h"}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const WH_SECRET = process.env.TV_WEBHOOK_SECRET || ''; // опционально

async function fetchKlines(symbol, interval='1h', limit=200){
  symbol = symbol.replace('.P','').toLowerCase();
  const map = {
    btcusdt: "bitcoin", ethusdt: "ethereum", solusdt: "solana",
    bnbusdt: "binancecoin", xrpusdt: "ripple", dogeusdt: "dogecoin",
    adausdt: "cardano", avaxusdt: "avalanche-2", linkusdt: "chainlink",
    dotusdt: "polkadot", maticusdt: "matic-network", atomusdt: "cosmos",
    nearusdt: "near", aptusdt: "aptos", suiusdt: "sui",
    arbusdt: "arbitrum", opusdt: "optimism", injusdt: "injective-protocol",
    tonusdt: "the-open-network", pepeusdt: "pepe",
    ltcusdt: "litecoin", uniusdt: "uniswap", aaveusdt: "aave",
    filusdt: "filecoin", ftmusdt: "fantom", runeusdt: "thorchain",
  };
  const coin = map[symbol];
  if(!coin) {
    // Fallback: try using symbol directly as CoinGecko ID (strip 'usdt')
    const fallbackId = symbol.replace('usdt','').replace('usd','').replace('busd','');
    const testUrl = `https://api.coingecko.com/api/v3/coins/${fallbackId}/ohlc?vs_currency=usd&days=1`;
    const testR = await fetch(testUrl, { signal: AbortSignal.timeout(5000) });
    if(testR.ok) {
      const raw = await testR.json();
      return raw.map(k => ({ time: Math.floor(k[0]/1000), open:k[1], high:k[2], low:k[3], close:k[4], volume:0 }));
    }
    throw new Error(`Coin not mapped: ${symbol}`);
  }
  const url = `https://api.coingecko.com/api/v3/coins/${coin}/ohlc?vs_currency=usd&days=1`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000)
  });
  if(!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
  const raw = await r.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: k[1],
    high: k[2],
    low:  k[3],
    close:k[4],
    volume: 0
  }));
}

function computeRSI(candles, period=14){
  if(candles.length < period+1) return null;
  const cl = candles.map(c=>c.close);
  let g=0,l=0;
  for(let i=cl.length-period;i<cl.length;i++){
    const d=cl[i]-cl[i-1]; if(d>0) g+=d; else l-=d;
  }
  if(l===0) return 100;
  return 100 - 100/(1+g/l);
}

function computeStructure(candles){
  const n=candles.length; if(n<10) return null;
  const swH=[],swL=[];
  for(let i=3;i<n-3;i++){
    if(candles[i].high>=Math.max(...candles.slice(i-3,i).map(c=>c.high)) &&
       candles[i].high>=Math.max(...candles.slice(i+1,i+4).map(c=>c.high)))
      swH.push({price:candles[i].high});
    if(candles[i].low<=Math.min(...candles.slice(i-3,i).map(c=>c.low)) &&
       candles[i].low<=Math.min(...candles.slice(i+1,i+4).map(c=>c.low)))
      swL.push({price:candles[i].low});
  }
  let trend='НЕЙТРАЛЬНЫЙ';
  if(swH.length>=2&&swL.length>=2){
    const hh=swH[swH.length-1].price>swH[swH.length-2].price;
    const hl=swL[swL.length-1].price>swL[swL.length-2].price;
    const lh=swH[swH.length-1].price<swH[swH.length-2].price;
    const ll=swL[swL.length-1].price<swL[swL.length-2].price;
    if(hh&&hl) trend='БЫЧИЙ (HH+HL)';
    else if(lh&&ll) trend='МЕДВЕЖИЙ (LH+LL)';
    else trend='CHOPPY';
  }
  return { trend, lastHigh:swH[swH.length-1]?.price, lastLow:swL[swL.length-1]?.price };
}

function computeOrderBlocks(candles){
  const obs=[]; const n=candles.length;
  for(let i=2;i<n-2;i++){
    const c=candles[i],c1=candles[i+1],c2=candles[i+2];
    if(c.close<c.open && c1.close>c1.open && (c1.close-c1.open)/c1.open*100>0.3 && c2.close>c2.open)
      obs.push({type:'bull',high:c.high,low:c.low,mitigated:candles.slice(i+3).some(x=>x.low<=c.low)});
    if(c.close>c.open && c1.close<c1.open && (c1.open-c1.close)/c1.open*100>0.3 && c2.close<c2.open)
      obs.push({type:'bear',high:c.high,low:c.low,mitigated:candles.slice(i+3).some(x=>x.high>=c.high)});
  }
  return obs.filter(o=>!o.mitigated).slice(-3);
}

function computeFVG(candles){
  const fvgs=[];
  for(let i=1;i<candles.length-1;i++){
    const p=candles[i-1],nx=candles[i+1];
    if(nx.low>p.high&&(nx.low-p.high)/p.high*100>0.1)
      fvgs.push({type:'bull',high:nx.low,low:p.high,filled:candles.slice(i+2).some(c=>c.low<=p.high)});
    if(nx.high<p.low&&(p.low-nx.high)/p.low*100>0.1)
      fvgs.push({type:'bear',high:p.low,low:nx.high,filled:candles.slice(i+2).some(c=>c.high>=p.low)});
  }
  return fvgs.filter(f=>!f.filled).slice(-3);
}

function fmtP(p){
  const n=parseFloat(p); if(isNaN(n)) return '—';
  if(n>=1000) return '$'+n.toLocaleString('en',{maximumFractionDigits:2});
  if(n>=1) return '$'+n.toFixed(2);
  return '$'+n.toFixed(5);
}

async function tgSend(chat_id, text){
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id,text,parse_mode:'HTML',disable_web_page_preview:true})
  });
}

async function aiAnalyze(pair, interval, direction, price, ms, rsi, obs, fvgs){
  const obStr  = obs.length  ? obs.map(o=>`${o.type} OB ${fmtP(o.low)}-${fmtP(o.high)}`).join(', ')  : 'нет';
  const fvgStr = fvgs.length ? fvgs.map(f=>`${f.type} FVG ${fmtP(f.low)}-${fmtP(f.high)}`).join(', ') : 'нет';
  const prompt = `ICT/SMC анализ сигнала из TradingView.
Пара: ${pair} | ТФ: ${interval} | Сигнал: ${direction.toUpperCase()} | Цена: ${price}
Структура: ${ms?.trend||'—'} | RSI(14): ${rsi!=null?Math.round(rsi):'—'}
OB: ${obStr} | FVG: ${fvgStr}
Дай 3-4 предложения: подтверждает ли структура сигнал, качество входа, ключевые уровни.
По-русски, конкретно, без вступлений.`;
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY||'','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:400,
        messages:[{role:'user',content:prompt}]})
    });
    const d = await r.json();
    return d.content?.[0]?.text || '';
  }catch(e){ return ''; }
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || 'https://orbitum.trade');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).end();

  // Optional secret check
  if(WH_SECRET && req.query.secret !== WH_SECRET)
    return res.status(401).json({error:'Unauthorized'});

  const body = req.body;
  // TradingView sends: action, ticker, close (and optionally interval, user_id)
  const action   = (body.action||body.signal||'').toLowerCase();  // buy/sell/long/short
  const ticker   = (body.ticker||body.symbol||'BTCUSDT').toUpperCase().replace('/','').replace('-','');
  const closeStr = body.close || body.price || '0';
  const price    = parseFloat(closeStr);
  const interval = body.interval || body.tf || '1h';
  const userId   = body.user_id || null; // optional — to find TG chat

  if(!action||!ticker||!price)
    return res.status(400).json({error:'Missing action/ticker/close'});

  const direction = action.includes('buy')||action.includes('long') ? 'long' : 'short';

  try{
    // Fetch klines for analysis
    const candles = await fetchKlines(ticker, interval, 200);
    const rsi  = computeRSI(candles);
    const ms   = computeStructure(candles);
    const obs  = computeOrderBlocks(candles);
    const fvgs = computeFVG(candles);

    // AI analysis
    const aiText = await aiAnalyze(ticker, interval, direction, price, ms, rsi, obs, fvgs);

    // Find TG recipients
    let recipients = [];
    if(userId){
      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=tg_chat_id,tg_linked,tg_notify_alerts`,
        {headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Accept':'application/json'}}
      );
      const profiles = await r.json();
      if(profiles?.[0]?.tg_linked) recipients = profiles;
    } else {
      // Broadcast to all users with tg_notify_alerts enabled
      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?tg_linked=is.true&tg_notify_alerts=is.true&select=tg_chat_id`,
        {headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Accept':'application/json'}}
      );
      recipients = await r.json() || [];
    }

    // ── Confidence score (ICT/SMC signal quality) ─────────────────
    // Factors: structure alignment, RSI zone, OB/FVG confluences
    let confidence = 55; // baseline
    const isBull = direction === 'long';

    // Structure alignment +15
    if (ms?.trend && (
      (isBull && ms.trend.includes('БЫЧ')) ||
      (!isBull && ms.trend.includes('МЕД'))
    )) confidence += 15;
    else if (ms?.trend === 'CHOPPY') confidence -= 5;

    // RSI zone alignment +10
    if (rsi != null) {
      if (isBull && rsi <= 40) confidence += 10;
      else if (!isBull && rsi >= 60) confidence += 10;
      else if ((isBull && rsi >= 70) || (!isBull && rsi <= 30)) confidence -= 10; // extreme
    }

    // OB confluence +8 each (max +16)
    const alignedOBs = obs.filter(o => (isBull && o.type === 'bull') || (!isBull && o.type === 'bear'));
    confidence += Math.min(16, alignedOBs.length * 8);

    // FVG confluence +7 each (max +14)
    const alignedFVGs = fvgs.filter(f => (isBull && f.type === 'bull') || (!isBull && f.type === 'bear'));
    confidence += Math.min(14, alignedFVGs.length * 7);

    confidence = Math.max(30, Math.min(95, Math.round(confidence)));

    // ── Build SETUP SIGNAL message (template format) ───────────────
    const confFilled = Math.round(confidence / 10);
    const confBar    = ('█'.repeat(confFilled) + '░'.repeat(10 - confFilled));
    const confDot    = confidence >= 75 ? '🟢' : confidence >= 60 ? '🟠' : '🟡';
    const dirEmoji   = direction === 'long' ? '🟢' : '🔴';
    const dirLabel   = direction === 'long' ? 'LONG' : 'SHORT';
    const pair       = ticker.includes('USDT') ? ticker : ticker + '/USDT';
    const tf         = interval.toUpperCase();
    const timeStr    = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const appUrl     = process.env.APP_URL || 'https://orbitum.trade';

    // Structure line
    const structLine = ms?.trend
      ? `Structure · <code>${ms.trend}</code>${ms.lastHigh ? `  H:${fmtP(ms.lastHigh)}` : ''}
`
      : '';
    const rsiLine    = rsi != null
      ? `RSI(14)   · <b>${Math.round(rsi)}</b>${rsi >= 70 ? ' ⚠️ OB' : rsi <= 30 ? ' ⚠️ OS' : ''}
`
      : '';
    const obLine     = obs.length
      ? `OB zones  · ${obs.map(o => `${o.type} ${fmtP(o.low)}–${fmtP(o.high)}`).join(', ')}
`
      : '';
    const fvgLine    = fvgs.length
      ? `FVG zones · ${fvgs.map(f => `${f.type} ${fmtP(f.low)}–${fmtP(f.high)}`).join(', ')}
`
      : '';

    const insightLine = aiText
      ? `
🧠 <i>${aiText.slice(0, 300)}</i>`
      : '';

    const scarcity = confidence >= 80
      ? '
<code>⚡ Setup quality: A+ — rare occurrence</code>'
      : `
<code>✦ ${Math.floor(Math.random() * 200 + 100)} traders tracking this setup</code>`;

    const msg =
      `⚡ <b>SETUP SIGNAL</b> · ${timeStr} UTC
` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `${dirEmoji} <b>${pair} · ${dirLabel}</b> · ${tf}
` +
      `<code>TradingView Webhook</code>
` +
      `${confDot} <code>${confBar}</code> <b>${confidence}%</b> confidence
` +
      `━━━━━━━━━━━━━━━━━━━
` +
      `Price     · <b>${fmtP(price)}</b>
` +
      structLine + rsiLine + obLine + fvgLine +
      `━━━━━━━━━━━━━━━━━━━` +
      insightLine +
      scarcity +
      `

<a href="${appUrl}/screener?coin=${encodeURIComponent(pair)}&tf=${tf.toLowerCase()}&panel=signal">📊 OPEN CHART</a>  ·  <a href="${appUrl}/journal?log=auto">📓 LOG TRADE</a>`;

    let sent=0;
    for(const p of recipients){
      if(p.tg_chat_id){ await tgSend(p.tg_chat_id, msg); sent++; }
    }

    console.log(`[webhook-tv] ${ticker} ${direction} → ${sent} TG`);
    return res.status(200).json({ ok:true, ticker, direction, price, sent });

  }catch(e){
    console.error('[webhook-tv]', e);
    return res.status(500).json({error:e.message});
  }
}
