/* Public market streams plus bounded snapshot repair. Fresh quotes never renew old OHLC. */
const marketLive = {
  records:new Map(), flights:new Map(), channels:new Map(), quoteTimes:new Map(),
  target:'', generation:0, busy:false, lastAttempt:0, lastWatch:0, lastContext:0, lastMetrics:0,
  renderTimer:null, watchTimer:null, historyAt:0, historyBusy:false, historyRevision:0,
  error:'', historyError:false, installed:false
};
const LIVE_POLL_MS=30000, LIVE_STALE_MS=120000;
const LIVE_BYBIT_INTERVALS={'5m':'5','15m':'15','1h':'60','4h':'240','1d':'D'};
function liveActivePage(){return document.querySelector('.page.active')?.id.replace('page-','')||'';}
function liveTarget(page=liveActivePage()){
  const states={overview:overviewState,marketintel:marketIntelState,battle:battleState,liquidity:liquidityState,elliott:elliottState,trendline:trendlineState};
  return states[page]?{page,symbol:states[page].symbol,intervals:page==='trendline'?['5m','15m','1h','4h']:MI_DATA_INTERVALS}:null;
}
function liveCanRun(){return !document.hidden&&navigator.onLine!==false;}
function liveAge(record,intervals){
  if(!record)return 0;
  return Math.min(record.quoteAt||0,...intervals.map(tf=>record.framesAt[tf]||0));
}
function liveMergeCandle(rows,candle,tf){
  if(!rows?.length||!trendlineValidCandle(candle)||candle.time>Date.now()+60000)return 'invalid';
  const last=rows.at(-1),duration=coinTfMs[tf];
  if(candle.time>last.time+duration)return 'gap';
  if(candle.time===last.time){rows[rows.length-1]=candle;return 'updated';}
  if(candle.time===last.time+duration){rows.push(candle);if(rows.length>1000)rows.shift();return 'new';}
  if(candle.time===last.time-duration&&rows.at(-2)?.time===candle.time){rows[rows.length-2]=candle;return 'closed';}
  return 'old';
}
function liveStore(symbol,data,intervals,started){
  const now=Date.now(),exchange=data.exchange||'BINANCE',previous=marketLive.records.get(symbol);
  const record=previous?.exchange===exchange?previous:{symbol,exchange,framesAt:{},events:{},quoteAt:0,data:{candles:{},ticker:{}}};
  for(const tf of intervals){
    const rows=data.candles[tf];
    if(!rows?.length||!rows.every(trendlineValidCandle))throw Error('Неполные свечи');
    // Keep messages received while the HTTP request was in flight, including a new bar.
    if((record.framesAt[tf]||0)>started){
      const updates=record.data.candles[tf]||[],byTime=new Map(rows.map(c=>[c.time,c]));
      for(const candle of updates.slice(-2))byTime.set(candle.time,candle);
      record.data.candles[tf]=[...byTime.values()].sort((a,b)=>a.time-b.time).slice(-1000);
    }else record.data.candles[tf]=rows;
    record.framesAt[tf]=now;
  }
  if(record.quoteAt<=started){record.data.ticker=data.ticker;record.quoteAt=now;}
  Object.assign(record.data,{source:data.source,exchange,receivedAt:now});record.at=now;record.error='';
  marketLive.records.set(symbol,record);liveSyncStreams();return record.data;
}
function liveQuote(exchange,symbol,ticker,eventAt){
  const record=marketLive.records.get(symbol);
  if(!record||record.exchange!==exchange||!(ticker.price>0)||!Number.isFinite(ticker.price)||!Number.isFinite(eventAt)||Math.abs(Date.now()-eventAt)>120000||eventAt<(record.events.quote||0))return false;
  record.events.quote=eventAt;record.quoteAt=Date.now();
  for(const [key,value] of Object.entries(ticker))if(Number.isFinite(value))record.data.ticker[key]=value;
  updateTickerItem(symbol,record.data.ticker.price,record.data.ticker.changePct);
  liveUpdateWatch(record);liveQueueRender();return true;
}
function liveCandle(exchange,symbol,tf,candle,eventAt){
  const record=marketLive.records.get(symbol);
  if(!record||record.exchange!==exchange||!(tf in coinTfMs)||!Number.isFinite(eventAt)||Math.abs(Date.now()-eventAt)>120000||eventAt<(record.events[tf]||0))return false;
  const result=liveMergeCandle(record.data.candles[tf],candle,tf);
  if(result==='gap'){marketLive.lastAttempt=0;return false;}
  if(!['new','updated','closed'].includes(result))return false;
  record.events[tf]=eventAt;record.framesAt[tf]=Date.now();
  liveUpdateWatch(record);liveQueueRender();return true;
}
function liveMessage(exchange,raw){
  let message;try{message=JSON.parse(raw);}catch{return false;}
  if(exchange==='BINANCE'){
    const d=message.data||message,symbol=String(d.s||'').replace(/USDT$/,'');
    if(d.e==='24hrTicker')return liveQuote(exchange,symbol,{price:Number(d.c),change:Number(d.p),changePct:Number(d.P),high:Number(d.h),low:Number(d.l),volumeQuote:Number(d.q),trades:Number(d.n)},Number(d.E));
    if(d.e==='kline'&&d.k)return liveCandle(exchange,symbol,d.k.i,{time:Number(d.k.t),open:Number(d.k.o),high:Number(d.k.h),low:Number(d.k.l),close:Number(d.k.c),volume:Number(d.k.v)},Number(d.E));
  }else{
    if(!message.topic)return false;
    const parts=message.topic.split('.'),symbol=parts.at(-1).replace(/USDT$/,'');
    if(parts[0]==='tickers'){
      const d=Array.isArray(message.data)?message.data[0]:message.data;if(!d)return false;
      const price=Number(d.lastPrice),previous=Number(d.prevPrice24h);
      return liveQuote(exchange,symbol,{price,change:previous>0?price-previous:NaN,changePct:d.price24hPcnt==null?NaN:Number(d.price24hPcnt)*100,high:d.highPrice24h==null?NaN:Number(d.highPrice24h),low:d.lowPrice24h==null?NaN:Number(d.lowPrice24h),volumeQuote:d.turnover24h==null?NaN:Number(d.turnover24h)},Number(message.ts));
    }
    if(parts[0]==='kline'){
      const tf=Object.keys(LIVE_BYBIT_INTERVALS).find(key=>LIVE_BYBIT_INTERVALS[key]===parts[1]);
      return (message.data||[]).reduce((changed,c)=>liveCandle(exchange,symbol,tf,{time:Number(c.start),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)},Number(message.ts))||changed,false);
    }
  }
  return false;
}
function liveCloseChannel(channel){
  clearTimeout(channel.retry);clearInterval(channel.ping);clearTimeout(channel.timeout);
  if(channel.socket){channel.socket.onclose=null;channel.socket.onerror=null;channel.socket.onmessage=null;channel.socket.onopen=null;try{channel.socket.close();}catch{}channel.socket=null;}
}
function liveConnect(channel){
  if(!liveCanRun()||!channel.topics.length)return;
  liveCloseChannel(channel);channel.lastAt=0;channel.openedAt=Date.now();
  const url=channel.exchange==='BINANCE'?'wss://stream.binance.com:443/stream?streams='+channel.topics.join('/'):'wss://stream.bybit.com/v5/public/spot';
  let socket;try{socket=new WebSocket(url);}catch{liveRetry(channel);return;}channel.socket=socket;
  channel.timeout=setTimeout(()=>{if(channel.socket===socket&&!channel.lastAt){liveCloseChannel(channel);liveRetry(channel);}},20000);
  socket.onopen=()=>{
    if(channel.socket!==socket)return;
    if(channel.exchange==='BYBIT'){
      // Bybit spot subscriptions are capped at ten topics per message.
      for(let i=0;i<channel.topics.length;i+=10)socket.send(JSON.stringify({op:'subscribe',args:channel.topics.slice(i,i+10)}));
      channel.ping=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({op:'ping'}));},20000);
    }
  };
  socket.onmessage=event=>{if(channel.socket!==socket||!liveCanRun())return;if(liveMessage(channel.exchange,event.data)){channel.lastAt=Date.now();channel.failures=0;clearTimeout(channel.timeout);}};
  socket.onerror=()=>{try{socket.close();}catch{}};
  socket.onclose=()=>{if(channel.socket!==socket)return;liveCloseChannel(channel);liveRetry(channel);};
}
function liveRetry(channel){
  if(!liveCanRun()||marketLive.channels.get(channel.exchange)!==channel)return;
  channel.failures=(channel.failures||0)+1;
  channel.retry=setTimeout(()=>liveConnect(channel),Math.min(30000,2000*2**Math.min(channel.failures,4)));
  liveStatus();
}
function liveSyncStreams(){
  if(!marketLive.installed||!liveCanRun())return;
  const target=liveTarget(),symbols=new Map();
  if(target)symbols.set(target.symbol,target.intervals);
  // The personal scanner continues in the background; closed bars drive event confirmation.
  if(watchtowerState.initialized)for(const symbol of watchtowerState.watchlist)if(!symbols.has(symbol))symbols.set(symbol,MI_DIVERGENCE_INTERVALS);
  const groups={BINANCE:[],BYBIT:[]};
  for(const [symbol,intervals] of symbols){
    const record=marketLive.records.get(symbol);if(!record)continue;
    if(record.exchange==='BYBIT')groups.BYBIT.push('tickers.'+symbol+'USDT',...intervals.map(tf=>'kline.'+LIVE_BYBIT_INTERVALS[tf]+'.'+symbol+'USDT'));
    else groups.BINANCE.push(symbol.toLowerCase()+'usdt@ticker',...intervals.map(tf=>symbol.toLowerCase()+'usdt@kline_'+tf));
  }
  for(const [exchange,topics] of Object.entries(groups)){
    topics.sort();const key=topics.join('|'),old=marketLive.channels.get(exchange);
    if(old?.key===key)continue;if(old)liveCloseChannel(old);
    if(!topics.length){marketLive.channels.delete(exchange);continue;}
    const channel={exchange,key,topics,failures:0,lastAt:0};marketLive.channels.set(exchange,channel);liveConnect(channel);
  }
}
function liveQueueRender(){
  if(marketLive.renderTimer)return;
  marketLive.renderTimer=setTimeout(()=>{marketLive.renderTimer=null;liveRender();},2000);
}
function liveUpdateWatch(record){
  const result=watchtowerState.results.find(r=>r.symbol===record.symbol&&!r.error);
  if(result&&result.data.exchange===record.exchange){result.data.ticker=record.data.ticker;result.data.candles=record.data.candles;result.data.receivedAt=liveAge(record,MI_DIVERGENCE_INTERVALS);}
  if(!marketLive.watchTimer&&watchtowerState.initialized)marketLive.watchTimer=setTimeout(()=>{marketLive.watchTimer=null;liveRenderWatch();},3000);
}
function liveRenderWatch(){
  if(!liveCanRun()||watchtowerState.scanning)return;
  const next=watchtowerState.results.map(r=>r.error?r:watchAnalyze(r.data)),events=watchTransitions(next,watchPost.baseline);
  watchtowerState.results=next.sort((a,b)=>b.score-a.score);
  watchPost.events=[...events.reverse(),...watchPost.events].slice(0,80);
  if(liveActivePage()==='watchtower')watchRender();
  const fresh=events.find(e=>e.stage==='confirmed'&&!watchPost.notified.has(e.id));
  if(fresh){watchPost.notified.add(fresh.id);showNotif('success','СЛЕЖКА · '+fresh.symbol,fresh.title+' · новое событие, проверь сценарий',5000);}
}
function liveApply(target,record){
  if(!target||!record||target.symbol!==record.symbol)return false;
  const at=liveAge(record,target.intervals);if(!at)return false;
  if(target.page==='trendline'){
    if(trendlineState.loading||trendlineState.symbol!==record.symbol)return false;
    trendlineState.data=record.data;trendlineState.loadedAt=at;trendlineState.error='';renderTrendlineEngine();
  }else{
    if(marketIntelState.loading||marketIntelState.symbol!==record.symbol)return false;
    Object.assign(marketIntelState,{candles:record.data.candles,ticker:record.data.ticker,source:record.data.source,exchange:record.exchange,loadedAt:at});
    if(target.page==='overview')overviewRender();
    if(target.page==='marketintel'){
      const cursor=worldInstrument?.cursor??-1,selected=cursor>=0?worldInstrument.candles[cursor]?.time:null;
      miRenderAnalysis(miBuildAnalysis());
      if(selected&&worldInstrument){const index=worldInstrument.candles.findIndex(c=>c.time===selected);if(index>=0)worldInspectMarketChart(index);}
    }
    if(target.page==='battle')renderBattleScreen();
    if(target.page==='liquidity')renderLiquidityMap();
    if(target.page==='elliott')renderElliottLab();
  }
  return true;
}
function liveRender(){if(liveCanRun()){const target=liveTarget();if(target)liveApply(target,marketLive.records.get(target.symbol));}liveStatus();}
async function liveRefresh(){
  const target=liveTarget();if(!liveCanRun()||!target||marketLive.busy||marketIntelState.loading||trendlineState.loading||overviewState.loading)return;
  marketLive.busy=true;marketLive.lastAttempt=Date.now();const generation=marketLive.generation,shared=marketIntelState.requestId,trend=trendlineState.requestId;
  try{
    await miLoadSpotHistory(target.symbol,target.intervals);if(generation!==marketLive.generation)return;
    const current=liveTarget();
    if(shared!==marketIntelState.requestId||trend!==trendlineState.requestId||current?.page!==target.page||current?.symbol!==target.symbol)return;
    const record=marketLive.records.get(target.symbol);marketLive.error='';liveApply(target,record);
  }catch{if(generation===marketLive.generation)marketLive.error='Источник временно недоступен · повторяем автоматически';}
  finally{marketLive.busy=false;liveStatus();}
}
async function liveHistory(force=false){
  const page=liveActivePage();if(!liveCanRun()||!['journal','dashboard','progress','digest','coach'].includes(page)||marketLive.historyBusy||(!force&&Date.now()-marketLive.historyAt<LIVE_POLL_MS))return;
  if(!currentUser?.id)return;marketLive.historyBusy=true;marketLive.historyAt=Date.now();
  const user=currentUser.id,revision=marketLive.historyRevision,before=JSON.stringify(allTrades);
  try{
    const response=window._isDemoMode?{data:demoLoadTrades()}:await journalWithTimeout(sb.from('trades').select('*').eq('user_id',user).order('created_at',{ascending:false}),12000);
    if(currentUser?.id!==user||revision!==marketLive.historyRevision)return;
    if(response.error)throw response.error;if(!Array.isArray(response.data))throw Error('Неполная история');marketLive.historyError=false;
    if(before!==JSON.stringify(allTrades))return; // A local save/delete won while this request was pending.
    const data=response.data||[];if(JSON.stringify(data)===before)return;
    allTrades=data;hideStatSkeletons();updateStatsEnhanced();render();renderDashboard();renderProgress();renderLevelBar(allTrades);orbColorUserByRank(allTrades);
    // Do not restore form defaults during a background refresh.
  }catch{marketLive.historyError=true;}finally{marketLive.historyBusy=false;liveStatus();}
}
function liveStatus(){
  const page=liveActivePage(),root=document.getElementById('page-'+page);if(!root)return;
  let el=root.querySelector('.live-refresh-status');if(!el){el=document.createElement('div');el.className='live-refresh-status';root.prepend(el);}
  const target=liveTarget(page),record=target&&marketLive.records.get(target.symbol),channel=record&&marketLive.channels.get(record.exchange),now=Date.now(),at=target?liveAge(record,target.intervals):0;
  const offline=navigator.onLine===false,stale=at&&now-at>LIVE_STALE_MS,stream=channel?.lastAt&&now-channel.lastAt<20000;
  let text,tone='';
  if(target){
    tone=offline||stale||marketLive.error?'warn':stream?'live':'';
    text=offline?'Нет сети · восстановим связь автоматически':marketLive.error?marketLive.error:stale?'Данные устарели · переподключаемся':stream?'Живой поток · цена и свечи':'Автообновление · каждые 30с';
    if(record?.quoteAt)text+=' · цена '+Math.max(0,Math.floor((now-record.quoteAt)/1000))+'с назад';
    if(at)text+=' · свечи '+Math.max(0,Math.floor((now-at)/1000))+'с назад';
    if(target.page==='trendline'&&(offline||stale))document.getElementById('tl-journal-action')?.setAttribute('disabled','');
    if(target.page==='battle'&&(offline||stale))document.getElementById('bs-action')?.setAttribute('disabled','');
  }else if(page==='watchtower'){
    const staleRows=watchtowerState.results.filter(r=>r.error||now-(r.data?.receivedAt||0)>180000).length;
    const connected=[...marketLive.channels.values()].some(c=>c.lastAt&&now-c.lastAt<20000);
    tone=offline||staleRows?'warn':connected?'live':'';text=offline?'Нет сети · обход возобновится автоматически':(connected?'Цена и свечи — потоком · ':'')+'Проверка списка каждые 30с'+(staleRows?' · '+staleRows+' без свежих данных':'');
  }else if(['journal','dashboard','progress','digest','coach'].includes(page)){
    tone=offline||marketLive.historyError?'warn':'';text=offline?'Нет сети · история сохранена на экране':marketLive.historyError?'История временно недоступна · повторяем автоматически':'История синхронизируется каждые 30с · введённые поля сохраняются';
  }else if(page==='premarket')text='Сессии — по часам UTC · календарь и индексы обновляются автоматически';
  else{el.hidden=true;return;}
  el.hidden=false;el.dataset.state=tone;el.textContent=text;
  el.title=at?'Свечи получены '+new Date(at).toLocaleTimeString('ru-RU',{timeZone:'UTC'})+' UTC. Новый сигнал подтверждается закрытой свечой.':'Автообновление работает, пока вкладка открыта. После возврата пропущенные данные догружаются.';
}
function liveContext(force=false){
  if(!liveCanRun())return;const tasks=[],now=Date.now();
  if(force||now-marketLive.lastMetrics>=60000){marketLive.lastMetrics=now;tasks.push(fetchEnvironmentCalendar(false),fetchMarket(),fetchGL());}
  if(force||now-marketLive.lastContext>=300000){marketLive.lastContext=now;tasks.push(overviewLoadNews(false),fetchFNG(),fetchTrending());}
  if(tasks.length)Promise.allSettled(tasks).then(()=>{renderEnvironment();liveRender();});
}
function liveTick(){
  if(!liveCanRun()){liveStatus();return;}
  const target=liveTarget(),key=target?target.page+':'+target.symbol:liveActivePage();
  if(key!==marketLive.target){marketLive.target=key;marketLive.generation++;marketLive.lastAttempt=0;marketLive.error='';}
  liveSyncStreams();
  for(const channel of marketLive.channels.values())if(channel.socket?.readyState===1&&channel.lastAt&&Date.now()-channel.lastAt>90000){liveCloseChannel(channel);liveRetry(channel);}
  if(target&&Date.now()-marketLive.lastAttempt>=LIVE_POLL_MS){
    const record=marketLive.records.get(target.symbol);if(record&&Date.now()-record.at<10000)marketLive.lastAttempt=record.at;else liveRefresh();
  }
  if(watchtowerState.initialized&&Date.now()-marketLive.lastWatch>=LIVE_POLL_MS&&!watchtowerState.scanning){marketLive.lastWatch=Date.now();watchScan(false);}
  liveHistory();liveContext();liveStatus();
}
function liveResume(){
  if(!liveCanRun()){for(const channel of marketLive.channels.values())liveCloseChannel(channel);liveStatus();return;}
  marketLive.lastAttempt=0;marketLive.lastWatch=0;
  // Reconnect even if the subscriptions did not change while this tab slept.
  for(const channel of marketLive.channels.values())liveConnect(channel);
  liveTick();liveHistory(true);marketRegistryLoadQuotes();
}


async function liveCalendar(force){
  if(!force&&Date.now()-environmentState.lastCalendarAt<60000)return environmentState.events;
  const from=new Date(Date.now()-86400000).toISOString().slice(0,10),to=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  try{
    const r=await fetch(`/api/finnhub?type=calendar&from=${from}&to=${to}`,{cache:'no-store'}),data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    const source=Array.isArray(data)?data:(data.events||data.economicCalendar||[]);environmentState.events=source.map(environmentNormalizeEvent).filter(x=>Number.isFinite(x.timestamp)).sort((a,b)=>a.timestamp-b.timestamp);environmentState.source=String(data.source||'economic feed');environmentState.lastCalendarAt=Number.isFinite(Date.parse(data.updatedAt))?Math.min(Date.now(),Date.parse(data.updatedAt)):Date.now();
  }catch(e){
    if(new URLSearchParams(location.search).get('demo')==='1'){environmentState.events=environmentDemoEvents();environmentState.source='demo macro feed';environmentState.lastCalendarAt=Date.now();}
    else{environmentState.source='calendar unavailable';}
  }
  return environmentState.events;
}

function liveMarketSnapshot(){
  const entries=[];try{if(typeof tickerData!=='undefined')Object.entries(tickerData).forEach(([symbol,data])=>{if(symbol.includes('/'))return;const received=typeof marketLive!=='undefined'&&marketLive.installed?marketLive.quoteTimes.get(symbol):null;if(typeof marketLive!=='undefined'&&marketLive.installed&&(!received||Date.now()-received>180000))return;const change=Number(data&&data.chg);if(Number.isFinite(change))entries.push({symbol,change});});}catch(e){}
  const count=entries.length,up=entries.filter(x=>x.change>0).length,down=entries.filter(x=>x.change<0).length,breadth=count?up/count*100:null,avgAbs=count?entries.reduce((s,x)=>s+Math.abs(x.change),0)/count:null,btc=entries.find(x=>x.symbol==='BTC')?.change,eth=entries.find(x=>x.symbol==='ETH')?.change,fng=Number(window.etMarketFeed&&window.etMarketFeed.fng),dispersion=count?Math.max(...entries.map(x=>x.change))-Math.min(...entries.map(x=>x.change)):null;
  let code='NO DATA',copy='Жду живые котировки основных криптоактивов.',tone='';
  if(count){
    if(avgAbs>=4.5){code='HIGH EXPANSION';copy='Движение корзины резко расширено. Погони за ценой и поздние входы имеют повышенный риск.';tone='bad';}
    else if(breadth>=72&&btc>0){code='RISK ON';copy='Рост подтверждается шириной рынка. Приоритет — лонговые сетапы после отката, не погоня за импульсом.';tone='good';}
    else if(breadth<=28&&btc<0){code='RISK OFF';copy='Снижение широкое, а не локальное. Контртрендовые лонги требуют отдельного подтверждения.';tone='bad';}
    else if(avgAbs<.85){code='COMPRESSION';copy='Рынок сжат. Вероятность ложных пробоев выше, пока не появится объёмное расширение.';tone='warn';}
    else if(dispersion>=6){code='ROTATION';copy='Сильный разброс между активами. Общерыночный сигнал слабее — нужен выбор лидеров и аутсайдеров.';tone='warn';}
    else{code='MIXED FLOW';copy='Ширина рынка не даёт единого направления. Торговать только локальную структуру конкретного актива.';tone='warn';}
  }
  const snapshot={entries,count,up,down,breadth,avgAbs,btc,eth,fng:Number.isFinite(fng)?fng:null,dispersion,code,copy,tone,at:typeof marketLive!=='undefined'&&marketLive.installed&&entries.length?Math.min(...entries.map(x=>marketLive.quoteTimes.get(x.symbol)||0)):Date.now()};environmentState.snapshot=snapshot;environmentState.lastMarketAt=entries.length?snapshot.at:0;return snapshot;
}

async function liveNews(force){if(!force&&Date.now()-overviewState.newsLoadedAt<240000)return overviewState.news;const categories=['general','crypto'],settled=await Promise.allSettled(categories.map(async category=>{const response=await fetch('/api/finnhub?type=news&category='+category,{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error(payload.error||'News HTTP '+response.status);const rows=Array.isArray(payload)?payload:(payload.news||[]);return rows.map(item=>({headline:String(item.headline||item.title||''),summary:String(item.summary||''),source:String(item.source||'NEWS'),url:/^https?:\/\//i.test(String(item.url||''))?String(item.url):'',datetime:Number(item.datetime||item.timestamp||0),category}))}));if(settled.every(x=>x.status==='rejected'))return overviewState.news;const macroPattern=/\b(fed|fomc|ecb|boj|central bank|interest rate|inflation|cpi|ppi|gdp|payroll|jobs|unemployment|treasury|bond|dollar|oil|tariff|economy|recession)\b/i,merged=settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value).filter(x=>x.headline&&(x.category==='crypto'||macroPattern.test(x.headline+' '+x.summary))),seen=new Set();overviewState.news=merged.sort((a,b)=>b.datetime-a.datetime).filter(item=>{const key=item.headline.toLowerCase().replace(/\s+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true}).slice(0,12);overviewState.newsLoadedAt=Date.now();return overviewState.news}

async function liveSelectOverview(rawSymbol,button,force=false){const symbol=miCleanSymbol(rawSymbol);if(!symbol){showNotif('warn','ОБЗОР','Введи тикер монеты, например BTC или ETH.',2600);return}overviewState.symbol=symbol;overviewSyncControls();const requestId=++overviewState.requestId,sharedRequest=++marketIntelState.requestId,loading=overviewEl('ov-loading');overviewState.loading=true;worldRenderOverviewWorkspace(null,environmentMarketSnapshot());loading?.classList.add('show');overviewSet('ov-loading-copy','Собираю '+symbol+': цена, структура, новости и макро-контекст…');try{if(!force&&marketIntelState.symbol===symbol&&marketIntelState.loadedAt&&Date.now()-marketIntelState.loadedAt<45000){overviewRender();return}const data=await miLoadMarket(symbol);if(requestId!==overviewState.requestId||sharedRequest!==marketIntelState.requestId)return;marketIntelState.symbol=symbol;marketIntelState.candles=data.candles;marketIntelState.ticker=data.ticker;marketIntelState.source=data.source;marketIntelState.loadedAt=Date.now();overviewRender();if(button)showNotif('success','ОБЗОР',symbol+'/USDT · выжимка обновлена',2200)}catch(error){if(requestId===overviewState.requestId){overviewSet('ov-price','НЕТ ДАННЫХ','bad');overviewSet('ov-price-meta',error.message||'Источник недоступен');showNotif('error','ОБЗОР',error.message||'Не удалось загрузить монету',3600)}}finally{if(requestId===overviewState.requestId){overviewState.loading=false;loading?.classList.remove('show')}}}

function liveInstall(){
  const load=miLoadSpotHistory;
  miLoadSpotHistory=async function(symbol,intervals=MI_DATA_INTERVALS){
    const key=symbol+':'+[...intervals].sort().join(','),existing=marketLive.flights.get(key);
    if(existing)return existing;
    const record=marketLive.records.get(symbol);
    if(record&&Date.now()-record.at<10000&&intervals.every(tf=>record.data.candles[tf]?.length>=40))return record.data;
    const started=Date.now(),task=load(symbol,intervals).then(data=>liveStore(symbol,data,intervals,started));marketLive.flights.set(key,task);
    try{return await task;}finally{if(marketLive.flights.get(key)===task)marketLive.flights.delete(key);}
  };
  // A real market quote replaces the manufactured sparkline fallback for these tools.
  miLoadMarket=miLoadSpotHistory;refreshMarketIntel=()=>liveRefresh();
  fetchEnvironmentCalendar=liveCalendar;environmentMarketSnapshot=liveMarketSnapshot;overviewLoadNews=liveNews;overviewSelectSymbol=liveSelectOverview;
  const quote=updateTickerItem;updateTickerItem=function(symbol,price,change){if(Number.isFinite(Number(price))&&Number(price)>0)marketLive.quoteTimes.set(symbol,Date.now());return quote(symbol,price,change);};
  const history=loadTrades;loadTrades=async function(...args){marketLive.historyRevision++;const result=await history(...args);marketLive.historyAt=Date.now();return result;};
  const page=showPage;showPage=function(...args){page(...args);liveTick();};
  for(const [name,state] of [['initOverview',overviewState],['initBattleScreen',battleState],['initLiquidityMap',liquidityState],['initTrendlineEngine',trendlineState],['initElliottLab',elliottState],['initWatchtower',watchtowerState]]){
    clearInterval(state.refreshTimer);state.refreshTimer=null;
    const init=window[name];window[name]=function(...args){const result=init(...args);clearInterval(state.refreshTimer);state.refreshTimer=null;return result;};
  }
  marketLive.installed=true;marketLive.lastContext=Date.now();marketLive.lastMetrics=Date.now();
  setInterval(liveTick,5000);
  document.addEventListener('visibilitychange',liveResume);window.addEventListener('online',liveResume);window.addEventListener('offline',liveResume);window.addEventListener('pageshow',event=>{if(event.persisted)liveResume();});
  window.addEventListener('focus',()=>{if(liveCanRun()&&Date.now()-marketLive.lastAttempt>LIVE_POLL_MS)liveResume();});
  window.addEventListener('pagehide',()=>{for(const channel of marketLive.channels.values())liveCloseChannel(channel);});
  window.addEventListener('storage',event=>{if(window._isDemoMode&&event.key?.includes('trade'))liveHistory(true);});
  liveTick();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',liveInstall,{once:true});else liveInstall();
