import {credentials,okxClient,readOnly,paginated,reconcile,OkxError} from '../lib/okx-journal.js';

// Credentials never leave the server. OKX calls are GET-only and use an endpoint allowlist.
export function makeHandler({env=process.env,fetcher=fetch,now=Date.now}={}){
 const request=async(url,options={})=>{try{return await fetcher(url,{...options,signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new OkxError('server_unavailable',503);}};
 const db=async(path,body)=>{
  const r=await request(env.SUPABASE_URL+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok)throw new OkxError('database_unavailable',503);return r.json();
 };
 const rpc=(operation,owner=null,value={})=>db('rpc/okx_journal_service',{operation,owner,value});
 const status=owner=>rpc('status',owner);
 const trades=owner=>db('trades?user_id=eq.'+encodeURIComponent(owner)+'&exchange=eq.okx&select=*&order=created_at.desc&limit=500');
 async function sync(owner){
  const claim=await rpc('claim',owner);if(!claim)return {connection:await status(owner),trades:await trades(owner)};
  try{
   const client=okxClient(claim.credentials,{fetcher,now});await client.clock();
   const account=(await client.get('/api/v5/account/config'))[0];if(!readOnly(account))throw new OkxError('read_only_required',400);
   if(String(account.uid)!==claim.account_uid)throw new OkxError('account_changed',409);
   const existing=await trades(owner),since=Math.min(Date.parse(claim.last_sync_at||claim.created_at),...existing.filter(t=>t.status==='open'&&t.payload?.exchange?.account===claim.region+':'+(claim.demo?'demo':'live')+':'+claim.account_uid).map(t=>Number(t.payload.exchange.position_updated_at)||now()));
   const [snapshot,history,specs]=await Promise.all([
    client.get('/api/v5/account/positions').then(positions=>({positions,at:now()})),
    paginated(client,'/api/v5/account/positions-history',{before:Math.max(0,since-1000)},'uTime'),
    Promise.all(['SWAP','FUTURES'].map(instType=>client.get('/api/v5/public/instruments',{instType},true)))
   ]);
   let orders=[],ordersAvailable=true;
   try{orders=(await Promise.all(['conditional','oco'].map(ordType=>paginated(client,'/api/v5/trade/orders-algo-pending',{ordType},'algoId')))).flat();}catch{ordersAvailable=false;}
   const result=reconcile({connection:claim,positions:snapshot.positions,history,instruments:new Map(specs.flat().map(s=>[s.instId,s])),orders,ordersAvailable,existing,now:snapshot.at});
   const applied=await rpc('finish',owner,{lease:claim.lease,rows:result.rows,counts:result.counts});
   if(!applied)throw new OkxError('connection_changed',409);
   return {connection:await status(owner),trades:await trades(owner)};
  }catch(error){await rpc('fail',owner,{lease:claim.lease,error:error instanceof OkxError?error.code:'server_unavailable'}).catch(()=>{});throw error;}
 }
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  const origin=req.headers?.origin;if(origin&&['https://orbitum.trade','https://www.orbitum.trade'].includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'method_not_allowed'});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_KEY)return res.status(503).json({error:'server_not_configured'});
  let body=req.body||{};try{if(typeof body==='string'){if(body.length>8192)throw Error();body=JSON.parse(body);}if(JSON.stringify(body).length>8192)throw Error();}catch{return res.status(400).json({error:'invalid_request'});}
  const action=req.method==='GET'?'status':body.action;
  try{
   if(action==='cron'){
    const owners=await rpc('cron',null,{token:String(body.token||'').slice(0,256)});if(!owners)return res.status(403).json({error:'unauthorized'});
    let cursor=0,updated=0,failed=0;const worker=async()=>{while(cursor<owners.length){const owner=owners[cursor++];try{await sync(owner);updated++;}catch{failed++;}}};
    await Promise.all([worker(),worker(),worker()]);return res.status(200).json({ok:true,updated,failed});
   }
   const token=String(req.headers?.authorization||'').match(/^Bearer (\S+)$/i)?.[1];if(!token||token.length>8192)return res.status(401).json({error:'unauthorized'});
   const response=await request(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+token}});
   if(!response.ok)return res.status(401).json({error:'unauthorized'});
   const user=await response.json();if(!/^[0-9a-f-]{36}$/i.test(user.id||''))return res.status(401).json({error:'unauthorized'});
   // Never accept a user_id supplied in the request body.
   if(action==='status')return res.status(200).json({connection:await status(user.id)});
   if(action==='disconnect'){await rpc('disconnect',user.id);return res.status(200).json({connection:await status(user.id),trades:await trades(user.id)});}
   if(action==='sync')return res.status(200).json(await sync(user.id));
   if(action==='connect'){
    const c=credentials(body),client=okxClient(c,{fetcher,now});await client.clock();const account=(await client.get('/api/v5/account/config'))[0];
    if(!readOnly(account))throw new OkxError('read_only_required',400);
    if(!/^\d+$/.test(String(account.uid||'')))throw new OkxError('okx_auth',400);
    await rpc('connect',user.id,{credentials:c,account_uid:String(account.uid),key_hint:c.apiKey.slice(-4)});
    // A successfully connected account stays connected if the initial position request fails.
    try{return res.status(200).json(await sync(user.id));}catch(error){return res.status(200).json({connection:await status(user.id),warning:error instanceof OkxError?error.code:'server_unavailable'});}
   }
   return res.status(400).json({error:'invalid_action'});
  }catch(error){return res.status(error instanceof OkxError?error.status:503).json({error:error instanceof OkxError?error.code:'server_unavailable'});}
 };
}
export default makeHandler();
