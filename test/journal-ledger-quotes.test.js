import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/journal-ledger.js',import.meta.url),'utf8');
const fetcher=source.slice(source.indexOf('async function ledgerFetchQuote('),source.indexOf('function ledgerScheduleQuoteRender('));
function context(overrides){const c=vm.createContext({AbortController,Number,Promise,Error,encodeURIComponent,setTimeout,clearTimeout,...overrides});vm.runInContext(fetcher,c);return c;}
test('a slow primary quote is bypassed by a valid backup and pending requests are cancelled',async()=>{
  let primarySignal,backupCalls=0;const c=context({miBinance:(_,signal)=>{primarySignal=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Aborted'))));},miFetchJSON:async url=>{backupCalls++;assert.ok(url.includes('symbol=AVAXUSDT'));return{retCode:0,result:{list:[{symbol:'OTHER',lastPrice:'999'},{symbol:'AVAXUSDT',lastPrice:'11.1'}]}};}});
  const quote=await c.ledgerFetchQuote('AVAXUSDT');assert.equal(quote.price,11.1);assert.equal(quote.source,'Bybit Spot');assert.equal(backupCalls,1);assert.equal(primarySignal.aborted,true);
});
test('a quick primary avoids unnecessary backup requests',async()=>{
  const c=context({miBinance:async()=>({price:'100'}),miFetchJSON:()=>{throw Error('Backup should not start');}});
  const quote=await c.ledgerFetchQuote('BTCUSDT');assert.equal(quote.price,100);assert.equal(quote.source,'Binance Spot');
});
test('invalid prices or exchange errors cannot become a live quote',async()=>{
  const c=context({miBinance:async()=>({price:'NaN'}),miFetchJSON:async()=>({retCode:10001,result:{list:[{symbol:'BTCUSDT',lastPrice:'100'}]}})});
  await assert.rejects(c.ledgerFetchQuote('BTCUSDT'));
});
