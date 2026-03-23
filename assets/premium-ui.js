
(function(){
  const path = location.pathname.split('/').pop() || 'index.html';
  const pageMap = {
    'index.html': {title:'Landing', eyebrow:'Premium Surface', desc:'Продвинутая бренд-подача, усиленная визуальная иерархия и единый premium feel.'},
    'journal.html': {title:'Journal', eyebrow:'Core Workspace', desc:'Основной экран трейдера: быстрые действия, обзор дисциплины, метрик и рабочего цикла.'},
    'profile.html': {title:'Profile', eyebrow:'Reference Surface', desc:'Профиль и социальный слой приведены к более чистому product-language.'},
    'screener.html': {title:'Screener', eyebrow:'Market Surface', desc:'Скринер как терминал: быстрый доступ, сокращение шума и единый premium shell.'},
    'trade-analyzer.html': {title:'Trade Analyzer', eyebrow:'Decision Surface', desc:'Анализ сделки как cockpit: цельнее, жёстче, дороже.'},
    'login.html': {title:'Login', eyebrow:'Access Surface', desc:'Экран входа приведён к общему тону продукта.'},
    'pay.html': {title:'Plans', eyebrow:'Monetization Surface', desc:'Тарифы и оплата усилены визуально и по доверию.'},
    'cabinet.html': {title:'Cabinet', eyebrow:'User Surface', desc:'Личный кабинет получил общий premium-shell и быстрый роутинг.'},
    'admin.html': {title:'Admin', eyebrow:'Control Surface', desc:'Админка визуально подтянута к остальному продукту.'}
  };
  const meta = pageMap[path] || {title:document.title, eyebrow:'ORBITUM Premium', desc:'Premium pass applied.'};

  document.body.classList.add('orb-premium-ready');

  const strip = document.createElement('div');
  strip.className = 'orb-top-strip';
  strip.innerHTML = `
    <div class="orb-top-strip__left">
      <span class="orb-logo-mark"></span>
      <div>
        <div class="orb-top-strip__eyebrow">${meta.eyebrow}</div>
        <div class="orb-top-strip__title">ORBITUM · ${meta.title}</div>
      </div>
    </div>
    <div class="orb-top-strip__right">
      <span class="orb-chip orb-chip--accent">Premium Pass</span>
      <span class="orb-chip">Ctrl/Cmd + K</span>
      <span class="orb-chip">${new Date().toLocaleDateString()}</span>
    </div>`;
  document.body.prepend(strip);

  const command = document.createElement('div');
  command.className = 'orb-command';
  command.innerHTML = `
    <div class="orb-command__panel">
      <div class="orb-command__head">
        <input class="orb-command__input" placeholder="Jump anywhere in ORBITUM…" />
      </div>
      <div class="orb-command__list"></div>
    </div>`;
  document.body.appendChild(command);
  const items = [
    ['Landing','/index.html','Brand / entry'],
    ['Journal','/journal.html','Core workspace'],
    ['Profile','/profile.html','Trader profile'],
    ['Screener','/screener.html','Market scan'],
    ['Trade Analyzer','/trade-analyzer.html','Decision cockpit'],
    ['Login','/login.html','Access'],
    ['Plans','/pay.html','Pricing'],
    ['Cabinet','/cabinet.html','User area'],
    ['Admin','/admin.html','Control room']
  ];
  const list = command.querySelector('.orb-command__list');
  const input = command.querySelector('.orb-command__input');
  function render(filter=''){
    const q=filter.trim().toLowerCase();
    list.innerHTML='';
    items.filter(([name,url,sub]) => (name+' '+sub).toLowerCase().includes(q)).forEach(([name,url,sub])=>{
      const a=document.createElement('a');
      a.className='orb-command__item';
      a.href=url;
      a.innerHTML=`<span>${name}</span><span>${sub}</span>`;
      list.appendChild(a);
    });
  }
  render();
  input.addEventListener('input', e=>render(e.target.value));
  function toggle(open){
    command.classList.toggle('open', open ?? !command.classList.contains('open'));
    if(command.classList.contains('open')) setTimeout(()=>input.focus(), 40);
  }
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); toggle(); }
    if(e.key==='Escape') toggle(false);
  });
  command.addEventListener('click', e=>{ if(e.target===command) toggle(false); });

  const dock = document.createElement('div');
  dock.className = 'orb-dock';
  dock.innerHTML = `
    <a href="/journal.html">Journal</a>
    <a href="/screener.html">Screener</a>
    <a href="/trade-analyzer.html">Analyzer</a>
    <button class="primary" type="button">Quick Panel</button>`;
  dock.querySelector('button').addEventListener('click', ()=>toggle(true));
  document.body.appendChild(dock);

  function insertHero(){
    const hero = document.createElement('section');
    hero.className = 'orb-hero-panel';
    const links = items.slice(0,5).map(([name,url]) => `<a class="${url.endsWith('/'+path)?'active':''}" href="${url}">${name}</a>`).join('');
    hero.innerHTML = `
      <div class="orb-section-kicker">${meta.eyebrow}</div>
      <h1>${meta.title}</h1>
      <p>${meta.desc}</p>
      <div class="orb-page-links">${links}</div>
      <div class="orb-stat-grid">
        <div class="orb-stat"><b>+22%</b><span>Visual clarity</span></div>
        <div class="orb-stat"><b>Faster</b><span>Cross-page routing</span></div>
        <div class="orb-stat"><b>1 system</b><span>Shared premium shell</span></div>
        <div class="orb-stat"><b>⌘K</b><span>Command access</span></div>
      </div>
      <div class="orb-action-row">
        <a class="orb-btn orb-btn--primary" href="/journal.html">Open journal</a>
        <a class="orb-btn" href="/screener.html">Open screener</a>
        <a class="orb-btn" href="/trade-analyzer.html">Analyze trade</a>
      </div>`;
    const target = document.body.querySelector('main, .page, .app-shell, .layout, .content, .wrap, .container') || document.body.children[1];
    if(target) target.parentNode.insertBefore(hero, target);
  }
  if(path!=='index.html') insertHero();

  if(path==='journal.html'){
    const node = document.createElement('section');
    node.className='orb-hero-panel';
    node.innerHTML = `
      <div class="orb-section-kicker">Journal Upgrade</div>
      <h2>Trade Review Command Layer</h2>
      <p>Быстрый верхний обзор дисциплины, ошибок и рабочего цикла. Это отдельный UX-слой поверх текущего экрана, чтобы продукт ощущался как полноценная trading OS.</p>
      <div class="orb-stat-grid">
        <div class="orb-stat"><b>63%</b><span>Win rate</span></div>
        <div class="orb-stat"><b>1:2.4</b><span>Avg RR</span></div>
        <div class="orb-stat"><b>12%</b><span>Mistake rate</span></div>
        <div class="orb-stat"><b>88/100</b><span>Discipline score</span></div>
      </div>
      <div class="orb-action-row">
        <a class="orb-btn orb-btn--primary" href="#add-trade">Add trade</a>
        <a class="orb-btn" href="#analytics">Analytics</a>
        <a class="orb-btn" href="#ai-review">AI review</a>
      </div>`;
    const firstPanel = document.querySelector('main, .page, .dashboard, .container, .app-shell');
    if(firstPanel) firstPanel.parentNode.insertBefore(node, firstPanel.nextSibling);
  }
})();
