/* A read-only exchange connection. API credentials are held only in the transient form. */
const journalOkx={owner:null,connection:null,busy:false,attempt:0,controller:null,generation:0,error:''};
const okxCopy={invalid_credentials:'Заполните API Key, Secret Key и Passphrase.',read_only_required:'Нужен отдельный ключ только с правом Read. Уберите Trade и Withdraw.',okx_auth:'OKX не подтвердил ключ. Проверьте регион, тип аккаунта, Passphrase и ограничения IP.',okx_rate_limit:'OKX ограничил частоту запросов. Повторим синхронизацию позже.',okx_unavailable:'OKX временно не отвечает. Последние данные сохранены.',database_unavailable:'Хранилище временно недоступно. Повторите подключение позже.',server_not_configured:'Подключение на сервере ещё не настроено.',unauthorized:'Войдите в аккаунт журнала.',connection_changed:'Подключение изменилось. Обновите его состояние.',account_changed:'Ключ относится к другому аккаунту. Подключите его заново.',incomplete_snapshot:'OKX вернул неполные данные. Закрытия пока не подтверждены.',invalid_position:'Не удалось проверить данные позиции OKX.',invalid_instrument:'Не удалось проверить размер контракта OKX.',server_unavailable:'Синхронизация временно недоступна. Последние данные сохранены.'};
function okxErrorCopy(code){return okxCopy[code]||okxCopy.server_unavailable;}
function okxCardFooter(t){
 const x=t.payload?.exchange||{},copy=t.status!=='open'?'Закрыта на OKX':x.sync_state==='paused'?'Синхронизация на паузе':x.sync_state==='pending_close'?'Закрытие уточняется':'Уровни и закрытие — на OKX';
 return `<button type="button" data-ledger-action="okx-notes" data-id="${escHtml(String(t.id))}">${ledgerObject('scroll')}<span>Заметки</span></button><span class="ledger-okx-state" title="${escHtml(x.instId||'')}">${ledgerObject('link')}${escHtml(copy)}</span>`;
}
function okxQuote(t){
 const x=t.payload?.exchange,at=Date.parse(x?.synced_at),price=Number(x?.mark_price);
 if(!x||x.sync_state!=='active'||!(price>0)||!Number.isFinite(at)||Date.now()-at>=LEDGER_QUOTE_STALE_MS)return null;
 return {price,at,source:'OKX · mark',pnl:ledgerNumber(x.unrealized_pnl)};
}
async function okxRequest(action,value={}){
 if(window._isDemoMode||!currentUser?.id||!sb)throw Error('unauthorized');
 const owner=currentUser.id,{data}=await sb.auth.getSession();
 if(!data?.session?.access_token||currentUser?.id!==owner)throw Error('unauthorized');
 const controller=new AbortController();journalOkx.controller=controller;const timer=setTimeout(()=>controller.abort(),35000);
 try{
  const response=await fetch('/api/okx',{method:action==='status'?'GET':'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},...(action==='status'?{}:{body:JSON.stringify({action,...value})})});
  const result=await response.json().catch(()=>({error:'server_unavailable'}));if(currentUser?.id!==owner)throw Error('unauthorized');
  if(!response.ok)throw Error(result.error||'server_unavailable');return result;
 }catch(error){if(controller.signal.aborted)throw Error('server_unavailable');throw error;}finally{clearTimeout(timer);if(journalOkx.controller===controller)journalOkx.controller=null;}
}
function okxMerge(result){
 journalOkx.error=result.warning||'';journalOkx.connection=result.connection||{connected:false};
 if(Array.isArray(result.trades)){
  const fresh=result.trades.filter(t=>t.user_id===currentUser?.id&&t.exchange==='okx'),ids=new Set(fresh.map(t=>String(t.id)));
  allTrades=[...fresh,...allTrades.filter(t=>!ids.has(String(t.id)))];ledgerInvalidate();ledgerRefreshAll();
 }
 okxPaint();
}
function okxPaint(error=''){
 if(error)journalOkx.error=error;const panel=ledgerField('journal-okx');if(!panel)return;const c=journalOkx.connection,connected=c?.connected===true,demo=window._isDemoMode;
 const badge=panel.querySelector('.okx-status'),copy=panel.querySelector('.okx-copy'),button=panel.querySelector('[data-okx-connect]'),sync=panel.querySelector('[data-okx-sync]'),disconnect=panel.querySelector('[data-okx-disconnect]');
 badge.textContent=demo?'Демо журнала':connected?(c.demo?'OKX Demo · Read':'OKX · Read'):'OKX';badge.classList.toggle('connected',connected);
 let status=journalOkx.error||c?.last_error;
 copy.textContent=demo?'Подключение биржи доступно после входа в свой аккаунт.':status?okxErrorCopy(status):connected?(c.last_sync_at?'Сверено '+new Date(c.last_sync_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · 10 с в журнале / 1 мин в фоне':'Подключено · получаю позиции…'):'Позиции с биржи автоматически появятся здесь · USDT-фьючерсы';
 if(connected&&c.counts?.unsupported)copy.textContent+=' · другие типы позиций: '+c.counts.unsupported;
 if(connected&&c.counts?.ordersAvailable===false)copy.textContent+=' · стопы и цели пока не подтверждены';
 copy.classList.toggle('error',Boolean(status));button.textContent=connected?'Настроить':'Подключить OKX';sync.hidden=!connected;disconnect.hidden=!connected;
 for(const b of panel.querySelectorAll('button'))b.disabled=journalOkx.busy||demo||!currentUser?.id;
 panel.setAttribute('aria-busy',String(journalOkx.busy));
 const clear=document.querySelector('#page-journal .history-clear-btn');if(clear){const imported=ledgerRows().some(t=>t.exchange==='okx');clear.textContent=imported?'Очистить ручные':'Очистить';clear.title=imported?'Очистить ручные записи; позиции OKX сохранятся':'Очистить всю историю';clear.setAttribute('aria-label',clear.title);}
}
async function okxRefresh(action='sync'){
 if(journalOkx.busy||!currentUser?.id||window._isDemoMode)return;
 const generation=journalOkx.generation;journalOkx.busy=true;journalOkx.attempt=Date.now();okxPaint();
 try{const result=await okxRequest(action);if(generation===journalOkx.generation)okxMerge(result);}catch(error){if(generation===journalOkx.generation)okxPaint(error.message);}
 finally{if(generation===journalOkx.generation){journalOkx.busy=false;okxPaint();}}
}
function okxConnectDialog(){
 const dialog=ledgerField('okx-dialog');if(!dialog||window._isDemoMode||!currentUser?.id)return;
 dialog.innerHTML=`<form id="okx-connect-form" autocomplete="off"><header>${ledgerObject('key')}<div><h2>Подключить OKX</h2><p>Автоматический журнал · только чтение</p></div><button type="button" data-okx-cancel aria-label="Закрыть окно">×</button></header><p>Создайте отдельный API-ключ с правом <strong>Read</strong>. Ключи хранятся зашифрованными на сервере. Импортируются USDT-фьючерсы и бессрочные контракты.</p><div class="okx-fields"><label>API Key<input name="apiKey" type="password" required autocomplete="off" maxlength="256" spellcheck="false"></label><label>Secret Key<input name="secretKey" type="password" required autocomplete="new-password" maxlength="256" spellcheck="false"></label><label>Passphrase<input name="passphrase" type="password" required autocomplete="new-password" maxlength="256" spellcheck="false"></label><div class="okx-options"><label>Регион аккаунта<select name="region"><option value="global">Global</option><option value="eu">Европа · EEA</option><option value="us">США / Австралия</option><option value="tr">Турция</option></select></label><label>Аккаунт<select name="environment"><option value="live">Реальный</option><option value="demo">OKX Demo Trading</option></select></label></div></div><p class="okx-scope">При подключении загрузятся текущие позиции. Сделки, закрытые после подключения, сохранятся в истории; старую историю автоматически не импортируем.</p><p id="okx-dialog-error" role="alert" hidden></p><footer><a href="https://www.okx.com/account/my-api" target="_blank" rel="noopener noreferrer">API-ключи OKX ↗</a><button type="submit">Проверить и подключить</button></footer></form>`;
 const form=dialog.querySelector('form');form.elements.region.value=journalOkx.connection?.region||'global';form.elements.environment.value=journalOkx.connection?.demo?'demo':'live';
 dialog.querySelector('[data-okx-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>form.reset();
 form.onsubmit=async event=>{
  event.preventDefault();if(journalOkx.busy)return;
  const generation=journalOkx.generation,values={apiKey:form.elements.apiKey.value,secretKey:form.elements.secretKey.value,passphrase:form.elements.passphrase.value,region:form.elements.region.value,demo:form.elements.environment.value==='demo'},button=form.querySelector('[type=submit]'),error=ledgerField('okx-dialog-error');
  journalOkx.busy=true;button.disabled=true;button.textContent='Проверяю…';error.hidden=true;okxPaint();
  try{const result=await okxRequest('connect',values);if(generation===journalOkx.generation){okxMerge(result);dialog.close();if(result.warning)okxPaint(result.warning);}}
  catch(e){if(generation===journalOkx.generation){error.hidden=false;error.textContent=okxErrorCopy(e.message);}}
  finally{values.apiKey=values.secretKey=values.passphrase='';form.elements.apiKey.value=form.elements.secretKey.value=form.elements.passphrase.value='';if(generation===journalOkx.generation){journalOkx.busy=false;journalOkx.attempt=Date.now();button.disabled=false;button.textContent='Проверить и подключить';okxPaint();}}
 };
 dialog.showModal();
}
async function okxDisconnect(){
 if(journalOkx.busy||!await etConfirm({title:'Отключить OKX?',copy:'Ключи будут удалены. Импортированные сделки и ваши заметки сохранятся.',confirmText:'Отключить',cancelText:'Оставить',tone:'danger'}))return;
 await okxRefresh('disconnect');
}
function okxNotes(id){
 const t=ledgerRows().find(t=>String(t.id)===String(id)&&t.exchange==='okx');if(!t)return;
 const owner=currentUser.id,dialog=ledgerField('okx-notes-dialog');dialog.innerHTML=`<form><header>${ledgerObject('scroll')}<div><h2>Заметки к позиции</h2><p>${escHtml(t.pair)} · ${escHtml(t.payload?.exchange?.instId||'OKX')}</p></div><button type="button" data-okx-cancel aria-label="Закрыть окно">×</button></header><label>План и причины входа<textarea name="why" maxlength="6000">${escHtml(t.note_why||'')}</textarea></label><label>Выводы и урок<textarea name="lesson" maxlength="6000">${escHtml(t.note_lesson||'')}</textarea></label><p role="alert" hidden></p><footer><button type="submit">Сохранить заметки</button></footer></form>`;
 dialog.querySelector('[data-okx-cancel]').onclick=()=>dialog.close();dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const f=event.target,b=f.querySelector('[type=submit]'),error=f.querySelector('[role=alert]');if(b.disabled)return;b.disabled=true;error.hidden=true;try{if(currentUser?.id!==owner)throw Error();const notes={note_why:f.elements.why.value,note_lesson:f.elements.lesson.value};const {data,error:failure}=await sb.from('trades').update(notes).eq('user_id',owner).eq('id',t.id).eq('exchange','okx').select('*');if(failure||!data?.length||currentUser?.id!==owner)throw Error();allTrades=allTrades.map(row=>String(row.id)===String(t.id)?{...row,...notes}:row);ledgerInvalidate();ledgerRender();dialog.close();}catch{error.hidden=false;error.textContent='Не удалось сохранить заметки. Повторите позже.';}finally{b.disabled=false;}};dialog.showModal();
}
async function okxClearManual(){
 const owner=currentUser?.id,manual=ledgerRows().filter(t=>!t.exchange);if(!owner||!manual.length)return;
 if(!await etConfirm({title:'Очистить ручные записи?',copy:'Будут удалены '+manual.length+' ручных записей. Импортированные позиции OKX сохранятся.',confirmText:'Очистить ручные',cancelText:'Отмена',tone:'danger'}))return;
 if(currentUser?.id!==owner)return;const {error}=await sb.from('trades').delete().eq('user_id',owner).is('exchange',null);if(error){showNotif('error','ЖУРНАЛ','Не удалось очистить ручные записи.',4000);return;}if(currentUser?.id!==owner)return;allTrades=allTrades.filter(t=>t.exchange);ledgerInvalidate();ledgerRefreshAll();
}
function okxInstall(){
 const heading=document.querySelector('#page-journal .ledger-heading');if(!heading||ledgerField('journal-okx'))return;
 heading.insertAdjacentHTML('beforeend',`<section id="journal-okx" aria-label="Подключение биржи"><div class="okx-identity">${ledgerObject('link')}<strong class="okx-status">OKX</strong></div><p class="okx-copy" role="status">Позиции с биржи автоматически появятся здесь · USDT-фьючерсы</p><div class="okx-actions"><button type="button" data-okx-connect>Подключить OKX</button><button type="button" data-okx-sync hidden>${ledgerObject('clock')}Обновить</button><button type="button" data-okx-disconnect hidden>Отключить</button></div></section>`);
 for(const id of ['okx-dialog','okx-notes-dialog']){const d=document.createElement('dialog');d.id=id;d.className='okx-dialog';document.body.append(d);}
 ledgerField('journal-okx').querySelector('[data-okx-connect]').onclick=okxConnectDialog;ledgerField('journal-okx').querySelector('[data-okx-sync]').onclick=()=>okxRefresh();ledgerField('journal-okx').querySelector('[data-okx-disconnect]').onclick=okxDisconnect;
 ledgerField('page-journal').addEventListener('click',event=>{const b=event.target.closest('[data-ledger-action="okx-notes"]');if(b)okxNotes(b.dataset.id);});
 const clear=clearAllTrades;clearAllTrades=()=>ledgerRows().some(t=>t.exchange==='okx')?okxClearManual():clear();
 const remove=deleteTrade;deleteTrade=id=>{if(ledgerRows().some(t=>String(t.id)===String(id)&&t.exchange==='okx'))return;return remove(id);};
 const edit=openEditModal;openEditModal=id=>{if(ledgerRows().some(t=>String(t.id)===String(id)&&t.exchange==='okx'))return okxNotes(id);return edit(id);};
 const tick=()=>{
  if(journalOkx.owner!==currentUser?.id){journalOkx.controller?.abort();journalOkx.generation++;journalOkx.owner=currentUser?.id;journalOkx.connection=null;journalOkx.error='';journalOkx.busy=false;journalOkx.attempt=0;ledgerField('okx-dialog').close();ledgerField('okx-notes-dialog').close();okxPaint();}
  if(document.hidden||!ledgerField('page-journal').classList.contains('active')||window._isDemoMode||!currentUser?.id)return;
  if(journalOkx.connection===null&&Date.now()-journalOkx.attempt>=10000)okxRefresh('status');else if(journalOkx.connection?.connected&&Date.now()-journalOkx.attempt>=10000)okxRefresh();
 };
 setInterval(tick,2000);window.addEventListener('online',tick);document.addEventListener('visibilitychange',tick);tick();okxPaint();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',okxInstall,{once:true});else okxInstall();
