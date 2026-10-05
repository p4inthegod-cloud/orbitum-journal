export const SB_URL = 'https://kgutmsosfyyxnlnhucaa.supabase.co';
export const SB_KEY = 'sb_publishable_Jzzgsd9kwaXDEPb8OSVm3Q_TXsDe4q6';
export const WALLET = 'UQBvLtwoGw4fhWM7ZipdzYhh6pNtVZJywxcfAAeeAlu_2rsA';
export const PLAN_NAMES = { monthly: 'На месяц', lifetime: 'Навсегда' };

// Accept only local app paths. Reject protocol-relative URLs, encoded separators,
// control characters and auth loops before carrying a destination into email links.
export function safeReturnTo(value, origin = 'https://orbitum.trade') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/journal';
  try {
    const decoded = decodeURIComponent(value);
    if (/^[\/]{2}|[\\\u0000-\u0020]/.test(decoded)) return '/journal';
    const url = new URL(value, origin);
    if (url.origin !== origin || /^\/login(?:\.html)?\/?$/i.test(decodeURIComponent(url.pathname))) return '/journal';
    return url.pathname + url.search + url.hash;
  } catch { return '/journal'; }
}

export function normalizeTelegram(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^@?([a-zA-Z][a-zA-Z0-9_]{4,31})$/) || raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/i);
  return match ? '@' + match[1] : null;
}
export function validTxHash(value) {
  return !value || /^[a-f0-9]{64}$/i.test(value) || /^[a-zA-Z0-9+/_-]{43}=?$/.test(value);
}
export function formatAmount(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(Number(value));
}
export function authError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error || '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Email или пароль не подошли. Проверь их или войди по ссылке из письма.';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'Сначала подтверди email по ссылке из письма. Можно также запросить ссылку для входа.';
  if (code.includes('rate_limit') || error?.status === 429 || msg.includes('rate limit') || msg.includes('after 60 seconds')) return 'Слишком много попыток. Подожди минуту и попробуй ещё раз.';
  if (code === 'user_already_exists' || msg.includes('already registered')) return 'Этот email уже используется. Войди или восстанови пароль.';
  if (msg.includes('signups not allowed for otp')) return 'Для входа по ссылке сначала создай аккаунт с этим email.';
  if (code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid token')) return 'Ссылка истекла или уже использована. Запроси новое письмо.';
  if (code === 'weak_password' || msg.includes('password should')) return 'Пароль слишком простой. Используй не менее 8 символов, буквы и цифры.';
  if (msg.includes('same password')) return 'Новый пароль должен отличаться от предыдущего.';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || error?.name === 'AbortError') return 'Не удалось подключиться. Проверь интернет и попробуй ещё раз.';
  if (msg.includes('email') && msg.includes('invalid')) return 'Проверь email — адрес должен быть в формате name@example.com.';
  return 'Не удалось выполнить запрос. Попробуй ещё раз немного позже.';
}

let client;
export async function getClient() {
  if (client) return client;
  if (!window.supabase?.createClient) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('Connection timeout')); }, 10000);
      script.src = '/js/vendor/supabase-2.117.2.js';
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Network error')); };
      document.head.append(script);
    });
  }
  client = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(15000) }) }
  });
  return client;
}
export function message(id, text, kind = 'error') {
  const element = document.getElementById(id);
  element.textContent = text;
  element.dataset.kind = kind;
  element.hidden = !text;
}
export function readDraft(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; }
}
export function writeDraft(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: continue without a draft */ }
}
