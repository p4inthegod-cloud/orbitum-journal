/* Supplied pixel objects are decoration; labels and data remain semantic HTML. */
const atlasRoutes = [
  ['overview','Обзор рынка','compass','Начните здесь: цена, фон рынка и ближайшие уровни.','Рынок'],
  ['marketintel','Аналитика монет','gem','Свечи, RSI, объём и согласованность таймфреймов.','Рынок'],
  ['premarket','Контекст и события','earth','Сессии, календарь и ограничения дня.','Рынок'],
  ['watchtower','Наблюдения','owl','Наблюдения за монетами и изменения сценариев.','Рынок'],
  ['battle','Анализ решений','target','Проверьте сценарий, риск и условия отмены.','План'],
  ['liquidity','Карта ликвидности','crystal-purple','Ценовые пулы, расстояния и история пересечений.','План'],
  ['trendline','Трендовая линия','pickaxe','Опоры, пробой, ретест и состояние подтверждения.','План'],
  ['elliott','Волны Эллиотта','wave','Основной и альтернативный счёт на свечах.','План'],
  ['journal','Журнал сделок','scroll','Запишите вход и вернитесь к сделке после закрытия.','История'],
  ['dashboard','Результаты','chest','Денежный P&L, R и просадка выбранного периода.','История'],
  ['progress','Разбор сделок','search','Найдите повторяющиеся условия и ошибки.','История'],
  ['digest','Отчёты','clock','Посмотрите итоги за 7, 30 или 90 дней.','История'],
  ['coach','Рекомендации','bulb','Разберите свою историю и привычки.','История'],
  ['library','Книга / справочник','wizard','Значения терминов и материалы по инструментам.','Помощь'],
  ['aichat','Помощник','orb','Задайте вопрос о текущем инструменте.','Помощь'],
  ['settings','Настройки','hammer','Профиль уведомлений, Telegram и алерты.','Помощь']
];
const atlasEmoji = {'📊':'compass','💎':'gem','📓':'scroll','📒':'scroll','📔':'scroll','📈':'target','🔭':'owl','🔬':'chest','🧰':'pickaxe','🔥':'fire','⏳':'hourglass','⌛':'hourglass','🛡️':'shield','🛡':'shield','🎯':'target','📚':'scroll','📖':'scroll','📕':'scroll','🔍':'search','💡':'bulb','🔒':'lock','🔑':'key','🔗':'link','⚠️':'warning','⚠':'warning','✅':'check','❌':'cross','🌐':'earth','🌍':'earth','⭐':'star','✨':'sparkle','🧲':'magnet','📌':'flag','📨':'mail','✉️':'mail','🤖':'orb','🧠':'bulb','📰':'scroll','⚔️':'sword','⚡':'lightning','💰':'coin','❤️':'heart','🌅':'sun','🔔':'clock','🛰️':'portal-blue','🕰️':'clock'};
function atlasImage(name) {
  const img = document.createElement('img'); img.className='atlas-icon';
  img.src='assets/pixel-pack/'+name+'.png'; img.alt=''; img.width=32; img.height=32; img.decoding='async'; img.loading='lazy'; img.draggable=false;
  return img;
}
function atlasDecorate(root) {
  const nodes=[...(root.matches?.('.emoji-glyph,.world-toy,.world-brand-crystal')?[root]:[]),...root.querySelectorAll('.emoji-glyph,.world-toy,.world-brand-crystal')];
  for(const node of nodes){
    if(node.dataset.atlasIcon)continue;
    const toy=[...node.classList].find(c=>c.startsWith('world-toy-'))?.replace('world-toy-','');
    const name=node.classList.contains('world-brand-crystal')?'crystal-purple':toy?({compass:'compass',crystal:'crystal-purple',rock:'ore',beacon:'lantern',flag:'flag',book:'scroll',square:'gem',weather:'cloud'})[toy]:atlasEmoji[node.textContent.trim()];
    if(!name)continue;node.dataset.atlasIcon=name;node.replaceChildren(atlasImage(name));node.classList.add('atlas-object');node.setAttribute('aria-hidden','true');
  }
}
function atlasRenderRoutes(query='') {
  const host=document.getElementById('atlas-results'),current=auditNavigation.active,needle=query.trim().toLocaleLowerCase('ru');
  const routes=atlasRoutes.filter(row=>row.join(' ').toLocaleLowerCase('ru').includes(needle));host.replaceChildren();
  document.getElementById('atlas-count').textContent=routes.length?'Разделов: '+routes.length:'Ничего не найдено. Попробуйте «риск», «свечи» или «журнал».';
  let group='';
  for(const [id,label,icon,description,category] of routes){
    if(group!==category){group=category;const title=document.createElement('h3');title.textContent=group;host.append(title);}
    const button=document.createElement('button');button.type='button';button.className='atlas-route';button.dataset.route=id;
    button.append(atlasImage(icon));const text=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=label;small.textContent=description;text.append(strong,small);button.append(text);
    if(current===id){const badge=document.createElement('span');badge.className='atlas-current';badge.textContent='Вы здесь';button.append(badge);button.setAttribute('aria-current','page');}
    button.addEventListener('click',()=>{document.getElementById('atlas-dialog').close();showPage(id);if(id!=='aichat'){scrollTo({top:0,behavior:'instant'});const heading=document.querySelector('#page-'+id+' h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}});host.append(button);
  }
}
function atlasOpen(){const dialog=document.getElementById('atlas-dialog');if(dialog.open)return;document.getElementById('atlas-search').value='';atlasRenderRoutes();dialog.showModal();document.getElementById('atlas-search').focus();}
function atlasInstall(){
  const stylesheet=document.querySelector('link[href="css/journal-atlas.css"]');if(stylesheet)document.head.append(stylesheet);
  const right=document.querySelector('.jtb-right');if(!right)return;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='atlas-launch';trigger.append(atlasImage('compass'));trigger.setAttribute('aria-label','Карта разделов и поиск · Ctrl K');trigger.title='Карта разделов · Ctrl K';trigger.addEventListener('click',atlasOpen);right.prepend(trigger);
  const dialog=document.createElement('dialog');dialog.id='atlas-dialog';dialog.className='atlas-dialog';dialog.setAttribute('aria-labelledby','atlas-title');
  dialog.innerHTML='<header><div><h2 id="atlas-title">Карта разделов</h2><p>Рынок · план · история · разбор</p></div><button type="button" class="atlas-close" aria-label="Закрыть карту разделов">×</button></header><label for="atlas-search">Куда хотите перейти?</label><input id="atlas-search" type="search" placeholder="Название, инструмент или задача" autocomplete="off"><p id="atlas-count" role="status" aria-live="polite"></p><div id="atlas-results"></div><footer><span>Ctrl K / ⌘ K — открыть</span><span>Esc — закрыть</span></footer>';
  document.body.append(dialog);dialog.querySelector('.atlas-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>trigger.focus({preventScroll:true}));dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  const search=document.getElementById('atlas-search');search.addEventListener('input',()=>atlasRenderRoutes(search.value));search.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();dialog.querySelector('.atlas-route')?.focus();}if(e.key==='Enter'){e.preventDefault();dialog.querySelector('.atlas-route')?.click();}});
  document.getElementById('atlas-results').addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const buttons=[...dialog.querySelectorAll('.atlas-route')],i=buttons.indexOf(document.activeElement);if(i<0)return;e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){event.preventDefault();dialog.open?dialog.close():atlasOpen();}});
  document.querySelectorAll('.top-nav [data-page]').forEach(button=>{const route=atlasRoutes.find(row=>row[0]===button.dataset.page);if(!route)return;const slot=button.querySelector('.world-nav-slot');if(slot){slot.replaceChildren(atlasImage(route[2]));slot.setAttribute('aria-hidden','true');}else button.prepend(atlasImage(route[2]));button.title=route[3];});
  const tools=document.querySelector('.top-nav-group summary .world-nav-slot');if(tools)tools.replaceChildren(atlasImage('pickaxe'));
  const watchLabel=document.querySelector('.top-nav [data-page="watchtower"] .world-nav-label');if(watchLabel)watchLabel.textContent='Наблюдения';
  document.querySelectorAll('.world-symbol-guide').forEach(guide=>{guide.querySelector('summary>span:not(.world-toy)').textContent='Легенда';});
  const pulse=document.getElementById('ov-pulse'),hero=document.getElementById('world-market-now');
  if(pulse&&hero){
    const secondary=[...pulse.querySelectorAll('article')].slice(1),explanation=hero.querySelector('.world-market-explanation');
    const details=document.createElement('details');details.className='atlas-context';details.innerHTML='<summary>Фон рынка, сессия и риск</summary><div class="atlas-context-grid"></div>';hero.append(details);
    const media=matchMedia('(max-width:768px)'),arrange=()=>{details.hidden=!media.matches;details.open=false;if(media.matches){details.querySelector('div').append(...secondary);if(explanation)details.append(explanation);}else{pulse.append(...secondary);if(explanation)hero.append(explanation);}};
    arrange();media.addEventListener('change',arrange);
  }
  const pending=new Set();let frame=0;
  const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData'){const parent=record.target.parentElement;if(parent?.matches('.emoji-glyph')){delete parent.dataset.atlasIcon;pending.add(parent);}}else for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches('.atlas-icon'))pending.add(node);}if(!frame&&pending.size)frame=requestAnimationFrame(()=>{frame=0;for(const node of pending)if(node.isConnected)atlasDecorate(node);pending.clear();});});
  atlasDecorate(document.body);observer.observe(document.body,{childList:true,subtree:true,characterData:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',atlasInstall,{once:true});else atlasInstall();
