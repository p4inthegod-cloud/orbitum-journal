import { getClient, normalizeTelegram, validTxHash, formatAmount, PLAN_NAMES, WALLET, message, readDraft, writeDraft } from './andromeda-access-core.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let sb, session, profile, products = {}, selectedPlan = 'monthly', currentStep = 1, maxStep = 1, ready = false, busy = false, payment = null, subscription;
const queryPlan = ['monthly', 'lifetime'].includes(params.get('plan')) ? params.get('plan') : null;
function draftKey() { return 'andromeda.checkout.' + (session?.user?.id || 'guest'); }
function saveDraft() {
  writeDraft(draftKey(), { plan: selectedPlan, tg: session ? $('tg').value : '', tx: session ? $('tx').value : '', step: currentStep, updated: Date.now() });
}
function restoreDraft() {
  const draft = readDraft(draftKey());
  const fresh = Number(draft.updated) > Date.now() - 24 * 3600000;
  selectedPlan = queryPlan || (fresh && PLAN_NAMES[draft.plan] ? draft.plan : selectedPlan);
  if (session && fresh) {
    $('tg').value = String(draft.tg || '').slice(0, 80); $('tx').value = String(draft.tx || '').slice(0, 128);
    if (normalizeTelegram($('tg').value) && products[selectedPlan]) {
      currentStep = Math.min(3, Math.max(1, Number(draft.step) || 1)); maxStep = currentStep;
    }
  }
}
function updateSummary() {
  const price = products[selectedPlan]?.price, tg = normalizeTelegram($('tg').value) || '@username';
  const amount = price == null ? '—' : formatAmount(price);
  document.querySelectorAll('input[name=plan]').forEach(input => input.checked = input.value === selectedPlan);
  $('summary-plan').textContent = PLAN_NAMES[selectedPlan]; $('summary-duration').textContent = selectedPlan === 'lifetime' ? 'Бессрочный доступ' : '30 дней после активации';
  for (const id of ['summary-price', 'transfer-amount']) $(id).textContent = amount;
  $('transfer-memo').textContent = tg; $('review-plan').textContent = PLAN_NAMES[selectedPlan];
  $('review-amount').textContent = amount + ' USDT'; $('review-tg').textContent = tg; $('check-amount').textContent = amount + ' USDT';
  controls();
}
function controls() {
  $('continue-payment').disabled = !ready || busy || !products[selectedPlan];
  $('submit-payment').disabled = !ready || busy;
  $('to-confirm').disabled = !ready || busy;
  $('plans').disabled = !ready || busy;
  document.querySelectorAll('[data-back]').forEach(button => button.disabled = busy);
  document.querySelectorAll('[data-step]').forEach(button => {
    const step = Number(button.dataset.step);
    button.disabled = busy || !ready || !!payment || step > maxStep;
    button.toggleAttribute('aria-current', currentStep === step);
    if (currentStep === step) button.setAttribute('aria-current', 'step');
    button.dataset.complete = String(currentStep === 'result' || step < currentStep);
  });
  $('payment-form').setAttribute('aria-busy', String(busy));
}
function showStep(step, focus = true) {
  currentStep = step;
  if (typeof step === 'number') maxStep = Math.max(maxStep, step);
  document.querySelectorAll('.checkout-step').forEach(element => element.hidden = element.id !== 'step-' + step);
  message('pay-message', ''); controls();
  if (focus) $('step-' + step).querySelector('h2')?.focus({ preventScroll: true });
  if (focus && innerWidth < 801) $('checkout').scrollIntoView({ block: 'start', behavior: 'instant' });
  if (typeof step === 'number') saveDraft();
}
function login() {
  saveDraft(); location.assign('/login?returnTo=' + encodeURIComponent('/pay?plan=' + selectedPlan));
}
function validateTelegram() {
  const tg = normalizeTelegram($('tg').value);
  $('tg').setAttribute('aria-invalid', String(!tg));
  if (!tg) { message('pay-message', 'Укажи username из Telegram: @username или t.me/username. Это имя пользователя, а не имя профиля.'); $('tg').focus(); return false; }
  $('tg').value = tg; return true;
}
function resultDetails(rows) {
  $('result-details').replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div'), name = document.createElement('span'), text = document.createElement('strong');
    name.textContent = label; text.textContent = value; row.append(name, text); return row;
  }));
}
function showPayment(saved, notified = null, focus = false) {
  payment = saved; selectedPlan = saved.plan; showStep('result', focus);
  $('summary-plan').textContent = PLAN_NAMES[saved.plan]; $('summary-price').textContent = formatAmount(saved.amount_usdt);
  $('summary-duration').textContent = saved.plan === 'lifetime' ? 'Бессрочный доступ' : '30 дней после активации';
  const confirmed = saved.status === 'confirmed', rejected = saved.status === 'rejected';
  $('result-kicker').textContent = confirmed ? 'ОПЛАТА ПОДТВЕРЖДЕНА' : rejected ? 'НУЖНО УТОЧНИТЬ ПЕРЕВОД' : 'ЗАЯВКА СОХРАНЕНА';
  $('result-title').textContent = confirmed ? 'Доступ активирован.' : rejected ? 'Платёж не подтверждён.' : 'Платёж на проверке.';
  $('result-description').textContent = confirmed ? 'Всё готово. Открой ANDROMEDA и продолжи работу.' : rejected ? 'Проверка не подтвердила перевод. Проверь реквизиты и хэш; если деньги уже отправлены, не переводи их повторно.' : 'Проверим перевод и активируем доступ. Заявка сохранена в твоём аккаунте — повторно оплачивать не нужно.';
  $('result-icon').src = '/assets/pixel-pack/' + (confirmed ? 'check' : rejected ? 'mail' : 'hourglass') + '.webp';
  const tg = saved.notes?.match(/(?:^|;\s*)tg:([^;]+)/)?.[1] || normalizeTelegram($('tg').value) || '—';
  resultDetails([['Заявка', '#' + saved.id], ['Тариф', PLAN_NAMES[saved.plan]], ['Сумма', formatAmount(saved.amount_usdt) + ' USDT'], ['Telegram', tg], ['Статус', confirmed ? 'Подтверждён' : rejected ? 'Не подтверждён' : 'Ожидает проверки']]);
  $('notification-note').textContent = notified === false ? 'Заявка сохранена. Уведомление в Telegram пока не доставлено; администратор увидит её в списке платежей.' : notified === true ? 'Администратору отправлено уведомление о твоей заявке.' : 'Проверка выполняется вручную. Нажми «Обновить статус», чтобы узнать результат.';
  $('refresh-status').hidden = confirmed; $('new-payment').hidden = !rejected;
  $('open-system').querySelector('span').textContent = confirmed ? 'Открыть ANDROMEDA' : 'Вернуться в систему';
}
function showActive() {
  payment = { active: true }; selectedPlan = 'lifetime'; updateSummary(); showStep('result', false);
  $('result-kicker').textContent = 'ТВОЙ ТАРИФ УЖЕ АКТИВЕН'; $('result-title').textContent = 'Полный доступ открыт.';
  $('result-description').textContent = 'У тебя бессрочный доступ. Все инструменты системы уже доступны — повторная оплата не нужна.';
  $('result-icon').src = '/assets/pixel-pack/check.webp'; resultDetails([['Тариф', 'Навсегда'], ['Статус', 'Активен']]);
  $('notification-note').textContent = ''; $('refresh-status').hidden = true; $('new-payment').hidden = true;
  $('open-system').querySelector('span').textContent = 'Открыть ANDROMEDA';
}
document.querySelectorAll('input[name=plan]').forEach(input => input.addEventListener('change', () => {
  selectedPlan = input.value; maxStep = 1; $('paid-confirm').checked = false; $('tx').value = ''; updateSummary(); saveDraft();
  const url = new URL(location.href); url.searchParams.set('plan', selectedPlan); history.replaceState(null, '', url.pathname + url.search);
}));
$('tg').addEventListener('input', () => { $('tg').removeAttribute('aria-invalid'); $('paid-confirm').checked = false; maxStep = 1; updateSummary(); saveDraft(); });
$('tx').addEventListener('input', saveDraft);
$('continue-payment').addEventListener('click', () => {
  if (!session) return login();
  if (!validateTelegram()) return;
  updateSummary(); showStep(2);
});
$('to-confirm').addEventListener('click', () => { if (!session) return login(); showStep(3); });
document.querySelectorAll('[data-back],[data-step]').forEach(button => button.addEventListener('click', () => {
  const step = Number(button.dataset.back || button.dataset.step);
  if (!busy && !payment && step <= maxStep) showStep(step);
}));
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  const value = button.dataset.copy === 'wallet' ? WALLET : button.dataset.copy === 'amount' ? String(products[selectedPlan].price) : normalizeTelegram($('tg').value);
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const old = button.textContent; button.textContent = 'Скопировано ✓';
    message('pay-message', button.dataset.copy === 'wallet' ? 'Адрес скопирован. В кошельке выбери USDT и сеть TON.' : button.dataset.copy === 'memo' ? 'Комментарий скопирован.' : 'Сумма скопирована.', 'success');
    setTimeout(() => { button.textContent = old; }, 2000);
  } catch { message('pay-message', 'Браузер не разрешил копирование. Выдели реквизит и скопируй вручную.'); }
}));
async function init() {
  ready = false; controls(); $('retry-connection').hidden = true; $('connection-note').hidden = false; $('connection-note').textContent = 'Загружаем тарифы и твой аккаунт…';
  try {
    sb = await getClient();
    const auth = await sb.auth.getSession();
    if (auth.error) throw auth.error;
    session = auth.data.session;
    if (!subscription) subscription = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') setTimeout(() => { if (!busy) init(); }, 0);
    });
    const [catalog, userProfile, pending] = await Promise.all([
      sb.from('products').select('id,price,currency').in('id', ['monthly', 'lifetime']).eq('is_active', true),
      session ? sb.from('profiles').select('tg_username,plan,plan_expires_at').eq('id', session.user.id).maybeSingle() : Promise.resolve({ data: null }),
      session ? sb.from('payments').select('id,plan,amount_usdt,status,notes,tx_hash,created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null })
    ]);
    if (userProfile.error || pending.error) throw userProfile.error || pending.error;
    profile = userProfile.data; products = {};
    for (const product of catalog.data || []) if (product.currency === 'USDT' && Number.isFinite(Number(product.price)) && Number(product.price) > 0) products[product.id] = { ...product, price: Number(product.price) };
    restoreDraft();
    if (!products[selectedPlan] && Object.keys(products).length) selectedPlan = Object.keys(products)[0];
    document.querySelectorAll('input[name=plan]').forEach(input => { input.disabled = !products[input.value]; $('price-' + input.value).textContent = products[input.value] ? formatAmount(products[input.value].price) : '—'; });
    $('telegram-field').hidden = !session;
    $('account-title').textContent = session ? session.user.email || 'Твой аккаунт ANDROMEDA' : 'Сначала — твой аккаунт';
    $('account-description').textContent = session ? 'Доступ активируем на этот аккаунт.' : 'Привяжем оплату к нему, чтобы доступ не потерялся.';
    $('continue-payment').querySelector('span').textContent = session ? 'Перейти к оплате' : 'Войти и продолжить';
    $('plan-footnote').textContent = session ? 'Разовая оплата. Автоматических списаний нет.' : 'Новый аккаунт можно создать бесплатно на странице входа.';
    if (session && !$('tg').value && profile?.tg_username) $('tg').value = normalizeTelegram(profile.tg_username) || '';
    ready = true; $('connection-note').hidden = true; updateSummary();
    if (pending.data && ['pending', 'rejected'].includes(pending.data.status)) showPayment(pending.data);
    else if (profile?.plan === 'lifetime') showActive();
    else {
      payment = null; if (!session) { currentStep = 1; maxStep = 1; $('tg').value = ''; $('tx').value = ''; }
      showStep(currentStep === 'result' ? 1 : currentStep, false);
      if (catalog.error || !Object.keys(products).length) throw new Error('catalog_unavailable');
      if (profile?.plan === 'monthly' && new Date(profile.plan_expires_at) > new Date()) message('pay-message', 'Месячный доступ уже активен. Новая оплата продлит его на 30 дней после текущего срока.', 'info');
    }
  } catch {
    if (!payment) ready = false; controls(); $('connection-note').hidden = false;
    $('connection-note').textContent = 'Не удалось загрузить актуальные данные. Не отправляй новый перевод, пока подключение не восстановится.';
    $('retry-connection').hidden = false;
  }
}
$('payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || busy || !$('payment-form').reportValidity()) return;
  if (!session) return login();
  const tx = $('tx').value.trim();
  if (!validTxHash(tx)) { message('pay-message', 'Хэш TON-транзакции: 64 символа в hex или 44 в base64. Можно оставить поле пустым, если перевод был с комментарием.'); $('tx').focus(); return; }
  if (!validateTelegram()) return;
  busy = true; controls(); $('submit-payment').querySelector('span').textContent = 'Сохраняем заявку…'; saveDraft();
  try {
    const auth = await sb.auth.getSession();
    if (auth.error || !auth.data.session) return login();
    session = auth.data.session;
    const response = await fetch('/api/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ type: 'payment_checkout', data: { plan: selectedPlan, amount: products[selectedPlan].price, tg_username: normalizeTelegram($('tg').value), tx_hash: tx || null, confirmed: $('paid-confirm').checked } })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) return login();
    if (!response.ok || !result.payment) {
      const errors = { price_changed: `Цена тарифа обновилась до ${formatAmount(result.price)} USDT. Если перевод уже отправлен, не оплачивай повторно — сохрани хэш и уточни платёж у администратора.`, plan_unavailable: 'Этот тариф сейчас недоступен. Обнови страницу. Если перевод отправлен, не оплачивай повторно.', transaction_already_used: 'Этот хэш уже указан в другой заявке. Проверь историю платежей в своём аккаунте.', invalid_payment: 'Проверь тариф, Telegram и данные перевода.' };
      throw new Error(errors[result.error] || 'Не удалось получить подтверждение сохранения. Повтори отправку заявки — новый перевод не нужен.');
    }
    showPayment(result.payment, result.notified, true);
    writeDraft(draftKey(), {});
  } catch (error) { message('pay-message', error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Соединение прервалось. Нажми отправку ещё раз: сохранённую заявку найдём автоматически. Повторно переводить деньги не нужно.' : error.message); }
  finally { busy = false; $('submit-payment').querySelector('span').textContent = 'Отправить на проверку'; controls(); }
});
$('refresh-status').addEventListener('click', async () => {
  if (!payment?.id || busy) return;
  const button = $('refresh-status'); button.disabled = true; button.textContent = 'Проверяем…';
  try {
    const { data, error } = await sb.from('payments').select('id,plan,amount_usdt,status,notes,tx_hash,created_at').eq('user_id', session.user.id).eq('id', payment.id).single();
    if (error) throw error;
    showPayment(data);
    if (data.status === 'pending') message('pay-message', 'Заявка всё ещё на проверке. Данные сохранены; повторная оплата не нужна.', 'info');
  } catch { message('pay-message', 'Не удалось обновить статус. Попробуй ещё раз — твоя заявка сохранена.'); }
  finally { button.disabled = false; button.textContent = 'Обновить статус'; }
});
$('new-payment').addEventListener('click', () => { payment = null; maxStep = 1; $('paid-confirm').checked = false; updateSummary(); showStep(1); });
$('retry-connection').addEventListener('click', init);
init();
