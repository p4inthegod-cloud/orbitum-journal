import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../journal.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function trendlineValidCandle('),html.indexOf('function trendlineBestSignal('));
const atr=html.slice(html.indexOf('function miATR('),html.indexOf('function miMACD('));
const ctx=vm.createContext({Math,Number,Date,miClamp:(x,a,b)=>Math.max(a,Math.min(b,x)),miAverage:xs=>xs.reduce((a,b)=>a+b,0)/xs.length});
vm.runInContext(atr+'\n'+source+'\nthis.detect=trendlineDetect;this.at=trendlineAt;',ctx);
const candles=(slope=.15,scale=1,count=150)=>Array.from({length:count},(_,i)=>{
  const close=(100+slope*i+Math.cos(i*Math.PI/10)*2)*scale;
  return {time:Date.UTC(2026,9,2)+i*900000,open:close-.2*scale,close,high:close+1*scale,low:close-1*scale,volume:100};
});

test('ascending support and descending resistance use real confirmed pivots at every price scale',()=>{
  for(const scale of [.00000001,.01,1,1000])for(const slope of [.15,-.15]){
    const result=ctx.detect(candles(slope,scale),'15m');
    assert.equal(result.found,true);
    assert.equal(result.side,slope>0?'support':'resistance');
    assert.ok(slope>0?result.slope>0:result.slope<0);
    assert.ok(Math.abs(result.anchorTwo.price-result.anchorOne.price)>=result.tolerance*2);
    assert.equal(result.all[result.anchorOne.index].time,result.anchorOne.time);
    assert.equal(result.all[result.anchorTwo.index].time,result.anchorTwo.time);
    for(let i=result.anchorOne.index+1;i<result.anchorTwo.index;i++){
      const level=ctx.at(result,i);
      assert.ok(result.side==='support'?result.closed[i].low>=level-result.tolerance:result.closed[i].high<=level+result.tolerance);
    }
  }
});
test('horizontal range and insufficient or invalid candles do not create a directional line',()=>{
  assert.equal(ctx.detect(candles(0),'15m').found,false);
  assert.equal(ctx.detect(candles(.15,1,35),'15m').found,false);
  const bad=candles();bad[40].high=NaN;
  assert.equal(ctx.detect(bad,'15m').found,false);
});
test('an unfinished retest candle cannot confirm entry',()=>{
  const rows=candles(.15,1,120);
  for(let i=116;i<119;i++){rows[i].close=108;rows[i].open=109;rows[i].low=107;rows[i].high=110;}
  rows[119]={...rows[119],open:108,close:108,high:124,low:107};
  const result=ctx.detect(rows,'15m');
  assert.equal(result.found,true);assert.equal(result.broken,true);
  assert.equal(result.retestIndex,-1);assert.equal(result.entryReady,false);
});
