import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/journal-live.js',import.meta.url),'utf8');
function context(){
  const ctx=vm.createContext({Date,Map,Set,Number,Math,JSON,coinTfMs:{'5m':300000,'1h':3600000},document:{readyState:'loading',addEventListener(){}},setTimeout:()=>1,clearTimeout(){},clearInterval(){},navigator:{onLine:true},trendlineValidCandle:c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)&&c.volume>=0,updateTickerItem(){}});
  vm.runInContext(source,ctx);vm.runInContext('liveSyncStreams=()=>{};liveUpdateWatch=()=>{};liveQueueRender=()=>{}',ctx);return ctx;
}
const bar=(time,close=100)=>({time,open:100,high:Math.max(101,close),low:99,close,volume:5});
function record(ctx){ctx.now=Date.now();ctx.rows=[bar(ctx.now-300000),bar(ctx.now)];vm.runInContext("marketLive.records.set('BTC',{symbol:'BTC',exchange:'BINANCE',framesAt:{'5m':now-180000,'1h':now-180000},events:{},quoteAt:now-180000,data:{ticker:{price:100,changePct:1},candles:{'5m':rows,'1h':rows}}})",ctx);return vm.runInContext("marketLive.records.get('BTC')",ctx);}
test('open bars replace in place, new bars append, gaps are repaired rather than manufactured',()=>{
  const c=context(),now=Date.now(),rows=[bar(now-300000)];
  assert.equal(c.liveMergeCandle(rows,bar(now-300000,102),'5m'),'updated');assert.equal(rows.length,1);assert.equal(rows[0].close,102);
  assert.equal(c.liveMergeCandle(rows,bar(now,103),'5m'),'new');assert.equal(rows.length,2);
  assert.equal(c.liveMergeCandle(rows,bar(now+900000),'5m'),'invalid');
  const older=[bar(now-1200000)];assert.equal(c.liveMergeCandle(older,bar(now),'5m'),'gap');assert.equal(older.length,1);
  assert.equal(c.liveMergeCandle(rows,{...bar(now),low:105},'5m'),'invalid');
});
test('fresh tickers do not make old indicator history fresh',()=>{
  const c=context(),r=record(c),old=r.framesAt['5m'];
  assert.equal(c.liveQuote('BINANCE','BTC',{price:105,changePct:2},Date.now()),true);
  assert.equal(r.data.ticker.price,105);assert.equal(c.liveAge(r,['5m','1h']),old);
  assert.equal(c.liveCandle('BINANCE','BTC','5m',bar(c.now,106),Date.now()),true);
  assert.equal(c.liveAge(r,['5m','1h']),old);
});
test('a different exchange, old event, malformed timestamp or other coin cannot replace selected quotes',()=>{
  const c=context(),r=record(c),now=Date.now();
  assert.equal(c.liveQuote('BYBIT','BTC',{price:999},now),false);
  assert.equal(c.liveQuote('BINANCE','ETH',{price:999},now),false);
  assert.equal(c.liveQuote('BINANCE','BTC',{price:999},NaN),false);
  assert.equal(c.liveQuote('BINANCE','BTC',{price:999},now-200000),false);
  c.liveQuote('BINANCE','BTC',{price:105},now);
  assert.equal(c.liveQuote('BINANCE','BTC',{price:999},now-1),false);assert.equal(r.data.ticker.price,105);
});
test('a slow HTTP snapshot preserves newer streamed prices and candles',()=>{
  const c=context(),r=record(c),started=Date.now()-1000;
  c.liveQuote('BINANCE','BTC',{price:108},Date.now());c.liveCandle('BINANCE','BTC','5m',bar(c.now,108),Date.now());
  const result=c.liveStore('BTC',{exchange:'BINANCE',source:'РЫНОЧНЫЕ ДАННЫЕ',ticker:{price:101},candles:{'5m':[bar(c.now-300000),bar(c.now,101)]}},['5m'],started);
  assert.equal(result.ticker.price,108);assert.equal(result.candles['5m'].at(-1).close,108);
  assert.equal(result,r.data);assert.equal(new Set(result.candles['5m'].map(b=>b.time)).size,2);
});
test('Bybit spot snapshots retain their percentage units and exact OHLC volume',()=>{
  const c=context(),r=record(c);r.exchange='BYBIT';
  assert.equal(c.liveMessage('BYBIT',JSON.stringify({topic:'tickers.BTCUSDT',ts:Date.now(),data:{lastPrice:'102',prevPrice24h:'100',price24hPcnt:'.02',highPrice24h:'105',lowPrice24h:'98',turnover24h:'12000'}})),true);
  assert.equal(r.data.ticker.changePct,2);assert.equal(r.data.ticker.volumeQuote,12000);
  c.liveMessage('BYBIT',JSON.stringify({topic:'kline.5.BTCUSDT',ts:Date.now(),data:[{start:c.now,open:'100',high:'104',low:'99',close:'103',volume:'7',confirm:false}]}));
  assert.equal(r.data.candles['5m'].at(-1).close,103);assert.equal(r.data.candles['5m'].at(-1).volume,7);
});
test('old candle messages cannot rewind a new stream update',()=>{
  const c=context(),r=record(c),now=Date.now();c.liveCandle('BINANCE','BTC','5m',bar(c.now,105),now);
  assert.equal(c.liveCandle('BINANCE','BTC','5m',bar(c.now,101),now-1),false);assert.equal(r.data.candles['5m'].at(-1).close,105);
});
test('background history queries only the current user and preserves entry fields',async()=>{
  const c=context();let queriedUser,defaults=0,renders=0;
  Object.assign(c,{currentUser:{id:'owner'},allTrades:[],window:{_isDemoMode:false},sb:{from:()=>({select:()=>({eq:(_,user)=>{queriedUser=user;return {order:async()=>({data:[{id:'trade-1',user_id:'owner'}]})};}})})},journalWithTimeout:async p=>p,hideStatSkeletons(){},updateStatsEnhanced(){},render(){renders++},renderDashboard(){},renderProgress(){},renderLevelBar(){},orbColorUserByRank(){},restoreFormDefaults(){defaults++}});
  vm.runInContext("liveCanRun=()=>true;liveActivePage=()=> 'journal';liveStatus=()=>{}",c);
  await c.liveHistory(true);assert.equal(queriedUser,'owner');assert.equal(c.allTrades.length,1);assert.equal(renders,1);assert.equal(defaults,0);
});
test('late history after account switch or local reload cannot replace the current journal',async()=>{
  for(const action of ['account','reload']){
    const c=context();let resolve;
    Object.assign(c,{currentUser:{id:'owner'},allTrades:[{id:'kept'}],window:{_isDemoMode:false},sb:{from:()=>({select:()=>({eq:()=>({order:()=>new Promise(r=>{resolve=r;})})})})},journalWithTimeout:async p=>p});
    vm.runInContext("liveCanRun=()=>true;liveActivePage=()=> 'journal';liveStatus=()=>{}",c);
    const task=c.liveHistory(true);
    if(action==='account')c.currentUser={id:'new-owner'};else vm.runInContext('marketLive.historyRevision++',c);
    resolve({data:[{id:'old-answer'}]});await task;assert.equal(c.allTrades[0].id,'kept');
  }
});
