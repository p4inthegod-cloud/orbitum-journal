/* Decorative details read existing state. Freshness means received data, never a repaint. */
const worldSourceTimes={quotes:0,scan:0};
let worldInstrument=null;
let worldConnectionFrame;
let worldLastSignalFingerprint='';
function worldRecordSource(source){worldSourceTimes[source]=Date.now();cancelAnimationFrame(worldConnectionFrame);worldConnectionFrame=requestAnimationFrame(worldRenderConnections);}
function worldConnectionState(at,pending=false,unavailable=false,now=Date.now(),staleAfter=180000){
  if(pending)return {code:'loading',label:'Обновление'};
  if(unavailable||!at)return {code:'offline',label:'Нет данных'};
  const age=Math.max(0,now-at);
  return age>staleAfter?{code:'stale',label:'Задержка · '+Math.floor(age/60000)+' мин'}:{code:'fresh',label:'Получено · '+Math.floor(age/1000)+' с назад'};
}
function worldRenderConnections(){
  if(typeof environmentState==='undefined'||typeof watchtowerState==='undefined')return;
  const calendarDemo=/demo/i.test(environmentState.source),calendarMissing=/unavailable|waiting/i.test(environmentState.source);
  const failed=watchtowerState.results.filter(item=>item.error).length;
  const sources=[['📡','Котировки',worldConnectionState(worldSourceTimes.quotes)],['🛰️','Календарь',calendarDemo?{code:'demo',label:'Демо-данные'}:worldConnectionState(environmentState.lastCalendarAt,false,calendarMissing,Date.now(),360000)],['🔭','Слежка',worldConnectionState(worldSourceTimes.scan,watchtowerState.scanning,!watchtowerState.results.length||failed===watchtowerState.results.length)]];
  if(failed&&failed<watchtowerState.results.length&&!watchtowerState.scanning)sources[2][2]={code:'partial',label:'Неполные данные · '+failed+' ошибок'};
  ['world-radar-connections','world-watch-connections'].forEach(id=>{
    const host=document.getElementById(id);if(!host)return;
    sources.forEach(([emoji,name,state],index)=>{
      let chip=host.children[index];if(!chip){chip=worldElement('div','world-connection');const icon=worldElement('span','emoji-glyph',emoji);icon.setAttribute('aria-hidden','true');chip.append(icon,worldElement('strong',null,name),worldElement('span','world-connection-light'),worldElement('small'));host.append(chip);}
      if(chip.dataset.state!==state.code){chip.dataset.state=state.code;chip.className='world-connection '+state.code;}
      const text=chip.querySelector('small');if(text.textContent!==state.label)text.textContent=state.label;
      chip.title=name+' · '+state.label;
    });
  });
  const fingerprint=watchtowerState.results.filter(item=>!item.error).map(item=>item.symbol+':'+item.primary.title+':'+Math.round(item.score)).join('|');
  if(fingerprint&&worldLastSignalFingerprint&&fingerprint!==worldLastSignalFingerprint){const feed=document.querySelector('.wt-feed');if(feed){feed.classList.add('world-event-new');setTimeout(()=>feed.classList.remove('world-event-new'),1800);}}
  if(fingerprint)worldLastSignalFingerprint=fingerprint;
}
function worldInstallDetails(){
  document.querySelectorAll('.top-nav > .top-nav-link,.top-nav-group > summary').forEach(control=>{
    const crystal=worldElement('span','world-nav-crystal');crystal.setAttribute('aria-hidden','true');
    const tip=worldElement('span','world-nav-tip',control.querySelector('.world-nav-label')?.firstChild.textContent.trim());tip.setAttribute('aria-hidden','true');control.append(crystal,tip);
  });
  [['#page-premarket .env-head','world-radar-connections'],['#page-watchtower .wt-head','world-watch-connections']].forEach(([selector,id])=>{
    const header=document.querySelector(selector);if(!header)return;
    const rail=worldElement('div','world-connections');rail.id=id;rail.setAttribute('aria-label','Состояние источников данных');header.after(rail);
  });
  [['.env-session-card .env-card-title','🕰️'],['.env-pulse-card .env-card-title','📡'],['.env-card:has(#env-calendar-list) .env-card-title','🗓️'],['.wt-board .wt-card-title','🔭'],['.wt-feed .wt-card-title','🛰️'],['.mi-chart-card .mi-card-title','📐'],['.lq-vrvp .lq-card-title','📊']].forEach(([selector,emoji])=>{
    document.querySelectorAll(selector).forEach(title=>{const icon=worldElement('span','emoji-glyph world-heading-icon',emoji);icon.setAttribute('aria-hidden','true');title.prepend(icon);});
  });
  [['env-current-session','🕰️'],['env-next-session','⏳'],['env-market-regime','📡'],['env-macro-risk','🛡️'],['env-data-age','🛰️']].forEach(([id,emoji])=>{const title=document.getElementById(id)?.closest('article')?.querySelector('span');if(title){const icon=worldElement('span','emoji-glyph world-heading-icon',emoji);icon.setAttribute('aria-hidden','true');title.prepend(icon);}});
  const scan=document.getElementById('wt-scan-label');if(scan)new MutationObserver(worldRenderConnections).observe(scan,{childList:true});
  const chart=document.getElementById('mi-chart');
  if(chart){
    chart.tabIndex=0;chart.setAttribute('role','img');chart.setAttribute('aria-label','Цена и EMA 21. Стрелки влево и вправо выбирают свечу. Escape убирает подсказку.');
    const tooltip=worldElement('output','world-instrument-tooltip');tooltip.id='world-mi-tooltip';tooltip.hidden=true;chart.parentElement.append(tooltip);
    chart.addEventListener('pointermove',event=>{if(!worldInstrument)return;const x=event.clientX-chart.getBoundingClientRect().left;worldInspectMarketChart(Math.max(0,Math.min(worldInstrument.candles.length-1,Math.round((x-worldInstrument.left)/(worldInstrument.right-worldInstrument.left)*(worldInstrument.candles.length-1)))));});
    chart.addEventListener('pointerleave',()=>{if(document.activeElement!==chart)worldInspectMarketChart(-1);});
    chart.addEventListener('keydown',event=>{if(!worldInstrument)return;if(event.key==='Escape'){worldInspectMarketChart(-1);return;}if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const index=worldInstrument.cursor<0?worldInstrument.candles.length-1:worldInstrument.cursor;worldInspectMarketChart(Math.max(0,Math.min(worldInstrument.candles.length-1,index+(event.key==='ArrowLeft'?-1:1))));tooltip.setAttribute('aria-live','polite');}});
    chart.addEventListener('blur',()=>worldInspectMarketChart(-1));
    let frame;new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(worldInstrument&&chart.clientWidth)worldRenderMarketInstrument(worldInstrument.analysis);});}).observe(chart);
    new MutationObserver(()=>{if(worldInstrument)worldRenderMarketInstrument(worldInstrument.analysis);}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  worldRenderConnections();setInterval(worldRenderConnections,10000);
  const profile=document.getElementById('lq-vrvp-chart');
  if(profile){const tip=worldElement('output','world-instrument-tooltip world-profile-tooltip');tip.hidden=true;profile.parentElement.append(tip);profile.addEventListener('pointermove',event=>worldInspectProfile(event,tip));profile.addEventListener('pointerleave',()=>{tip.hidden=true;profile.querySelector('.world-profile-cursor')?.remove();});}
}
function worldInspectProfile(event,tip){
  const svg=document.getElementById('lq-vrvp-chart'),profile=liquidityBuildVRVP(liquidityState.vrvpTf);if(!svg||!profile)return;
  const box=svg.getBoundingClientRect(),w=svg.viewBox.baseVal.width,h=svg.viewBox.baseVal.height,xx=(event.clientX-box.left)/box.width*w,yy=(event.clientY-box.top)/box.height*h;
  const left=w<600?52:78,profileWidth=Math.max(72,Math.min(340,Math.round(w*.24))),profileLeft=w-20-profileWidth,right=profileLeft-(w<600?24:112),ns='http://www.w3.org/2000/svg';
  svg.querySelector('.world-profile-cursor')?.remove();tip.hidden=false;
  const group=document.createElementNS(ns,'g');group.classList.add('world-profile-cursor');
  if(xx>=left&&xx<=right){
    const index=Math.max(0,Math.min(profile.candles.length-1,Math.floor((xx-left)/(right-left)*profile.candles.length))),c=profile.candles[index],x=left+(index+.5)/profile.candles.length*(right-left);
    const path=document.createElementNS(ns,'path');path.setAttribute('d','M'+x+' 42V'+(h-24));path.setAttribute('stroke','var(--world-cyan)');path.setAttribute('stroke-dasharray','2 4');group.append(path);
    const point=document.createElementNS(ns,'rect');Object.entries({x:x-3,y:42+(profile.high-c.close)/(profile.high-profile.low||1)*(h-66)-3,width:6,height:6,fill:'var(--world-cyan)'}).forEach(([key,value])=>point.setAttribute(key,value));group.append(point);
    tip.textContent=new Date(c.time).toLocaleString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' UTC · O '+miFmtPrice(c.open)+' · H '+miFmtPrice(c.high)+' · L '+miFmtPrice(c.low)+' · C '+miFmtPrice(c.close)+' · V '+Number(c.volume).toLocaleString('ru-RU',{maximumFractionDigits:2});
  }else if(xx>=profileLeft){
    const price=profile.high-(yy-42)/(h-66)*(profile.high-profile.low),bin=profile.bins.find(bin=>price>=bin.low&&price<=bin.high);
    if(!bin){tip.hidden=true;return;}
    tip.textContent=miFmtPrice(bin.low)+'–'+miFmtPrice(bin.high)+' · Оценочный объём уровня: '+Number(bin.total).toLocaleString('ru-RU',{maximumFractionDigits:2});
    const path=document.createElementNS(ns,'path');path.setAttribute('d','M'+profileLeft+' '+yy+'H'+(w-20));path.setAttribute('stroke','var(--world-violet)');path.setAttribute('stroke-dasharray','2 4');group.append(path);
  }else{tip.hidden=true;return;}svg.append(group);
}
function worldRenderMarketInstrument(analysis){
  const svg=document.getElementById('mi-chart'),tf=marketIntelState.chartTF,full=marketIntelState.candles[tf]||[],candles=full.slice(-96);if(!svg)return;
  if(candles.length<2){svg.replaceChildren();worldInstrument=null;document.getElementById('world-mi-tooltip')?.setAttribute('hidden','');return;}
  const width=svg.clientWidth||svg.parentElement.clientWidth||900,height=svg.clientHeight||270,left=10,right=Math.max(40,width-82),top=35,bottom=height-32;
  const closes=candles.map(c=>c.close),ema=miEMA(closes,21),values=closes.concat(ema.filter(Number.isFinite));
  const min=Math.min(...values),max=Math.max(...values),span=max-min||Math.max(max*.01,1),pad=span*.1,domainSpan=max-min+pad*2;
  const x=i=>left+i/(candles.length-1)*(right-left),y=p=>top+(max+pad-p)/domainSpan*(bottom-top);
  const dark=worldTheme()==='dark',cyan=dark?'#62d2e1':'#168ca9',violet=dark?'#b296ed':'#8756c6',caption=dark?'#a6b2d0':'#58667e',edge=dark?'#354365':'#d2dfec';
  const line=list=>{let started=false;return list.map((p,i)=>{if(!Number.isFinite(p))return '';const command=started?'L':'M';started=true;return command+x(i).toFixed(1)+' '+y(p).toFixed(1);}).join(' ');};
  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  const pricePath=line(closes);let drawing='<defs><linearGradient id="worldMiArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+cyan+'" stop-opacity=".16"/><stop offset="1" stop-color="'+violet+'" stop-opacity="0"/></linearGradient></defs>';
  for(let i=0;i<4;i++){const price=max+pad-i/3*domainSpan,yy=y(price);drawing+='<path d="M'+left+' '+yy+'H'+right+'" stroke="'+edge+'" fill="none"/><text x="'+(right+7)+'" y="'+(yy+4)+'" fill="'+caption+'" font-size="11" font-weight="600">'+escHtml(miFmtPrice(price))+'</text>';}
  drawing+='<path d="'+pricePath+' L'+right+' '+bottom+' L'+left+' '+bottom+'Z" fill="url(#worldMiArea)"/><path d="'+line(ema)+'" fill="none" stroke="'+violet+'" stroke-width="1.5"/><path d="'+pricePath+'" fill="none" stroke="'+cyan+'" stroke-width="2"/>';
  [[analysis.levels.support,cyan,'S'],[analysis.levels.resistance,violet,'R']].forEach(([price,color,label])=>{if(price<min-pad||price>max+pad)return;const yy=y(price);drawing+='<path d="M'+left+' '+yy+'H'+right+'" stroke="'+color+'" stroke-dasharray="4 5" opacity=".65"/><rect x="'+(right-25)+'" y="'+(yy-18)+'" width="22" height="16" fill="var(--bg-card)" stroke="'+color+'"/><text x="'+(right-14)+'" y="'+(yy-6)+'" fill="'+color+'" text-anchor="middle" font-size="10" font-weight="700">'+label+'</text>';});
  const div=analysis.divergences?.[tf],offset=full.length-candles.length;
  if(div?.found&&div.first.index>=offset&&div.second.index>=offset){const a=div.first.index-offset,b=div.second.index-offset,color=div.direction==='bull'?cyan:violet;drawing+='<path d="M'+x(a)+' '+y(div.first.price)+'L'+x(b)+' '+y(div.second.price)+'" stroke="'+color+'" stroke-width="2" stroke-dasharray="5 4"/>';[div.first,div.second].forEach(point=>{drawing+='<rect x="'+(x(point.index-offset)-3)+'" y="'+(y(point.price)-3)+'" width="6" height="6" fill="'+color+'"/>';});drawing+='<text x="'+((x(a)+x(b))/2)+'" y="'+(Math.min(y(div.first.price),y(div.second.price))-9)+'" fill="'+color+'" font-size="10" text-anchor="middle">'+(div.direction==='bull'?'RSI БЫЧЬЯ':'RSI МЕДВЕЖЬЯ')+'</text>';}
  drawing+='<rect x="'+(right-3)+'" y="'+(y(closes.at(-1))-3)+'" width="6" height="6" fill="'+cyan+'"/>';
  for(let i=0;i<3;i++){const index=Math.round(i/2*(candles.length-1)),date=new Date(candles[index].time),label=date.toLocaleString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});drawing+='<text x="'+x(index)+'" y="'+(height-10)+'" fill="'+caption+'" font-size="10" text-anchor="'+(i===0?'start':i===2?'end':'middle')+'">'+escHtml(label)+'</text>';}
  svg.innerHTML=drawing;worldInstrument={analysis,candles,ema,left,right,x,y,top,bottom,cursor:-1,cyan};worldInspectMarketChart(-1);
  miSet('mi-chart-caption',candles.length+' свечей · '+MI_TF_LABELS[tf]+' · UTC');miSet('mi-chart-low','МИН '+miFmtPrice(Math.min(...closes)));miSet('mi-chart-current','ТЕКУЩАЯ '+miFmtPrice(closes.at(-1)));miSet('mi-chart-high','МАКС '+miFmtPrice(Math.max(...closes)));
}
function worldInspectMarketChart(index){
  const svg=document.getElementById('mi-chart'),tip=document.getElementById('world-mi-tooltip');if(!svg||!tip)return;svg.querySelector('.world-instrument-cursor')?.remove();tip.hidden=index<0;if(!worldInstrument||index<0){if(worldInstrument)worldInstrument.cursor=-1;return;}
  const s=worldInstrument,c=s.candles[index];if(!c)return;s.cursor=index;const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g');group.classList.add('world-instrument-cursor');
  const line=document.createElementNS(ns,'path');line.setAttribute('d','M'+s.x(index)+' '+s.top+'V'+s.bottom);line.setAttribute('stroke',s.cyan);line.setAttribute('stroke-dasharray','2 4');
  const point=document.createElementNS(ns,'rect');Object.entries({x:s.x(index)-3,y:s.y(c.close)-3,width:6,height:6,fill:s.cyan}).forEach(([key,value])=>point.setAttribute(key,value));group.append(line,point);svg.append(group);
  tip.textContent=new Date(c.time).toLocaleString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' UTC · O '+miFmtPrice(c.open)+' · H '+miFmtPrice(c.high)+' · L '+miFmtPrice(c.low)+' · C '+miFmtPrice(c.close)+' · V '+Number(c.volume).toLocaleString('ru-RU',{maximumFractionDigits:2})+(Number.isFinite(s.ema[index])?' · EMA '+miFmtPrice(s.ema[index]):'');
}
document.addEventListener('DOMContentLoaded',worldInstallDetails,{once:true});
