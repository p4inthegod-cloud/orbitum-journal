import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/journal-ledger-model.js',import.meta.url),'utf8');
function context(){const c=vm.createContext({Date,Map,Set,Number,Math,JSON,allTrades:[],document:{getElementById:id=>({value:({'f-pair':'HYPE','f-entry':'100','f-dep':'1000','f-sl':'95','f-exit':'110','f-lev':'10'})[id]||''})},currentUser:{id:'owner'},currentDir:'long',currentTF:'1H',currentRegime:'TREND',currentSetup:'',currentMistakes:new Set(),emVals:{conf:5,fear:3,greed:3,calm:7}});vm.runInContext(source,c);return c;}
test('an open trade has nullable result and P&L, a separate planned target and actual notional',()=>{const c=context(),t=c.ledgerFormTrade();assert.equal(t.status,'open');assert.equal(t.result,null);assert.equal(t.pnl_usd,null);assert.equal(t.pnl_pct,null);assert.equal(t.exit_price,null);assert.equal(t.take_profit,110);assert.equal(t.deposit,1000);assert.equal(t.leverage,10);assert.equal(t.pair,'HYPE/USDT');});
test('full notional determines risk and reward without another leverage multiplier',()=>{const c=context(),p=c.ledgerPlan({entry:100,size:1000,stop:95,target:110});assert.equal(p.qty,10);assert.equal(p.risk,50);assert.equal(p.reward,100);assert.equal(p.rr,2);});
test('closing long or short derives the result from actual exit and costs, including zero',()=>{const c=context();for(const direction of ['long','short']){const t={entry_price:100,deposit:1000,direction};const r=c.ledgerSettlement(t,{exit:direction==='long'?110:90,net:null,fees:5});assert.equal(r.pnl_usd,95);assert.equal(r.result,'win');assert.equal(r.pnl_pct,9.5);assert.equal(c.ledgerSettlement(t,{exit:100,net:null,fees:0}).result,'be');assert.equal(c.ledgerSettlement(t,{exit:100,net:null,fees:5}).result,'loss');}});
test('manual net P&L has priority and fees are not charged twice',()=>{const c=context(),r=c.ledgerSettlement({entry_price:100,deposit:1000,direction:'long'},{exit:110,net:-20,fees:5});assert.equal(r.result,'loss');assert.equal(r.pnl_usd,-20);assert.equal(c.ledgerSettlement({deposit:1000},{net:0,fees:0}).result,'be');});
test('missing or invalid execution cannot silently close a trade',()=>{const c=context();assert.throws(()=>c.ledgerSettlement({entry_price:100,deposit:1000},{exit:null,net:null}));assert.throws(()=>c.ledgerSettlement({entry_price:100,deposit:1000},{exit:-1,net:5}));assert.throws(()=>c.ledgerSettlement({entry_price:100,deposit:1000},{exit:110,fees:-1}));assert.equal(c.ledgerNumber(''),null);assert.equal(c.ledgerNumber('0'),0);assert.equal(c.ledgerNumber('1,5'),1.5);});
test('closed analytics exclude open records and attribute lifecycle results to the close date',()=>{const c=context(),rows=[{status:'open',pnl_usd:999},{result:'win',created_at:'2026-09-01'},{status:'closed',created_at:'2026-09-02',payload:{journal:{closed_at:'2026-10-03'}}}];const closed=c.ledgerClosed(rows);assert.equal(closed.length,2);assert.equal(closed[0].created_at,'2026-10-03');assert.equal(closed[1].created_at,'2026-09-01');assert.equal(rows[2].created_at,'2026-09-02');});
test('invalid long and short level geometry is rejected while optional stop/target stays optional',()=>{const c=context();assert.equal(c.ledgerPlan({entry:100,size:1000,stop:105,direction:'long'}).invalidStop,true);assert.equal(c.ledgerPlan({entry:100,size:1000,target:110,direction:'short'}).invalidTarget,true);const p=c.ledgerPlan({entry:100,size:1000,stop:null,target:null});assert.equal(p.invalidStop,false);assert.equal(p.risk,null);assert.equal(p.reward,null);});
test('authenticated closing is scoped to the owner and open status, rejecting a zero-row update',async()=>{
  const c=context(),calls=[],query={update:()=>query,eq:(key,value)=>{calls.push([key,value]);return query;},select:()=>Promise.resolve({data:[],error:null})};
  c.window={_isDemoMode:false};c.sb={from:name=>{assert.equal(name,'trades');return query;}};c.journalWithTimeout=task=>task;
  await assert.rejects(c.ledgerPersist({status:'closed',pnl_usd:0,result:'be'},'17',true));
  assert.deepEqual(calls,[['id','17'],['user_id','owner'],['status','open']]);assert.equal(c.allTrades.length,0);
});
test('successful database persistence preserves null open results and rejects late account switching',async()=>{
  const c=context(),row={id:1,user_id:'owner',status:'open',result:null,pnl_usd:null};let refresh=0;
  c.window={_isDemoMode:false};c.journalWithTimeout=task=>task;c.updateStatsEnhanced=c.render=c.renderDashboard=c.renderProgress=c.renderLevelBar=()=>refresh++;
  const query={insert:rows=>{assert.equal(rows[0].result,null);return query;},select:()=>Promise.resolve({data:[row],error:null})};c.sb={from:()=>query};
  await c.ledgerPersist({result:null});assert.equal(c.allTrades[0].id,1);assert.equal(refresh,5);
  query.select=()=>{c.currentUser={id:'other'};return Promise.resolve({data:[{...row,id:2}],error:null});};
  await assert.rejects(c.ledgerPersist({result:null}));assert.equal(c.allTrades.length,1);
});
