import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Isolated development browser with mocked Auth/REST/checkout boundaries.
// No real emails, transfers, admin approvals or Telegram notifications are sent.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ACCESS_BASE_URL || 'http://127.0.0.1:4173';
const output = path.resolve(process.env.ACCESS_SCREENSHOTS || '../access-preview');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'trader@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ id: 'test-identity' }], created_at: new Date().toISOString() };
const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test-signature'].join('.');
const authSession = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user };
let payment, checkoutCalls = 0, authCalls = [], catalogFails = false, duplicateClicks = 0;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
await context.route('https://kgutmsosfyyxnlnhucaa.supabase.co/**', async route => {
  const request = route.request(), url = new URL(request.url());
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  let body = {}, status = 200;
  if (url.pathname.includes('/auth/v1/')) {
    authCalls.push({ path: url.pathname, query: url.search, method: request.method(), data: request.postDataJSON() });
    if (url.pathname.endsWith('/token')) body = authSession;
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.endsWith('/signup')) body = { user, session: null };
  } else if (url.pathname.endsWith('/products')) {
    if (catalogFails) { status = 503; body = { message: 'Offline fixture' }; }
    else body = [{ id: 'monthly', price: 29, currency: 'USDT' }, { id: 'lifetime', price: 197, currency: 'USDT' }];
  } else if (url.pathname.endsWith('/profiles')) body = { tg_username: '@trader_one', plan: 'none', plan_expires_at: null };
  else if (url.pathname.endsWith('/payments')) body = payment || null;
  else throw new Error('Unexpected upstream route ' + url.pathname);
  await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
});
await context.route(base + '/api/notify', async route => {
  checkoutCalls++; const data = route.request().postDataJSON().data;
  assert.equal(data.plan, 'lifetime'); assert.equal(data.amount, 197); assert.equal(data.tg_username, '@trader_one'); assert.equal(data.confirmed, true);
  if (payment) duplicateClicks++;
  payment ||= { id: 42, plan: data.plan, amount_usdt: data.amount, status: 'pending', notes: 'tg:' + data.tg_username, created_at: new Date().toISOString() };
  await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, payment, notified: false }) });
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const visible = selector => page.locator(selector).waitFor({ state: 'visible' });
const enabled = selector => page.waitForFunction(selector => !document.querySelector(selector).disabled, selector);
async function screenshot(name) { await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; }); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); }
async function noOverflow() { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow'); }
try {
  await page.goto(base + '/login'); await enabled('#panel-login button[type=submit]');
  await screenshot('login-desktop'); await noOverflow();
  await page.getByRole('tab', { name: 'Создать аккаунт', exact: true }).click(); await visible('#panel-register');
  await page.locator('#reg-name').fill('Test trader'); await page.locator('#reg-email').fill(user.email); await page.locator('#reg-pass').fill('Test-password-42');
  await page.locator('#panel-register button[type=submit]').click(); await visible('#panel-sent');
  assert.match(await page.locator('#sent-description').textContent(), /подтверди адрес/);
  assert.ok(await page.locator('#resend-email').isDisabled());
  assert.ok(authCalls.find(call => call.path.endsWith('/signup')).data.options === undefined); // SDK sends data directly, profile creation is server-owned.
  await page.reload(); await enabled('#panel-login button[type=submit]');
  await page.locator('#login-email').fill(user.email); await page.getByRole('button', { name: 'Забыли пароль?' }).click();
  assert.equal(await page.locator('#forgot-email').inputValue(), user.email);
  await page.locator('#panel-forgot button[type=submit]').click(); await visible('#panel-sent');
  const recoveryCall = authCalls.find(call => call.path.endsWith('/recover'));
  assert.match(decodeURIComponent(recoveryCall.query), /mode=recovery/);
  await page.goto(base + '/login?returnTo=%2Fpay%3Fplan%3Dlifetime'); await enabled('#panel-login button[type=submit]');
  await page.locator('#login-email').fill(user.email); await page.getByRole('button', { name: 'Получить ссылку на email', exact: true }).click();
  assert.equal(await page.locator('#magic-email').inputValue(), user.email);
  await page.locator('#panel-magic button[type=submit]').click(); await visible('#panel-sent');
  assert.equal(authCalls.find(call => call.path.endsWith('/otp')).data.create_user, false);
  assert.match(decodeURIComponent(authCalls.find(call => call.path.endsWith('/otp')).query), /returnTo=.*pay/);
  await page.goto(base + '/pay'); await enabled('#continue-payment'); await screenshot('pay-desktop');
  await page.locator('input[value=lifetime]').check(); await page.locator('#continue-payment').click(); await visible('#panel-login');
  assert.match(page.url(), /returnTo=.*lifetime/);
  await page.locator('#login-email').fill(user.email); await page.locator('#login-pass').fill('Test-password-42');
  await page.getByRole('button', { name: 'Показать пароль', exact: true }).click(); assert.equal(await page.locator('#login-pass').getAttribute('type'), 'text');
  await page.locator('#login-pass').press('Enter'); await page.waitForURL('**/pay?plan=lifetime'); await visible('#telegram-field');
  assert.ok(await page.locator('input[value=lifetime]').isChecked()); assert.equal(await page.locator('#tg').inputValue(), '@trader_one');
  await page.locator('#tg').fill('John Smith'); await page.locator('#continue-payment').click();
  assert.equal(await page.locator('#tg').getAttribute('aria-invalid'), 'true');
  await page.locator('#tg').fill('https://t.me/trader_one'); await page.locator('#continue-payment').click(); await visible('#step-2');
  await screenshot('pay-transfer-desktop');
  await page.locator('[data-copy=wallet]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'UQBvLtwoGw4fhWM7ZipdzYhh6pNtVZJywxcfAAeeAlu_2rsA');
  await page.locator('#to-confirm').click(); await visible('#step-3'); await page.reload(); await visible('#step-3');
  await page.locator('#tx').fill('invalid'); await page.locator('#paid-confirm').check(); await page.locator('#submit-payment').click();
  assert.equal(checkoutCalls, 0); assert.match(await page.locator('#pay-message').textContent(), /Хэш/);
  await page.locator('#tx').fill('a'.repeat(64)); await page.locator('#submit-payment').dblclick(); await visible('#step-result');
  assert.equal(checkoutCalls, 1); assert.equal(duplicateClicks, 0); assert.match(await page.locator('#notification-note').textContent(), /не доставлено/);
  await screenshot('pay-pending-desktop');
  await page.reload(); await visible('#step-result'); assert.match(await page.locator('#result-details').textContent(), /#42/);
  payment.status = 'confirmed'; await page.locator('#refresh-status').click(); await page.getByRole('heading', { name: 'Доступ активирован.' }).waitFor();
  await screenshot('pay-confirmed-desktop');
  await page.goto(base + '/login?mode=recovery&returnTo=%2Fpay'); await visible('#panel-reset');
  await page.locator('#new-pass').fill('Changed-password-42'); await page.locator('#confirm-pass').fill('wrong-password-42');
  await page.locator('#panel-reset button[type=submit]').click();
  assert.equal(await page.locator('#confirm-pass').evaluate(element => element.validationMessage), 'Пароли должны совпадать.');
  await page.locator('#confirm-pass').fill('Changed-password-42'); await page.locator('#panel-reset button[type=submit]').click(); await page.waitForURL('**/pay');
  assert.ok(authCalls.find(call => call.method === 'PUT' && call.path.endsWith('/user')));
  await context.clearCookies(); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); payment = null;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
    await page.goto(base + '/login'); await enabled('#panel-login button[type=submit]'); await noOverflow();
    if (width === 390) await screenshot('login-mobile');
    await page.goto(base + '/pay'); await enabled('#continue-payment'); await noOverflow();
    if (width === 390) await screenshot('pay-mobile');
  }
  catalogFails = true; await page.reload(); await visible('#retry-connection'); assert.ok(await page.locator('#continue-payment').isDisabled());
  catalogFails = false; await page.locator('#retry-connection').click(); await enabled('#continue-payment');
  assert.deepEqual(errors, []);
  console.log('PASS: registration, password/link login, recovery, checkout return, validation, copying, drafts, single submission, notification outage, status restore/activation, responsive widths 320/390/768/1440, catalog failure/retry. No real messages or payments sent.');
  console.log('Screenshots: ' + output);
} finally { await browser.close(); }
