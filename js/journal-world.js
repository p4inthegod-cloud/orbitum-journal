/* Original pixel scenery and responsive game-window chrome. Data stays in HTML. */
const worldTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const worldElement = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
function worldAttachSessionScene(block,code) {
  const index = {ASIA:0,LONDON:1,OVERLAP:2,NEW_YORK:3,OFF_HOURS:4}[code] ?? 4;
  const scenery = worldElement('div','world-session-scenery'); scenery.setAttribute('aria-hidden','true');
  const scene=worldElement('span','world-session-scene');
  scene.style.backgroundPosition=([20,70,50,85,50][index])+'% '+(index*25)+'%';scenery.append(scene);
  block.append(scenery);
}
function worldRenderLiquidity(data, targetId = 'lq-chart') {
  const host=document.getElementById(targetId);if(!host)return;host.setAttribute('role','group');host.replaceChildren();
  const rows=data.pools.slice(0,12).map(pool=>({pool,price:pool.price}));rows.push({current:true,price:data.current});rows.sort((a,b)=>b.price-a.price);
  rows.forEach(item=>{
    const pool=item.pool,swept=pool?.status==='swept',tone=item.current?'current':swept?'swept':pool.price>data.current?'above':'below',heat=swept?0:Math.max(1,Math.min(3,pool?.heat||1));
    const row=worldElement('div','world-pool '+tone);row.dataset.price=String(item.price);row.dataset.status=item.current?'current':pool.status;
    const name=worldElement('div','world-pool-name'),price=worldElement('strong','world-pool-price',miFmtPrice(item.price));
    if(item.current){name.append(worldElement('i','world-price-pointer'),worldElement('strong',null,'Текущая цена'));row.setAttribute('aria-label','Текущая цена '+miFmtPrice(item.price));}
    else{name.append(worldElement('span','world-pool-code',pool.short),worldElement('strong',null,pool.name));row.title=pool.name+' · '+miFmtPrice(pool.price)+' · '+pool.distancePct.toFixed(2)+'% · '+pool.distanceAtr.toFixed(2)+' ATR';row.setAttribute('aria-label',pool.name+', '+miFmtPrice(pool.price)+', '+(swept?'ликвидность снята':'неснятый пул, сила '+heat+' из 3'));}
    const platform=worldElement('div','world-platform');platform.setAttribute('aria-hidden','true');
    const strength=item.current?100:miClamp(Number(pool.strength)||0,0,100),filled=Math.round((.24+strength*.0072)*24);platform.style.setProperty('--fill',item.current?'100%':filled/24*100+'%');
    for(let i=0;i<24;i++)platform.append(worldElement('i',i<(item.current?24:filled)?'filled':null));
    if(!item.current){
      const ground=worldElement('span','world-crystal-ground'),crystal=worldElement('span','world-pool-crystal');crystal.style.backgroundPosition=(swept?'100%':pool.price>data.current?'0%':'50%')+' 0%';platform.append(ground,crystal);
      if(!swept&&heat>=2){const shards=worldElement('span','world-crystal-shards');for(let i=0;i<heat*2;i++)shards.append(worldElement('i'));platform.append(shards);}
    }
    const fire=worldElement('span','world-pool-fire');fire.setAttribute('aria-hidden','true');
    if(!item.current&&!swept){for(let i=0;i<heat;i++)fire.append(worldElement('span','emoji-glyph','🔥'));if(heat>=2){const sparks=worldElement('span','px-pool-sparks');sparks.style.setProperty('--spark-delay',Math.floor(pool.price%4)+'s');for(let i=0;i<heat;i++)sparks.append(worldElement('i'));fire.append(sparks);}}
    else if(swept)fire.append(worldElement('span','world-swept-label','Снята'));
    if(!item.current){
      row.tabIndex=0;row.setAttribute('role','button');
      row.setAttribute('aria-pressed',String(typeof worldLiquiditySelection!=='undefined'&&worldLiquiditySelection?.price===pool.price));
      const details=worldElement('span','world-pool-detail',pool.distancePct.toFixed(2)+'% · '+pool.distanceAtr.toFixed(2)+' ATR · '+(swept?'Снята':'Сила '+heat+'/3'));
      row.append(details);
      const select=()=>worldSelectLiquidityLevel(pool,targetId);row.addEventListener('click',select);
      row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
    }
    row.append(name,platform,fire,price);host.append(row);
  });
}
function worldDrawBackground() {
  const canvas=document.getElementById('world-space'); if(canvas){canvas.width=1;canvas.height=1;}
}
function worldInstallChrome() {
  const canvas=worldElement('canvas','world-space');canvas.id='world-space';canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);worldDrawBackground();
  const icons=['📊','💎','📓','📈','🌐','🔬','🧰'];
  document.querySelectorAll('.top-nav > .top-nav-link, .top-nav-group > summary').forEach((control,index)=>{
    const label=control.firstChild?.textContent.trim()||control.textContent.trim(),slot=worldElement('span','world-nav-slot'),emoji=worldElement('span','emoji-glyph',icons[index]),copy=worldElement('span','world-nav-label',label);
    slot.setAttribute('aria-hidden','true');slot.append(emoji);control.replaceChildren(slot,copy);if(control.tagName==='SUMMARY')copy.append(worldElement('span','world-nav-chevron','⌄'));
  });
  const brand=document.querySelector('.top-brand');if(brand){const crystal=worldElement('span','world-brand-crystal');crystal.setAttribute('aria-hidden','true');brand.replaceChildren(crystal,worldElement('span',null,'ANDROMEDA'));}
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(worldDrawBackground);});
  new MutationObserver(worldDrawBackground).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
}
document.addEventListener('DOMContentLoaded',worldInstallChrome,{once:true});
