import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../journal.html',import.meta.url),'utf8');
function load(){const ctx=vm.createContext({Date,Math,Number,Map,Set,miClamp:(x,a,b)=>Math.max(a,Math.min(b,x)),miAverage:xs=>xs.reduce((s,x)=>s+x,0)/xs.length,miRSISeries:rows=>rows.map((_,i)=>80-i*.3)});
  vm.runInContext(html.slice(html.indexOf('function miATR('),html.indexOf('function miMACD(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function trendlineValidCandle('),html.indexOf('function trendlineBestSignal(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function elliottSwings('),html.indexOf('function elliottRenderChart(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function liquidityPoolStatus('),html.indexOf('function liquidityBuild(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function terminalStats('),html.indexOf('let edgeActivePeriod=')),ctx);return ctx;
}
const leg=(values=[100,110,105,125,115,130])=>Array.from({length:(values.length-1)*5+8},(_,i)=>{const index=Math.min(values.length-2,Math.floor(i/5)),value=i>=(values.length-1)*5?values.at(-1):values[index]+(values[index+1]-values[index])*(i%5)/5;return {time:i*60000,open:value,close:value,low:value-.001,high:value+.001,volume:100};});
const points=(provisional=false)=>[100,110,105,125,115,130].map((price,i)=>({price,index:i*5,time:i*300000,type:i%2?'high':'low',provisional:provisional&&i===5}));
const closes=(price=118,count=30)=>Array.from({length:count},(_,i)=>({time:i*300000,open:price,close:price,low:price-.1,high:price+.1,volume:100}));

test('a lower-timeframe fragment or history gap cannot prove a parent wave',()=>{const c=load(),rows=leg();const start={time:0,price:100},end={time:1500000,price:130};
  assert.equal(c.elliottSubdivisionEvidence(rows.slice(8),start,end,'bull').available,false);
  assert.equal(c.elliottSubdivisionEvidence(rows.slice(0,22),start,end,'bull').available,false);
  assert.equal(c.elliottSubdivisionEvidence(rows.filter((_,i)=>i!==12),start,end,'bull').available,false);
  assert.equal(c.elliottSubdivisionEvidence(rows,start,end,'bull').verified,true);
});
test('an embedded five-wave fragment is insufficient to prove the whole leg',()=>{const c=load(),p=points();assert.equal(c.elliottMicroMotive(p,'bull').verified,true);assert.equal(c.elliottMicroMotive([...p,{type:'low',price:120,index:30},{type:'high',price:140,index:35}],'bull').verified,false);});
test('price crossing without proven subdivisions stays a candidate',()=>{const c=load(),result=c.elliottImpulseCandidate(points(),'bull',closes(),1,false,{},'1h');assert.ok(result);assert.equal(result.confirmed,false);assert.equal(result.trendlineConfirmed,false);assert.equal(c.elliottStatusText(result),'КАНДИДАТ');});
test('a provisional fifth pivot never completes a confirmed count',()=>{const c=load();c.elliottSubdivisionEvidence=(_,a,b,dir,mode)=>({available:true,verified:true,pattern:mode==='three'?'three':'impulse',detail:'controlled full structure'});const result=c.elliottImpulseCandidate(points(true),'bull',closes(),1,false,{},'1h');assert.ok(result);assert.equal(result.confirmed,false);assert.equal(result.trendlineConfirmed,false);});
test('completed impulse reversal targets face the triggered direction and expire',()=>{const c=load();c.elliottSubdivisionEvidence=(_,a,b,dir,mode)=>({available:true,verified:true,pattern:mode==='three'?'three':'impulse',detail:'controlled full structure'});const result=c.elliottImpulseCandidate(points(),'bull',closes(),1,false,{},'1h');assert.equal(result.trendlineConfirmed,true);assert.equal(result.scenarioDirection,'short');assert.ok(result.targetTwo<result.current);assert.equal(result.invalidation,130);const expired=c.elliottImpulseCandidate(points(),'bull',closes(118,35),1,false,{},'1h');assert.equal(expired.trendlineConfirmed,false);assert.equal(c.elliottStatusText(expired),'ТРИГГЕР УСТАРЕЛ');});
test('a confirmed wave reversal is cancelled after price breaks its last extreme',()=>{const c=load(),rows=closes();rows[29].high=132;const result=c.elliottFinalizeCandidate({type:'impulse',partial:false,points:points(),direction:'bull',confirmed:true,current:118},rows,1);assert.equal(result.cancelled,true);assert.equal(result.trendlineConfirmed,false);assert.equal(result.targetOne,null);});
test('all liquidity level kinds retain a historical sweep after price returns',()=>{const c=load();for(const kind of ['period','cluster']){assert.equal(c.liquidityPoolStatus({side:'above',price:100,formedAt:1000,kind},90,[{time:0,high:110},{time:1000,high:105},{time:2000,high:95}]),'swept');assert.equal(c.liquidityPoolStatus({side:'below',price:100,formedAt:1000,kind},110,[{time:0,low:90},{time:1000,low:95},{time:2000,low:105}]),'swept');assert.equal(c.liquidityPoolStatus({side:'above',price:100,formedAt:2000,kind},90,[{time:0,high:110},{time:1000,high:105},{time:2000,high:95}]),'live');}});
test('position percentages never become account P&L and unknown R is not fabricated',()=>{const c=load(),trades=[{status:'closed',result:'win',pnl_usd:10,pnl_pct:10,created_at:'2026-10-01'},{status:'closed',result:'loss',pnl_usd:-10,pnl_pct:-1,created_at:'2026-10-02'},{status:'open',pnl_usd:null,pnl_pct:null}];const stats=c.terminalStats(trades);assert.equal(stats.net,0);assert.equal(stats.maxDD,10);assert.equal(stats.rCount,0);assert.equal(stats.valid.length,2);assert.equal(stats.expectancy,0);assert.equal(stats.entries[0].r,null);});
test('R uses actual exit rather than the planned target and excludes missing stops',()=>{const c=load(),stats=c.terminalStats([{result:'win',pnl_usd:10,entry_price:100,stop_loss:95,exit_price:110,take_profit:150,direction:'long'},{result:'loss',pnl_usd:-10,entry_price:100,stop_loss:null,exit_price:90,direction:'long'}]);assert.equal(stats.netR,2);assert.equal(stats.rCount,1);assert.equal(stats.entries[1].r,null);});
test('cancelled and late trend triggers are inactive for every consuming tool',()=>{const c=load(),rows=closes(98,8),make=()=>({side:'support',slope:.1,anchorOne:{index:0,price:100},closed:rows.slice(0,-1),all:rows,live:rows.at(-1),broken:true,breakIndex:3,retestHeld:true,retestIndex:4,current:98,currentLine:100.7,buffer:.2,atr:1,distanceAtr:1,stateKey:'entry',direction:'short',entryReady:true,plan:{entry:100}});const result=make();rows[7].close=103;assert.equal(c.trendlineApplyLifecycle(result,'15m').entryReady,false);assert.equal(result.cancelled,true);rows[7].close=98;const late=make();late.breakIndex=1;late.retestIndex=1;c.trendlineApplyLifecycle(late,'15m');assert.equal(late.expired,true);assert.equal(late.entryReady,false);});
test('forming-bar invalidation cancels a wave trigger even when its close returns inside',()=>{const c=load(),result=c.elliottFinalizeCandidate({type:'impulse',partial:false,points:points(),direction:'bull',confirmed:true,current:118},closes(),1);assert.equal(result.trendlineConfirmed,true);c.elliottApplyLiveLifecycle(result,{close:118,high:132,low:117},1);assert.equal(result.cancelled,true);assert.equal(result.trendlineConfirmed,false);assert.equal(result.targetOne,null);});
test('already reached wave targets disappear after a live quote update',()=>{const c=load(),result={current:118,trendlineConfirmed:false,scenarioDirection:'short',targetOne:115,targetTwo:110};c.elliottApplyLiveLifecycle(result,{close:114,high:116,low:113},1);assert.equal(result.targetOne,null);assert.equal(result.targetTwo,110);});
test('period liquidity uses the previous UTC calendar day and excludes incomplete days',()=>{
  const c=load(),now=Date.now(),day=86400000,today=Math.floor(now/day)*day;
  vm.runInContext(html.slice(html.indexOf('function liquidityStaticPools('),html.indexOf('function liquidityPoolStatus(')),c);
  const rows=Array.from({length:48},(_,i)=>({time:today-day*2+i*3600000,high:100+i,low:80+i}));
  c.marketIntelState={candles:{'1h':[...rows,{time:today,high:999,low:1}],'4h':[]}};
  const pools=c.liquidityStaticPools(),high=pools.find(x=>x.short==='PDH'),low=pools.find(x=>x.short==='PDL');assert.equal(high.price,147);assert.equal(low.price,104);assert.equal(high.formedAt,today);
  c.marketIntelState.candles['1h'].splice(30,1);assert.equal(c.liquidityStaticPools().some(x=>x.short==='PDH'),false);
});
test('unknown R is excluded from grouped averages and cannot confirm a statistical edge',()=>{
  const c=load();vm.runInContext(html.slice(html.indexOf('function reviewGroupEntries('),html.indexOf('function reviewRenderContextList(')),c);vm.runInContext(html.slice(html.indexOf('function edgeStatus('),html.indexOf('function edgeRenderCurve(')),c);
  const groups=c.reviewGroupEntries([{trade:{pair:'BTC'},r:2},{trade:{pair:'BTC'},r:null}],t=>t.pair);assert.equal(groups[0].avg,2);assert.equal(groups[0].n,1);assert.equal(groups[0].total,2);
  const stats=c.terminalStats(Array.from({length:30},()=>({pnl_usd:10,result:'win'})));assert.equal(c.edgeStatus(stats,100).code,'НЕПОЛНЫЕ ДАННЫЕ');
});
test('AI receives cash P&L with explicit USD units and missing account ROI',()=>{
  const source=readFileSync(new URL('../api/ai.js',import.meta.url),'utf8'),ctx=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function buildStatsLine('),source.indexOf('function summarizeTrades(')),ctx);
  const summary=ctx.buildStatsLine({totalPnl:10,totalPnlUnit:'USD',knownCashResults:2,closedTrades:3});assert.match(summary,/10 USD/);assert.match(summary,/2\/3/);assert.match(summary,/ROI счёта неизвестен/);assert.doesNotMatch(summary,/10%/);
});
