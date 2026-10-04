import test from 'node:test';
import assert from 'node:assert/strict';
import {credentials,signature,readOnly,okxClient,paginated,reconcile,orderLevels} from '../lib/okx-journal.js';
import {makeHandler} from '../api/okx.js';
const now=1700001000000,connection={id:'connection',region:'global',demo:false,account_uid:'1234',created_at:new Date(now-100000).toISOString()};
const position={instId:'BTC-USDT-SWAP',instType:'SWAP',posId:'987654321012345678',posSide:'net',pos:'10',avgPx:'100',markPx:'106',lever:'5',upl:'6',mgnMode:'cross',cTime:String(now-10000),uTime:String(now-1000)};
const instruments=new Map([[position.instId,{ctType:'linear',ctVal:'0.01',ctMult:'1',ctValCcy:'BTC',settleCcy:'USDT'}]]);
const run=options=>reconcile({connection,positions:[position],history:[],instruments,now,...options});
const closedHistory=(p=position)=>({...p,direction:p.pos==='-10'?'short':'long',openAvgPx:'100',openMaxPos:'10',closeAvgPx:'110',type:'2',uTime:String(now),realizedPnl:'0',fee:'-1',fundingFee:'1'});
test('contract quantity becomes entry notional once, without multiplying by leverage',()=>{
 const row=run().rows[0];assert.equal(row.deposit,10);assert.equal(row.payload.exchange.quantity,.1);assert.equal(row.pnl_usd,null);assert.equal(row.direction,'long');assert.equal(row.payload.exchange.posId,position.posId);
 const short=run({positions:[{...position,pos:'-10'}]}).rows[0];assert.equal(short.direction,'short');assert.notEqual(short.exchange_uid,row.exchange_uid);assert.equal(short.deposit,10);
});
test('updates and partial closes keep one lifecycle and its identity',()=>{
 const row=run().rows[0],update=run({positions:[{...position,pos:'5',avgPx:'102',uTime:String(now)}],existing:[row]}).rows[0];
 assert.equal(update.exchange_uid,row.exchange_uid);assert.ok(Math.abs(update.deposit-5.1)<1e-10);assert.equal(update.status,'open');assert.equal(update.created_at,row.created_at);
});
test('only a verified full close with actual realized P&L closes a record, including zero',()=>{
 const row=run().rows[0];let result=run({positions:[],existing:[row],history:[{...closedHistory(),type:'1'}]});assert.equal(result.rows[0].status,'open');assert.equal(result.rows[0].payload.exchange.sync_state,'pending_close');
 result=run({positions:[],existing:[row],history:[closedHistory()]});assert.equal(result.rows.length,1);assert.equal(result.rows[0].status,'closed');assert.equal(result.rows[0].pnl_usd,0);assert.equal(result.rows[0].result,'be');assert.equal(result.rows[0].payload.exchange.funding_fee,1);
 assert.equal(run({positions:[],existing:[row],history:[{...closedHistory(),realizedPnl:''}]}).rows[0].status,'open');
 assert.equal(run({positions:[],existing:[row]}).rows[0].payload.exchange.synced_at,row.payload.exchange.synced_at);
});
test('a reopened position using the same posId receives a separate lifecycle',()=>{
 const row=run().rows[0],closed=run({positions:[],existing:[row],history:[closedHistory()]}).rows[0];
 const reopened=run({positions:[{...position,uTime:String(now+1000)}],existing:[closed]}).rows[0];assert.notEqual(reopened.exchange_uid,row.exchange_uid);
 const simultaneous=run({positions:[{...position,uTime:String(now+1000)}],existing:[row],history:[closedHistory()]});assert.equal(simultaneous.rows.length,2);assert.equal(simultaneous.rows[0].status,'closed');assert.equal(simultaneous.rows[1].status,'open');
});
test('closed trades between polls are recovered without importing earlier history or duplicating them',()=>{
 const history=closedHistory(),row=run({positions:[],history:[history]}).rows[0];assert.equal(row.status,'closed');
 assert.equal(run({positions:[],history:[history],existing:[row]}).rows.length,0);
 assert.equal(run({connection:{...connection,created_at:new Date(now+1000).toISOString()},positions:[],history:[history]}).rows.length,0);
});
test('invalid snapshots fail and unsupported currency types are counted without false USD accounting',()=>{
 assert.throws(()=>run({positions:[{...position,pos:'NaN'}]}));assert.throws(()=>run({positions:[{...position,markPx:''}]}));assert.throws(()=>run({positions:[position,position]}));
 const other=run({positions:[{...position,instId:'BTC-USD-SWAP'}]});assert.equal(other.rows.length,0);assert.equal(other.counts.unsupported,1);
});
test('stop and target levels match side, margin mode and full close size; ambiguous orders stay unknown',()=>{
 const order={instId:position.instId,tdMode:'cross',posSide:'net',side:'sell',reduceOnly:'true',sz:'10',slTriggerPx:'95',tpTriggerPx:'110'};
 assert.deepEqual(orderLevels(position,[order]),{stop_loss:95,take_profit:110});
 assert.equal(orderLevels(position,[{...order,side:'buy'}]).stop_loss,null);assert.equal(orderLevels(position,[{...order,sz:'2'}]).take_profit,null);
 assert.equal(orderLevels(position,[order,{...order,slTriggerPx:'94'}]).stop_loss,null);
 assert.equal(orderLevels(position,[{...order,slTriggerPx:'103'}]).stop_loss,103);
 const row=run({orders:[order]}).rows[0];assert.equal(run({existing:[row],ordersAvailable:false}).rows[0].stop_loss,95);
});
test('keys with trading/withdraw permissions and arbitrary API hosts are rejected',()=>{
 assert.equal(readOnly({perm:'read_only'}),true);assert.equal(readOnly({perm:'read_only,trade'}),false);assert.equal(readOnly({perm:''}),false);
 assert.throws(()=>credentials({apiKey:'key',secretKey:'secret',passphrase:'pass',region:'https://attacker.example'}));assert.throws(()=>credentials({apiKey:'key\nheader',secretKey:'secret',passphrase:'pass'}));
 for(const region of ['constructor','__proto__','toString'])assert.throws(()=>credentials({apiKey:'key',secretKey:'secret',passphrase:'pass',region}));
});
test('the client signs GET path including its query and refuses trading endpoints',async()=>{
 const c=credentials({apiKey:'key',secretKey:'secret',passphrase:'pass',demo:true}),calls=[];
 const client=okxClient(c,{now:()=>now,fetcher:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({code:'0',data:[{ts:String(now)}]})};}});
 await client.clock();await client.get('/api/v5/account/positions',{instType:'SWAP'});const call=calls[1];assert.equal(call.options.method,'GET');assert.equal(call.options.headers['x-simulated-trading'],'1');assert.equal(call.options.headers['OK-ACCESS-SIGN'],signature('secret',new Date(now).toISOString(),'/api/v5/account/positions?instType=SWAP'));
 await assert.rejects(client.get('/api/v5/trade/order'));assert.equal(calls.length,2);
});
test('incomplete pagination fails instead of asserting that missing positions closed',async()=>{
 await assert.rejects(paginated({get:async()=>Array.from({length:100},()=>({uTime:'123'}))},'/api/v5/account/positions-history',{},'uTime',2));
});
function response(){return{code:0,value:null,setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;return this;},end(){return this;}};}
const env={SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_KEY:'server-key'};
test('unauthenticated requests cannot read connection data or send OKX credentials upstream',async()=>{
 let calls=0;const handler=makeHandler({env,fetcher:async()=>{calls++;return{ok:false};}}),res=response();await handler({method:'POST',headers:{},body:{action:'connect',apiKey:'private'}},res);assert.equal(res.code,401);assert.equal(calls,0);
});
test('the owner always comes from verified Auth, never from a client user_id',async()=>{
 const id='11111111-1111-4111-8111-111111111111',calls=[];
 const handler=makeHandler({env,fetcher:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id}:{connected:false}};}}),res=response();await handler({method:'GET',headers:{authorization:'Bearer valid'},body:{user_id:'other'}},res);
 assert.equal(res.code,200);assert.equal(JSON.parse(calls[1].options.body).owner,id);assert.equal(calls[0].options.headers.Authorization,'Bearer valid');assert.ok(!JSON.stringify(res.value).includes('server-key'));
});
test('failed OKX authentication returns a safe code without echoing the secret or exchange message',async()=>{
 const handler=makeHandler({env,fetcher:async(url)=>({ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id:'11111111-1111-4111-8111-111111111111'}:url.includes('/public/time')?{code:'0',data:[{ts:String(now)}]}:{code:'50113',msg:'private-secret',data:[]}}),now:()=>now}),res=response();
 await handler({method:'POST',headers:{authorization:'Bearer valid'},body:{action:'connect',apiKey:'private-key',secretKey:'private-secret',passphrase:'private-pass'}},res);assert.equal(res.value.error,'okx_auth');assert.ok(!JSON.stringify(res.value).includes('private-'));
});
test('connect and sync authenticate the owner, verify read-only permissions and persist a scoped snapshot without returning credentials',async()=>{
 const owner='11111111-1111-4111-8111-111111111111';let connectionRow=null,stored=[],privateCalls=0;const rpcCalls=[];
 const fetcher=async(url,options)=>{
  const parsed=new URL(url);let data;
  if(parsed.pathname==='/auth/v1/user')data={id:owner};
  else if(parsed.pathname==='/rest/v1/rpc/okx_journal_service'){
   const {operation,owner:requestedOwner,value}=JSON.parse(options.body);assert.equal(requestedOwner,owner);rpcCalls.push(operation);
   if(operation==='connect'){connectionRow={...connection,id:'connection',account_uid:value.account_uid,credentials:value.credentials,lease:'11111111-1111-4111-8111-111111111112'};data={connected:true};}
   else if(operation==='claim')data=connectionRow;
   else if(operation==='finish'){stored=value.rows.map((t,i)=>({...t,id:i+1,user_id:owner}));data=true;}
   else if(operation==='status')data={connected:true};
  }else if(parsed.pathname==='/rest/v1/trades'){assert.equal(parsed.searchParams.get('user_id'),'eq.'+owner);data=stored;}
  else if(parsed.pathname==='/api/v5/public/time')data={code:'0',data:[{ts:String(now)}]};
  else if(parsed.pathname==='/api/v5/public/instruments')data={code:'0',data:parsed.searchParams.get('instType')==='SWAP'?[{instId:position.instId,...instruments.get(position.instId)}]:[]};
  else{privateCalls++;assert.equal(options.method,'GET');assert.equal(options.headers['OK-ACCESS-KEY'],'test-only-key');data={code:'0',data:parsed.pathname==='/api/v5/account/config'?[{uid:'1234',perm:'read_only'}]:parsed.pathname==='/api/v5/account/positions'?[position]:[]};}
  return{ok:true,json:async()=>data};
 };
 const handler=makeHandler({env,fetcher,now:()=>now}),res=response();await handler({method:'POST',headers:{authorization:'Bearer valid'},body:{action:'connect',apiKey:'test-only-key',secretKey:'test-only-secret',passphrase:'test-only-pass',user_id:'someone-else'}},res);
 assert.equal(res.code,200);assert.equal(res.value.trades.length,1);assert.equal(res.value.trades[0].user_id,owner);assert.equal(res.value.trades[0].payload.exchange.unrealized_pnl,6);assert.ok(privateCalls>0);assert.deepEqual(rpcCalls,['connect','claim','finish','status']);assert.ok(!JSON.stringify(res.value).includes('test-only'));
});
test('an invalid background token cannot enumerate connections or trigger exchange requests',async()=>{
 const calls=[],handler=makeHandler({env,fetcher:async(url,options)=>{calls.push(url);assert.equal(JSON.parse(options.body).operation,'cron');return{ok:true,json:async()=>null};}}),res=response();
 await handler({method:'POST',headers:{},body:{action:'cron',token:'wrong'}},res);assert.equal(res.code,403);assert.equal(calls.length,1);assert.equal(res.value.error,'unauthorized');
});
