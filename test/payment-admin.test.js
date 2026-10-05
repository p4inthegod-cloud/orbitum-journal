import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_KEY = 'test-server-key';
const { default: handler } = await import('../api/admin.js');
const admin = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
function res() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
test('admin activation uses one atomic RPC with the verified administrator, not supplied account/tariff', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    const body = url.endsWith('/auth/v1/user') ? { id: admin } : url.includes('select=id,role') ? [{ id: admin, role: 'admin' }] : url.includes('/rpc/') ? { ok: true, user_id: owner, plan: 'monthly' } : [];
    return { ok: true, json: async () => body };
  });
  const response = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: { action: 'confirm_payment', payId: 42, userId: 'forged-user', plan: 'lifetime' } }, response);
  assert.equal(response.statusCode, 200); assert.equal(response.body.ok, true);
  const rpc = calls.find(call => call.url.includes('/rpc/'));
  assert.deepEqual(JSON.parse(rpc.options.body), { p_payment_id: '42', p_admin_id: admin });
  assert.ok(calls.find(call => call.url.includes('profiles?id=eq.' + owner)));
  assert.ok(!calls.some(call => call.options.method === 'PATCH'));
});
test('an already confirmed claim returns success without granting or notifying again', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('/auth/v1/user') ? { id: admin } : url.includes('/rpc/') ? { ok: true, already_confirmed: true } : [{ id: admin, role: 'admin' }] };
  });
  const response = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: { action: 'confirm_payment', payId: 42 } }, response);
  assert.equal(response.body.already_confirmed, true); assert.equal(calls.length, 3);
});
test('a failed database write is not reported as successful activation', async t => {
  t.mock.method(globalThis, 'fetch', async url => ({ ok: !url.includes('/rpc/'), status: 503, json: async () => url.endsWith('/auth/v1/user') ? { id: admin } : [{ id: admin, role: 'admin' }] }));
  const response = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: { action: 'confirm_payment', payId: 42 } }, response);
  assert.equal(response.statusCode, 500); assert.ok(response.body.error);
});
test('rejecting a completed payment cannot change its status', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'PATCH') assert.match(url, /status=eq.pending/);
    return { ok: true, json: async () => url.endsWith('/auth/v1/user') ? { id: admin } : options.method === 'PATCH' ? [] : [{ id: admin, role: 'admin' }] };
  });
  const response = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: { action: 'reject_payment', payId: 42 } }, response);
  assert.equal(response.statusCode, 409);
});
