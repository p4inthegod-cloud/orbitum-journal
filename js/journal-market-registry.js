/* One catalogue for quote streams, market tables and ticker suggestions. */
const MARKET_COIN_NAMES = Object.freeze({
  BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana', BNB:'BNB', XRP:'XRP',
  DOGE:'Dogecoin', ADA:'Cardano', AVAX:'Avalanche', LINK:'Chainlink', PEPE:'Pepe', TON:'Toncoin',
  HYPE:'Hyperliquid', SUI:'Sui', SEI:'Sei', INJ:'Injective', TIA:'Celestia', APT:'Aptos',
  ARB:'Arbitrum', OP:'Optimism', ONDO:'Ondo', ENA:'Ethena', JUP:'Jupiter', PENDLE:'Pendle',
  WLD:'World', PYTH:'Pyth Network', JTO:'Jito', STRK:'Starknet', ZK:'ZKsync', ZRO:'LayerZero',
  AERO:'Aerodrome Finance', RENDER:'Render', TAO:'Bittensor'
});

async function marketRegistryLoadQuotes() {
  if (document.hidden) return;
  try {
    const pairs=Object.keys(MARKET_COIN_NAMES).map(symbol=>symbol+'USDT');
    const rows=await miBinance('/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(pairs)));
    if (!Array.isArray(rows)) return;
    rows.forEach(row=>{
      const symbol=String(row.symbol||'').replace(/USDT$/,'');
      const price=Number(row.lastPrice),change=Number(row.priceChangePercent);
      if (MARKET_COIN_NAMES[symbol]&&price>0&&Number.isFinite(price)&&Number.isFinite(change)) updateTickerItem(symbol,price,change);
    });
    overviewMarketScheduleRender();
  } catch (_) {
    // A single unlisted Binance pair rejects the entire bulk request (e.g. HYPE).
    try {
      const response=await miFetchJSON('https://api.bybit.com/v5/market/tickers?category=spot');
      if(response.retCode!==0)return;
      for(const row of response.result?.list||[]){
        if(!row.symbol.endsWith('USDT'))continue;
        const symbol=row.symbol.slice(0,-4),price=Number(row.lastPrice),change=Number(row.price24hPcnt)*100;
        if(MARKET_COIN_NAMES[symbol]&&price>0&&Number.isFinite(change))updateTickerItem(symbol,price,change);
      }
      overviewMarketScheduleRender();
    } catch (_) { /* Retain last valid quotes and their original reception times. */ }
  }
}

async function miLoadBybitSpot(symbol, intervals, signal) {
  const pair=encodeURIComponent(symbol+'USDT'),base='https://api.bybit.com/v5/market/';
  const intervalIds={'5m':'5','15m':'15','1h':'60','4h':'240','1d':'D'};
  const [quote,...series]=await Promise.all([
    miFetchJSON(base+'tickers?category=spot&symbol='+pair,9000,signal),
    ...intervals.map(tf=>miFetchJSON(base+'kline?category=spot&symbol='+pair+'&interval='+intervalIds[tf]+'&limit='+(tf==='1d'?500:1000),9000,signal))
  ]);
  const ticker=quote.retCode===0&&quote.result?.list?.find(row=>row.symbol===symbol+'USDT');
  if (!ticker||!(Number(ticker.lastPrice)>0)) throw Error('Спотовая пара не найдена');
  const candles={};
  intervals.forEach((tf,i)=>{
    if (series[i].retCode!==0) throw Error('Свечи источника недоступны');
    candles[tf]=miParseKlines(series[i].result?.list).sort((a,b)=>a.time-b.time);
    if (candles[tf].length<40||!candles[tf].every(trendlineValidCandle)||new Set(candles[tf].map(c=>c.time)).size!==candles[tf].length) throw Error('Недостаточно достоверных свечей');
  });
  const price=Number(ticker.lastPrice),previous=Number(ticker.prevPrice24h);
  return {source:'РЫНОЧНЫЕ ДАННЫЕ',exchange:'BYBIT',ticker:{price,change:previous>0?price-previous:null,changePct:Number(ticker.price24hPcnt)*100,high:Number(ticker.highPrice24h),low:Number(ticker.lowPrice24h),volumeQuote:Number(ticker.turnover24h),trades:null},candles};
}

let spotPreferredExchange='BINANCE';
async function miLoadSpotHistory(symbol, intervals=MI_DATA_INTERVALS) {
  // Race complete, validated snapshots; never combine candles from two exchanges.
  const primary=new AbortController(),backup=new AbortController();
  const loaders=spotPreferredExchange==='BYBIT'?[miLoadBybitSpot,miLoadBinance]:[miLoadBinance,miLoadBybitSpot];
  let timer,startBackup,started=false,primaryError;
  const fallback=new Promise((resolve,reject)=>{
    startBackup=()=>{if(started)return;started=true;clearTimeout(timer);loaders[1](symbol,intervals,backup.signal).then(resolve,reject);};
    timer=setTimeout(startBackup,750);
  });
  const first=loaders[0](symbol,intervals,primary.signal).catch(error=>{primaryError=error;startBackup();throw error;});
  try {
    const data=await Promise.any([first,fallback]);
    spotPreferredExchange=data.exchange||'BINANCE';return data;
  } catch (_) {throw primaryError||new Error('Рыночные источники недоступны');}
  finally {clearTimeout(timer);primary.abort();backup.abort();}
}

document.addEventListener('DOMContentLoaded',()=>{
  const list=document.createElement('datalist');list.id='market-coin-registry';
  Object.entries(MARKET_COIN_NAMES).forEach(([symbol,name])=>{
    const option=document.createElement('option');option.value=symbol;option.label=name+' · '+symbol+'/USDT';list.append(option);
  });
  document.body.append(list);
  for (const id of ['ov-symbol-input','bs-symbol-input','lq-symbol-input','tl-symbol-input','el-symbol-input','mi-symbol-input','wt-add-symbol']) {
    const input=document.getElementById(id);
    if (input) {input.setAttribute('list',list.id);input.placeholder='BTC, HYPE, SUI…';}
  }
  marketRegistryLoadQuotes();
  setInterval(()=>{if(['page-overview','page-premarket'].includes(document.querySelector('.page.active')?.id))marketRegistryLoadQuotes();},30000);
});
