import {createHmac,createHash} from 'node:crypto';

export const OKX_HOSTS={global:'https://openapi.okx.com',eu:'https://eea.okx.com',us:'https://us.okx.com',tr:'https://tr.okx.com'};
const PATHS=new Set(['/api/v5/account/config','/api/v5/account/positions','/api/v5/account/positions-history','/api/v5/trade/orders-algo-pending','/api/v5/public/instruments','/api/v5/public/time']);
export class OkxError extends Error{constructor(code,status=502){super(code);this.code=code;this.status=status;}}
export function number(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
export function credentials(input){
 const c={apiKey:String(input.apiKey||'').trim(),secretKey:String(input.secretKey||'').trim(),passphrase:String(input.passphrase||''),region:input.region||'global',demo:input.demo===true};
 if(!Object.hasOwn(OKX_HOSTS,c.region)||!c.apiKey||!c.secretKey||!c.passphrase||[c.apiKey,c.secretKey,c.passphrase].some(v=>v.length>256||/[\r\n\x00]/.test(v)))throw new OkxError('invalid_credentials',400);
 return c;
}
export function signature(secret,timestamp,path){return createHmac('sha256',secret).update(timestamp+'GET'+path).digest('base64');}
export function readOnly(account){return String(account?.perm||'').split(',').map(x=>x.trim()).filter(Boolean).join(',')==='read_only';}
export function exchangeError(code){return ['50101','50102','50105','50110','50111','50113','50119','50120'].includes(String(code))?'okx_auth':String(code)==='50011'?'okx_rate_limit':'okx_unavailable';}
export function okxClient(c,{fetcher=fetch,now=Date.now}={}){
 let offset=0;
 const get=async(path,params={},isPublic=false)=>{
  if(!PATHS.has(path))throw new OkxError('unsupported_endpoint',400);
  const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null)).toString(),requestPath=path+(query?'?'+query:''),headers={Accept:'application/json'};
  if(c.demo)headers['x-simulated-trading']='1';
  if(!isPublic){const timestamp=new Date(now()+offset).toISOString();Object.assign(headers,{'OK-ACCESS-KEY':c.apiKey,'OK-ACCESS-SIGN':signature(c.secretKey,timestamp,requestPath),'OK-ACCESS-TIMESTAMP':timestamp,'OK-ACCESS-PASSPHRASE':c.passphrase});}
  let response,data;
  try{response=await fetcher(OKX_HOSTS[c.region]+requestPath,{method:'GET',headers,signal:AbortSignal.timeout(6500),redirect:'error'});data=await response.json();}catch{throw new OkxError('okx_unavailable');}
  if(!response.ok||String(data.code)!=='0'||!Array.isArray(data.data))throw new OkxError(exchangeError(data.code));
  return data.data;
 };
 return {get,async clock(){const start=now(),rows=await get('/api/v5/public/time',{},true),time=number(rows[0]?.ts);if(time===null)throw new OkxError('okx_unavailable');offset=time-(start+now())/2;}};
}
export async function paginated(client,path,params,cursorField,maxPages=5){
 const rows=[];let after;
 for(let page=0;page<maxPages;page++){
  const batch=await client.get(path,{...params,limit:100,after});rows.push(...batch);if(batch.length<100)return rows;
  const next=String(batch.at(-1)?.[cursorField]||'');if(!next||next===after)throw new OkxError('incomplete_snapshot');after=next;
 }
 // An incomplete list cannot establish that a position/order disappeared.
 throw new OkxError('incomplete_snapshot');
}
const supported=p=>['SWAP','FUTURES'].includes(p.instType)&&/^[A-Z0-9]+-USDT-(SWAP|\d{6})$/.test(p.instId||'');
const direction=p=>p.posSide==='short'||p.posSide==='net'&&number(p.pos)<0?'short':'long';
const iso=time=>{const n=number(time);if(!(n>0))throw new OkxError('invalid_position');return new Date(n).toISOString();};
const prefix=c=>c.region+':'+(c.demo?'demo':'live')+':'+c.account_uid;
const identity=(p,c)=>[prefix(c),p.instId,String(p.posId),p.posSide||'net',p.direction||direction(p),String(p.cTime)].join(':');
const hash=value=>createHash('sha256').update(value).digest('hex');
function baseQuantity(p,instruments){
 const spec=instruments.get(p.instId),contracts=Math.abs(number(p.pos)??0),ctVal=number(spec?.ctVal),mult=number(spec?.ctMult)||1;
 if(!spec||spec.ctType!=='linear'||spec.settleCcy!=='USDT'||!(ctVal>0)||spec.ctValCcy!==p.instId.split('-')[0])throw new OkxError('invalid_instrument');
 return contracts*ctVal*mult;
}
export function orderLevels(p,orders){
 const opposite=direction(p)==='short'?'buy':'sell';
 const matching=orders.filter(o=>o.instId===p.instId&&o.tdMode===p.mgnMode&&(o.posSide||'net')===(p.posSide||'net')&&o.side===opposite&&(p.posSide!=='net'||String(o.reduceOnly)==='true')&&(String(o.closeFraction)==='1'||number(o.sz)>=Math.abs(number(p.pos))));
 const unique=field=>{const prices=[...new Set(matching.map(o=>number(o[field])).filter(n=>n>0))];return prices.length===1?prices[0]:null;};
 // A moved stop may protect profit beyond the entry. Preserve the actual exchange level.
 return {stop_loss:unique('slTriggerPx'),take_profit:unique('tpTriggerPx')};
}
function matchingHistory(row,h){const x=row.payload?.exchange;return h.instId===x.instId&&String(h.posId)===x.posId&&String(h.cTime)===x.cTime&&(h.direction||h.posSide)===row.direction&&number(h.uTime)>=number(x.position_updated_at);}
function closure(row,h,now){
 const pnl=number(h.realizedPnl);if(pnl===null||!['2','3','6'].includes(String(h.type)))return null;
 return {...row,exit_price:number(h.closeAvgPx),status:'closed',result:pnl>0?'win':pnl<0?'loss':'be',pnl_usd:pnl,pnl_pct:null,payload:{...row.payload,journal:{...row.payload?.journal,closed_at:iso(h.uTime)},exchange:{...row.payload.exchange,sync_state:'closed',synced_at:new Date(now).toISOString(),closed_at:iso(h.uTime),realized_pnl:pnl,fee:number(h.fee),funding_fee:number(h.fundingFee),liquidation_penalty:number(h.liqPenalty),close_type:String(h.type)}}};
}
/** One journal row per observed position lifecycle; no close is inferred from absence alone. */
export function reconcile({connection,positions,history,instruments,orders=[],ordersAvailable=true,existing=[],now=Date.now()}){
 const rows=[],active=positions.filter(p=>supported(p)&&Math.abs(number(p.pos)||0)>0),seen=new Set();
 if(positions.some(p=>supported(p)&&(number(p.pos)===null||!p.posId||!p.cTime)))throw new OkxError('invalid_position');
 const relevant=existing.filter(t=>t.exchange==='okx'&&t.payload?.exchange?.account===prefix(connection));
 for(const p of active){
  const key=identity(p,connection);if(seen.has(key))throw new OkxError('invalid_position');seen.add(key);
  const entry=number(p.avgPx),mark=number(p.markPx),qty=baseQuantity(p,instruments);
  if(!(entry>0&&mark>0&&qty>0))throw new OkxError('invalid_position');
  let current=relevant.find(t=>t.status==='open'&&t.payload.exchange.position_key===key&&t.direction===direction(p));
  const closedSince=current&&history.filter(h=>matchingHistory(current,h)&&['2','3','6'].includes(String(h.type))&&number(h.uTime)<number(p.uTime)).sort((a,b)=>number(b.uTime)-number(a.uTime))[0];
  if(closedSince){const closed=closure(current,closedSince,now);if(!closed)throw new OkxError('incomplete_snapshot');rows.push(closed);current=null;}
  const prior=relevant.some(t=>t.payload.exchange.position_key===key)||Boolean(closedSince);
  const uid=current?.exchange_uid||hash(key+(prior?':reopened:'+p.uTime:''));
  const levels=ordersAvailable?orderLevels(p,orders):{stop_loss:current?.stop_loss??null,take_profit:current?.take_profit??null};
  rows.push({exchange:'okx',exchange_uid:uid,pair:p.instId.split('-').slice(0,2).join('/'),direction:direction(p),status:'open',result:null,pnl_usd:null,pnl_pct:null,entry_price:entry,exit_price:null,deposit:qty*entry,leverage:number(p.lever),created_at:current?.created_at||iso(prior?p.uTime:p.cTime),...levels,payload:{journal:{version:1},exchange:{source:'okx',account:prefix(connection),connection_id:connection.id,position_key:key,posId:String(p.posId),cTime:String(p.cTime),instId:p.instId,instType:p.instType,mgnMode:p.mgnMode,posSide:p.posSide,quantity:qty,contracts:Math.abs(number(p.pos)),mark_price:mark,unrealized_pnl:number(p.upl),realized_pnl:number(p.realizedPnl),liquidation_price:number(p.liqPx),position_updated_at:String(p.uTime),synced_at:new Date(now).toISOString(),sync_state:'active',orders_available:ordersAvailable}}});
 }
 for(const row of relevant.filter(t=>t.status==='open'&&!rows.some(r=>r.exchange_uid===t.exchange_uid))){
  const found=history.filter(h=>matchingHistory(row,h)&&['2','3','6'].includes(String(h.type))).sort((a,b)=>number(b.uTime)-number(a.uTime))[0];
  const closed=found&&closure(row,found,now);
  if(closed)rows.push(closed);
  else rows.push({...row,payload:{...row.payload,exchange:{...row.payload.exchange,sync_state:'pending_close'}}});
 }
 // Recover lifecycles that opened and closed between background polls.
 for(const h of history){
  if(!supported(h)||!['2','3','6'].includes(String(h.type))||number(h.uTime)<=Date.parse(connection.created_at)||number(h.realizedPnl)===null)continue;
  if([...relevant,...rows].some(t=>t.payload.exchange.instId===h.instId&&t.payload.exchange.posId===String(h.posId)&&t.payload.exchange.closed_at===iso(h.uTime)))continue;
  // An observed open record awaiting a complete result owns this lifecycle.
  if(rows.some(t=>t.status==='open'&&matchingHistory(t,h)&&number(h.uTime)>=number(t.payload.exchange.position_updated_at)))continue;
  const spec=instruments.get(h.instId);if(!spec)continue;
  const entry=number(h.openAvgPx),qty=baseQuantity({...h,pos:h.openMaxPos},instruments);if(!(entry>0&&qty>0)||!['long','short'].includes(h.direction))continue;
  const key=identity(h,connection),seed={exchange:'okx',exchange_uid:hash(key+':closed:'+h.uTime),pair:h.instId.split('-').slice(0,2).join('/'),direction:h.direction,entry_price:entry,deposit:qty*entry,leverage:number(h.lever),stop_loss:null,take_profit:null,created_at:iso(h.cTime),payload:{journal:{version:1},exchange:{source:'okx',account:prefix(connection),connection_id:connection.id,position_key:key,posId:String(h.posId),cTime:String(h.cTime),instId:h.instId,instType:h.instType,quantity:qty,position_updated_at:String(h.cTime)}}};
  rows.push(closure(seed,h,now));
 }
 return {rows,counts:{open:rows.filter(t=>t.status==='open').length,closed:rows.filter(t=>t.status==='closed').length,unsupported:positions.filter(p=>!supported(p)&&Math.abs(number(p.pos)||0)>0).length,ordersAvailable}};
}
