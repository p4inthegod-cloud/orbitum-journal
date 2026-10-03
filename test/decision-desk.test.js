import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/journal-decision.js',import.meta.url),'utf8');
const ctx=vm.createContext({miFmtPrice:n=>String(n),environmentDirectiveLabel:s=>s,MI_TF_LABELS:{'15m':'15 минут','1h':'1 час'},Date});
vm.runInContext(source.slice(source.indexOf('function decisionFactors('),source.indexOf('function decisionInstall(')),ctx);
const now=Date.now(),meta={age:0,calendarAt:now,calendarSource:'finnhub',calendarAge:0,now};
const result=()=>({direction:'long',best:100,spread:90,hardBlock:false,copy:'Дневной запрет',analysis:{dailyTrend:{label:'Восходящий',tone:'good'},inds:{'15m':{rsi:60},'1h':{rsi:60,volumeRatio:1.2}}},levels:{support:90,resistance:110},directive:{code:'SELECTIVE',copy:'Наблюдать подтверждение'},today:[],maxTrades:4,lock:{lock:false}});
test('a 100-point bias without a trigger waits for confirmation',()=>{const m=ctx.decisionBuildModel(result(),meta);assert.equal(m.state,'waiting');assert.equal(m.title,'ЖДАТЬ ПОДТВЕРЖДЕНИЕ');});
test('only a recent aligned confirmed retest is ready',()=>{const r=result();r.trendlineSignal={entryReady:true,direction:'long',tf:'15m',retestTime:now-600000};assert.equal(ctx.decisionBuildModel(r,meta).state,'ready');r.trendlineSignal.direction='short';assert.equal(ctx.decisionBuildModel(r,meta).state,'waiting');r.trendlineSignal.direction='long';r.trendlineSignal.retestTime=now-3600000;assert.equal(ctx.decisionBuildModel(r,meta).state,'waiting');});
test('unknown calendar, stale quotes and market pause cannot claim readiness',()=>{const r=result();r.trendlineSignal={entryReady:true,direction:'long',tf:'15m',retestTime:now};assert.equal(ctx.decisionBuildModel(r,{...meta,calendarSource:'unavailable'}).title,'ПРОВЕРИТЬ СРЕДУ');assert.equal(ctx.decisionBuildModel(r,{...meta,age:121}).title,'ОБНОВИТЬ ДАННЫЕ');r.directive.code='WAIT';assert.equal(ctx.decisionBuildModel(r,meta).state,'blocked');});
test('missing RSI is unknown and bearish context conflicts with a long scenario',()=>{const r=result();r.analysis.inds['15m'].rsi=null;r.analysis.inds['1h'].rsi=null;assert.equal(ctx.decisionFactors(r)[1].state,'unknown');r.analysis.dailyTrend.tone='bad';assert.equal(ctx.decisionFactors(r)[0].state,'against');});
test('long and short sizes use real stop distance and quote risk',()=>{for(const [side,stop,target] of [['long',95,110],['short',105,90]]){const p=ctx.decisionPosition(side,100,stop,target,10);assert.equal(p.valid,true);assert.equal(p.quantity,2);assert.equal(p.notional,200);assert.equal(p.rr,2);assert.equal(p.distancePct,5);}});
test('invalid stop, zero risk, missing price and wrong target never form a valid order plan',()=>{assert.equal(ctx.decisionPosition('long',100,101,110,10).valid,false);assert.equal(ctx.decisionPosition('short',100,99,90,10).valid,false);assert.equal(ctx.decisionPosition('long',100,95,110,0).valid,false);assert.equal(ctx.decisionPosition('long',NaN,95,110,10).valid,false);assert.equal(ctx.decisionPosition('long',100,95,90,10).targetValid,false);});

test('decision handoff replaces stale journal notional and closed-result fields without saving a trade',()=>{
  const fields=Object.fromEntries(['bs-action','decision-entry','decision-stop','decision-target','f-dep','f-entry','f-sl','f-exit','f-risk','f-usd','f-pnl','ledger-actual-exit','ledger-fees'].map(id=>[id,{value:'stale',disabled:false}]));
  let stored=0,mode,page;
  const transfer=source.slice(source.indexOf('  battlePrepareTrade=function(){'),source.indexOf('  setInterval(',source.indexOf('  battlePrepareTrade=function(){')));
  const handoff=vm.createContext({decisionModel:{side:'long',riskUsd:10,effectivePct:1},battleState:{symbol:'HYPE'},battleEl:id=>fields[id],decisionPosition:ctx.decisionPosition,setPair:v=>{fields.pair=v;},setDir:v=>{fields.direction=v;},ledgerSetMode:v=>{mode=v;},ledgerStoreDraft:()=>{stored++;},calcRR:()=>{},showPage:v=>{page=v;},document:{querySelector:()=>null}});
  vm.runInContext(transfer,handoff);
  for(const [side,stop,target] of [['long','95','110'],['short','105','90']]){
    handoff.decisionModel.side=side;fields['decision-entry'].value='100';fields['decision-stop'].value=stop;fields['decision-target'].value=target;fields['f-dep'].value='9999';
    handoff.battlePrepareTrade();assert.equal(fields['f-dep'].value,'200');assert.equal(fields['f-entry'].value,'100');assert.equal(fields['f-exit'].value,target);assert.equal(fields.pair,'HYPE/USDT');assert.equal(fields.direction,side);assert.equal(mode,'open');assert.equal(page,'journal');
    for(const id of ['f-usd','f-pnl','ledger-actual-exit','ledger-fees'])assert.equal(fields[id].value,'');
  }
  assert.equal(stored,2);fields['bs-action'].disabled=true;handoff.battlePrepareTrade();assert.equal(stored,2);
  fields['bs-action'].disabled=false;handoff.decisionModel.riskUsd=0;handoff.battlePrepareTrade();assert.equal(stored,2);
});