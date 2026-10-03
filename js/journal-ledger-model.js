/* Trade lifecycle: planned levels are never realized P&L. Existing database columns suffice. */
const journalLedger={mode:'open',filter:'all',busy:false,full:null,quotes:new Map(),quoteBusy:false,quoteAt:0,editId:null};
function ledgerOpen(t){return String(t.status||'').toLowerCase()==='open';}
function ledgerRows(){return (journalLedger.full||allTrades||[]).filter(t=>currentUser?.id&&t.user_id===currentUser.id);}
function ledgerClosed(rows){return (rows||[]).filter(t=>!ledgerOpen(t)).map(t=>{
  const closed=t.payload?.journal?.closed_at;
  return closed?{...t,created_at:closed}:t;
}).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));}
function ledgerNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;}
function ledgerPositionRoute(t,quote){
  const entry=ledgerNumber(t.entry_price),stop=ledgerNumber(t.stop_loss),target=ledgerNumber(t.take_profit),sign=t.direction==='short'?-1:1;
  const risk=(entry-stop)*sign,reward=(target-entry)*sign;
  if(!(entry>0&&stop>0&&target>0&&risk>0&&reward>0))return null;
  const price=ledgerNumber(quote?.price),move=price>0?(price-entry)*sign:null;
  const targetPct=move===null?null:move/reward*100,riskPct=move===null?null:Math.max(0,-move/risk*100);
  // Risk and reward have separate visual scales so a very close stop stays readable.
  const position=move===null?null:move>=0?28+Math.min(1,move/reward)*72:28*(1-Math.min(1,-move/risk));
  return {position,targetPct,riskPct,phase:move===null?'pending':move>=reward?'target':move<=-risk?'stop':move<0?'risk':'reward'};
}
function ledgerPlan({entry,size,stop,target,direction='long'}){
  [entry,size,stop,target]=[entry,size,stop,target].map(ledgerNumber);
  const sign=direction==='short'?-1:1,qty=entry>0&&size>0?size/entry:null;
  const risk=qty!==null&&stop>0?(entry-stop)*sign*qty:null;
  const reward=qty!==null&&target>0?(target-entry)*sign*qty:null;
  return {qty,risk,reward,rr:risk>0&&reward>0?reward/risk:null,
    invalidStop:entry>0&&stop!==null&&(!(stop>0)||(entry-stop)*sign<=0),
    invalidTarget:entry>0&&target!==null&&(!(target>0)||(target-entry)*sign<=0)};
}
function ledgerSettlement(t,{exit,net,fees=0}){
  exit=ledgerNumber(exit);net=ledgerNumber(net);fees=ledgerNumber(fees);
  if(fees===null||fees<0)throw Error('Комиссии должны быть нулём или положительным числом.');
  const entry=ledgerNumber(t.entry_price),size=ledgerNumber(t.deposit);
  if(exit!==null&&exit<=0)throw Error('Цена закрытия должна быть больше нуля.');
  if(net===null){
    if(!(entry>0&&size>0&&exit>0))throw Error('Укажите цену закрытия или фактический P&L.');
    net=(exit-entry)*(t.direction==='short'?-1:1)*(size/entry)-fees;
  }
  const pnl=Math.round((net+Number.EPSILON)*1e8)/1e8;
  return {status:'closed',result:pnl>0?'win':pnl<0?'loss':'be',pnl_usd:pnl,pnl_pct:size>0?pnl/size*100:null,exit_price:exit};
}
function ledgerField(id){return document.getElementById(id);}
function ledgerValue(id){return ledgerNumber(ledgerField(id)?.value);}
function ledgerFormTrade(){
  const pair=(ledgerField('f-pair').value||'').trim().toUpperCase().replace(/\s/g,'').replace(/-/g,'/');
  if(!/^[A-Z0-9]{1,20}(?:[\/-][A-Z0-9]{1,12})?$/.test(pair))throw Error('Укажите пару, например BTC/USDT.');
  const entry=ledgerValue('f-entry'),size=ledgerValue('f-dep'),stop=ledgerValue('f-sl'),target=ledgerValue('f-exit'),leverage=ledgerValue('f-lev')??1;
  if(!(entry>0&&size>0))throw Error('Укажите цену входа и полный размер позиции в долларах.');
  if(leverage<1||leverage>200)throw Error('Плечо должно быть от 1 до 200.');
  const plan=ledgerPlan({entry,size,stop,target,direction:currentDir});
  if(plan.invalidStop)throw Error('Стоп для Long должен быть ниже входа, для Short — выше.');
  if(plan.invalidTarget)throw Error('Цель для Long должна быть выше входа, для Short — ниже.');
  const note=(ledgerField('f-why').value.trim()+` [TF:${currentTF}] [REGIME:${currentRegime}]`).trim();
  const row={user_id:currentUser?.id,pair:pair.includes('/')?pair:pair.replace(/USDT$/,'')+'/USDT',direction:currentDir,
    status:'open',result:null,pnl_pct:null,pnl_usd:null,entry_price:entry,deposit:size,exit_price:null,
    take_profit:target,stop_loss:stop,leverage,setup_type:currentSetup||null,
    note_why:note,note_feel:(ledgerField('f-feel').value.trim()+Array.from(currentMistakes).map(x=>' #'+x).join('')).trim()||null,
    note_lesson:ledgerField('f-lesson').value.trim()||null,
    emotion_conf:emVals.conf,emotion_fear:emVals.fear,emotion_greed:emVals.greed,emotion_calm:emVals.calm,
    payload:{journal:{version:1,risk_limit_pct:ledgerValue('f-risk')}}};
  if(journalLedger.mode==='closed'){
    const settled=ledgerSettlement(row,{exit:ledgerValue('ledger-actual-exit'),net:ledgerValue('f-usd'),fees:ledgerValue('ledger-fees')??0});
    Object.assign(row,settled);row.payload.journal.closed_at=new Date().toISOString();
  }
  return row;
}
function ledgerInvalidate(){if(typeof marketLive!=='undefined')marketLive.historyRevision++;}
function ledgerRefreshAll(){updateStatsEnhanced();render();renderDashboard();renderProgress();renderLevelBar(ledgerClosed(ledgerRows()));}
async function ledgerPersist(row,id=null,closing=false){
  const user=currentUser?.id;if(!user)throw Error('Войдите в аккаунт, чтобы сохранить сделку.');
  ledgerInvalidate();
  if(window._isDemoMode){
    const rows=ledgerRows();
    if(id!==null){const i=rows.findIndex(t=>String(t.id)===String(id));if(i<0||closing&&!ledgerOpen(rows[i]))throw Error('Сделка уже изменилась. Обновите историю.');rows[i]={...rows[i],...row};}
    else rows.unshift({...row,id:'demo_'+crypto.randomUUID(),created_at:new Date().toISOString()});
    demoSaveTrades(rows);allTrades=rows;ledgerRefreshAll();return;
  }
  let query=id===null?sb.from('trades').insert([row]):sb.from('trades').update(row).eq('id',id).eq('user_id',user);
  if(closing)query=query.eq('status','open');
  const {data,error}=await journalWithTimeout(query.select('*'),12000);
  if(error)throw Error(error.message);
  if(currentUser?.id!==user)throw Error('Аккаунт изменился. Откройте его историю для проверки сохранения.');
  if(!data?.length)throw Error('Запись не обновилась. Возможно, сделка уже закрыта.');
  if(id===null)allTrades.unshift(data[0]);else allTrades=allTrades.map(t=>String(t.id)===String(id)?data[0]:t);
  ledgerInvalidate();ledgerRefreshAll();
}
async function ledgerSave(){
  if(journalLedger.busy)return;
  let row;try{row=ledgerFormTrade();}catch(e){ledgerMessage(e.message,true);return;}
  journalLedger.busy=true;ledgerReady();
  try{
    if(!ORBITUM_PERSONAL_MODE&&!window._hasFullAccess&&ledgerRows().length>=10)throw Error('Лимит бесплатного плана — 10 сделок.');
    if(!await ledgerPreflight())return;
    await ledgerPersist(row);ledgerMessage(row.status==='open'?'Позиция записана. Закройте её позже в журнале.':'Закрытая сделка записана.');
    ['f-pair','f-entry','f-sl','f-exit','f-usd','f-pnl','f-why','f-feel','f-lesson','ledger-actual-exit','ledger-fees'].forEach(id=>{if(ledgerField(id))ledgerField(id).value='';});
    currentSetup='';currentRes='';resetTerminalMistakes();document.querySelectorAll('.setup-btn').forEach(b=>b.classList.remove('active'));
    journalLedger.mode='open';ledgerSetMode('open');ledgerClearDraft();
  }catch(e){ledgerMessage(e.message,true);}finally{journalLedger.busy=false;ledgerReady();}
}
async function ledgerPreflight(){
  const rows=ledgerRows(),closed=ledgerClosed(rows),now=new Date(),day=t=>new Date(t.created_at).toDateString()===now.toDateString();
  const today=rows.filter(day),pnl=closed.filter(day).reduce((sum,t)=>sum+(Number(t.pnl_pct)||0),0),limits=terminalLimits();
  let streak=0;for(const t of closed){if(terminalTradeOutcome(t)==='loss')streak++;else break;}
  const reasons=[];if(today.length>=limits.maxTrades)reasons.push('Достигнут дневной лимит записей: '+limits.maxTrades);
  if(pnl<=-limits.dailyLoss)reasons.push('Закрытые сделки достигли стопа дня: '+pnl.toFixed(2)+'%');
  if(streak>=3)reasons.push(streak+' убыточных закрытий подряд');
  return !reasons.length||Boolean(await etConfirm({title:'Защита торгового дня',copy:'Можно записать уже совершённую сделку, осознанно подтвердив превышение лимита.',reasons,confirmText:'Записать факт сделки',cancelText:'Вернуться',tone:'danger'}));
}
function ledgerCalc(){
  const p=ledgerPlan({entry:ledgerValue('f-entry'),size:ledgerValue('f-dep'),stop:ledgerValue('f-sl'),target:ledgerValue('f-exit'),direction:currentDir});
  const set=(id,value)=>{const n=ledgerField(id);if(n&&n.textContent!==value)n.textContent=value;};
  set('rr-val',p.rr!==null?'1 : '+p.rr.toFixed(2):'—');set('risk-usd-val',p.risk>0?terminalFormatUsd(-p.risk):'—');
  set('tp-usd-val',p.reward>0?terminalFormatUsd(p.reward):'—');set('pos-size-val',ledgerValue('f-dep')>0?terminalFormatUsd(ledgerValue('f-dep'),false):'—');
  ledgerRenderPlan(p);ledgerReady();
}
function ledgerReady(){const b=ledgerField('btn-add');if(!b)return;b.disabled=journalLedger.busy;b.textContent=journalLedger.busy?'Сохраняем…':journalLedger.mode==='open'?'Записать открытую сделку':'Записать закрытую сделку';b.classList.toggle('is-ready',Boolean(ledgerField('f-pair')?.value&&ledgerValue('f-entry')>0&&ledgerValue('f-dep')>0));}
function ledgerDraftKey(){return 'orb_journal_draft_v1_'+(window._isDemoMode?'demo':currentUser?.id||'guest');}
const LEDGER_DRAFT_FIELDS=['f-pair','f-dep','f-entry','f-sl','f-exit','f-lev','f-risk','f-why','f-feel','f-lesson','f-usd','ledger-actual-exit','ledger-fees'];
function ledgerStoreDraft(){if(!currentUser)return;try{sessionStorage.setItem(ledgerDraftKey(),JSON.stringify({values:Object.fromEntries(LEDGER_DRAFT_FIELDS.map(id=>[id,ledgerField(id)?.value||''])),direction:currentDir,mode:journalLedger.mode,setup:currentSetup,tf:currentTF,regime:currentRegime,mistakes:[...currentMistakes],emotions:emVals}));}catch(_){} }
function ledgerClearDraft(){try{sessionStorage.removeItem(ledgerDraftKey());}catch(_){} }
function ledgerRestoreDraft(){if(!currentUser)return;try{const draft=JSON.parse(sessionStorage.getItem(ledgerDraftKey())||'null');if(!draft)return;LEDGER_DRAFT_FIELDS.forEach(id=>{if(ledgerField(id))ledgerField(id).value=draft.values?.[id]||'';});setDir(draft.direction==='short'?'short':'long');currentSetup=draft.setup||'';currentTF=draft.tf||currentTF;currentRegime=draft.regime||currentRegime;currentMistakes=new Set(draft.mistakes||[]);emVals=draft.emotions||emVals;ledgerPaintDraft();ledgerSetMode(draft.mode==='closed'?'closed':'open');ledgerMessage('Черновик восстановлен в этой вкладке.');}catch(_){} }
