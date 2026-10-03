/* Form completeness and a calendar of actual journal records. No trading decisions. */
let worldJournalDay = '';
let worldCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let worldJournalLoaded = false;

function worldFocusField(id) {
  const field=document.getElementById(id);if(!field)return;
  const details=field.closest('details');if(details)details.open=true;
  field.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  field.focus({preventScroll:true});
}

function worldRefreshPreparation() {
  const host=document.getElementById('world-preparation');if(!host)return;
  const value=id=>Number(document.getElementById(id)?.value), positive=id=>value(id)>0;
  const pair=document.getElementById('f-pair').value.trim();
  const entry=value('f-entry'),stop=value('f-sl'),exit=value('f-exit');
  const long=document.getElementById('btn-long').classList.contains('active');
  const geometry=entry>0&&stop>0&&exit>0&&(long?stop<entry&&exit>entry:stop>entry&&exit<entry);
  const risk=positive('f-dep')&&positive('f-risk')&&value('f-risk')<=100;
  const plan=Boolean(currentSetup||document.getElementById('f-why').value.trim());
  const steps=[['Контекст',Boolean(pair),'f-pair',pair||'Укажите пару'],['Уровни',geometry,'f-entry',geometry?'Вход · стоп · выход':'Проверьте уровни и направление'],['Риск',risk,'f-risk',risk?value('f-risk')+'% от позиции':'Укажите позицию и риск'],['План',plan,'f-why',plan?'Сетап описан':'Выберите сетап или опишите его']];
  host.replaceChildren();
  steps.forEach(([label,done,id,detail],index)=>{
    const button=worldElement('button','world-prep-step'+(done?' is-complete':''));button.type='button';
    button.append(worldElement('span','world-prep-number',done?'✓':String(index+1)),worldElement('strong',null,label),worldElement('small',null,detail));
    button.setAttribute('aria-label',label+': '+detail);button.addEventListener('click',()=>worldFocusField(id));host.append(button);
  });
  document.getElementById('world-prep-progress').textContent=steps.filter(s=>s[1]).length+' / 4 заполнено';
  const summary=document.getElementById('world-journal-summary');summary.replaceChildren();
  const metrics=[['Риск, $',geometry&&risk?'risk-usd-val':null],['R : R',geometry?'rr-val':null],['Расчёт позиции','pos-size-val'],['Ожидаемый результат',geometry&&risk?'tp-usd-val':null]];
  metrics.forEach(([label,id])=>{const box=worldElement('div','world-journal-metric');const valid=id&&(id!=='pos-size-val'||geometry&&risk);box.append(worldElement('span',null,label),worldElement('strong',null,valid?document.getElementById(id)?.textContent||'—':'—'));summary.append(box);});
}

function worldSelectJournalDay(key) {
  worldJournalDay=worldJournalDay===key?'':key;
  render();
  document.getElementById('trades-list')?.scrollIntoView({block:'nearest',behavior:'auto'});
}

function worldRenderJournalCalendar() {
  const host=document.getElementById('world-journal-calendar');if(!host)return;
  worldJournalLoaded=true;
  const year=worldCalendarMonth.getFullYear(),month=worldCalendarMonth.getMonth();
  const stats=new Map();
  allTrades.forEach(trade=>{const key=terminalTradeDayKey(trade);if(key==='unknown')return;const stat=stats.get(key)||{count:0,pnl:0,known:0};stat.count++;const pnl=terminalTradePnl(trade);if(pnl!==null){stat.pnl+=pnl;stat.known++;}stats.set(key,stat);});
  host.replaceChildren();
  const heading=worldElement('div','world-calendar-heading');
  const prev=worldElement('button',null,'‹'),next=worldElement('button',null,'›');
  [[prev,-1,'Предыдущий месяц'],[next,1,'Следующий месяц']].forEach(([button,offset,label])=>{button.type='button';button.setAttribute('aria-label',label);button.addEventListener('click',()=>{worldCalendarMonth=new Date(year,month+offset,1);worldRenderJournalCalendar();});});
  heading.append(prev,worldElement('strong',null,worldCalendarMonth.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})),next);host.append(heading);
  const grid=worldElement('div','world-calendar-grid');
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(day=>grid.append(worldElement('span','world-calendar-weekday',day)));
  const offset=(new Date(year,month,1).getDay()+6)%7;
  for(let i=0;i<offset;i++)grid.append(worldElement('span','world-calendar-spacer'));
  const today=terminalTradeDayKey({created_at:new Date().toISOString()});
  for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
    const key=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'),stat=stats.get(key);
    const tone=!stat?'empty':stat.known<stat.count?'unknown':stat.pnl>0?'positive':stat.pnl<0?'negative':'flat';
    const button=worldElement('button','world-calendar-day '+tone+(key===today?' is-today':'')+(key===worldJournalDay?' is-selected':''));button.type='button';
    const result=stat?(stat.known===stat.count?terminalFormatUsd(stat.pnl):'P&L не полный'):'Нет сделок';
    const description=new Date(year,month,day).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})+' · '+(stat?stat.count+' сделок · ':'')+result;
    button.title=description;button.setAttribute('aria-label',description);button.setAttribute('aria-pressed',String(key===worldJournalDay));
    button.append(worldElement('span',null,String(day)),worldElement('i','world-calendar-pixel'));
    button.addEventListener('click',()=>worldSelectJournalDay(key));grid.append(button);
  }
  host.append(grid);
  const note=worldElement('div','world-calendar-note',worldJournalDay?'Выбран день: '+worldJournalDay:'Цвет — итог дня · время вашего устройства');
  if(worldJournalDay){const clear=worldElement('button',null,'Все дни');clear.type='button';clear.addEventListener('click',()=>{worldJournalDay='';render();});note.append(clear);}
  host.append(note);
  const detail=worldElement('p','world-calendar-detail');detail.textContent='Наведите на день или выберите его, чтобы открыть сделки.';host.append(detail);
  grid.addEventListener('pointerover',event=>{const button=event.target.closest('button');if(button)detail.textContent=button.title;});
  grid.addEventListener('focusin',event=>{if(event.target.title)detail.textContent=event.target.title;});
}

document.addEventListener('DOMContentLoaded',()=>{
  const form=document.getElementById('add-trade-form'),rail=document.querySelector('.history-rail');if(!form||!rail)return;
  const prep=worldElement('section','world-preparation-panel');prep.setAttribute('aria-label','Подготовка записи сделки');
  const heading=worldElement('div','world-quest-heading');heading.append(worldElement('h3',null,'Подготовка сделки'),Object.assign(worldElement('span'),{id:'world-prep-progress'}));
  prep.append(heading,Object.assign(worldElement('div','world-preparation'),{id:'world-preparation'}),worldElement('small','world-prep-note','Полнота записи · проверка параметров в кнопке «Проверить сетап»'));
  form.querySelector('.trade-form-heading').after(prep);
  const summary=worldElement('section','world-journal-summary-panel');summary.append(worldElement('h3',null,'Расчёт сделки'),Object.assign(worldElement('div','world-journal-summary'),{id:'world-journal-summary'}));rail.before(summary);
  const calendar=worldElement('section','world-calendar-panel');calendar.append(worldElement('h3',null,'Календарь результатов'),Object.assign(worldElement('div','world-journal-calendar','Загружаем сделки…'),{id:'world-journal-calendar'}));rail.prepend(calendar);
  let frame;const refresh=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(worldRefreshPreparation);};
  form.addEventListener('input',refresh);form.addEventListener('change',refresh);form.addEventListener('click',refresh);
  ['rr-val','risk-usd-val','tp-usd-val','pos-size-val'].forEach(id=>new MutationObserver(refresh).observe(document.getElementById(id),{childList:true,subtree:true}));
  worldRefreshPreparation();
  // Only a successful render marks history as loaded. Errors keep the retry state.
  if(!document.getElementById('trades-skeleton')&&!document.querySelector('.history-load-error'))worldRenderJournalCalendar();
  new MutationObserver(()=>{const error=document.querySelector('.history-load-error');if(error){worldJournalLoaded=false;document.getElementById('world-journal-calendar').textContent='История недоступна. Повторите загрузку ниже.';}}).observe(document.getElementById('trades-list'),{childList:true});
},{once:true});
