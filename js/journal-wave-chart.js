/* Responsive price/RSI coordinates. The chart never changes model evidence. */
const elliottChartState={alternate:true,rsi:true,zoom:0,offset:0,last:null};
function elliottToggleLayer(layer,button){elliottChartState[layer]=!elliottChartState[layer];button.setAttribute('aria-pressed',String(elliottChartState[layer]));elliottChartRedraw();}
function elliottChartZoom(delta){elliottChartState.zoom=delta===0?0:Math.max(0,Math.min(4,elliottChartState.zoom+delta));elliottChartState.offset=0;elliottChartRedraw();}
function elliottChartPan(delta){elliottChartState.offset=Math.max(0,elliottChartState.offset+delta);elliottChartRedraw();}
function elliottChartRedraw(){if(elliottChartState.last&&document.getElementById('page-elliott')?.classList.contains('active'))worldRenderElliottChart(...elliottChartState.last);}
function worldRenderElliottChart(result,candles){
  const svg=document.getElementById('el-chart');if(!svg)return;
  elliottChartState.last=[result,candles];
  if(!candles?.length){svg.replaceChildren();return;}
  const allModels=[result.found?result:null,elliottChartState.alternate?result.alternate:null].filter(Boolean);
  const firstAnchor=Math.min(...allModels.flatMap(m=>m.points.map(p=>p.time)));
  const start=Number.isFinite(firstAnchor)?Math.max(0,candles.findIndex(c=>c.time>=firstAnchor)-5):Math.max(0,candles.length-120);
  const full=candles.slice(start),count=Math.max(24,Math.ceil(full.length/Math.pow(1.55,elliottChartState.zoom)));
  elliottChartState.offset=Math.min(elliottChartState.offset,Math.max(0,full.length-count));
  const end=full.length-elliottChartState.offset,rows=full.slice(Math.max(0,end-count),end);
  const width=Math.max(300,Math.round(svg.parentElement.clientWidth||900)),mobile=width<580,height=elliottChartState.rsi?(mobile?470:520):(mobile?340:390);
  const left=12,right=mobile?73:88,top=32,bottom=elliottChartState.rsi?height-151:height-33,plotWidth=width-left-right;
  const values=rows.flatMap(c=>[c.high,c.low]);
  const rowTimes=new Map(rows.map((c,i)=>[c.time,i]));
  allModels.forEach(model=>model.points.filter(p=>rowTimes.has(p.time)).forEach(p=>values.push(p.price)));
  const low=Math.min(...values),high=Math.max(...values),span=high-low||high*.01||1,min=low-span*.14,max=high+span*.14;
  const x=i=>left+(i+.5)/rows.length*plotWidth,y=price=>top+(max-price)/(max-min)*(bottom-top);
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.style.height=height+'px';
  const dark=worldTheme()==='dark',up=dark?'#54d1d5':'#158db0',down=dark?'#ae88ed':'#9260d7',gold=dark?'#e5c87e':'#967326';
  const parts=[],text=(px,py,value,color='var(--m)',anchor='start',size=10)=>`<text x="${px}" y="${py}" fill="${color}" text-anchor="${anchor}" font-size="${size}">${escHtml(String(value))}</text>`;
  const price=value=>miFmtPrice(value),date=time=>new Date(time).toLocaleString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  for(let i=0;i<=4;i++){const value=max-(max-min)*i/4,py=y(value);parts.push(`<line x1="${left}" x2="${width-right+4}" y1="${py}" y2="${py}" stroke="var(--b)" stroke-dasharray="2 5"/>`,text(width-right+8,py+3,price(value)));}
  const candleWidth=Math.max(.6,Math.min(8,plotWidth/rows.length*.65));
  rows.forEach((c,i)=>{const px=x(i),color=c.close>=c.open?up:down;parts.push(`<line x1="${px}" x2="${px}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}" stroke-width="1"/><rect x="${px-candleWidth/2}" y="${Math.min(y(c.open),y(c.close))}" width="${candleWidth}" height="${Math.max(1,Math.abs(y(c.open)-y(c.close)))}" fill="${color}" opacity=".82"/>`);});
  const boxes=[];
  function label(px,py,value,color,above){const boxWidth=Math.max(25,value.length*6+12),bx=Math.max(left,Math.min(width-right-boxWidth,px-boxWidth/2));let by=py+(above?-30:12);for(let k=0;k<5;k++){if(!boxes.some(b=>bx<b.x+b.w&&bx+boxWidth>b.x&&by<b.y+19&&by+19>b.y))break;by+=above?-21:21;}by=Math.max(10,Math.min(bottom-19,by));boxes.push({x:bx,y:by,w:boxWidth});return `<rect x="${bx}" y="${by}" width="${boxWidth}" height="19" fill="var(--color-neutral-1)" stroke="${color}"/>`+text(bx+boxWidth/2,by+13,value,color,'middle',11);}
  function modelLayer(model,alternate=false){
    const color=alternate?down:model.confirmed?up:gold,mapped=model.points.map((p,i)=>({p,index:rowTimes.get(p.time),label:model.labels[i]})).filter(p=>p.index!==undefined);
    if(mapped.length>=2)parts.push(`<path d="${mapped.map((m,i)=>(i?'L':'M')+x(m.index)+' '+y(m.p.price)).join(' ')}" fill="none" stroke="${color}" stroke-width="${alternate?1.6:2.5}" ${alternate||!model.confirmed?'stroke-dasharray="5 5"':''} opacity="${alternate?.65:.95}"/>`);
    mapped.forEach(m=>{const px=x(m.index),py=y(m.p.price);parts.push(`<path d="M${px} ${py-5}l5 5-5 5-5-5Z" fill="${m.p.provisional?'var(--color-neutral-1)':color}" stroke="${color}" stroke-width="1.5"/>`,label(px,py,(alternate?'alt ':'')+m.label+(m.p.provisional?' ?':''),color,m.p.type==='high'));});
    if(!alternate&&model.triggerLine){const line=model.triggerLine,indices=[rowTimes.get(line.a.time),rowTimes.get(line.b.time)];if(indices.every(i=>i!==undefined)){const a={...line.a,index:indices[0]},b={...line.b,index:indices[1]},endPrice=elliottLineValue(a,b,rows.length-1);parts.push(`<path d="M${x(a.index)} ${y(a.price)}L${x(rows.length-1)} ${y(endPrice)}" stroke="${gold}" stroke-width="1.6" stroke-dasharray="7 5" fill="none"/>`,text(left+4,top-10,'Линия '+line.label+' · '+elliottStatusText(model),gold));}}
  }
  if(result.alternate&&elliottChartState.alternate)modelLayer(result.alternate,true);
  if(result.found)modelLayer(result);
  if(result.found){for(const [key,title,color] of [['invalidation','Отмена',gold],['targetOne','Цель 1',up],['targetTwo','Цель 2',down]]){const value=result[key];if(Number.isFinite(value)&&value>=min&&value<=max){const py=y(value);parts.push(`<line x1="${left}" x2="${width-right}" y1="${py}" y2="${py}" stroke="${color}" opacity=".5" stroke-dasharray="4 7"/>`,text(width-right-4,py-6,title+' '+price(value),color,'end'));}}}
  const selectedTimes=[0,Math.floor((rows.length-1)/2),rows.length-1];selectedTimes.forEach((i,k)=>parts.push(text(k===0?left:k===2?width-right:x(i),height-9,date(rows[i].time),'var(--m)',k===0?'start':k===2?'end':'middle',mobile?9:10)));
  const rsiTop=bottom+31,rsiBottom=height-34,rsiY=v=>rsiBottom-v/100*(rsiBottom-rsiTop),rsis=miRSISeries(candles),rsiMap=new Map(candles.map((c,i)=>[c.time,rsis[i]]));
  if(elliottChartState.rsi){
    parts.push(text(left+4,rsiTop-10,'RSI 14 · те же свечи',down));
    for(const v of [30,50,70])parts.push(`<line x1="${left}" x2="${width-right}" y1="${rsiY(v)}" y2="${rsiY(v)}" stroke="var(--b)" stroke-dasharray="3 5"/>`,text(width-right+8,rsiY(v)+3,v));
    let rsiPath='',restart=true;rows.forEach((c,i)=>{const v=rsiMap.get(c.time);if(!Number.isFinite(v)){restart=true;return;}rsiPath+=(restart?'M':'L')+x(i)+' '+rsiY(v)+' ';restart=false;});parts.push(`<path d="${rsiPath}" fill="none" stroke="${down}" stroke-width="1.8"/>`);
    if(result.divergence){const p3=result.points[3],p5=result.points[5],i3=rowTimes.get(p3.time),i5=rowTimes.get(p5.time);if(i3!==undefined&&i5!==undefined){const a=rsiMap.get(p3.time),b=rsiMap.get(p5.time);if(Number.isFinite(a)&&Number.isFinite(b)){parts.push(`<path d="M${x(i3)} ${y(p3.price)}L${x(i5)} ${y(p5.price)}M${x(i3)} ${rsiY(a)}L${x(i5)} ${rsiY(b)}" fill="none" stroke="${gold}" stroke-width="2" stroke-dasharray="3 3"/>`,text(left+4,rsiTop+10,'Дивергенция 3 → 5',gold));}}}
  }
  parts.push(`<g id="el-cursor" visibility="hidden"><line id="el-cursor-line" stroke="${up}" stroke-dasharray="2 3"/><rect id="el-cursor-dot" width="6" height="6" fill="${up}"/></g>`);
  svg.innerHTML=parts.join('');
  let readout=document.getElementById('el-chart-readout');if(!readout){readout=document.createElement('div');readout.id='el-chart-readout';readout.className='el-chart-readout';svg.parentElement.append(readout);}
  const display=i=>{const c=rows[i],px=x(i),cursor=svg.querySelector('#el-cursor'),line=svg.querySelector('#el-cursor-line'),dot=svg.querySelector('#el-cursor-dot');cursor.setAttribute('visibility','visible');for(const [attr,val] of Object.entries({x1:px,x2:px,y1:top,y2:elliottChartState.rsi?rsiBottom:bottom}))line.setAttribute(attr,val);dot.setAttribute('x',px-3);dot.setAttribute('y',y(c.close)-3);readout.textContent=date(c.time)+' UTC · O '+price(c.open)+' · H '+price(c.high)+' · L '+price(c.low)+' · C '+price(c.close)+(Number.isFinite(rsiMap.get(c.time))?' · RSI '+rsiMap.get(c.time).toFixed(1):'');};
  svg.onpointermove=event=>{const rect=svg.getBoundingClientRect(),px=(event.clientX-rect.left)/rect.width*width;display(Math.max(0,Math.min(rows.length-1,Math.floor((px-left)/plotWidth*rows.length))));};
  svg.setAttribute('tabindex','0');let cursorIndex=rows.length-1;
  svg.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();cursorIndex=Math.max(0,Math.min(rows.length-1,cursorIndex+(event.key==='ArrowRight'?1:-1)));display(cursorIndex);};
  readout.textContent=rows.length+' свечей · UTC · '+(elliottChartState.zoom?'увеличенный участок':'весь выбранный счёт')+' · наведи курсор для OHLC/RSI';
  const altButton=document.getElementById('el-toggle-alt');if(altButton){altButton.disabled=!result.alternate;altButton.title=result.alternate?'Показать альтернативный счёт':'Второй допустимый счёт не найден';}
}
document.addEventListener('DOMContentLoaded',()=>{
  const wrap=document.querySelector('.el-chart-wrap');if(wrap&&typeof ResizeObserver==='function'){let width=0;new ResizeObserver(entries=>{const next=Math.round(entries[0].contentRect.width);if(next!==width&&next>0){width=next;elliottChartRedraw();}}).observe(wrap);}
  new MutationObserver(elliottChartRedraw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
});
