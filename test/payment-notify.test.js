import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_KEY = 'test-server-key';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
const { default: handler } = await import('../api/notify.js');
const uid = '11111111-1111-4111-8111-111111111111';
const claim = { id: 42, plan: 'monthly', amount_usdt: 29, tx_hash: 'saved-hash', notes: 'tg:@trader_one' };
function res() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const req = { method: 'POST', headers: { authorization: 'Bearer user-token', 'x-notify-user': uid }, body: { type: 'payment_request_admin', data: { payment_id: 42, plan: 'lifetime', amount: 0.01, tg_username: '@forged_user', tx_hash: 'forged-hash' } } };
test('legacy payment notifications use a saved claim owned by the verified account, ignoring forged details', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.includes('/payments?')) assert.match(url, new RegExp('user_id=eq.' + uid));
    if (url.includes('api.telegram.org')) sent = JSON.parse(options.body).text;
    const body = url.endsWith('/auth/v1/user') ? { id: uid } : url.includes('/payments?') ? [claim] : url.includes('role=eq.admin') ? [{ tg_chat_id: 'test-admin' }] : [];
    return { ok: true, json: async () => body };
  });
  const response = res(); await handler(req, response);
  assert.equal(response.statusCode, 200); assert.match(sent, /Monthly/); assert.match(sent, /29 USDT/); assert.match(sent, /@trader_one/); assert.match(sent, /saved-hash/); assert.doesNotMatch(sent, /forged|Lifetime|0.01/);
});
test('legacy payment notification cannot send for an absent claim and reports Telegram HTTP failures', async t => {
  let saved = false, telegramCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const telegram = url.includes('api.telegram.org'); if (telegram) telegramCalls++;
    const body = url.endsWith('/auth/v1/user') ? { id: uid } : url.includes('/payments?') ? saved ? [claim] : [] : url.includes('role=eq.admin') ? [{ tg_chat_id: 'test-admin' }] : [];
    return { ok: !telegram, json: async () => body };
  });
  const missing = res(); await handler(req, missing); assert.equal(missing.statusCode, 404); assert.equal(telegramCalls, 0);
  saved = true; const failed = res(); await handler(req, failed); assert.equal(failed.statusCode, 502); assert.equal(failed.body.sent, 0);
});
