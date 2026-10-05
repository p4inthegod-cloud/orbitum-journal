import { normalizeTelegram, validTxHash, WALLET } from '../js/andromeda-access-core.js';

const PAYMENT_SELECT = 'id,user_id,plan,amount_usdt,status,notes,tx_hash,created_at';
const escape = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
function canonicalHash(value) {
  if (!value) return null;
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : Buffer.from(value, 'base64url').toString('hex');
}

// Shares /api/notify's function so the project stays within its hosting limit.
// A request records a transfer claim; only the existing admin endpoint activates access.
export function makePaymentCheckout({ fetchImpl = (...args) => fetch(...args), env = process.env } = {}) {
  return async function paymentCheckout(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'service_unavailable' });
    const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    async function request(path, options = {}) {
      const response = await fetchImpl(url + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(5000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error('Database request failed'); error.status = response.status; error.code = body?.code; throw error;
      }
      return body;
    }
    async function pending(userId) {
      return (await request(`/rest/v1/payments?user_id=eq.${userId}&status=eq.pending&select=${PAYMENT_SELECT}&order=created_at.desc&limit=1`))?.[0];
    }
    try {
      const authResponse = await fetchImpl(url + '/auth/v1/user', { headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (!authResponse.ok) return res.status(401).json({ error: 'unauthorized' });
      const user = await authResponse.json();
      if (!/^[0-9a-f-]{36}$/i.test(user?.id || '')) return res.status(401).json({ error: 'unauthorized' });
      const data = req.body?.data || {};
      const plan = data.plan, tg = normalizeTelegram(data.tg_username), rawHash = String(data.tx_hash || '').trim();
      if (!['monthly', 'lifetime'].includes(plan) || !tg || !validTxHash(rawHash) || data.confirmed !== true)
        return res.status(400).json({ error: 'invalid_payment' });
      const [products, existing] = await Promise.all([
        request(`/rest/v1/products?id=eq.${plan}&is_active=eq.true&select=id,price,currency`), pending(user.id)
      ]);
      if (existing) return res.status(200).json({ ok: true, payment: existing, existing: true, notified: null });
      const product = products?.[0];
      if (!product || product.currency !== 'USDT' || !Number.isFinite(Number(product.price)) || Number(product.price) <= 0)
        return res.status(409).json({ error: 'plan_unavailable' });
      const amount = Number(product.price);
      if (Number(data.amount) !== amount) return res.status(409).json({ error: 'price_changed', price: amount });
      const txHash = canonicalHash(rawHash);
      const wallet = WALLET;
      let payment;
      try {
        const rows = await request('/rest/v1/payments?select=' + PAYMENT_SELECT, {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ user_id: user.id, plan, amount_usdt: amount, tx_hash: txHash, status: 'pending',
            notes: `network:TON; asset:USDT; tg:${tg}; transfer_comment:${tg}; destination:${wallet}` })
        });
        payment = rows?.[0];
        if (!payment?.id) throw new Error('Missing payment');
      } catch (error) {
        if (error.code === '23505') {
          const saved = await pending(user.id);
          if (saved) return res.status(200).json({ ok: true, payment: saved, existing: true, notified: null });
          return res.status(409).json({ error: 'transaction_already_used' });
        }
        throw error;
      }
      let notified = false;
      try {
        if (env.TELEGRAM_BOT_TOKEN) {
          const [profiles, admins] = await Promise.all([
            request(`/rest/v1/profiles?id=eq.${user.id}&select=full_name,username`),
            request('/rest/v1/profiles?role=eq.admin&tg_linked=is.true&tg_chat_id=not.is.null&select=tg_chat_id')
          ]);
          const name = profiles?.[0]?.full_name || profiles?.[0]?.username || 'Пользователь ANDROMEDA';
          const app = env.APP_URL || 'https://orbitum.trade';
          const text = `<b>Новая заявка · ANDROMEDA</b>\n\n${escape(name)}\nTelegram: <b>${escape(tg)}</b>\nТариф: <b>${plan === 'lifetime' ? 'Навсегда' : '30 дней'}</b>\nСумма: <b>${amount} USDT</b>\nСеть: TON\nЗаявка: <code>${payment.id}</code>\nTX: <code>${escape(txHash || 'не указан')}</code>\n\n<a href="${escape(app)}/admin">Проверить перевод и активировать доступ</a>`;
          const sent = await Promise.all((admins || []).map(async admin => {
            try {
              const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
                body: JSON.stringify({ chat_id: admin.tg_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
              });
              const body = await response.json().catch(() => ({}));
              return response.ok && body.ok === true;
            } catch { return false; }
          }));
          notified = sent.some(Boolean);
        }
      } catch { /* The persisted payment remains valid even if notification delivery fails. */ }
      return res.status(201).json({ ok: true, payment, existing: false, notified });
    } catch (error) {
      console.warn('[checkout] Request failed', error.code || error.name);
      return res.status(503).json({ error: 'service_unavailable' });
    }
  };
}
