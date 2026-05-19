/* ORBITUM standalone journal Supabase adapter.
   Attach after the standalone bundle if you need to bridge the new localStorage journal to Supabase. */
(function(){
  const SB_URL = 'https://kgutmsosfyyxnlnhucaa.supabase.co';
  const SB_KEY = 'sb_publishable_Jzzgsd9kwaXDEPb8OSVm3Q_TXsDe4q6';
  const STORE_KEY = 'orbitum.trades.v1';
  let client = null;
  let userId = null;

  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : null; }

  async function loadSupabaseScript(){
    if (window.supabase && window.supabase.createClient) return;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload=resolve;
      s.onerror=reject;
      document.head.appendChild(s);
    });
  }

  async function init(){
    await loadSupabaseScript();
    if (!client) {
      client = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      if (location.protocol !== 'file:') location.href = '/login';
      return null;
    }
    userId = data.session.user.id;
    return client;
  }

  function toDb(trade){
    const status = String(trade.status || 'OPEN').toUpperCase();
    return {
      user_id: userId,
      trade_uid: String(trade.id || ('t' + Date.now())),
      created_at: new Date(trade.date || Date.now()).toISOString(),
      pair: trade.pair || '',
      direction: String(trade.direction || 'LONG').toLowerCase() === 'short' ? 'short' : 'long',
      result: status === 'WIN' ? 'win' : status === 'LOSS' ? 'loss' : 'be',
      status,
      entry: trade.entry || null,
      stop: trade.stop || null,
      tp: trade.tp || null,
      size: trade.size || null,
      leverage: n(trade.leverage),
      tags: Array.isArray(trade.tags) ? trade.tags : [],
      emotion: trade.emotion || null,
      notes: trade.notes || null,
      ritual_score: trade.ritualScore || 5,
      entry_price: n(trade.entry),
      stop_loss: n(trade.stop),
      take_profit: n(trade.tp),
      deposit: n(trade.size),
      raw: trade
    };
  }

  function fromDb(row){
    const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
    return {
      id: row.trade_uid || raw.id || String(row.id),
      date: row.created_at ? new Date(row.created_at).getTime() : (raw.date || Date.now()),
      pair: row.pair || raw.pair || '',
      direction: (row.direction || raw.direction || 'long').toUpperCase(),
      entry: row.entry || (row.entry_price != null ? String(row.entry_price) : raw.entry || ''),
      stop: row.stop || (row.stop_loss != null ? String(row.stop_loss) : raw.stop || ''),
      tp: row.tp || (row.take_profit != null ? String(row.take_profit) : raw.tp || ''),
      size: row.size || (row.deposit != null ? String(row.deposit) : raw.size || ''),
      leverage: row.leverage != null ? String(row.leverage) : (raw.leverage || ''),
      tags: Array.isArray(row.tags) ? row.tags : (Array.isArray(raw.tags) ? raw.tags : []),
      emotion: row.emotion || raw.emotion || '',
      notes: row.notes || row.note_why || raw.notes || '',
      ritualScore: row.ritual_score || raw.ritualScore || 5,
      status: (row.status || raw.status || row.result || 'OPEN').toUpperCase()
    };
  }

  async function pull(){
    const sb = await init();
    if (!sb || !userId) return [];
    const { data, error } = await sb.from('trades').select('*').eq('user_id', userId).order('created_at',{ascending:false});
    if (error) throw error;
    const trades = (data || []).map(fromDb);
    if (trades.length) localStorage.setItem(STORE_KEY, JSON.stringify(trades));
    window.dispatchEvent(new CustomEvent('orbitum:trades-hydrated', { detail: trades }));
    return trades;
  }

  async function push(list){
    const sb = await init();
    if (!sb || !userId || !Array.isArray(list)) return;
    const payload = list.map(toDb).filter(x => x.user_id && x.trade_uid);
    if (!payload.length) return;
    const { error } = await sb.from('trades').upsert(payload, { onConflict: 'user_id,trade_uid' });
    if (error) throw error;
  }

  window.OrbitumSupabaseBridge = { init, pull, push, STORE_KEY };

  init().then(()=>pull()).catch(e=>console.warn('[ORBITUM] Supabase bridge init failed', e));
  window.addEventListener('storage', e => {
    if (e.key === STORE_KEY && e.newValue) {
      try { push(JSON.parse(e.newValue)); } catch(_) {}
    }
  });
})();
