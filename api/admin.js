// api/admin.js — Server-side admin operations
// Protects service key from browser exposure
// Admin auth: checks Supabase JWT + profiles.role === 'admin'

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=minimal',
      'Accept': 'application/json',
      ...opts.headers,
    },
  });
  if (opts.method === 'PATCH' || opts.method === 'DELETE') return { ok: r.ok };
  return r.json();
}

async function verifyAdmin(req) {
  // Extract JWT from Authorization header
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  // Verify JWT with Supabase
  const userResp = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SB_KEY },
  });
  if (!userResp.ok) return null;
  const user = await userResp.json();
  if (!user?.id) return null;

  // Check admin role
  const profiles = await sbFetch(`profiles?id=eq.${user.id}&select=id,role`, { prefer: 'return=representation' });
  if (!Array.isArray(profiles) || profiles[0]?.role !== 'admin') return null;
  return user;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Not admin' });

  const { action, userId, payId, plan, data } = req.body;

  try {
    // ── Confirm payment ────────────────────────────────────
    if (action === 'confirm_payment') {
      if (!payId || !userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly'
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;
      await sbFetch(`payments?id=eq.${payId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: admin.id,
        }),
      });
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ plan, plan_expires_at: expiresAt }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Reject payment ─────────────────────────────────────
    if (action === 'reject_payment') {
      if (!payId) return res.status(400).json({ error: 'Missing payId' });
      await sbFetch(`payments?id=eq.${payId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Grant/revoke access ────────────────────────────────
    if (action === 'set_plan') {
      if (!userId || !plan) return res.status(400).json({ error: 'Missing params' });
      const expiresAt = plan === 'monthly'
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const updates = plan === 'none'
        ? { plan: 'none', plan_expires_at: null }
        : { plan, plan_expires_at: expiresAt };
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Delete user ────────────────────────────────────────
    if (action === 'delete_user') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      // Delete trades first (cascade might handle this, but be explicit)
      await sbFetch(`trades?user_id=eq.${userId}`, { method: 'DELETE' });
      await sbFetch(`price_alerts?user_id=eq.${userId}`, { method: 'DELETE' });
      await sbFetch(`profiles?id=eq.${userId}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ── Send TG message to user ────────────────────────────
    if (action === 'send_tg') {
      if (!userId || !data?.text) return res.status(400).json({ error: 'Missing params' });
      const profiles = await sbFetch(`profiles?id=eq.${userId}&select=tg_chat_id,tg_linked`, { prefer: 'return=representation' });
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      if (!profile?.tg_linked || !profile?.tg_chat_id) {
        return res.status(400).json({ error: 'User has no TG linked' });
      }
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: profile.tg_chat_id,
          text: data.text,
          parse_mode: 'HTML',
        }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Set features (sections) ───────────────────────────
    if (action === 'set_features') {
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      // features = array like ['journal','dashboard','coach'] or null (journal only)
      const features = req.body.features; // array or null
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: features || null }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin]', action, e.message);
    return res.status(500).json({ error: e.message });
  }
}
