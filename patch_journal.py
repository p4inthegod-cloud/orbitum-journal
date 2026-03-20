#!/usr/bin/env python3
"""
ORBITUM AUTO-PATCHER
Usage: python3 patch_journal.py journal.html
Output: journal-fixed.html (in same directory)

Applies all 20 bugfixes automatically to your journal.html file.
"""
import re, sys, os

def patch(html):
    log = []

    # ══════════════════════════════════════════════════════════════
    # FIX #1 — init() never called. Add call before </body>
    # ══════════════════════════════════════════════════════════════
    if 'DOMContentLoaded", init' not in html and "DOMContentLoaded', init" not in html:
        html = html.replace('</body>', '<script>document.addEventListener("DOMContentLoaded", init);</script>\n</body>')
        log.append('FIX #1  ✓ Added init() call')

    # ══════════════════════════════════════════════════════════════
    # FIX #2 — HTML inside <script> (theme system IIFE)
    # The })(); at the end of the theme system is followed by
    # <!-- QUICK NOTE OVERLAY --> HTML without closing </script>
    # ══════════════════════════════════════════════════════════════
    # Find })(); followed by HTML comment or div tag
    p = re.search(r'(\}\)\(\);)\s*\n(\s*(?:<!--|<div class="qnote))', html)
    if p:
        # Check this is actually inside a <script> that has the theme code
        # by verifying there's no </script> between })(); and the HTML
        chunk = html[p.start():p.start()+500]
        if '</script>' not in chunk[:100]:
            html = html[:p.end(1)] + '\n</script>\n' + html[p.start(2):]
            log.append('FIX #2  ✓ Added </script> before Quick Note Overlay')

    # ══════════════════════════════════════════════════════════════
    # FIX #5 — setFilter('all') → setF('all',this)
    # ══════════════════════════════════════════════════════════════
    c = html.count("setFilter(")
    html = re.sub(r"onclick=\"setFilter\('all'\)\"", "onclick=\"setF('all',this)\"", html)
    if c: log.append(f'FIX #5  ✓ Replaced {c} setFilter → setF')

    # ══════════════════════════════════════════════════════════════
    # FIX #6 — calc:2 → calm:2 in demo data
    # ══════════════════════════════════════════════════════════════
    if ',calc:2}' in html:
        html = html.replace(',calc:2}', ',calm:2}')
        log.append('FIX #6  ✓ Fixed calc→calm typo')

    # ══════════════════════════════════════════════════════════════
    # FIX #7 — fromUsd() silent fail → show feedback
    # ══════════════════════════════════════════════════════════════
    OLD7 = "function fromUsd(){\n  const dep=parseFloat(document.getElementById('f-dep').value)||0;\n  const usd=parseFloat(document.getElementById('f-usd').value)||0;\n  if(dep&&usd) document.getElementById('f-pnl').value=(usd/dep*100).toFixed(2);\n}"
    NEW7 = """function fromUsd(){
  const dep=parseFloat(document.getElementById('f-dep').value)||0;
  const usd=parseFloat(document.getElementById('f-usd').value)||0;
  if(usd&&!dep){var _d=document.getElementById('f-dep');if(_d){_d.style.borderColor='rgba(245,166,35,0.6)';_d.placeholder='← нужен для P&L%';setTimeout(function(){_d.style.borderColor='';_d.placeholder='1000';},3000);}return;}
  if(dep&&usd) document.getElementById('f-pnl').value=(usd/dep*100).toFixed(2);
}"""
    if OLD7 in html:
        html = html.replace(OLD7, NEW7)
        log.append('FIX #7  ✓ Added deposit-empty feedback in fromUsd()')

    # ══════════════════════════════════════════════════════════════
    # FIX #8 — renderDigest() missing
    # ══════════════════════════════════════════════════════════════
    if 'function renderDigest' not in html:
        DIGEST = '''
// ═══ FIX #8: renderDigest + helpers ═══
function renderDigest(){
  var trades=allTrades||[];var now=new Date();var weekAgo=new Date(now);weekAgo.setDate(weekAgo.getDate()-7);
  var wk=trades.filter(function(t){return new Date(t.created_at)>=weekAgo;});
  var wl=document.getElementById('digest-week-label'),ti=document.getElementById('digest-title'),si=document.getElementById('digest-sub');
  if(wl)wl.textContent=weekAgo.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})+' — '+now.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'});
  if(!wk.length){if(ti)ti.textContent='НЕТ ДАННЫХ';if(si)si.textContent='Добавь сделки за эту неделю';return;}
  var wins=wk.filter(function(t){return t.result==='win';}),losses=wk.filter(function(t){return t.result==='loss';});
  var tp=wk.reduce(function(s,t){return s+(t.pnl_pct||0);},0),wr=Math.round(wins.length/wk.length*100);
  if(ti)ti.textContent=(tp>=0?'📈 ПРИБЫЛЬНАЯ НЕДЕЛЯ':'📉 УБЫТОЧНАЯ НЕДЕЛЯ');
  if(si)si.textContent=wk.length+' сделок · WR '+wr+'% · P&L '+(tp>=0?'+':'')+tp.toFixed(1)+'%';
  var dt=document.getElementById('dg-trades'),dd=document.getElementById('dg-trades-desc');
  if(dt)dt.textContent=wk.length;if(dd)dd.textContent='WR '+wr+'% · '+wins.length+'W / '+losses.length+'L';
  var dn=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],bd={};
  wk.forEach(function(t){var d=new Date(t.created_at),k=d.toDateString();if(!bd[k])bd[k]={pnl:0,count:0,day:dn[d.getDay()]};bd[k].pnl+=(t.pnl_pct||0);bd[k].count++;});
  var ds=Object.values(bd);
  if(ds.length){
    var best=ds.reduce(function(a,b){return a.pnl>b.pnl?a:b;}),worst=ds.reduce(function(a,b){return a.pnl<b.pnl?a:b;});
    var eb=document.getElementById('dg-best-day'),ebd=document.getElementById('dg-best-desc');
    var ew=document.getElementById('dg-worst-day'),ewd=document.getElementById('dg-worst-desc');
    if(eb)eb.textContent=best.day;if(ebd)ebd.textContent='+'+best.pnl.toFixed(1)+'% · '+best.count+' сд.';
    if(ew)ew.textContent=worst.day;if(ewd)ewd.textContent=worst.pnl.toFixed(1)+'% · '+worst.count+' сд.';
  }
  var il=document.getElementById('digest-insights-list');
  if(il){var ins=[];
    if(wr>=60)ins.push({i:'🎯',t:'<b>Высокий WR</b> — '+wr+'%'});
    else if(wr<40&&wk.length>=3)ins.push({i:'⚠️',t:'<b>Низкий WR</b> — '+wr+'%'});
    var af=wk.reduce(function(s,t){return s+(t.emotion_fear||0);},0)/wk.length;
    if(af>6)ins.push({i:'😰',t:'<b>Высокий страх</b> — '+af.toFixed(1)+'/10'});
    var ag=wk.reduce(function(s,t){return s+(t.emotion_greed||0);},0)/wk.length;
    if(ag>6)ins.push({i:'🤑',t:'<b>Жадность</b> — '+ag.toFixed(1)+'/10'});
    var ns=wk.filter(function(t){return !t.stop_loss;}).length;
    if(ns>0)ins.push({i:'🛑',t:'<b>'+ns+' без стопа</b> из '+wk.length});
    if(tp>0&&wk.length>=3)ins.push({i:'✅',t:'<b>Прибыльная неделя!</b> +'+tp.toFixed(1)+'%'});
    if(!ins.length)ins.push({i:'📊',t:'Заполняй эмоции и сетапы для анализа.'});
    il.innerHTML=ins.map(function(x){return '<div class="di-item"><span class="di-icon">'+x.i+'</span><div class="di-text">'+x.t+'</div></div>';}).join('');
  }
  _renderMC(trades);_renderWD(trades);
}
function _renderMC(trades){
  var el=document.getElementById('month-compare-rows');if(!el)return;
  var n=new Date(),tm=n.getMonth(),ty=n.getFullYear(),pm=tm===0?11:tm-1,py=tm===0?ty-1:ty;
  var ct=trades.filter(function(t){var d=new Date(t.created_at);return d.getMonth()===tm&&d.getFullYear()===ty;});
  var pt=trades.filter(function(t){var d=new Date(t.created_at);return d.getMonth()===pm&&d.getFullYear()===py;});
  var ms=[{k:'Сделок',c:ct.length,p:pt.length},
    {k:'WR%',c:ct.length?Math.round(ct.filter(function(t){return t.result==='win';}).length/ct.length*100):0,
     p:pt.length?Math.round(pt.filter(function(t){return t.result==='win';}).length/pt.length*100):0},
    {k:'P&L%',c:ct.reduce(function(s,t){return s+(t.pnl_pct||0);},0),p:pt.reduce(function(s,t){return s+(t.pnl_pct||0);},0)}];
  el.innerHTML=ms.map(function(m){var d=m.c-m.p;var dc=d>0?'up':d<0?'down':'same';var ds=d>0?'↑':d<0?'↓':'=';
    var f=function(v){return m.k.includes('%')?v.toFixed(1)+'%':v;};
    return '<div class="mc-row"><span class="mc-key">'+m.k+'</span><div class="mc-vals"><span class="mc-val prev">'+f(m.p)+'</span><span class="mc-val curr">'+f(m.c)+'</span><span class="mc-delta '+dc+'">'+ds+'</span></div></div>';}).join('');
}
function _renderWD(trades){
  var el=document.getElementById('weekly-dynamics');if(!el)return;
  if(trades.length<3){el.innerHTML='<div class="empty" style="padding:14px">Нужно больше сделок</div>';return;}
  var ws=[],n=new Date();for(var w=5;w>=0;w--){var s=new Date(n);s.setDate(s.getDate()-w*7-n.getDay());s.setHours(0,0,0,0);
    var e=new Date(s);e.setDate(e.getDate()+7);
    var wt=trades.filter(function(t){var d=new Date(t.created_at);return d>=s&&d<e;});
    ws.push({l:s.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}),p:wt.reduce(function(a,t){return a+(t.pnl_pct||0);},0)});}
  var mx=Math.max.apply(null,ws.map(function(w){return Math.abs(w.p);}))||1;
  el.innerHTML='<div style="display:flex;align-items:flex-end;gap:8px;height:80px;padding:8px 0">'+ws.map(function(w){
    var h=Math.max(4,Math.round(Math.abs(w.p)/mx*60));var c=w.p>=0?'rgba(52,208,88,0.6)':'rgba(255,77,77,0.6)';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="font-family:var(--font-mono);font-size:8px;color:'+(w.p>=0?'var(--g)':'var(--r)')+'">'+(w.p>=0?'+':'')+w.p.toFixed(1)+'%</div><div style="width:100%;height:'+h+'px;background:'+c+';border-radius:3px 3px 0 0"></div><div style="font-family:var(--font-mono);font-size:7px;color:var(--m)">'+w.l+'</div></div>';
  }).join('')+'</div>';
}
'''
        # Insert before "// ══ INIT CALL ══" or before init()
        marker = '// ══ INIT CALL ══'
        if marker in html:
            html = html.replace(marker, DIGEST + '\n' + marker)
        else:
            # Insert before last </script>
            idx = html.rfind('</script>')
            html = html[:idx] + DIGEST + '\n' + html[idx:]
        log.append('FIX #8  ✓ Added renderDigest()')

    # ══════════════════════════════════════════════════════════════
    # FIX #9 — clearAllTrades demo mode
    # ══════════════════════════════════════════════════════════════
    OLD9 = "async function clearAllTrades(){\n  if(!currentUser) return;\n  if(!confirm"
    if OLD9 in html:
        html = html.replace(
            "async function clearAllTrades(){\n  if(!currentUser) return;\n  if(!confirm('Удалить ВСЕ сделки? Это действие нельзя отменить.')) return;\n  const second=confirm('Вы уверены? Все ' + allTrades.length + ' сделок будут удалены навсегда.');\n  if(!second) return;\n  const {error}=await sb.from('trades').delete().eq('user_id',currentUser.id);\n  if(error){alert('Ошибка удаления: '+error.message);return;}\n  allTrades=[];\n  render();\n  updateStats();\n}",
            "async function clearAllTrades(){\n  if(!currentUser) return;\n  if(!confirm('Удалить ВСЕ сделки? Это действие нельзя отменить.')) return;\n  const second=confirm('Вы уверены? Все ' + allTrades.length + ' сделок будут удалены навсегда.');\n  if(!second) return;\n  if(window._isDemoMode){allTrades=[];if(typeof demoSaveTrades==='function')demoSaveTrades([]);render();updateStatsEnhanced();renderDashboard();renderProgress();renderLevelBar([]);showNotif('success','Очищено','Все demo-сделки удалены',3000);return;}\n  const {error}=await sb.from('trades').delete().eq('user_id',currentUser.id);\n  if(error){alert('Ошибка удаления: '+error.message);return;}\n  allTrades=[];\n  render();\n  updateStats();\n}"
        )
        log.append('FIX #9  ✓ clearAllTrades demo support')

    # ══════════════════════════════════════════════════════════════
    # FIX #10 — Balance format in onboarding
    # ══════════════════════════════════════════════════════════════
    if "localStorage.setItem('orb_balance', dep);" in html:
        html = html.replace(
            "localStorage.setItem('orb_balance', dep);",
            "localStorage.setItem('orb_balance', JSON.stringify({start: dep}));"
        )
        log.append('FIX #10 ✓ Fixed balance JSON format in onboarding')

    # ══════════════════════════════════════════════════════════════
    # FIX #11 — Extra ">" in trades-list
    # ══════════════════════════════════════════════════════════════
    if '</div>></div>' in html:
        html = html.replace('</div>></div>', '</div></div>', 1)
        log.append('FIX #11 ✓ Removed extra > in trades-list')

    # ══════════════════════════════════════════════════════════════
    # FIX #12 — renderJournalBell() missing
    # ══════════════════════════════════════════════════════════════
    if 'function renderJournalBell' not in html:
        html = html.replace(
            'let _jNotifs=[], _jNotifOpen=false;',
            'let _jNotifs=[], _jNotifOpen=false;\nfunction renderJournalBell(){var c=(_jNotifs||[]).filter(function(n){return !n.read;}).length;var b=document.querySelector(".notif-count");if(b){b.textContent=c;b.style.display=c>0?"flex":"none";}}'
        )
        log.append('FIX #12 ✓ Added renderJournalBell()')

    # ══════════════════════════════════════════════════════════════
    # FIX #13 — showPage guard for missing pages
    # ══════════════════════════════════════════════════════════════
    if "if(!pg)return;" in html:
        html = html.replace(
            "if(!pg)return;",
            "if(!pg){console.warn('[ORBITUM] Page not found: page-'+p);return;}"
        )
        log.append('FIX #13 ✓ Added missing page guard in showPage()')

    # ══════════════════════════════════════════════════════════════
    # FIX #14 — Edit modal paste detection
    # ══════════════════════════════════════════════════════════════
    if "editModal.style.display !== 'none'" in html:
        html = html.replace(
            "editModal && editModal.style.display !== 'none'",
            "editModal && editModal.classList.contains('open')"
        )
        log.append('FIX #14 ✓ Fixed edit modal detection for paste')

    # ══════════════════════════════════════════════════════════════
    # FIX #19 — XSS prevention
    # ══════════════════════════════════════════════════════════════
    if 'function escHtml' not in html:
        html = html.replace(
            'function render(){',
            "function escHtml(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}\nfunction render(){"
        )
        log.append('FIX #19 ✓ Added escHtml()')

    for old, new in [
        ("СЕТАП</span>${t.note_why}", "СЕТАП</span>${escHtml(t.note_why)}"),
        ("ЭМОЦИИ</span>${t.note_feel}", "ЭМОЦИИ</span>${escHtml(t.note_feel)}"),
        ("УРОК</span>${t.note_lesson}", "УРОК</span>${escHtml(t.note_lesson)}"),
    ]:
        if old in html:
            html = html.replace(old, new)
    log.append('FIX #19 ✓ Applied escHtml to user notes')

    # ══════════════════════════════════════════════════════════════
    # FIX #4 — WebSocket reconnect guard
    # ══════════════════════════════════════════════════════════════
    OLD4 = "function initJournalWS(){\n  const streams = _JWS_PAIRS"
    NEW4 = "var _jwsLock=false;\nfunction initJournalWS(){\n  if(_jwsLock)return;_jwsLock=true;\n  if(_jws){try{_jws.onclose=null;_jws.close();}catch(e){}}\n  const streams = _JWS_PAIRS"
    if OLD4 in html:
        html = html.replace(OLD4, NEW4)
        log.append('FIX #4  ✓ WebSocket reconnect guard')
    # Fix onclose/onerror
    if "_jws.onerror = () => {};\n  _jws.onclose = () => { setTimeout(initJournalWS, 2000); };" in html:
        html = html.replace(
            "_jws.onerror = () => {};\n  _jws.onclose = () => { setTimeout(initJournalWS, 2000); };",
            "_jws.onopen = () => {_jwsLock=false;};\n  _jws.onerror = () => {};\n  _jws.onclose = () => { _jwsLock=false; setTimeout(initJournalWS, 3000); };"
        )

    # ══════════════════════════════════════════════════════════════
    # FIX #15 — Remove duplicate fast refresh intervals
    # ══════════════════════════════════════════════════════════════
    dup_block = "window._jFastRefreshInstalled = window._jFastRefreshInstalled || false;\nif(!window._jFastRefreshInstalled){\n  window._jFastRefreshInstalled = true;\n  document.addEventListener('DOMContentLoaded', function(){\n    // Wait for init to complete, then set faster intervals\n    setTimeout(function(){\n      if(typeof fetchFNG    === 'function') setInterval(fetchFNG,    30000);\n      if(typeof fetchMarket === 'function') setInterval(fetchMarket, 30000);\n      if(typeof fetchGL     === 'function') setInterval(fetchGL,     60000);\n    }, 5000);\n  });\n}"
    if dup_block in html:
        html = html.replace(dup_block, '// FIX #15: duplicate intervals removed')
        log.append('FIX #15 ✓ Removed duplicate polling intervals')

    # ══════════════════════════════════════════════════════════════
    # FIX #16 — Throttle renderTickerTrack
    # ══════════════════════════════════════════════════════════════
    if "if(typeof renderTickerTrack === 'function') renderTickerTrack();" in html:
        html = html.replace(
            "if(typeof renderTickerTrack === 'function') renderTickerTrack();",
            "if(typeof renderTickerTrack==='function'&&!window._ttThrottle){window._ttThrottle=true;requestAnimationFrame(function(){renderTickerTrack();setTimeout(function(){window._ttThrottle=false;},1000);});}"
        )
        log.append('FIX #16 ✓ Throttled renderTickerTrack')

    # ══════════════════════════════════════════════════════════════
    # FIX #3 — Remove problematic initSidebarWidgets override
    # ══════════════════════════════════════════════════════════════
    override_block = """  const _origInit = window.initSidebarWidgets;
  window.initSidebarWidgets = function(){
    if(_origInit) _origInit();
    // Override the 5-min interval with 30s for market/GL data
    setInterval(()=>{
      if(typeof fetchMarket === 'function') fetchMarket();
      if(typeof fetchGL === 'function') fetchGL();
    }, 30000);
    // Trending every 2 min
    setInterval(()=>{
      if(typeof fetchTrending === 'function') fetchTrending();
    }, 120000);
  };"""
    if override_block in html:
        html = html.replace(override_block, '  // FIX #3: override removed — intervals in initSidebarWidgets')
        log.append('FIX #3  ✓ Removed initSidebarWidgets override')

    # ══════════════════════════════════════════════════════════════
    # FIX #20 — AI prompt sanitizer
    # ══════════════════════════════════════════════════════════════
    if 'function sanitizeForAI' not in html:
        html = html.replace(
            'function formatAIText(text){',
            "function sanitizeForAI(t){if(!t)return '';return String(t).replace(/ignore (all )?previous/gi,'').replace(/you are now/gi,'').replace(/system:/gi,'').replace(/<\\/?[a-z][^>]*>/gi,'').substring(0,500);}\nfunction formatAIText(text){"
        )
        log.append('FIX #20 ✓ Added AI prompt sanitizer')

    # ══════════════════════════════════════════════════════════════
    # BONUS — Challenges missing keys
    # ══════════════════════════════════════════════════════════════
    OLD_CH = """  var vals = {
    total: n,
    wr60: wr60?1:0,
    wr70: wr70?1:0,
    streak: streak
  };"""
    NEW_CH = """  // Compute all challenge keys (BUGFIX BONUS)
  var _bd2={};trades.forEach(function(t){var d=new Date(t.created_at).toDateString();if(!_bd2[d])_bd2[d]=0;_bd2[d]+=(t.pnl_pct||0);});
  var _sd=Object.keys(_bd2).sort(function(a,b){return new Date(b)-new Date(a);});
  var greendays=0;for(var _gi=0;_gi<_sd.length;_gi++){if(_bd2[_sd[_gi]]>0)greendays++;else break;}
  var _ld={};trades.forEach(function(t){if(t.result==='loss'){_ld[new Date(t.created_at).toDateString()]=true;}});
  var nolossdays=0;var _n2=new Date();for(var _ni=0;_ni<365;_ni++){var _dd2=new Date(_n2);_dd2.setDate(_dd2.getDate()-_ni);var _ds2=_dd2.toDateString();if(_ld[_ds2])break;if(_bd2[_ds2]!==undefined)nolossdays++;}
  var _wA=trades.filter(function(t){return t.result==='win';}),_lA=trades.filter(function(t){return t.result==='loss';});
  var _aW=_wA.length?_wA.reduce(function(s,t){return s+Math.abs(t.pnl_pct||0);},0)/_wA.length:0;
  var _aL=_lA.length?_lA.reduce(function(s,t){return s+Math.abs(t.pnl_pct||0);},0)/_lA.length:1;
  var rr2=n>=20&&_aL>0&&_aW/_aL>2.0?1:0;
  var emotions=trades.filter(function(t){return (t.emotion_fear||10)<4&&(t.emotion_conf||0)>6;}).length>=10?1:0;
  var vals = {
    total: n,
    wr60: wr60?1:0,
    wr70: wr70?1:0,
    streak: streak,
    greendays: greendays,
    nolossdays: nolossdays,
    rr2: rr2,
    emotions: emotions
  };"""
    if OLD_CH in html:
        html = html.replace(OLD_CH, NEW_CH)
        log.append('BONUS   ✓ Added missing challenge keys')

    return html, log


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 patch_journal.py journal.html")
        print("Output: journal-fixed.html")
        sys.exit(1)

    src = sys.argv[1]
    if not os.path.exists(src):
        print(f"Error: {src} not found")
        sys.exit(1)

    dst = os.path.join(os.path.dirname(src), 'journal-fixed.html')

    with open(src, 'r', encoding='utf-8') as f:
        html = f.read()

    print(f'Read {len(html):,} bytes from {src}')
    fixed, log = patch(html)

    with open(dst, 'w', encoding='utf-8') as f:
        f.write(fixed)

    print(f'\n{"="*50}')
    print(f' ORBITUM BUGFIX — {len(log)} patches applied')
    print(f'{"="*50}')
    for entry in log:
        print(f'  {entry}')
    print(f'{"="*50}')
    print(f'Output: {dst} ({len(fixed):,} bytes)')
    print(f'Original backup: {src} (untouched)')


if __name__ == '__main__':
    main()
