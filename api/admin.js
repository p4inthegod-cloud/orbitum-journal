// api/admin.js v2 — Server-side admin operations
// New actions: broadcast, get_users, get_stats, extend_plan

const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey:        SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        opts.prefer || 'return=minimal',
      Accept:        'application/json',
      ...opts.headers,
    },
  });
  if (opts.method === 'PATCH' || opts.method === 'DELETE') return { ok: r.ok };
  return r.json();
}

async function verifyAdmin(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return null;
  const userR = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY },
  });
  if (!userR.ok) return null;
  const user = await userR.json();
  if (!user?.id) return null;
  const profiles = await sbFetch(`profiles?id=eq.${user.id}&select=id,role`, { prefer: 'return=representation' });
  if (!Array.isArray(profiles) || profiles[0]?.role !== 'admin') return null;
  return user;
}

async function tgSend(chat_id, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (e?.error_code === 403) return false; // blocked
    }
    return true;
  } catch(_) { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Not admin' });

  const { action, userId, payId, plan, data, features } = req.body;

  try {

    // ── CONFIRM PAYMENT ──────────────────────────────────────────
    if (action === 'confirm_payment') {
      if (!payId || !userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly'
        ? new Date(Date.now() + 30 * 24 * 3600000).toISOString()
        : null;
      await sbFetch(`payments?id=eq.${payId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: admin.id }),
      });
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ plan, plan_expires_at: expiresAt }),
      });

      // Notify user via TG
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=tg_chat_id,tg_linked,full_name`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (profile?.tg_linked && profile?.tg_chat_id) {
        const name = profile.full_name?.split(' ')[0] || 'trader';
        await tgSend(profile.tg_chat_id,
          `<b>Access confirmed!</b>\n---\n` +
          `Welcome to ${plan === 'lifetime' ? 'Lifetime' : 'Monthly'} plan, <b>${name}</b>.\n\n` +
          `All features are now unlocked:\n` +
          `+ Real-time setup signals\n` +
          `+ AI insights + confidence %\n` +
          `+ Full analytics + AI Coach\n\n` +
          `<a href="${APP_URL}/screener">Open Screener</a>  |  <a href="${APP_URL}/journal">Open Journal</a>`
        );
      }
      return res.status(200).json({ ok: true });
    }

    // ── REJECT PAYMENT ───────────────────────────────────────────
    if (action === 'reject_payment') {
      if (!payId) return res.status(400).json({ error: 'Missing payId' });
      await sbFetch(`payments?id=eq.${payId}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
      return res.status(200).json({ ok: true });
    }

    // ── SET PLAN ─────────────────────────────────────────────────
    if (action === 'set_plan') {
      if (!userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly'
        ? new Date(Date.now() + 30 * 24 * 3600000).toISOString()
        : null;
      const updates = plan === 'none'
        ? { plan: 'none', plan_expires_at: null }
        : { plan, plan_expires_at: expiresAt };
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify(updates) });
      return res.status(200).json({ ok: true });
    }

    // ── EXTEND PLAN (add days to monthly) ────────────────────────
    if (action === 'extend_plan') {
      const { days = 30 } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=plan,plan_expires_at`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile) return res.status(404).json({ error: 'User not found' });
      const base    = profile.plan_expires_at ? new Date(profile.plan_expires_at) : new Date();
      const newExp  = new Date(Math.max(base.getTime(), Date.now()) + days * 24 * 3600000).toISOString();
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ plan: 'monthly', plan_expires_at: newExp }),
      });
      return res.status(200).json({ ok: true, new_expiry: newExp });
    }

    // ── DELETE USER ──────────────────────────────────────────────
    if (action === 'delete_user') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      await sbFetch(`trades?user_id=eq.${userId}`,       { method: 'DELETE' });
      await sbFetch(`price_alerts?user_id=eq.${userId}`, { method: 'DELETE' });
      await sbFetch(`payments?user_id=eq.${userId}`,     { method: 'DELETE' });
      await sbFetch(`profiles?id=eq.${userId}`,          { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ── SEND TG TO USER ──────────────────────────────────────────
    if (action === 'send_tg') {
      if (!userId || !data?.text) return res.status(400).json({ error: 'Missing params' });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=tg_chat_id,tg_linked`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile?.tg_linked || !profile?.tg_chat_id)
        return res.status(400).json({ error: 'User has no TG linked' });
      await tgSend(profile.tg_chat_id, data.text);
      return res.status(200).json({ ok: true });
    }

    // ── BROADCAST — send TG to all / paid / free ─────────────────
    if (action === 'broadcast') {
      const { text, audience = 'all' } = req.body; // audience: 'all' | 'paid' | 'free'
      if (!text) return res.status(400).json({ error: 'Missing text' });

      let query = 'profiles?tg_linked=is.true&select=tg_chat_id,plan';
      if (audience === 'paid') query += '&plan=in.(lifetime,monthly)';
      const recipients = await sbFetch(query, { prefer: 'return=representation' });
      if (!Array.isArray(recipients)) return res.status(500).json({ error: 'Failed to load users' });

      const filtered = audience === 'free'
        ? recipients.filter(u => u.plan !== 'lifetime' && u.plan !== 'monthly')
        : recipients;

      let sent = 0, failed = 0;
      for (const u of filtered) {
        if (!u.tg_chat_id) continue;
        const ok = await tgSend(u.tg_chat_id, text);
        if (ok) sent++; else failed++;
        if ((sent + failed) % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }

      console.log(`[admin:broadcast] audience=${audience} sent=${sent} failed=${failed}`);
      return res.status(200).json({ ok: true, sent, failed, total: filtered.length });
    }

    // ── GET USERS — list with filters ────────────────────────────
    if (action === 'get_users') {
      const { filter_plan, filter_tg, limit = 100, offset = 0 } = req.body;
      let query = `profiles?select=id,full_name,username,plan,plan_expires_at,tg_linked,tg_username,created_at&order=created_at.desc&limit=${limit}&offset=${offset}`;
      if (filter_plan)         query += `&plan=eq.${filter_plan}`;
      if (filter_tg === true)  query += '&tg_linked=is.true';
      if (filter_tg === false) query += '&tg_linked=is.false';

      const users = await sbFetch(query, { prefer: 'return=representation' });
      if (!Array.isArray(users)) return res.status(500).json({ error: 'Query failed' });

      // Enrich with trade counts (batch)
      const enriched = await Promise.all(users.map(async u => {
        try {
          const trR = await fetch(
            `${SB_URL}/rest/v1/trades?user_id=eq.${u.id}&select=id`,
            { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } }
          );
          const count = parseInt(trR.headers.get('content-range')?.split('/')[1] || '0');
          return { ...u, trade_count: isNaN(count) ? 0 : count };
        } catch(_) { return { ...u, trade_count: 0 }; }
      }));

      return res.status(200).json({ ok: true, users: enriched, total: enriched.length });
    }

    // ── GET STATS — platform overview ────────────────────────────
    if (action === 'get_stats') {
      const [allUsersR, paidR, tgLinkedR, tradesR, paymentsR] = await Promise.allSettled([
        sbFetch('profiles?select=id,plan,tg_linked,created_at', { prefer: 'return=representation' }),
        sbFetch('profiles?plan=in.(lifetime,monthly)&select=id,plan', { prefer: 'return=representation' }),
        sbFetch('profiles?tg_linked=is.true&select=id', { prefer: 'return=representation' }),
        fetch(`${SB_URL}/rest/v1/trades?select=id`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } }).then(r => parseInt(r.headers.get('content-range')?.split('/')[1] || '0')),
        sbFetch('payments?status=eq.confirmed&select=id', { prefer: 'return=representation' }),
      ]);

      const allUsers   = allUsersR.status   === 'fulfilled' && Array.isArray(allUsersR.value)   ? allUsersR.value   : [];
      const paidUsers  = paidR.status        === 'fulfilled' && Array.isArray(paidR.value)        ? paidR.value       : [];
      const tgLinked   = tgLinkedR.status    === 'fulfilled' && Array.isArray(tgLinkedR.value)    ? tgLinkedR.value   : [];
      const tradeCount = tradesR.status      === 'fulfilled' ? tradesR.value : 0;
      const payments   = paymentsR.status    === 'fulfilled' && Array.isArray(paymentsR.value)    ? paymentsR.value   : [];

      const lifetime  = paidUsers.filter(u => u.plan === 'lifetime').length;
      const monthly   = paidUsers.filter(u => u.plan === 'monthly').length;
      const freeUsers = allUsers.length - paidUsers.length;

      // New users this week
      const wkStart = new Date();
      wkStart.setUTCDate(wkStart.getUTCDate() - ((wkStart.getUTCDay() + 6) % 7));
      wkStart.setUTCHours(0,0,0,0);
      const newThisWeek = allUsers.filter(u => u.created_at && new Date(u.created_at) >= wkStart).length;

      // Revenue estimate (basic)
      const revenueEst = lifetime * 197 + monthly * 29;

      return res.status(200).json({
        ok: true,
        stats: {
          total_users:    allUsers.length,
          paid:           paidUsers.length,
          lifetime,
          monthly,
          free:           freeUsers,
          tg_linked:      tgLinked.length,
          total_trades:   tradeCount,
          payments:       payments.length,
          new_this_week:  newThisWeek,
          revenue_est:    revenueEst,
          conversion_pct: allUsers.length ? Math.round(paidUsers.length / allUsers.length * 100) : 0,
        },
      });
    }

    // ── SET FEATURES ─────────────────────────────────────────────
    if (action === 'set_features') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: features || null }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── SAVE / SEED PRODUCTS ─────────────────────────────────────
    if (action === 'save_product') {
      const { product } = req.body;
      if (!product) return res.status(400).json({ error: 'Missing product' });
      const r = product.id
        ? await sbFetch(`products?id=eq.${product.id}`, { method: 'PATCH', body: JSON.stringify(product) })
        : await sbFetch('products', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(product) });
      return res.status(200).json({ ok: true, result: r });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    console.error('[admin]', action, e.message);
    return res.status(500).json({ error: e.message });
  }
}
