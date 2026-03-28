
(function(){
  function createNotifIcon(type){
    const el = document.createElement('div');
    el.className = 'notif-icon notif-icon-' + type;
    return el;
  }

  function decorateButtons(){
    document.querySelectorAll('.pair-presets button,.lev-presets button,.setup-btn,.fbtn,.pm-mood-btn,.res-btn,.dbtn,.qnote-type-btn').forEach(btn=>{
      btn.setAttribute('type','button');
    });
  }

  function patchNotifs(){
    window.showNotif = function(type, title, msg, timeout){
      const tray = document.getElementById('notif-tray');
      if(!tray) return;
      const note = document.createElement('div');
      note.className = 'notif notif-' + type;
      const body = document.createElement('div');
      body.className = 'notif-body';
      body.innerHTML = '<div class="notif-title">'+ title +'</div><div class="notif-msg">'+ (msg || '') +'</div>';
      const close = document.createElement('button');
      close.className = 'notif-close';
      close.type = 'button';
      close.textContent = '×';
      close.onclick = ()=>window.dismissNotif ? window.dismissNotif(note) : note.remove();
      note.appendChild(createNotifIcon(type));
      note.appendChild(body);
      note.appendChild(close);
      tray.appendChild(note);
      if((timeout ?? 5000) > 0){
        setTimeout(()=>window.dismissNotif ? window.dismissNotif(note) : note.remove(), timeout ?? 5000);
      }
    }
  }

  function normalizeTexts(){
    document.querySelectorAll('.tg-linked-info > div:first-child').forEach(el=>{
      if(el.textContent.trim() === 'Telegram подключён') el.textContent = 'Telegram подключён';
    });
    document.querySelectorAll('.pm-check').forEach(el=>{
      if(!el.textContent.trim()) el.setAttribute('aria-hidden','true');
    });
  }

  function boot(){
    document.documentElement.style.background = '#262626';
    decorateButtons();
    patchNotifs();
    normalizeTexts();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
