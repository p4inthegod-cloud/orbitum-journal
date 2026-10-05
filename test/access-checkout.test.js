import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo, normalizeTelegram, validTxHash, authError } from '../js/andromeda-access-core.js';
import { makePaymentCheckout } from '../lib/payment-checkout.js';

test('return destinations retain checkout query strings and block external redirects and login loops', () => {
  for (const input of ['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/%2f%2fevil.test', '/login', '/login.html?returnTo=/pay', '/%6cogin', '/pay%0a', '']) assert.equal(safeReturnTo(input), '/journal', input);
  assert.equal(safeReturnTo('/pay?plan=lifetime'), '/pay?plan=lifetime');
  assert.equal(safeReturnTo('/profile'), '/profile');
});
test('Telegram handles normalize safely without accepting display names, phone numbers or injected memos', () => {
  assert.equal(normalizeTelegram(' @Trader_one '), '@Trader_one');
  assert.equal(normalizeTelegram('https://t.me/trader_one/'), '@trader_one');
  assert.equal(normalizeTelegram('trader_one'), '@trader_one');
  for (const value of ['name', 'John Smith', '+1234567890', '12345', '@name; plan:lifetime', 'https://evil.test/trader_one']) assert.equal(normalizeTelegram(value), null);
});
test('hash validation accepts TON hex/base64/base64url and rejects pasted URLs and arbitrary text', () => {
  for (const hash of ['', 'a'.repeat(64), Buffer.alloc(32, 7).toString('base64'), Buffer.alloc(32, 7).toString('base64url')]) assert.ok(validTxHash(hash));
  for (const hash of ['https://tonviewer.com/abc', 'abc', 'x'.repeat(64), 'a'.repeat(65)]) assert.equal(validTxHash(hash), false);
});
test('auth failures produce useful Russian messages without raw backend details', () => {
  assert.match(authError({ code: 'invalid_credentials' }), /Email или пароль/);
  assert.match(authError({ code: 'over_email_send_rate_limit' }), /минуту/);
  assert.match(authError({ message: 'sensitive database stacktrace' }), /Не удалось/);
});

const uid = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_KEY: 'server-only', TELEGRAM_BOT_TOKEN: 'mock-bot' };
const claim = { id: 42, user_id: uid, plan: 'monthly', amount_usdt: 29, status: 'pending', notes: 'tg:@trader_one' };
function response(body, status = 200) { return { ok: status < 400, status, json: async () => body }; }
function recorder() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
function request(data = {}) { return { headers: { authorization: 'Bearer test-user-token' }, body: { data: { plan: 'monthly', amount: 29, tg_username: '@trader_one', confirmed: true, ...data } } }; }
function backend(options = {}) {
  const calls = [], writes = [];
  const fetchImpl = async (url, config = {}) => {
    calls.push({ url, config });
    if (url.endsWith('/auth/v1/user')) return response({ id: uid }, options.authStatus || 200);
    if (url.includes('/products?')) return response(options.product === false ? [] : [{ id: 'monthly', price: options.price || 29, currency: 'USDT' }]);
    if (url.includes('/payments?') && config.method !== 'POST') return response(options.existing ? [claim] : options.race && writes.length ? [claim] : []);
    if (url.includes('/payments?') && config.method === 'POST') {
      writes.push(JSON.parse(config.body));
      if (options.race) return response({ code: '23505' }, 409);
      if (options.dbFail) return response({ code: '42501' }, 403);
      return response([claim], 201);
    }
    if (url.includes('/profiles?role')) return response([{ tg_chat_id: 'admin-test' }]);
    if (url.includes('/profiles?id')) return response([{ full_name: '<unsafe & name>' }]);
    if (url.includes('api.telegram.org')) return response({ ok: !options.telegramFail }, options.telegramFail ? 500 : 200);
    throw new Error('Unexpected request: ' + url);
  };
  return { fetchImpl, calls, writes };
}
test('checkout requires a verified session and never trusts a body user_id', async () => {
  const db = backend(), handler = makePaymentCheckout({ ...db, env }), res = recorder();
  await handler({ headers: {}, body: {} }, res); assert.equal(res.statusCode, 401); assert.equal(db.calls.length, 0);
  const bad = backend({ authStatus: 401 }), badRes = recorder();
  await makePaymentCheckout({ ...bad, env })(request(), badRes); assert.equal(badRes.statusCode, 401); assert.equal(bad.writes.length, 0);
  await handler(request({ user_id: 'attacker-supplied' }), recorder()); assert.equal(db.writes[0].user_id, uid);
});
test('checkout writes only the active server price, pending status and normalized Telegram, with canonical hash', async () => {
  const db = backend(), res = recorder(), hash = Buffer.alloc(32, 9);
  await makePaymentCheckout({ ...db, env })(request({ tg_username: 'https://t.me/trader_one', tx_hash: hash.toString('base64'), status: 'confirmed' }), res);
  assert.equal(res.statusCode, 201); assert.equal(db.writes[0].amount_usdt, 29); assert.equal(db.writes[0].status, 'pending');
  assert.equal(db.writes[0].tx_hash, hash.toString('hex')); assert.match(db.writes[0].notes, /tg:@trader_one/);
  assert.equal(res.body.notified, true); assert.doesNotMatch(JSON.stringify(res.body), /server-only|mock-bot/);
  const telegram = db.calls.find(call => call.url.includes('api.telegram.org'));
  assert.match(JSON.parse(telegram.config.body).text, /&lt;unsafe &amp; name&gt;/);
});
test('outdated quotes, inactive plans and unconfirmed transfers cannot create a claim', async () => {
  for (const [options, data, expected] of [[{ price: 35 }, {}, 'price_changed'], [{ product: false }, {}, 'plan_unavailable'], [{}, { confirmed: false }, 'invalid_payment'], [{}, { plan: 'free' }, 'invalid_payment'], [{}, { tx_hash: 'invalid' }, 'invalid_payment']]) {
    const db = backend(options), res = recorder();
    await makePaymentCheckout({ ...db, env })(request(data), res); assert.equal(res.body.error, expected); assert.equal(db.writes.length, 0);
  }
});
test('retry and concurrent insert conflicts return the same saved claim without notifying twice', async () => {
  for (const options of [{ existing: true }, { race: true }]) {
    const db = backend(options), res = recorder();
    await makePaymentCheckout({ ...db, env })(request(), res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.payment.id, 42); assert.equal(res.body.existing, true);
    assert.ok(!db.calls.some(call => call.url.includes('api.telegram.org')));
  }
});
test('a Telegram outage cannot undo the saved payment or claim successful delivery', async () => {
  const db = backend({ telegramFail: true }), res = recorder();
  await makePaymentCheckout({ ...db, env })(request(), res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.ok, true); assert.equal(res.body.notified, false);
});
test('database failure and missing server credentials do not claim success', async () => {
  const db = backend({ dbFail: true }), res = recorder();
  await makePaymentCheckout({ ...db, env })(request(), res); assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'service_unavailable');
  const unavailable = recorder(); await makePaymentCheckout({ ...db, env: {} })(request(), unavailable); assert.equal(unavailable.statusCode, 503);
});
