/* Original pixel scenery and responsive game-window chrome. Data stays in HTML. */
const worldArtwork = new Map();
const worldTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const worldElement = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
function worldRandom(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function worldPolygon(ctx, points, color) { ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.fill(); }
function worldCrystal(ctx, x, y, size, cyan = false, muted = false) {
  const dark = muted ? '#526078' : cyan ? '#3255a5' : '#48317c', mid = muted ? '#7a8799' : cyan ? '#539bfa' : '#9367ec', light = muted ? '#a2adbb' : cyan ? '#8ae8ff' : '#d0a0ff';
  const w = Math.max(3,Math.round(size * .36));
  worldPolygon(ctx,[[x,y-size],[x+w,y-size+5],[x+w,y-3],[x,y+2],[x-w,y-3],[x-w,y-size+5]],dark);
  worldPolygon(ctx,[[x,y-size],[x,y+1],[x-w,y-3],[x-w,y-size+5]],mid);
  worldPolygon(ctx,[[x,y-size],[x+2,y-size+3],[x+2,y-2],[x,y+1]],light);
  ctx.fillStyle=light;ctx.fillRect(x-2,y-size+3,2,3);
}
function worldCrystalImage(tone, heat, swept) {
  const key='crystal:'+tone+':'+heat+':'+swept;if(worldArtwork.has(key))return worldArtwork.get(key);
  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=26;const ctx=canvas.getContext('2d'),cyan=tone==='below';
  ctx.fillStyle=swept?'#526078':cyan?'#264986':'#453168';ctx.fillRect(5,23,38,2);ctx.fillRect(10,21,30,2);
  worldCrystal(ctx,24,23,20,cyan,swept);worldCrystal(ctx,14,24,11,cyan,swept);
  if(heat>=2)worldCrystal(ctx,34,24,14,cyan,swept);if(heat>=3)worldCrystal(ctx,8,24,7,cyan,swept);
  ctx.fillStyle=swept?'#7a8799':cyan?'#8ae8ff':'#d0a0ff';ctx.fillRect(42,9,2,2);ctx.fillRect(4,14,2,2);
  const url=canvas.toDataURL();worldArtwork.set(key,url);return url;
}
function worldCity(ctx,x,kind,color) {
  ctx.fillStyle=color;
  if(kind==='pagoda') { ctx.fillRect(x+7,20,5,24);for(const [y,w] of [[17,22],[25,18],[33,14]]){ctx.fillRect(x+10-w/2,y,w,2);ctx.fillRect(x+12-w/2,y-2,w-4,2);}ctx.fillRect(x+9,11,2,6); }
  else if(kind==='clock') { ctx.fillRect(x+4,14,8,30);ctx.fillRect(x+2,10,12,5);ctx.fillRect(x+6,5,4,5);ctx.fillRect(x+7,1,2,4);ctx.fillStyle='#bcc6fd';ctx.fillRect(x+6,17,4,4);ctx.fillStyle=color;ctx.fillRect(x+8,17,1,3); }
  else { const heights=[14,23,32,18,26];heights.forEach((h,i)=>ctx.fillRect(x+i*7,44-h,6,h));ctx.fillRect(x+16,9,1,5); }
}
function worldSessionImage(code) {
  const key='session:'+code;if(worldArtwork.has(key))return worldArtwork.get(key);
  const canvas=document.createElement('canvas');canvas.width=180;canvas.height=48;const ctx=canvas.getContext('2d');
  const palettes={ASIA:['#312044','#603778','#382c57','#a277cc'],LONDON:['#112d57','#284389','#18274b','#6689d3'],OVERLAP:['#252769','#7252b0','#2d2d69','#ac86e9'],NEW_YORK:['#152648','#394a8b','#202951','#778cd3'],OFF_HOURS:['#152039','#24304d','#1c2941','#4c6080']};
  const [top,bottom,land,city]=palettes[code]||palettes.OFF_HOURS;
  const gradient=ctx.createLinearGradient(0,0,180,0);gradient.addColorStop(0,top);gradient.addColorStop(1,bottom);ctx.fillStyle=gradient;ctx.fillRect(0,0,180,48);
  const rnd=worldRandom(code.length*159+code.charCodeAt(0));ctx.fillStyle='#93a6dd';for(let i=0;i<12;i++)ctx.fillRect(Math.floor(rnd()*180),Math.floor(rnd()*25),1,1);
  const mountain=[[0,48],[0,36]];for(let x=4;x<=180;x+=4)mountain.push([x,29+Math.floor(rnd()*13)]);mountain.push([180,48]);worldPolygon(ctx,mountain,land);
  if(code==='ASIA'){worldCity(ctx,10,'pagoda',city);worldCity(ctx,136,'pagoda',city);worldPolygon(ctx,[[40,46],[60,30],[73,21],[93,41],[118,48]],'#45315c');}
  else if(code==='LONDON'){worldCity(ctx,134,'clock',city);worldCity(ctx,22,'city',land);ctx.fillStyle=city;ctx.fillRect(73,37,50,11);ctx.fillRect(81,33,31,5);}
  else if(code==='OVERLAP'){worldCity(ctx,12,'clock',city);worldCity(ctx,113,'city',city);worldCity(ctx,64,'city',land);}
  else if(code==='NEW_YORK'){worldCity(ctx,13,'city',city);worldCity(ctx,83,'city',land);worldCity(ctx,130,'city',city);}
  else{ctx.fillStyle='#a1b7e5';ctx.fillRect(148,8,5,5);ctx.fillStyle=top;ctx.fillRect(150,6,4,5);}
  ctx.fillStyle='#111c37';ctx.fillRect(0,45,180,3);const url=canvas.toDataURL();worldArtwork.set(key,url);return url;
}
function worldAttachSessionScene(block,code) { const scene=worldElement('img','world-session-scene');scene.src=worldSessionImage(code);scene.alt='';scene.draggable=false;scene.setAttribute('aria-hidden','true');block.append(scene); }
function worldRenderLiquidity(data) {
  const host=document.getElementById('lq-chart');if(!host)return;host.replaceChildren();
  const rows=data.pools.slice(0,12).map(pool=>({pool,price:pool.price}));rows.push({current:true,price:data.current});rows.sort((a,b)=>b.price-a.price);
  rows.forEach(item=>{
    const pool=item.pool,swept=pool?.status==='swept',tone=item.current?'current':swept?'swept':pool.price>data.current?'above':'below',heat=swept?0:Math.max(1,Math.min(3,pool?.heat||1));
    const row=worldElement('div','world-pool '+tone);row.setAttribute('role','listitem');row.dataset.price=String(item.price);row.dataset.status=item.current?'current':pool.status;
    const name=worldElement('div','world-pool-name'),price=worldElement('strong','world-pool-price',miFmtPrice(item.price));
    if(item.current){name.append(worldElement('i','world-price-pointer'),worldElement('strong',null,'Текущая цена'));row.setAttribute('aria-label','Текущая цена '+miFmtPrice(item.price));}
    else{name.append(worldElement('span','world-pool-code',pool.short),worldElement('strong',null,pool.name));row.title=pool.name+' · '+miFmtPrice(pool.price)+' · '+pool.distancePct.toFixed(2)+'% · '+pool.distanceAtr.toFixed(2)+' ATR';row.setAttribute('aria-label',pool.name+', '+miFmtPrice(pool.price)+', '+(swept?'ликвидность снята':'неснятый пул, сила '+heat+' из 3'));}
    const platform=worldElement('div','world-platform');platform.setAttribute('aria-hidden','true');
    const strength=item.current?100:miClamp(Number(pool.strength)||0,0,100),filled=Math.round((.24+strength*.0072)*24);platform.style.setProperty('--fill',item.current?'100%':filled/24*100+'%');
    for(let i=0;i<24;i++)platform.append(worldElement('i',i<(item.current?24:filled)?'filled':null));
    if(!item.current){const crystal=worldElement('img','world-pool-crystal');crystal.src=worldCrystalImage(pool.price>data.current?'above':'below',heat||1,swept);crystal.alt='';crystal.draggable=false;platform.append(crystal);}
    const fire=worldElement('span','world-pool-fire');fire.setAttribute('aria-hidden','true');
    if(!item.current&&!swept){for(let i=0;i<heat;i++)fire.append(worldElement('span','emoji-glyph','🔥'));if(heat>=2){const sparks=worldElement('span','px-pool-sparks');sparks.style.setProperty('--spark-delay',Math.floor(pool.price%4)+'s');for(let i=0;i<heat;i++)sparks.append(worldElement('i'));fire.append(sparks);}}
    else if(swept)fire.append(worldElement('span','world-swept-label','Снята'));
    row.append(name,platform,fire,price);host.append(row);
  });
}
function worldDrawBackground() {
  const canvas=document.getElementById('world-space');if(!canvas)return;
  const scale=3,w=Math.ceil(innerWidth/scale),h=Math.ceil(innerHeight/scale),dark=worldTheme()==='dark';canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),rnd=worldRandom(907);
  ctx.clearRect(0,0,w,h);
  const sky=ctx.createLinearGradient(0,0,w,h);sky.addColorStop(0,dark?'#0c1226':'#eef3ff');sky.addColorStop(.6,dark?'#101326':'#f2f0ff');sky.addColorStop(1,dark?'#19172f':'#e9f4ff');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  for(let i=0;i<Math.round(w*h/1100);i++){const x=Math.floor(rnd()*w),y=Math.floor(rnd()*h);if(innerWidth<768 ? x>4&&x<w-4 : x>4&&x<w*.62)continue;ctx.fillStyle=dark?(i%3?'#576493':'#9aa4cf'):(i%3?'#c5ccef':'#a0b6e5');ctx.fillRect(x,y,1,1);if(i%12===0){ctx.fillRect(x-1,y,3,1);ctx.fillRect(x,y-1,1,3);}}
  const px=w-40,py=53,r=17;for(let y=-r;y<=r;y++){const width=Math.floor(Math.sqrt(r*r-y*y));ctx.fillStyle=dark?(y<0?'#554d9d':'#363470'):(y<0?'#d0c4ed':'#bdc5ef');ctx.fillRect(px-width,py+y,width*2,1);}
  ctx.fillStyle=dark?'#8b70cb':'#a8a4dc';for(let x=-33;x<=33;x++){const y=Math.round(x*.22);if(Math.abs(x)>15)ctx.fillRect(px+x,py+y,1,2);}ctx.fillStyle=dark?'#7370c8':'#b8b5e6';ctx.fillRect(px-4,py-11,7,3);ctx.fillRect(px+5,py+3,5,2);
  // Corner terrain stays behind the content; its uneven silhouette is intentional.
  const terrain=dark?'#22294b':'#dce3f7';ctx.fillStyle=terrain;for(let x=0;x<46;x+=3){const hh=5+Math.round(rnd()*10);ctx.fillRect(x,h-hh,3,hh);}worldCrystal(ctx,9,h-6,22,false,!dark);worldCrystal(ctx,20,h-3,33,true,!dark);worldCrystal(ctx,30,h-2,18,false,!dark);
  worldCrystal(ctx,w-3,35,20,true,!dark);worldCrystal(ctx,w-11,39,13,false,!dark);
}
function worldInstallChrome() {
  const canvas=worldElement('canvas','world-space');canvas.id='world-space';canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);worldDrawBackground();
  const icons=['📊','📓','📈','🌐','🔬','🧰'];
  document.querySelectorAll('.top-nav > .top-nav-link, .top-nav-group > summary').forEach((control,index)=>{
    const label=control.firstChild?.textContent.trim()||control.textContent.trim(),slot=worldElement('span','world-nav-slot'),emoji=worldElement('span','emoji-glyph',icons[index]),copy=worldElement('span','world-nav-label',label);
    slot.setAttribute('aria-hidden','true');slot.append(emoji);control.replaceChildren(slot,copy);if(control.tagName==='SUMMARY')copy.append(worldElement('span','world-nav-chevron','⌄'));
  });
  const brand=document.querySelector('.top-brand');if(brand){const crystal=worldElement('img','world-brand-crystal');crystal.src=worldCrystalImage('above',1,false);crystal.alt='';brand.replaceChildren(crystal,worldElement('span',null,'ANDROMEDA'));}
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(worldDrawBackground);});
  new MutationObserver(worldDrawBackground).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
}
document.addEventListener('DOMContentLoaded',worldInstallChrome,{once:true});
