// api/admin.js v2 — Server-side admin operations
// New actions: broadcast, get_users, get_stats, extend_plan

const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL   = process.env.APP_URL || 'https://orbitum.trade';

const FEATURE_BUNDLES = {
  none: ['journal'],
  free: ['journal'],
  journal: ['journal'],
  analytics: ['journal', 'dashboard', 'progress', 'digest', 'premarket', 'coach', 'aichat'],
  signals: ['journal', 'dashboard', 'progress', 'digest', 'premarket', 'coach', 'aichat', 'screener'],
  full: ['journal', 'dashboard', 'progress', 'digest', 'premarket', 'coach', 'aichat', 'screener'],
  monthly: ['journal', 'dashboard', 'progress', 'digest', 'premarket', 'coach', 'aichat', 'screener'],
  lifetime: ['journal', 'dashboard', 'progress', 'digest', 'premarket', 'coach', 'aichat', 'screener'],
};

function featuresForPlan(plan) {
  return FEATURE_BUNDLES[String(plan || 'none').toLowerCase()] || ['journal'];
}

function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 250);
}

async function audit(adminId, action, { targetUserId = null, targetType = null, targetId = null, metadata = {} } = {}) {
  try {
    await fetch(`${SB_URL}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        admin_id: adminId,
        action,
        target_user_id: targetUserId,
        target_type: targetType,
        target_id: targetId != null ? String(targetId) : null,
        metadata,
      }),
    });
  } catch (e) {
    console.warn('[admin:audit]', action, e.message);
  }
}

async function authAdminUpdate(userId, attrs) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attrs),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.msg || err?.message || `Auth admin error ${r.status}`);
  }
  return r.json();
}

async function listAuthUsers() {
  const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d?.users) ? d.users : Array.isArray(d) ? d : [];
}

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
      if (e?.error_code === 403) return false;
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
    if (action === 'confirm_payment') {
      if (!payId || !userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly' ? new Date(Date.now() + 30 * 24 * 3600000).toISOString() : null;
      await sbFetch(`payments?id=eq.${payId}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: admin.id }) });
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ plan, plan_expires_at: expiresAt, features: featuresForPlan(plan) }) });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=tg_chat_id,tg_linked,full_name`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (profile?.tg_linked && profile?.tg_chat_id) {
        const name = profile.full_name?.split(' ')[0] || 'trader';
        await tgSend(profile.tg_chat_id, `<b>Access confirmed!</b>\n---\nWelcome to ${plan === 'lifetime' ? 'Lifetime' : 'Monthly'} plan, <b>${name}</b>.\n\nAll features are now unlocked:\n+ Real-time setup signals\n+ AI insights + confidence %\n+ Full analytics + AI Coach\n\n<a href="${APP_URL}/screener">Open Screener</a>  |  <a href="${APP_URL}/journal">Open Journal</a>`);
      }
      await audit(admin.id, 'confirm_payment', { targetUserId: userId, targetType: 'payment', targetId: payId, metadata: { plan } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reject_payment') {
      if (!payId) return res.status(400).json({ error: 'Missing payId' });
      await sbFetch(`payments?id=eq.${payId}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
      await audit(admin.id, 'reject_payment', { targetType: 'payment', targetId: payId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_plan') {
      if (!userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly' ? new Date(Date.now() + 30 * 24 * 3600000).toISOString() : null;
      const updates = plan === 'none' ? { plan: 'none', plan_expires_at: null, features: featuresForPlan('none') } : { plan, plan_expires_at: expiresAt, features: featuresForPlan(plan) };
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify(updates) });
      await audit(admin.id, 'set_plan', { targetUserId: userId, targetType: 'profile', targetId: userId, metadata: { plan, expires_at: expiresAt } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'extend_plan') {
      const { days = 30 } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=plan,plan_expires_at`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile) return res.status(404).json({ error: 'User not found' });
      const base    = profile.plan_expires_at ? new Date(profile.plan_expires_at) : new Date();
      const newExp  = new Date(Math.max(base.getTime(), Date.now()) + days * 24 * 3600000).toISOString();
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ plan: 'monthly', plan_expires_at: newExp, features: featuresForPlan('monthly') }) });
      await audit(admin.id, 'extend_plan', { targetUserId: userId, targetType: 'profile', targetId: userId, metadata: { days, new_expiry: newExp } });
      return res.status(200).json({ ok: true, new_expiry: newExp });
    }

    if (action === 'delete_user') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      await sbFetch(`trades?user_id=eq.${userId}`,       { method: 'DELETE' });
      await sbFetch(`price_alerts?user_id=eq.${userId}`, { method: 'DELETE' });
      await sbFetch(`payments?user_id=eq.${userId}`,     { method: 'DELETE' });
      await sbFetch(`profiles?id=eq.${userId}`,          { method: 'DELETE' });
      await audit(admin.id, 'delete_user_data', { targetUserId: userId, targetType: 'profile', targetId: userId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'send_tg') {
      if (!userId || !data?.text) return res.status(400).json({ error: 'Missing params' });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=tg_chat_id,tg_linked`, { prefer: 'return=representation' });
      const profile  = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile?.tg_linked || !profile?.tg_chat_id) return res.status(400).json({ error: 'User has no TG linked' });
      await tgSend(profile.tg_chat_id, data.text);
      await audit(admin.id, 'send_tg', { targetUserId: userId, targetType: 'telegram', targetId: profile.tg_chat_id });
      return res.status(200).json({ ok: true });
    }

    if (action === 'broadcast') {
      const { text, audience = 'all' } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });
      let query = 'profiles?tg_linked=is.true&select=tg_chat_id,plan';
      if (audience === 'paid') query += '&plan=in.(lifetime,monthly)';
      const recipients = await sbFetch(query, { prefer: 'return=representation' });
      if (!Array.isArray(recipients)) return res.status(500).json({ error: 'Failed to load users' });
      const filtered = audience === 'free' ? recipients.filter(u => u.plan !== 'lifetime' && u.plan !== 'monthly') : recipients;
      let sent = 0, failed = 0;
      for (const u of filtered) {
        if (!u.tg_chat_id) continue;
        const ok = await tgSend(u.tg_chat_id, text);
        if (ok) sent++; else failed++;
        if ((sent + failed) % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[admin:broadcast] audience=${audience} sent=${sent} failed=${failed}`);
      await audit(admin.id, 'broadcast', { targetType: 'telegram', metadata: { audience, sent, failed, total: filtered.length } });
      return res.status(200).json({ ok: true, sent, failed, total: filtered.length });
    }

    if (action === 'get_users') {
      const { filter_plan, filter_tg, limit = 250, offset = 0 } = req.body;
      let query = `profiles?select=id,full_name,username,plan,plan_expires_at,tg_linked,tg_username,tg_chat_id,created_at,features,role&order=created_at.desc&limit=${Math.min(Number(limit)||250,250)}&offset=${Number(offset)||0}`;
      if (filter_plan)         query += `&plan=eq.${encodeURIComponent(filter_plan)}`;
      if (filter_tg === true)  query += '&tg_linked=is.true';
      if (filter_tg === false) query += '&tg_linked=is.false';
      const [users, authUsers] = await Promise.all([sbFetch(query, { prefer: 'return=representation' }), listAuthUsers()]);
      if (!Array.isArray(users)) return res.status(500).json({ error: 'Query failed' });
      const authMap = new Map(authUsers.map(u => [u.id, u]));
      const enriched = users.map(u => {
        const au = authMap.get(u.id);
        const bannedUntil = au?.banned_until || null;
        return { ...u, email: au?.email || null, auth_banned: !!(bannedUntil && new Date(bannedUntil).getTime() > Date.now()), auth_banned_until: bannedUntil, auth_last_sign_in_at: au?.last_sign_in_at || null, auth_created_at: au?.created_at || null };
      });
      return res.status(200).json({ ok: true, users: enriched, total: enriched.length });
    }

    if (action === 'get_stats') {
      const [allUsersR, paidR, tgLinkedR, tradesR, paymentsR] = await Promise.allSettled([
        sbFetch('profiles?select=id,plan,tg_linked,created_at', { prefer: 'return=representation' }),
        sbFetch('profiles?plan=in.(lifetime,monthly)&select=id,plan', { prefer: 'return=representation' }),
        sbFetch('profiles?tg_linked=is.true&select=id', { prefer: 'return=representation' }),
        fetch(`${SB_URL}/rest/v1/trades?select=id`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } }).then(r => parseInt(r.headers.get('content-range')?.split('/')[1] || '0')),
        sbFetch('payments?status=eq.confirmed&select=id', { prefer: 'return=representation' }),
      ]);
      const allUsers = allUsersR.status === 'fulfilled' && Array.isArray(allUsersR.value) ? allUsersR.value : [];
      const paidUsers = paidR.status === 'fulfilled' && Array.isArray(paidR.value) ? paidR.value : [];
      const tgLinked = tgLinkedR.status === 'fulfilled' && Array.isArray(tgLinkedR.value) ? tgLinkedR.value : [];
      const tradeCount = tradesR.status === 'fulfilled' ? tradesR.value : 0;
      const payments = paymentsR.status === 'fulfilled' && Array.isArray(paymentsR.value) ? paymentsR.value : [];
      const lifetime = paidUsers.filter(u => u.plan === 'lifetime').length;
      const monthly = paidUsers.filter(u => u.plan === 'monthly').length;
      const wkStart = new Date(); wkStart.setUTCDate(wkStart.getUTCDate() - ((wkStart.getUTCDay() + 6) % 7)); wkStart.setUTCHours(0,0,0,0);
      return res.status(200).json({ ok: true, stats: { total_users: allUsers.length, paid: paidUsers.length, lifetime, monthly, free: allUsers.length - paidUsers.length, tg_linked: tgLinked.length, total_trades: tradeCount, payments: payments.length, new_this_week: allUsers.filter(u => u.created_at && new Date(u.created_at) >= wkStart).length, revenue_est: lifetime * 197 + monthly * 29, conversion_pct: allUsers.length ? Math.round(paidUsers.length / allUsers.length * 100) : 0 } });
    }

    if (action === 'set_features') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ features: features || null }) });
      await audit(admin.id, 'set_features', { targetUserId: userId, targetType: 'profile', targetId: userId, metadata: { features: features || null } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_auth_access') {
      if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Invalid userId' });
      const locked = req.body.locked === true;
      await authAdminUpdate(userId, { ban_duration: locked ? '876000h' : 'none' });
      await audit(admin.id, locked ? 'lock_user' : 'unlock_user', { targetUserId: userId, targetType: 'auth', targetId: userId });
      return res.status(200).json({ ok: true, locked });
    }

    if (action === 'bulk_set_plan') {
      const ids = validUserIds(req.body.userIds);
      const bulkPlan = String(req.body.plan || 'none').toLowerCase();
      if (!ids.length) return res.status(400).json({ error: 'No valid users' });
      if (!['none','monthly','lifetime'].includes(bulkPlan)) return res.status(400).json({ error: 'Invalid plan' });
      const expiresAt = bulkPlan === 'monthly' ? new Date(Date.now() + 30 * 24 * 3600000).toISOString() : null;
      const updates = bulkPlan === 'none' ? { plan: 'none', plan_expires_at: null, features: featuresForPlan('none') } : { plan: bulkPlan, plan_expires_at: expiresAt, features: featuresForPlan(bulkPlan) };
      await sbFetch(`profiles?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify(updates) });
      await audit(admin.id, 'bulk_set_plan', { targetType: 'profiles', metadata: { user_ids: ids, plan: bulkPlan, expires_at: expiresAt } });
      return res.status(200).json({ ok: true, updated: ids.length });
    }

    if (action === 'bulk_set_auth_access') {
      const ids = validUserIds(req.body.userIds);
      const locked = req.body.locked === true;
      if (!ids.length) return res.status(400).json({ error: 'No valid users' });
      let updated = 0, failed = 0;
      for (const id of ids) {
        try { await authAdminUpdate(id, { ban_duration: locked ? '876000h' : 'none' }); updated++; } catch (_) { failed++; }
      }
      await audit(admin.id, locked ? 'bulk_lock_users' : 'bulk_unlock_users', { targetType: 'auth', metadata: { user_ids: ids, updated, failed } });
      return res.status(200).json({ ok: true, updated, failed });
    }

    if (action === 'bulk_set_features') {
      const ids = validUserIds(req.body.userIds);
      if (!ids.length) return res.status(400).json({ error: 'No valid users' });
      const nextFeatures = Array.isArray(req.body.features) ? req.body.features.slice(0, 30) : ['journal'];
      await sbFetch(`profiles?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ features: nextFeatures }) });
      await audit(admin.id, 'bulk_set_features', { targetType: 'profiles', metadata: { user_ids: ids, features: nextFeatures } });
      return res.status(200).json({ ok: true, updated: ids.length });
    }

    if (action === 'get_audit_log') {
      const limit = Math.min(Math.max(parseInt(req.body.limit || '150', 10), 1), 500);
      const rows = await sbFetch(`admin_audit_log?select=*&order=created_at.desc&limit=${limit}`, { prefer: 'return=representation' });
      return res.status(200).json({ ok: true, rows: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'save_product') {
      const { product } = req.body;
      if (!product) return res.status(400).json({ error: 'Missing product' });
      const r = product.id ? await sbFetch(`products?id=eq.${product.id}`, { method: 'PATCH', body: JSON.stringify(product) }) : await sbFetch('products', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(product) });
      await audit(admin.id, 'save_product', { targetType: 'product', targetId: product.id || null, metadata: { title: product.title || product.name || null } });
      return res.status(200).json({ ok: true, result: r });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    console.error('[admin]', action, e.message);
    return res.status(500).json({ error: e.message });
  }
}
