import { getClient, safeReturnTo, authError, message } from './andromeda-access-core.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const destination = safeReturnTo(params.get('returnTo'), location.origin);
let recovery = params.get('mode') === 'recovery' || hash.get('type') === 'recovery';
let callbackError = hash.get('error_description') || params.get('error_description');
let sb, busy = false, ready = false, activeView = 'login', sentRequest, cooldownUntil = 0, cooldownTimer;
const views = {
  login: ['С возвращением.', 'Твоя система уже ждёт. Продолжим?'],
  register: ['Твой путь начинается здесь.', 'Создай аккаунт и сохрани свой торговый процесс.'],
  magic: ['Вход без пароля.', 'Одна ссылка на email — и ты в системе.'],
  forgot: ['Вернём тебе доступ.', 'Укажи email, который использовал(а) при регистрации.'],
  reset: ['Новый пароль. Новый старт.', 'Задай пароль, с которым войдёшь в систему.'],
  sent: ['Проверь свою почту.', 'Остался один шаг — открыть письмо.']
};
function changeView(view, focus = true) {
  if (!views[view] || busy) return;
  const previousEmail = document.querySelector('.auth-panel:not([hidden]) input[type=email]')?.value || '';
  activeView = view;
  document.querySelector('.auth-tabs').hidden = !['login', 'register'].includes(view);
  document.querySelectorAll('.auth-panel').forEach(panel => panel.hidden = panel.id !== 'panel-' + view);
  document.querySelectorAll('[role=tab]').forEach(tab => {
    const selected = tab.dataset.view === (view === 'register' ? 'register' : 'login');
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
  });
  $('form-title').textContent = views[view][0]; $('form-intro').textContent = views[view][1];
  message('auth-message', '');
  const input = $('panel-' + view).querySelector('input');
  const email = $('panel-' + view).querySelector('input[type=email]');
  if (email && previousEmail && !email.value) email.value = previousEmail;
  if (focus) input?.focus();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => changeView(button.dataset.view)));
document.querySelector('.auth-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
  event.preventDefault();
  const view = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : activeView === 'register' ? 'login' : 'register';
  changeView(view, false); $('tab-' + view).focus();
});
document.querySelectorAll('[data-password]').forEach(button => button.addEventListener('click', () => {
  const input = $(button.dataset.password), show = input.type === 'password';
  input.type = show ? 'text' : 'password'; button.textContent = show ? 'Скрыть' : 'Показать';
  button.setAttribute('aria-pressed', String(show)); button.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
}));
document.querySelectorAll('input[autocomplete$=password]').forEach(input => {
  ['keydown', 'keyup'].forEach(type => input.addEventListener(type, event => {
    const warning = input.closest('.field')?.querySelector('.caps-warning');
    if (warning) warning.hidden = !event.getModifierState?.('CapsLock');
  }));
});
$('confirm-pass').addEventListener('input', () => $('confirm-pass').setCustomValidity(''));
$('return-context').hidden = !destination.startsWith('/pay');
if (recovery) changeView('reset', false);
else if (params.get('tab') === 'register') changeView('register', false);

function controls() {
  document.querySelectorAll('form button[type=submit]').forEach(button => button.disabled = !ready || busy);
  document.querySelectorAll('[data-view]').forEach(button => button.disabled = busy);
  $('access').setAttribute('aria-busy', String(busy || !ready));
}
function callbackUrl(reset = false) {
  const url = new URL('/login', location.origin);
  url.searchParams.set('returnTo', destination);
  if (reset) url.searchParams.set('mode', 'recovery');
  return url.href;
}
function tickCooldown() {
  const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  $('resend-email').disabled = !ready || busy || seconds > 0;
  $('resend-email').textContent = seconds ? `Повторить через ${seconds} сек.` : 'Отправить ещё раз';
  if (!seconds) clearInterval(cooldownTimer);
}
function showSent(type, email) {
  sentRequest = { type, email }; busy = false; changeView('sent');
  $('sent-description').textContent = type === 'forgot'
    ? `Если аккаунт ${email} существует, мы отправили ссылку для восстановления пароля.`
    : type === 'register' ? `Открой письмо на ${email} и подтверди адрес, чтобы войти.`
    : `Ссылка для входа отправлена на ${email}.`;
  cooldownUntil = Date.now() + 60000; clearInterval(cooldownTimer); tickCooldown(); cooldownTimer = setInterval(tickCooldown, 1000);
}
async function sendEmail(type, email, resend = false) {
  let result;
  if (type === 'forgot') result = await sb.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(true) });
  else if (type === 'register' && resend) result = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl() } });
  else result = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callbackUrl() } });
  if (result.error) throw result.error;
  showSent(type, email);
}
async function run(button, action, label) {
  if (!ready || busy) return;
  busy = true; controls(); message('auth-message', '');
  const original = button.innerHTML; button.textContent = label;
  try { await action(); } catch (error) { message('auth-message', authError(error)); }
  finally { busy = false; button.innerHTML = original; controls(); tickCooldown(); }
}
document.querySelectorAll('form.auth-panel').forEach(form => form.addEventListener('submit', event => {
  event.preventDefault();
  const emailInput = form.querySelector('input[type=email]');
  if (emailInput) emailInput.value = emailInput.value.trim();
  if (!form.reportValidity()) return;
  const type = form.id.replace('panel-', '');
  run(form.querySelector('button[type=submit]'), async () => {
    const email = emailInput?.value;
    if (type === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password: $('login-pass').value });
      if (error) throw error;
      location.replace(destination);
    } else if (type === 'register') {
      const name = $('reg-name').value.trim();
      if (!name) { $('reg-name').focus(); throw new Error('Invalid name'); }
      const username = 'trader_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
      const { data, error } = await sb.auth.signUp({ email, password: $('reg-pass').value, options: {
        data: { full_name: name, username }, emailRedirectTo: callbackUrl()
      } });
      if (error) throw error;
      // The database's handle_new_user trigger owns profile creation.
      // There is no email column on profiles and no client INSERT policy.
      if (data.session) location.replace(destination);
      else showSent('register', email);
    } else if (type === 'reset') {
      if ($('new-pass').value !== $('confirm-pass').value) {
        $('confirm-pass').setCustomValidity('Пароли должны совпадать.'); $('confirm-pass').reportValidity(); return;
      }
      const { error } = await sb.auth.updateUser({ password: $('new-pass').value });
      if (error) throw error;
      recovery = false; location.replace(destination);
    } else {
      if (cooldownUntil > Date.now()) { message('auth-message', 'Подожди минуту перед следующим письмом.', 'info'); return; }
      await sendEmail(type, email);
    }
  }, type === 'login' ? 'Входим…' : type === 'register' ? 'Создаём аккаунт…' : type === 'reset' ? 'Сохраняем…' : 'Отправляем письмо…');
}));
$('resend-email').addEventListener('click', () => {
  if (!sentRequest || cooldownUntil > Date.now()) return;
  run($('resend-email'), () => sendEmail(sentRequest.type, sentRequest.email, true), 'Отправляем…');
});
async function init() {
  ready = false; controls(); $('retry-connection').hidden = true; $('connection-note').hidden = false;
  try {
    sb = await getClient();
    sb.auth.onAuthStateChange((event, session) => {
      // Do not await another auth call inside this callback: Auth holds its lock.
      if (event === 'PASSWORD_RECOVERY') { recovery = true; changeView('reset', false); }
      if (event === 'SIGNED_IN' && session && !recovery && !busy && !callbackError) location.replace(destination);
    });
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    ready = true; $('connection-note').hidden = true; controls();
    if (callbackError) {
      recovery = false; changeView('forgot', false); message('auth-message', 'Ссылка истекла или уже использована. Запроси новое письмо.');
      history.replaceState(null, '', '/login?returnTo=' + encodeURIComponent(destination)); callbackError = null;
    } else if (recovery && !data.session) {
      recovery = false; changeView('forgot', false); message('auth-message', 'Открой ссылку из письма для восстановления пароля. Если она истекла, запроси новую.');
    } else if (data.session && !recovery) location.replace(destination);
  } catch (error) {
    $('connection-note').textContent = 'Вход пока недоступен. Проверь соединение и попробуй снова.';
    $('retry-connection').hidden = false; message('auth-message', authError(error));
  }
}
$('retry-connection').addEventListener('click', init);
init();
