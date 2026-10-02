/* Pixel journal workbench. User-controlled records, no automated trading or fabricated quotes. */
const ledgerIcon=kind=>worldProtocolItem(kind);
function ledgerMessage(copy,error=false){const box=ledgerField('ledger-message');if(!box)return;box.hidden=false;box.classList.toggle('error',error);box.textContent=copy;box.setAttribute('role',error?'alert':'status');}
function ledgerSetMode(mode){
  journalLedger.mode=mode;ledgerField('add-trade-form').dataset.ledgerMode=mode;
  document.querySelectorAll('[data-ledger-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ledgerMode===mode)));
  ledgerField('ledger-close-fields').hidden=mode==='open';ledgerField('f-usd').closest('.field').hidden=mode==='open';ledgerField('f-pnl').closest('.field').hidden=true;
  ledgerField('ledger-mode-copy').textContent=mode==='open'?'Запишите вход сейчас. Результат появится после закрытия.':'Укажите фактическую цену выхода или итоговый P&L — результат определится автоматически.';
  ledgerCalc();
}
function ledgerRenderPlan(p){
  const host=ledgerField('ledger-plan');if(!host)return;
  const entry=ledgerValue('f-entry'),stop=ledgerValue('f-sl'),target=ledgerValue('f-exit'),size=ledgerValue('f-dep');
  const value=n=>n>0?'$'+terminalFormatPrice(n):'—';
  host.innerHTML=`<div class="ledger-plan-head">${ledgerIcon('shield')}<div><strong>Карта вашей сделки</strong><small>Плановые уровни · полный размер позиции</small></div></div><div class="ledger-level-map"><div class="stop"><span>Стоп</span><strong>${value(stop)}</strong></div><div class="entry"><span>Вход ${currentDir==='short'?'↘':'↗'}</span><strong>${value(entry)}</strong></div><div class="target"><span>Цель</span><strong>${value(target)}</strong></div></div><div class="ledger-plan-metrics"><div><span>Потеря до стопа</span><strong>${p.risk>0?terminalFormatUsd(-p.risk):'—'}</strong></div><div><span>До цели</span><strong>${p.reward>0?terminalFormatUsd(p.reward):'—'}</strong></div><div><span>Риск / прибыль</span><strong>${p.rr!==null?'1 : '+p.rr.toFixed(2):'—'}</strong></div><div><span>Количество монет</span><strong>${p.qty!==null?Number(p.qty).toLocaleString('ru-RU',{maximumSignificantDigits:7}):'—'}</strong></div></div><p class="ledger-plan-note">${p.invalidStop||p.invalidTarget?'Уровни не соответствуют направлению. Проверьте стоп и цель.':size>0&&entry>0?'Плечо меняет требуемую маржу, а не прибыль полного размера позиции. Маржа ≈ '+terminalFormatUsd(size/(ledgerValue('f-lev')||1),false)+'.':'Укажите вход и размер позиции. Стоп и цель можно добавить позже.'}</p>`;
}
function ledgerSummary(){
  const rows=ledgerRows(),closed=ledgerClosed(rows),open=rows.filter(ledgerOpen),realized=closed.filter(t=>terminalTradePnl(t)!==null),net=realized.reduce((s,t)=>s+terminalTradePnl(t),0);
  const wins=closed.filter(t=>terminalTradeOutcome(t)==='win').length,losses=closed.filter(t=>terminalTradeOutcome(t)==='loss').length;
  ledgerField('ledger-overview').innerHTML=[['torch','Открытые позиции',String(open.length),'Записаны · ещё в работе'],['book','Закрытые сделки',String(closed.length),'Только завершённые сделки'],['crystal','Win rate',wins+losses?Math.round(wins/(wins+losses)*100)+'%':'—','Без открытых и безубытка'],['shield','Зафиксированный P&L',realized.length?terminalFormatUsd(net):'—','Без расчётной прибыли открытых']].map(([icon,title,value,copy])=>`<div class="ledger-overview-card">${ledgerIcon(icon)}<div><span>${title}</span><strong>${escHtml(value)}</strong><small>${copy}</small></div></div>`).join('');
}
function ledgerQuote(t){const symbol=String(t.pair||'').toUpperCase().replace(/[\/-]/g,'');const q=journalLedger.quotes.get(symbol);return q&&Date.now()-q.at<90000?q:null;}
async function ledgerRefreshQuotes(){
  if(journalLedger.quoteBusy||document.hidden||!ledgerField('page-journal')?.classList.contains('active'))return;
  journalLedger.quoteBusy=true;const user=currentUser?.id;
  const symbols=[...new Set(ledgerRows().filter(ledgerOpen).map(t=>String(t.pair||'').toUpperCase().replace(/[\/-]/g,'')))];
  let cursor=0;
  async function worker(){while(cursor<symbols.length){const symbol=symbols[cursor++];if(!/^[A-Z0-9]{2,32}USDT$/.test(symbol))continue;
    try{let price,source='Спот';try{const row=await miBinance('/api/v3/ticker/price?symbol='+encodeURIComponent(symbol));price=Number(row.price);if(!(price>0))throw Error('Нет цены');source='Binance Spot';}catch(_){const row=await miFetchJSON('https://api.bybit.com/v5/market/tickers?category=spot&symbol='+encodeURIComponent(symbol));if(row.retCode!==0)throw Error('Нет цены');price=Number(row.result?.list?.find(q=>q.symbol===symbol)?.lastPrice);source='Bybit Spot';}
      if(price>0&&Number.isFinite(price)&&currentUser?.id===user)journalLedger.quotes.set(symbol,{price,source,at:Date.now()});
    }catch(_){/* Keep the original age. A stale quote cannot look current. */}
  }}
  try{await Promise.all([worker(),worker(),worker()]);journalLedger.quoteAt=Date.now();if(currentUser?.id===user)ledgerRender();}finally{journalLedger.quoteBusy=false;}
}
function ledgerSetFilter(filter){journalLedger.filter=filter;currentFilter='all';worldJournalDay='';ledgerRender();}
function ledgerRender(){
  const host=ledgerField('trades-list');if(!host||!ledgerField('ledger-overview'))return;
  if(host.querySelector('.history-load-error')&&typeof marketLive!=='undefined'&&marketLive.historyError)return;
  const rows=ledgerRows(),signature=JSON.stringify([rows,journalLedger.filter,worldJournalDay,worldCalendarMonth.getTime(),rows.filter(ledgerOpen).map(t=>ledgerQuote(t))]);
  if(signature===journalLedger.renderSignature)return;journalLedger.renderSignature=signature;
  const openNotes=[...host.querySelectorAll('.ledger-note[open]')].map(n=>n.closest('[data-trade-id]').dataset.tradeId);
  const focused=document.activeElement?.closest('[data-ledger-action]'),focus=focused?{id:focused.dataset.id,action:focused.dataset.ledgerAction}:null,scroll=host.scrollTop;
  hideTradeSkeleton();ledgerSummary();worldRenderJournalCalendar();
  ledgerField('history-count').textContent=journalTradeCountLabel(rows.length);
  document.querySelectorAll('[data-ledger-filter]').forEach(b=>{const active=b.dataset.ledgerFilter===journalLedger.filter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  let filtered=rows.filter(t=>journalLedger.filter==='all'||journalLedger.filter==='open'&&ledgerOpen(t)||journalLedger.filter==='closed'&&!ledgerOpen(t)||['win','loss'].includes(journalLedger.filter)&&!ledgerOpen(t)&&terminalTradeOutcome(t)===journalLedger.filter||['long','short'].includes(journalLedger.filter)&&t.direction===journalLedger.filter);
  if(worldJournalDay)filtered=filtered.filter(t=>terminalTradeDayKey(ledgerOpen(t)?t:ledgerClosed([t])[0])===worldJournalDay);
  filtered=filtered.slice().sort((a,b)=>Number(ledgerOpen(b))-Number(ledgerOpen(a))||Date.parse(b.payload?.journal?.closed_at||b.created_at)-Date.parse(a.payload?.journal?.closed_at||a.created_at));
  if(!filtered.length){host.innerHTML=`<div class="ledger-empty">${ledgerIcon('book')}<strong>${rows.length?'В этом фильтре пока пусто':'Здесь начнётся ваша история'}</strong><p>${rows.length?'Выберите другой фильтр или день.':'Запишите открытую позицию. После закрытия появится результат.'}</p><button type="button" data-ledger-action="${rows.length?'reset':'focus'}">${rows.length?'Все сделки':'Записать первую сделку'}</button></div>`;return;}
  host.innerHTML=filtered.map(t=>{
    const open=ledgerOpen(t),id=escHtml(String(t.id)),q=open?ledgerQuote(t):null,outcome=terminalTradeOutcome(t),pnl=open?null:terminalTradePnl(t),date=terminalTradeDate(open?t:ledgerClosed([t])[0]);
    const plan=ledgerPlan({entry:t.entry_price,size:t.deposit,stop:t.stop_loss,target:t.take_profit,direction:t.direction});
    const move=q&&plan.qty!==null?(q.price-Number(t.entry_price))*(t.direction==='short'?-1:1)*plan.qty:null;
    const price=n=>Number(n)>0?'$'+terminalFormatPrice(n):'—';
    const actual=open?'Открыта':outcome==='win'?'Прибыль':outcome==='loss'?'Убыток':'Безубыток';
    const result=open?(move!==null?terminalFormatUsd(move):'—'):(pnl!==null?terminalFormatUsd(pnl):t.pnl_pct!==null&&t.pnl_pct!==undefined?terminalFormatPct(t.pnl_pct):'—');
    const note=terminalCleanNote(t.note_why);
    return `<article class="ledger-trade ${open?'open':outcome}" data-trade-id="${id}"><header>${ledgerIcon(open?'torch':outcome==='loss'?'shield':'crystal')}<div><strong>${escHtml(t.pair)}</strong><small>${escHtml(date.day+' · '+date.time)}</small></div><span class="ledger-direction ${t.direction==='short'?'short':'long'}">${t.direction==='short'?'↘ SHORT':'↗ LONG'}</span><span class="ledger-state">${actual}</span></header><div class="ledger-trade-result"><div><span>${open?'Расчётный P&L · до комиссий':'Зафиксированный P&L'}</span><strong class="${(move??pnl)>0?'positive':(move??pnl)<0?'negative':''}">${escHtml(result)}</strong></div><small>${open?(q?escHtml(q.source)+' · '+new Date(q.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Котировка недоступна или устарела'):'Сделка завершена'}</small></div><div class="ledger-trade-levels"><div><span>Вход</span><strong>${price(t.entry_price)}</strong></div><div><span>${open?'Текущая цена':'Выход'}</span><strong>${price(open?q?.price:t.exit_price)}</strong></div><div><span>Стоп</span><strong>${price(t.stop_loss)}</strong></div><div><span>Цель</span><strong>${price(t.take_profit)}</strong></div></div><div class="ledger-trade-meta"><span>Позиция ${price(t.deposit)}</span>${t.setup_type?'<span>'+escHtml(t.setup_type)+'</span>':''}${plan.rr!==null?'<span>R:R 1 : '+plan.rr.toFixed(2)+'</span>':''}</div>${open?ledgerProgress(t,q):''}${note?'<details class="ledger-note"><summary>План и заметки</summary><p>'+escHtml(note)+'</p>'+ (t.note_lesson?'<p>'+escHtml(t.note_lesson)+'</p>':'')+'</details>':''}<footer>${open?'<button type="button" class="ledger-close-button" data-ledger-action="close" data-id="'+id+'">Закрыть сделку</button>':''}<button type="button" data-ledger-action="edit" data-id="${id}">${open?'Изменить план':'Редактировать'}</button><button type="button" class="ledger-delete" data-ledger-action="delete" data-id="${id}" aria-label="Удалить сделку ${escHtml(t.pair)}">Удалить</button></footer></article>`;
  }).join('');
  host.querySelectorAll('[data-trade-id]').forEach(card=>{if(openNotes.includes(card.dataset.tradeId)){const note=card.querySelector('.ledger-note');if(note)note.open=true;}});
  if(focus){[...host.querySelectorAll('[data-ledger-action]')].find(b=>b.dataset.id===focus.id&&b.dataset.ledgerAction===focus.action)?.focus({preventScroll:true});}
  host.scrollTop=scroll;
}
function ledgerProgress(t,q){
  const stop=Number(t.stop_loss),target=Number(t.take_profit),entry=Number(t.entry_price);
  if(!(stop>0&&target>0&&stop!==target))return '';
  const fraction=n=>Math.max(0,Math.min(1,(n-stop)/(target-stop)));
  return `<div class="ledger-progress" aria-label="Стоп ${stop}, вход ${entry}, цель ${target}${q?', текущая цена '+q.price:''}"><span>Стоп</span><div>${Array.from({length:20},(_,i)=>'<i class="'+(i<10?'risk':'reward')+'"></i>').join('')}<b style="left:${fraction(entry)*100}%" title="Вход"></b>${q?'<em style="left:'+fraction(q.price)*100+'%" title="Текущая цена"></em>':''}</div><span>Цель</span></div>`;
}
function ledgerDialog(id,closing){
  const t=ledgerRows().find(x=>String(x.id)===String(id));if(!t||!ledgerOpen(t))return;
  journalLedger.editId=String(id);const dialog=ledgerField('ledger-dialog');dialog.dataset.closing=String(closing);
  dialog.innerHTML=`<form method="dialog"><header>${ledgerIcon(closing?'crystal':'hammer')}<div><h2>${closing?'Закрыть сделку':'Изменить план'}</h2><p>${escHtml(t.pair)} · ${t.direction==='short'?'Short':'Long'}</p></div><button type="button" data-ledger-dialog-cancel aria-label="Закрыть окно">×</button></header><p>${closing?'Введите реальную цену выхода или чистый P&L из биржи. Тейк-профит не считается фактическим выходом.':'Изменения сохранятся в открытой позиции.'}</p><div class="ledger-dialog-fields">${closing?'<label>Фактическая цена выхода, $<input id="ledger-dialog-exit" type="number" min="0" step="any" placeholder="Цена исполнения"></label><label>Чистый P&L, $ · необязательно<input id="ledger-dialog-net" type="number" step="any" placeholder="Приоритет над расчётом"></label><label>Комиссии + funding к вычету, $<input id="ledger-dialog-fees" type="number" min="0" step="any" value="0"></label><label>Урок из сделки<textarea id="ledger-dialog-lesson" placeholder="Что удалось, что изменить"></textarea></label>':[['entry','Вход, $',t.entry_price],['size','Полный размер позиции, $',t.deposit],['stop','Стоп, $',t.stop_loss],['target','Цель, $',t.take_profit]].map(([key,label,value])=>'<label>'+label+'<input id="ledger-dialog-'+key+'" type="number" step="any" value="'+(value??'')+'"></label>').join('')}</div><output id="ledger-dialog-estimate"></output><p id="ledger-dialog-error" role="alert" hidden></p><footer><button type="button" data-ledger-dialog-cancel>Отмена</button><button type="button" id="ledger-dialog-save">${closing?'Подтвердить закрытие':'Сохранить план'}</button></footer></form>`;
  dialog.querySelectorAll('[data-ledger-dialog-cancel]').forEach(b=>b.onclick=()=>dialog.close());
  function estimate(){const box=ledgerField('ledger-dialog-estimate');try{const r=ledgerSettlement(t,{exit:ledgerValue('ledger-dialog-exit'),net:ledgerValue('ledger-dialog-net'),fees:ledgerValue('ledger-dialog-fees')??0});box.textContent='Итог: '+terminalFormatUsd(r.pnl_usd)+' · '+(r.result==='win'?'Прибыль':r.result==='loss'?'Убыток':'Безубыток');}catch(_){box.textContent='Чистый P&L включает комиссии. При ручном вводе вычет повторно не применяется.';}}
  if(closing){dialog.oninput=estimate;estimate();}else dialog.oninput=null;
  ledgerField('ledger-dialog-save').onclick=async()=>{
    if(journalLedger.busy)return;
    const button=ledgerField('ledger-dialog-save'),error=ledgerField('ledger-dialog-error');journalLedger.busy=true;button.disabled=true;error.hidden=true;
    try{let update;
      if(closing){update=ledgerSettlement(t,{exit:ledgerValue('ledger-dialog-exit'),net:ledgerValue('ledger-dialog-net'),fees:ledgerValue('ledger-dialog-fees')??0});update.note_lesson=ledgerField('ledger-dialog-lesson').value.trim()||t.note_lesson;update.payload={...(t.payload||{}),journal:{...(t.payload?.journal||{}),version:1,closed_at:new Date().toISOString(),costs:ledgerValue('ledger-dialog-fees')??0,manual_net:ledgerValue('ledger-dialog-net')!==null}};}
      else{const entry=ledgerValue('ledger-dialog-entry'),size=ledgerValue('ledger-dialog-size'),stop=ledgerValue('ledger-dialog-stop'),target=ledgerValue('ledger-dialog-target'),p=ledgerPlan({entry,size,stop,target,direction:t.direction});if(!(entry>0&&size>0)||p.invalidStop||p.invalidTarget)throw Error('Проверьте вход, размер позиции, стоп и цель.');update={entry_price:entry,deposit:size,stop_loss:stop,take_profit:target};}
      await ledgerPersist(update,id,true);dialog.close();ledgerMessage(closing?'Сделка закрыта. Результат включён в статистику.':'План обновлён.');
    }catch(e){error.textContent=e.message;error.hidden=false;}finally{journalLedger.busy=false;button.disabled=false;}
  };
  dialog.showModal();dialog.querySelector('input')?.focus();
}
function ledgerInstallAdapters(){
  // These synchronous renderers read allTrades. Scope their input, restoring the full journal immediately.
  const scope=fn=>function(...args){const full=allTrades,previous=journalLedger.full;journalLedger.full=previous||full;allTrades=ledgerClosed(full);try{return fn.apply(this,args);}finally{allTrades=full;journalLedger.full=previous;}};
  ['updateStats','updateStatsEnhanced','renderDashboard','renderProgress','renderDigest','checkTiltAlert','runAICoach','_exportLocalReport'].forEach(name=>{if(typeof window[name]==='function')window[name]=scope(window[name]);});
  ['terminalStats','renderHistoryInsights','renderEdgeKernel','renderTerminalOS','renderLevelBar','orbColorUserByRank','worldRenderJournalCalendar'].forEach(name=>{if(typeof window[name]!=='function')return;const original=window[name];window[name]=function(rows,...args){return scope(original).call(this,ledgerClosed(rows??allTrades),...args);};});
  const outcome=terminalTradeOutcome,pnl=terminalTradePnl;terminalTradeOutcome=t=>ledgerOpen(t)?'open':outcome(t);terminalTradePnl=t=>ledgerOpen(t)?null:pnl(t);
  render=ledgerRender;calcRR=ledgerCalc;recalc=ledgerCalc;fromPct=()=>{};fromUsd=ledgerCalc;updateSaveReadyState=ledgerReady;addTrade=ledgerSave;window._demoAddTrade=ledgerSave;
  worldRefreshPreparation=ledgerCalc;
  const filter=setF;setF=(value,button)=>{if(ledgerField('page-journal').classList.contains('active'))ledgerSetFilter(value);else filter(value,button);};
  const edit=openEditModal;openEditModal=id=>{const t=ledgerRows().find(t=>String(t.id)===String(id));if(t&&ledgerOpen(t))ledgerDialog(id,false);else edit(id);};
  const show=showPage;showPage=function(...args){const result=show.apply(this,args);if(args[0]==='journal'){ledgerCalc();ledgerRender();ledgerRefreshQuotes();}return result;};
}
function ledgerInstall(){
  const page=ledgerField('page-journal'),form=ledgerField('add-trade-form');if(!page||page.dataset.ledgerInstalled)return;page.dataset.ledgerInstalled='true';
  page.insertAdjacentHTML('afterbegin',`<section class="ledger-heading"><div>${ledgerIcon('book')}<div><h1>Журнал сделок</h1><p>Записывайте вход, следите за планом и разбирайте закрытые сделки.</p></div></div><span>Ваш торговый дневник</span></section><section id="ledger-overview" aria-label="Сводка журнала"></section>`);
  form.querySelector('.fcard-title').textContent='Запись сделки';form.querySelector('.form-intro').textContent='Пара, направление, вход и размер позиции — остальное можно добавить позже.';
  form.querySelector('.trade-form-badge').innerHTML=ledgerIcon('hammer')+' Рабочий стол';
  form.querySelector('.world-preparation-panel')?.remove();document.querySelector('.world-journal-summary-panel')?.remove();
  form.querySelector('.trade-form-heading').insertAdjacentHTML('afterend',`<div class="ledger-mode"><button type="button" data-ledger-mode="open">В работе · открыта</button><button type="button" data-ledger-mode="closed">Уже закрыта</button></div><p id="ledger-mode-copy" class="ledger-mode-copy"></p><p id="ledger-message" hidden></p>`);
  form.querySelector('.res-btns').closest('.field').hidden=true;
  const rename=(id,label,tip)=>{const field=ledgerField(id),node=field?.closest('.field').querySelector('label');if(node){node.textContent=label;if(tip){const hint=document.createElement('small');hint.className='ledger-field-note';hint.textContent=tip;field.after(hint);}}};
  rename('f-dep','Полный размер позиции, $','Номинал всей позиции, уже с учётом плеча.');rename('f-lev','Плечо, ×','Нужно для оценки маржи.');rename('f-exit','Плановая цель, $');rename('f-risk','Лимит потери позиции, %','Дополнительный ориентир, не процент от баланса.');rename('f-usd','Фактический чистый P&L, $','Необязательно, если указана цена выхода.');
  ledgerField('f-lev').placeholder='1';ledgerField('f-pnl').removeAttribute('oninput');
  const groups=form.querySelectorAll('.trade-form-group');groups[1].querySelector('h3').textContent='Размер и плечо';groups[2].querySelector('h3').textContent='Уровни плана';
  // Move fields into a compact level row; hidden compatibility fields remain available to existing drafts.
  const pnlField=ledgerField('f-usd').closest('.field');groups[2].append(pnlField);
  const riskField=ledgerField('f-risk').closest('.field');riskField.hidden=true;
  const levelGrid=document.createElement('div');levelGrid.className='ledger-level-fields';['f-entry','f-sl','f-exit'].forEach(id=>levelGrid.append(ledgerField(id).closest('.field')));groups[2].querySelector('h3').after(levelGrid);
  groups[2].querySelector('.trade-risk-summary').hidden=true;
  groups[2].insertAdjacentHTML('beforeend',`<div id="ledger-close-fields" hidden><label class="ledger-input-label" for="ledger-actual-exit">Фактический выход, $<input type="number" step="any" min="0" id="ledger-actual-exit" placeholder="Цена исполнения"></label><label class="ledger-input-label" for="ledger-fees">Комиссии + funding к вычету, $<input type="number" step="any" min="0" id="ledger-fees" placeholder="0"></label></div><div id="ledger-plan"></div>`);
  form.querySelectorAll('input[type="number"]').forEach(input=>{input.step='any';input.inputMode='decimal';});
  form.querySelectorAll('.fg2').forEach(grid=>{if(!grid.querySelector('.field')||[...grid.querySelectorAll('.field')].every(field=>field.hidden||field.contains(ledgerField('f-pnl'))))grid.hidden=true;});
  form.querySelectorAll('.form-section-title').forEach((title,i)=>title.insertAdjacentHTML('afterbegin',ledgerIcon(i===0?'crystal':'shield')));
  form.querySelector('.trade-details summary').firstElementChild.textContent='Заметки, сетап и эмоции';
  const setup=groups[3];const advanced=form.querySelector('#trade-details .trade-details-body');advanced.prepend(setup);
  const rail=page.querySelector('.history-rail'),calendar=rail.querySelector('.world-calendar-panel');if(calendar){const details=document.createElement('details');details.className='ledger-calendar';details.innerHTML='<summary>Календарь закрытых сделок</summary>';details.append(calendar);rail.append(details);}
  rail.querySelector('.list-title').textContent='Позиции и история';const filters=rail.querySelector('.filters');filters.innerHTML=[['all','Все'],['open','Открытые'],['closed','Закрытые'],['win','Прибыль'],['loss','Убыток'],['long','Long'],['short','Short']].map(([key,label])=>`<button type="button" class="fbtn" data-ledger-filter="${key}">${label}</button>`).join('');
  const dialog=document.createElement('dialog');dialog.id='ledger-dialog';dialog.className='ledger-dialog';document.body.append(dialog);
  page.addEventListener('click',event=>{
    const mode=event.target.closest('[data-ledger-mode]');if(mode){ledgerSetMode(mode.dataset.ledgerMode);ledgerStoreDraft();}
    const filter=event.target.closest('[data-ledger-filter]');if(filter)ledgerSetFilter(filter.dataset.ledgerFilter);
    const action=event.target.closest('[data-ledger-action]');if(!action)return;
    const id=action.dataset.id;if(action.dataset.ledgerAction==='close')ledgerDialog(id,true);else if(action.dataset.ledgerAction==='edit')openEditModal(id);else if(action.dataset.ledgerAction==='delete')deleteTrade(id);else if(action.dataset.ledgerAction==='reset')ledgerSetFilter('all');else ledgerField('f-pair').focus();
  });
  form.addEventListener('input',()=>{ledgerCalc();ledgerStoreDraft();});form.addEventListener('change',ledgerStoreDraft);form.addEventListener('click',()=>{requestAnimationFrame(()=>{ledgerCalc();ledgerStoreDraft();});});
  ledgerInstallAdapters();ledgerSetMode('open');ledgerRender();
  const defaults=restoreFormDefaults;restoreFormDefaults=function(){defaults();ledgerRestoreDraft();ledgerCalc();};
  ledgerRestoreDraft();
  const session=()=>{journalLedger.quotes.clear();LEDGER_DRAFT_FIELDS.forEach(id=>{if(ledgerField(id))ledgerField(id).value='';});currentSetup='';currentMistakes.clear();ledgerSetMode('open');ledgerRestoreDraft();ledgerRender();ledgerRefreshQuotes();};
  let owner=currentUser?.id;setInterval(()=>{if(owner!==currentUser?.id){owner=currentUser?.id;session();}if(page.classList.contains('active')&&!document.hidden){if(Date.now()-journalLedger.quoteAt>=30000)ledgerRefreshQuotes();else ledgerRender();}},10000);
  window.addEventListener('online',ledgerRefreshQuotes);document.addEventListener('visibilitychange',()=>{if(!document.hidden)ledgerRefreshQuotes();});
  ledgerRefreshQuotes();worldFitPanels(page);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ledgerInstall,{once:true});else ledgerInstall();
