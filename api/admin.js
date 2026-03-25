// api/admin.js — Server-side admin operations
// Protects service key from browser exposure
// Admin auth: checks Supabase JWT + profiles.role === 'admin'

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function resolveCorsOrigin(req) {
  const requestOrigin = req.headers.origin;
  const appUrl = process.env.APP_URL || 'https://orbitum.trade';
  if (!requestOrigin) return appUrl;
  if (/^https:\/\/.*\.vercel\.app$/i.test(requestOrigin)) return requestOrigin;
  if (['https://orbitum.trade','https://www.orbitum.trade', appUrl].includes(requestOrigin)) return requestOrigin;
  return appUrl;
}

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
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
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
      const features = req.body.features;
      await sbFetch(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: features || null }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── Save/upsert product (bypasses RLS — service key required) ──
    if (action === 'save_product') {
      const { productId, updates } = req.body;
      if (!productId || !updates) return res.status(400).json({ error: 'Missing productId or updates' });
      // Upsert with service key — no RLS restrictions
      const result = await sbFetch(`products?id=eq.${productId}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify(updates),
      });
      // If PATCH returned no rows (product doesn't exist), INSERT it
      if (result && result.length === 0 || !result) {
        await sbFetch('products', {
          method: 'POST',
          prefer: 'return=minimal',
          body: JSON.stringify({ id: productId, ...updates }),
        });
      }
      return res.status(200).json({ ok: true });
    }

    // ── Seed default products ──────────────────────────────────────
    if (action === 'seed_products') {
      const defaults = [
        {
          id: 'monthly', sort_order: 1, is_active: true,
          name_en: 'Monthly', name_ru: 'Месячный',
          price: 29, price_old: null,
          badge_en: null, badge_ru: null,
          description_en: 'Full access for 30 days',
          description_ru: 'Полный доступ на 30 дней',
          features_en: '["Trading Journal","AI Coach","Crypto Screener","Analytics & Progress","Pre-market Checklist"]',
          features_ru: '["Журнал сделок","AI Коуч и Чекер","Крипто Скринер","Аналитика и прогресс","Пре-маркет чеклист"]',
          updated_at: new Date().toISOString(),
        },
        {
          id: 'lifetime', sort_order: 2, is_active: true,
          name_en: 'Lifetime', name_ru: 'Навсегда',
          price: 197, price_old: 297,
          badge_en: 'Best Value', badge_ru: 'Лучший выбор',
          description_en: 'One-time payment — access forever',
          description_ru: 'Разовая оплата — доступ навсегда',
          features_en: '["Everything in Monthly","Lifetime updates","Priority support","AI Advanced features","Future modules free"]',
          features_ru: '["Всё из Месячного","Обновления навсегда","Приоритетная поддержка","AI расширенные функции","Будущие модули бесплатно"]',
          updated_at: new Date().toISOString(),
        },
      ];
      for (const p of defaults) {
        // Try PATCH first, then POST if not exists
        const patch = await sbFetch(`products?id=eq.${p.id}`, {
          method: 'PATCH', prefer: 'return=representation',
          body: JSON.stringify(p),
        });
        if (!Array.isArray(patch) || patch.length === 0) {
          await sbFetch('products', {
            method: 'POST', prefer: 'return=minimal',
            body: JSON.stringify(p),
          });
        }
      }
      return res.status(200).json({ ok: true, seeded: defaults.length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin]', action, e.message);
    return res.status(500).json({ error: e.message });
  }
}
