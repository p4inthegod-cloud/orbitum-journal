/* Decision desk: market evidence and trigger readiness are separate. */
let decisionModel=null,decisionRequest=0,decisionDraftSymbol='';
WORLD_PROTOCOL_SPRITES.flag=['..mmmm......','..mcccccc...','..mcvvvcc...','..mcccccc...','..mccc......','..m.........','..m.........','..m.........','..m.........','..m.........','.ddd........','dddddd......'];
const decisionItem=(kind)=>worldProtocolItem(kind);
function decisionFactors(r){
  const side=r.direction, stance=d=>!d?'unknown':d===side?'support':'against';
  const rsi15=r.analysis.inds['15m'].rsi,rsi1=r.analysis.inds['1h'].rsi;
  const impulse=Number.isFinite(rsi15)&&Number.isFinite(rsi1)?rsi15>=55&&rsi1>=55?'long':rsi15<=45&&rsi1<=45?'short':null:null;
  const div=r.strongestDiv,volume=r.analysis.inds['1h'].volumeRatio;
  return [
    {item:'shield',name:'Структура',value:r.analysis.dailyTrend.label,copy:'Дневной тренд задаёт общий фон.',page:'marketintel',state:stance(r.analysis.dailyTrend.tone==='good'?'long':r.analysis.dailyTrend.tone==='bad'?'short':null)},
    {item:'torch',name:'Импульс',value:'RSI '+[r.analysis.inds['15m'].rsi,r.analysis.inds['1h'].rsi].map(n=>Number.isFinite(n)?n.toFixed(1):'—').join(' / '),copy:'15м / 1ч · выше 55 — рост, ниже 45 — снижение.',page:'marketintel',state:stance(impulse)},
    {item:'crystal',name:'Дивергенция',value:div?div.title:'Нет сигнала',copy:div?'Расхождение RSI · '+MI_TF_LABELS[div.tf]:'Подтверждённого расхождения RSI нет.',page:'marketintel',state:stance(div?(div.direction==='bull'?'long':'short'):null)},
    {item:'hammer',name:'Трендовая',value:r.trendlineSignal?.state||'Нет подтверждения',copy:r.trendlineSignal?MI_TF_LABELS[r.trendlineSignal.tf]+' · закрытие и структура':'Нужны подтверждённые опоры и пробой.',page:'trendline',state:stance(r.trendlineSignal?.direction)},
    {item:'book',name:'Волны',value:r.elliottContext?.phase||'Нет чистого счёта',copy:'Волновая модель — дополнительный контекст.',page:'elliott',state:stance(r.elliottSignal?.direction)},
    {item:'torch',name:'Объём',value:Number.isFinite(volume)?volume.toFixed(2)+'×':'Нет данных',copy:'Часовой объём относительно среднего; сам по себе не задаёт направление.',page:'marketintel',state:!Number.isFinite(volume)?'unknown':volume>=1.15?'support':volume<.7?'against':'context'},
    {item:'crystal',name:'Ликвидность',value:miFmtPrice(side==='long'?r.levels.resistance:r.levels.support),copy:'Ближайший ценовой ориентир из экстремумов 4ч; не гарантия движения.',page:'liquidity',state:'context'},
    {item:'shield',name:'Среда',value:environmentDirectiveLabel(r.directive.code),copy:r.directive.copy||'Сессия, ширина рынка и события.',page:'premarket',state:['WAIT','OBSERVE','WAIT BREAK','MANAGE','REDUCE'].includes(r.directive.code)?'against':'context'},
    {item:'book',name:'Лимит дня',value:r.today.length+' / '+r.maxTrades,copy:r.lock.lock?'Защита активна. Новые планы заблокированы.':'Сделки сегодня · дата UTC.',page:'journal',state:r.hardBlock?'against':'context'}
  ];
}
function decisionBuildModel(r,meta){
  const factors=decisionFactors(r),evidence=factors.slice(0,6),supports=evidence.filter(f=>f.state==='support'),against=evidence.filter(f=>f.state==='against'),unknown=evidence.filter(f=>f.state==='unknown');
  const stale=meta.age>120,calendarKnown=meta.calendarAt>0&&!/unavailable|waiting/i.test(meta.calendarSource)&&meta.calendarAge<1800;
  const blocked=r.hardBlock||r.directive.code==='WAIT',bias=r.best>=60&&r.spread>=8;
  const signal=r.trendlineSignal,tfMs={'5m':300000,'15m':900000,'1h':3600000};
  const triggerAge=(meta.now||Date.now())-(signal?.retestTime||0);
  const trigger=Boolean(signal?.entryReady&&signal.direction===r.direction&&Number.isFinite(signal.retestTime)&&triggerAge>=0&&triggerAge<=3*(tfMs[signal.tf]||0));
  let title='ЖДАТЬ НАПРАВЛЕНИЕ',copy='Перевес небольшой. Наблюдай реакцию на поддержку и сопротивление.',state='waiting';
  if(blocked){title='ПРОПУСТИТЬ ВХОД';copy=r.hardBlock?r.copy:r.directive.copy;state='blocked';}
  else if(stale){title='ОБНОВИТЬ ДАННЫЕ';copy='Котировки старше двух минут. Обнови анализ перед проверкой сценария.';state='waiting';}
  else if(!calendarKnown){title='ПРОВЕРИТЬ СРЕДУ';copy='Календарь недоступен или устарел. Направление видно, но риск событий неизвестен.';state='waiting';}
  else if(!['SELECTIVE','GO','REDUCE'].includes(r.directive.code)){title='ЖДАТЬ УСЛОВИЯ';copy=r.directive.copy;state='waiting';}
  else if(bias&&trigger){title='СЦЕНАРИЙ ПОДТВЕРЖДЁН';copy='Ретест '+MI_TF_LABELS[r.trendlineSignal.tf]+' удержан. Проверь актуальность входа, стоп и размер позиции.';state='ready';}
  else if(bias){title='ЖДАТЬ ПОДТВЕРЖДЕНИЕ';copy='Уклон '+r.direction.toUpperCase()+' есть. Жди реакцию на уровне и подтверждённый триггер; оценка контекста не заменяет вход.';}
  return {factors,supports,against,unknown,stale,calendarKnown,blocked,bias,trigger,title,copy,state,side:r.direction};
}
function decisionPosition(side,entry,stop,target,riskUsd){
  if(![entry,stop,riskUsd].every(n=>Number.isFinite(n)&&n>0))return {valid:false,copy:'Укажи цену входа и стоп, чтобы рассчитать размер позиции.'};
  if(side==='long'?stop>=entry:stop<=entry)return {valid:false,copy:side==='long'?'Для LONG стоп должен быть ниже входа.':'Для SHORT стоп должен быть выше входа.'};
  const distance=Math.abs(entry-stop),quantity=riskUsd/distance,notional=quantity*entry;
  if(!Number.isFinite(quantity)||!Number.isFinite(notional))return {valid:false,copy:'Разница между входом и стопом слишком мала для расчёта.'};
  const targetValid=Number.isFinite(target)&&target>0&&(side==='long'?target>entry:target<entry);
  return {valid:true,quantity,notional,distancePct:distance/entry*100,rr:targetValid?Math.abs(target-entry)/distance:null,targetValid,copy:'Размер по риску до стопа, без учёта комиссии и проскальзывания. Номинал позиции не равен залогу.'};
}
function decisionInstall(){
  const section=document.querySelector('#page-battle .battle-screen')||document.querySelector('#page-battle section');if(!section||document.getElementById('decision-context'))return;
  section.classList.add('decision-desk');
  const topbar=document.querySelector('.jnl-topbar');
  if(topbar){const updateOffset=()=>document.documentElement.style.setProperty('--decision-nav-offset',(getComputedStyle(topbar).position==='fixed'?topbar.getBoundingClientRect().height+16:16)+'px');new ResizeObserver(updateOffset).observe(topbar);updateOffset();}
  section.querySelector('.bs-head h1').textContent='ШТАБ РЕШЕНИЙ';
  section.querySelector('.bs-head p').textContent='Направление, важные цены и следующий шаг — в одном месте.';
  const context=document.createElement('div');context.id='decision-context';context.className='decision-context';context.setAttribute('aria-label','Рыночный контекст');section.querySelector('.bs-grid').before(context);
  const ring=battleEl('bs-score-ring');ring.title='Число факторов, поддерживающих выбранное направление. Не вероятность прибыли.';ring.querySelector('small').textContent='ФАКТОРЫ ЗА';
  const verdict=section.querySelector('.bs-verdict-copy>span');verdict.textContent='ЧТО ДЕЛАТЬ СЕЙЧАС';verdict.prepend(document.createRange().createContextualFragment(decisionItem('book')));
  const matched=document.createElement('p');matched.id='decision-matched';matched.className='decision-matched';battleEl('bs-trade-gate').before(matched);
  const conflict=document.createElement('div');conflict.id='decision-conflicts';conflict.className='decision-conflicts';section.querySelector('.bs-grid').after(conflict);
  const map=document.createElement('article');map.className='decision-map world-game-panel';map.id='decision-map';map.innerHTML='<header>'+decisionItem('crystal')+'<div><h2>КАРТА СЦЕНАРИЯ</h2><p>Экстремумы 4ч · ориентиры для наблюдения, не готовая заявка</p></div><button type="button" onclick="decisionOpen(\'liquidity\')">Открыть карту →</button></header><div id="decision-map-levels" class="decision-map-levels"></div><div id="decision-map-plan" class="decision-map-levels"></div><p id="decision-map-note"></p>';conflict.after(map);
  section.querySelector('.bs-scoreboard-head span').textContent='Оценка контекста · отдельно от готовности входа';
  section.querySelectorAll('.bs-direction').forEach((card,i)=>{card.dataset.route=i?'short':'long';card.querySelector('.bs-dir-name').prepend(document.createRange().createContextualFragment(decisionItem(i?'hammer':'torch')));const why=document.createElement('p');why.id=i?'decision-short-why':'decision-long-why';why.className='decision-route-why';card.querySelector('.pixel-meter-host').after(why);});
  section.querySelector('.bs-factors .bs-card-title').textContent='ИНВЕНТАРЬ ФАКТОРОВ';section.querySelector('.bs-factors .bs-card-head small').textContent='Поддержка, противоречия и отсутствующие подтверждения';
  section.querySelector('.bs-mission .bs-card-title').textContent='ПАНЕЛЬ ЗАЩИТЫ';section.querySelector('.bs-mission .bs-card-title').prepend(document.createRange().createContextualFragment(decisionItem('shield')));
  const calculator=document.createElement('div');calculator.className='decision-calculator';calculator.innerHTML='<h3>Размер позиции по стопу</h3><div class="decision-price-inputs"><label>Вход $<input id="decision-entry" type="number" min="0" step="any" inputmode="decimal" placeholder="Цена входа"></label><label>Стоп $<input id="decision-stop" type="number" min="0" step="any" inputmode="decimal" placeholder="Цена отмены"></label><label>Цель $ · необязательно<input id="decision-target" type="number" min="0" step="any" inputmode="decimal" placeholder="Первая цель"></label></div><div id="decision-position" aria-live="polite"></div>';
  section.querySelector('.bs-risk-choice').after(calculator);calculator.addEventListener('input',decisionRenderPosition);
  battleEl('bs-action').textContent='СОХРАНИТЬ ПЛАН В ЖУРНАЛ';
}
function decisionMeta(){return {age:Math.max(0,(Date.now()-marketIntelState.loadedAt)/1000),calendarAt:environmentState.lastCalendarAt,calendarSource:environmentState.source,calendarAge:(Date.now()-environmentState.lastCalendarAt)/1000};}
function decisionOpen(page){
  const symbol=battleState.symbol;
  if(page==='trendline'){openTrendlineFor(symbol);return;}
  if(page==='liquidity'){liquidityState.symbol=symbol;showPage(page,document.querySelector('[data-page="'+page+'"]'));liquidityScan(symbol,false);return;}
  if(page==='elliott'){elliottState.symbol=symbol;showPage(page,document.querySelector('[data-page="'+page+'"]'));elliottScan(symbol,false);return;}
  showPage(page,document.querySelector('[data-page="'+page+'"]'));if(page==='marketintel')selectMarketCoin(symbol,null,false);
}
function decisionRender(r,riskUsd,effectivePct){
  decisionInstall();const meta=decisionMeta(),m=decisionBuildModel(r,meta);decisionModel={...m,result:r,riskUsd:m.blocked||m.stale?0:riskUsd,effectivePct:m.blocked||m.stale?0:effectivePct};
  if(m.blocked||m.stale){battleSet('bs-risk-usd','$0');battleSet('bs-risk-pct','0.00%');battleSet('bs-risk-mode','ПАУЗА');pixelSetMeter('bs-risk-meter',0,{label:'Риск от баланса',max:1.5,segments:12});}
  const set=(id,value)=>battleSet(id,value);
  const card=battleEl('bs-verdict-card');card.dataset.readiness=m.state;card.setAttribute('aria-busy','false');
  set('bs-verdict',m.title);battleEl('bs-verdict').style.color=m.state==='blocked'?'var(--r)':m.state==='ready'?'var(--world-cyan)':'var(--world-gold)';set('bs-verdict-copy',m.copy);
  set('bs-score',m.supports.length+' / 6');set('decision-matched',m.supports.length+' за '+m.side.toUpperCase()+' · '+m.against.length+' против · '+m.unknown.length+' без подтверждения'+(m.factors.slice(0,6).some(f=>f.state==='context')?' · объём нейтрален':''));
  pixelSetMeter('bs-signal-meter',m.supports.length,{label:'Факторы за '+m.side.toUpperCase(),max:6,segments:6,caption:''});
  const event=r.macro.nextHigh;
  battleEl('decision-context').innerHTML=[['book',battleState.symbol+' / USDT','Структура 1д · триггер 5м–1ч'],['torch',r.session.phase.title,'Сессия · UTC'],['crystal',environmentRegimeLabel(r.snapshot.code),r.snapshot.breadth==null?'Ширина рынка неизвестна':Math.round(r.snapshot.breadth)+'% корзины растут'],['shield',m.calendarKnown?(event?environmentCountdown(Math.max(0,r.macro.highMinutes)):'Нет важных событий / 48ч'):'Календарь неизвестен',event?event.country+' · '+event.title:'Риск событий'],['book',Math.round(meta.age)+'с назад',m.stale?'Данные устарели':'Живой поток · проверка свечей каждые 30с']].map(([item,title,copy])=>'<div>'+decisionItem(item)+'<span><strong>'+escHtml(title)+'</strong><small>'+escHtml(copy)+'</small></span></div>').join('');
  if(!m.calendarKnown){set('bs-event-count','НЕТ ДАННЫХ');set('bs-event-name','Календарь недоступен или устарел. Отсутствие событий не подтверждено.');}
  const conflicts=m.factors.filter(f=>f.state==='against').map(f=>f.name+': '+f.value);if(!m.calendarKnown)conflicts.push('Риск событий неизвестен');if(m.stale)conflicts.push('Устаревшие котировки');
  battleEl('decision-conflicts').innerHTML=decisionItem('hammer')+'<div><strong>'+(conflicts.length?'Что требует внимания':'Явных противоречий не найдено')+'</strong><p>'+escHtml(conflicts.length?conflicts.join(' · '):'Отсутствие противоречий не подтверждает вход. Нужен ценовой триггер.')+'</p></div>';
  battleEl('bs-factor-list').innerHTML=m.factors.map(f=>'<button type="button" class="decision-factor '+f.state+'" onclick="decisionOpen(\''+f.page+'\')">'+decisionItem(f.item)+'<div><span>'+escHtml(f.name)+'</span><strong>'+escHtml(f.value)+'</strong><small>'+escHtml(f.copy)+'</small></div><em>'+({support:'Поддерживает',against:'Противоречит',unknown:'Нет подтверждения',context:'Контекст'}[f.state])+' →</em></button>').join('');
  const current=r.analysis.current,levels=[{label:'Поддержка',price:r.levels.support,item:'shield',kind:'support'},{label:'Цена сейчас',price:current,item:'torch',kind:'current'},{label:'Сопротивление',price:r.levels.resistance,item:'crystal',kind:'resistance'}];
  battleEl('decision-map-levels').innerHTML=levels.map(l=>'<div class="decision-level '+l.kind+'">'+decisionItem(l.item)+'<span>'+l.label+'</span><strong>'+miFmtPrice(l.price)+'</strong><small>'+(l.kind==='current'?'Текущая котировка':(l.price/current-1)*100>=0?'+'+((l.price/current-1)*100).toFixed(2)+'% от цены':((l.price/current-1)*100).toFixed(2)+'% от цены')+'</small></div>').join('');
  set('decision-map-note','Зона наблюдения для '+m.side.toUpperCase()+': '+miFmtPrice(m.side==='long'?r.levels.support:r.levels.resistance)+'. Отмена — '+(m.side==='long'?'закрепление ниже поддержки.':'закрепление выше сопротивления.')+' '+(m.trigger?'Ретест уже подтверждён на '+MI_TF_LABELS[r.trendlineSignal.tf]+'.':'Подтверждённого триггера в этом направлении пока нет.'));
  for(const side of ['long','short']){const score=side==='long'?r.longScore:r.shortScore;set('decision-'+side+'-why','Контекст '+score+'/100 · '+(side===m.side&&m.bias?'основное направление':'альтернативный сценарий'));const route=document.querySelector('[data-route="'+side+'"]');route.classList.toggle('preferred',side===m.side&&m.bias);}
  if(decisionDraftSymbol!==battleState.symbol){decisionDraftSymbol=battleState.symbol;for(const id of ['entry','stop','target'])battleEl('decision-'+id).value='';}
  set('bs-mission-note',m.blocked?'Новый риск заблокирован. '+r.copy:'Базовый риск '+battleState.riskPct.toFixed(1)+'% · после ограничений среды '+effectivePct.toFixed(2)+'%. Стоп и размер ниже — расчёт плана, не подтверждение входа.');
  decisionRenderPosition();worldFitPanels(document.getElementById('page-battle'));
}
function decisionRenderPosition(){
  if(!decisionModel)return;const m=decisionModel;
  const val=id=>{const value=battleEl('decision-'+id)?.value;return value===''?NaN:Number(value);};
  const p=decisionPosition(m.side,val('entry'),val('stop'),val('target'),m.riskUsd);m.position=p;
  battleEl('decision-map-plan').innerHTML=[['flag','Вход плана','entry'],['shield','Стоп плана','stop'],['crystal','Цель плана','target']].map(([item,label,id])=>'<div class="decision-level">'+decisionItem(item)+'<span>'+label+'</span><strong>'+miFmtPrice(val(id))+'</strong><small>'+(val(id)>0?'Цена из твоего плана':'Укажи цену в панели защиты')+'</small></div>').join('');
  const fmt=n=>n.toLocaleString('ru-RU',{maximumSignificantDigits:7});
  battleEl('decision-position').innerHTML=p.valid?'<div class="decision-position-values"><div><span>Количество '+battleState.symbol+'</span><strong>'+fmt(p.quantity)+'</strong></div><div><span>Номинал позиции</span><strong>$'+fmt(p.notional)+'</strong></div><div><span>До стопа</span><strong>'+p.distancePct.toFixed(2)+'%</strong></div><div><span>Цель / риск</span><strong>'+(p.rr===null?'—':p.rr.toFixed(2)+' : 1')+'</strong></div></div><p>'+escHtml(p.copy)+(val('target')>0&&!p.targetValid?' Цель должна быть '+(m.side==='long'?'выше':'ниже')+' входа.':'')+'</p>':'<p>'+escHtml(p.copy)+'</p>';
  const allowed=p.valid&&!m.blocked&&!m.stale&&m.bias&&(Number.isNaN(val('target'))||p.targetValid);battleEl('bs-action').disabled=!allowed;battleEl('bs-action').textContent=allowed?'СОХРАНИТЬ ПЛАН '+m.side.toUpperCase()+' В ЖУРНАЛ':m.blocked?'НОВЫЙ РИСК ЗАБЛОКИРОВАН':m.stale?'ОБНОВИ ДАННЫЕ':!m.bias?'ЖДЁМ НАПРАВЛЕНИЕ':'УКАЖИ ВХОД И СТОП';
}
function decisionClear(copy='Получаем свечи и ограничения среды…'){
  decisionInstall();decisionModel=null;battleState.lastDecision=null;
  battleEl('bs-action').disabled=true;battleSet('bs-action','ОЖИДАНИЕ ДАННЫХ');battleSet('bs-verdict','ЗАГРУЗКА');battleSet('bs-verdict-copy',copy);battleSet('bs-score','—');
  for(const id of ['decision-context','decision-map-levels','decision-map-plan','decision-conflicts','bs-factor-list','decision-position'])battleEl(id).replaceChildren();
  for(const id of ['bs-long-score','bs-short-score','bs-risk-usd','bs-risk-pct','bs-event-count','bs-trades-left'])battleSet(id,'—');
  for(const id of ['bs-long-condition','bs-short-condition','bs-long-invalid','bs-short-invalid','decision-matched','decision-map-note','decision-long-why','decision-short-why','bs-event-name','bs-mission-note'])battleSet(id,copy);
  for(const id of ['bs-signal-meter','bs-long-meter','bs-short-meter','bs-risk-meter'])pixelSetMeter(id,null,{label:'Ожидаем данные'});
  battleEl('bs-verdict-card').setAttribute('aria-busy','true');
  battleEl('bs-verdict-card').dataset.readiness='waiting';
}
document.addEventListener('DOMContentLoaded',()=>{
  decisionInstall();const original=renderBattleScreen;
  renderBattleScreen=function(){if(marketIntelState.symbol!==battleState.symbol||marketIntelState.loading||!marketIntelState.ticker){decisionClear();return;}original();};
  battleScan=async function(raw,button,force){
    const symbol=miCleanSymbol(raw);if(!symbol)return;
    const request=++decisionRequest,shared=++marketIntelState.requestId;battleState.symbol=symbol;marketIntelState.symbol=symbol;marketIntelState.loading=true;battleEl('bs-symbol-input').value=symbol;decisionClear();
    document.querySelectorAll('[data-bs-symbol]').forEach(button=>button.classList.toggle('active',button.dataset.bsSymbol===symbol));
    try{const data=await miLoadSpotHistory(symbol);if(request!==decisionRequest||shared!==marketIntelState.requestId)return;if(!(data.ticker.price>0)||MI_DATA_INTERVALS.some(tf=>!data.candles[tf]?.length||!data.candles[tf].every(trendlineValidCandle)))throw Error('Неполные свечи');marketIntelState.candles=data.candles;marketIntelState.ticker=data.ticker;marketIntelState.source=data.source;marketIntelState.loadedAt=Date.now();marketIntelState.loading=false;renderBattleScreen();}
    catch(error){if(request!==decisionRequest||shared!==marketIntelState.requestId)return;marketIntelState.loading=false;marketIntelState.ticker=null;marketIntelState.candles=Object.fromEntries(MI_DATA_INTERVALS.map(tf=>[tf,[]]));marketIntelState.loadedAt=0;decisionClear('Данные '+symbol+' недоступны. Проверь тикер или повтори загрузку.');battleSet('bs-verdict','НЕТ ДАННЫХ');battleEl('bs-verdict-card').setAttribute('aria-busy','false');}
  };
  battlePrepareTrade=function(){
    if(!decisionModel||battleEl('bs-action').disabled)return;
    const m=decisionModel,entry=battleEl('decision-entry').value,stop=battleEl('decision-stop').value,target=battleEl('decision-target').value;
    const position=decisionPosition(m.side,Number(entry),Number(stop),Number(target),m.riskUsd);if(!position.valid)return;
    setPair(battleState.symbol+'/USDT');setDir(m.side);
    for(const [id,value] of [['f-entry',entry],['f-sl',stop],['f-exit',target],['f-risk',m.effectivePct]]){if(battleEl(id))battleEl(id).value=value;}
    if(typeof ledgerSetMode==='function'){
      battleEl('f-dep').value=String(position.notional);
      ['f-usd','f-pnl','ledger-actual-exit','ledger-fees'].forEach(id=>{if(battleEl(id))battleEl(id).value='';});
      ledgerSetMode('open');ledgerStoreDraft();
    }
    if(typeof calcRR==='function')calcRR();showPage('journal',document.querySelector('[data-page="journal"]'));
  };
  setInterval(()=>{if(battleEl('page-battle')?.classList.contains('active')&&!marketIntelState.loading&&battleState.lastDecision)renderBattleScreen();},15000);
});
