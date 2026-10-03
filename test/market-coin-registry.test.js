import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../journal.html',import.meta.url),'utf8');
const registry=readFileSync(new URL('../js/journal-market-registry.js',import.meta.url),'utf8');
const required=['5m','15m','1h','4h'];
const row=i=>[String(1700000000000+i*300000),'100','102','98','101','123'];
function context(overrides={}) {
  const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,document:{addEventListener(){}},MI_DATA_INTERVALS:[...required,'1d'],trendlineValidCandle:c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close),...overrides});
  vm.runInContext(html.slice(html.indexOf('function miParseKlines('),html.indexOf('async function miLoadUniverse('))+'\n'+registry+'\nthis.names=MARKET_COIN_NAMES;',ctx);
  return ctx;
}
test('registry contains HYPE and 20 requested liquid alternatives without duplicates',()=>{
  const names=context().names;
  for(const symbol of ['HYPE','SUI','SEI','INJ','TIA','APT','ARB','OP','ONDO','ENA','JUP','PENDLE','WLD','PYTH','JTO','STRK','ZK','ZRO','AERO','RENDER','TAO'])assert.ok(names[symbol]);
  assert.equal(Object.keys(names).length,32);
});
test('short daily listing history does not block the four real trend intervals',async()=>{
  const calls=[],ctx=context({miBinance:async path=>{calls.push(path);return path.includes('ticker')?{lastPrice:'101'}:Array.from({length:path.includes('interval=1d')?9:48},(_,i)=>row(i));}});
  const data=await ctx.miLoadSpotHistory('HYPE',required);
  assert.deepEqual(Object.keys(data.candles),required);
  assert.ok(!calls.some(path=>path.includes('interval=1d')));
  await assert.rejects(()=>ctx.miLoadBinance('HYPE'),/Недостаточно свечей/);
});
test('spot fallback keeps genuine chronological OHLC and converts percentage units',async()=>{
  const ctx=context({miBinance:async()=>{throw Error('Spot primary unavailable')},miFetchJSON:async url=>url.includes('tickers')?{retCode:0,result:{list:[{symbol:'HYPEUSDT',lastPrice:'101',prevPrice24h:'100',price24hPcnt:'.01',highPrice24h:'102',lowPrice24h:'98',turnover24h:'5000'}]}}:{retCode:0,result:{list:Array.from({length:48},(_,i)=>row(i)).reverse()}}});
  const data=await ctx.miLoadSpotHistory('HYPE',required);
  assert.equal(data.exchange,'BYBIT');assert.equal(data.ticker.changePct,1);
  assert.equal(data.candles['5m'].length,48);
  assert.equal(data.candles['5m'][0].time,1700000000000);
  assert.equal(data.candles['5m'][0].volume,123);
});
test('fallback rejects duplicated candles and missing instruments',async()=>{
  const quote={retCode:0,result:{list:[{symbol:'HYPEUSDT',lastPrice:'101'}]}};
  const ctx=context({miFetchJSON:async url=>url.includes('tickers')?quote:{retCode:0,result:{list:Array.from({length:48},()=>row(0))}}});
  await assert.rejects(()=>ctx.miLoadBybitSpot('HYPE',required),/достоверных свечей/);
  quote.result.list=[];
  await assert.rejects(()=>ctx.miLoadBybitSpot('UNKNOWN',required),/пара не найдена/);
});

test('a stalled primary cannot hold up a valid complete fallback snapshot and its requests are cancelled',async()=>{
  let aborted=0;
  const ctx=context({miBinance:(path,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(Error('Aborted'));},{once:true})),miFetchJSON:async url=>url.includes('tickers')?{retCode:0,result:{list:[{symbol:'HYPEUSDT',lastPrice:'101',prevPrice24h:'100',price24hPcnt:'.01'}]}}:{retCode:0,result:{list:Array.from({length:48},(_,i)=>row(i)).reverse()}}});
  const started=Date.now(),data=await ctx.miLoadSpotHistory('HYPE',required);
  assert.ok(Date.now()-started<2000,'backup must start while the primary is still pending');
  assert.equal(data.exchange,'BYBIT');assert.deepEqual(Object.keys(data.candles),required);
  assert.equal(aborted,required.length+1);
});

test('a responsive primary avoids requesting the backup exchange',async()=>{
  let backups=0;
  const ctx=context({miBinance:async path=>path.includes('ticker')?{lastPrice:'101'}:Array.from({length:48},(_,i)=>row(i)),miFetchJSON:async()=>{backups++;throw Error('Backup should not start');}});
  await ctx.miLoadSpotHistory('BTC',required);await new Promise(resolve=>setTimeout(resolve,800));
  assert.equal(backups,0);
});
test('changing coin during a page initialization loads the new choice and ignores the late old response',async()=>{
  const pending={},state={symbol:'BTC',loading:false,loadedAt:0,requestId:0};
  const ctx=vm.createContext({marketIntelState:state,document:{querySelectorAll:()=>[]},miCleanSymbol:s=>s,miEl:()=>null,miSet(){},miRenderAnalysis(){},miBuildAnalysis:()=>({}),miLoadMarket:s=>new Promise(resolve=>pending[s]=resolve)});
  vm.runInContext(html.slice(html.indexOf('async function selectMarketCoin('),html.indexOf('function marketIntelSubmit(')),ctx);
  const old=ctx.selectMarketCoin('BTC'),latest=ctx.selectMarketCoin('HYPE');
  assert.equal(typeof pending.HYPE,'function');
  pending.HYPE({ticker:{price:90},candles:{'1h':[]},source:'РЫНОЧНЫЕ ДАННЫЕ'});await latest;
  pending.BTC({ticker:{price:85000},candles:{'1h':[]},source:'РЫНОЧНЫЕ ДАННЫЕ'});await old;
  assert.equal(state.symbol,'HYPE');assert.equal(state.ticker.price,90);assert.equal(state.loading,false);
});
