(() => {
  'use strict';

  const path = window.location.pathname;
  document.documentElement.lang = 'ru';

  try {
    localStorage.setItem('orb_lang', 'ru');
    localStorage.setItem('orb_admin_lang', 'ru');
  } catch (_) {}

  const titles = {
    '/login': 'ORBITUM — Вход',
    '/login.html': 'ORBITUM — Вход',
    '/pay': 'ORBITUM — Программа',
    '/pay.html': 'ORBITUM — Программа',
    '/cabinet': 'ORBITUM — Кабинет',
    '/cabinet.html': 'ORBITUM — Кабинет',
    '/admin': 'ORBITUM — Управление',
    '/admin.html': 'ORBITUM — Управление',
    '/trade-analyzer': 'ORBITUM — Анализ сделки',
    '/trade-analyzer.html': 'ORBITUM — Анализ сделки',
    '/screener': 'ORBITUM — Скринер сигналов',
    '/screener.html': 'ORBITUM — Скринер сигналов',
    '/profile': 'ORBITUM — Профиль трейдера',
    '/profile.html': 'ORBITUM — Профиль трейдера',
    '/journal': 'ORBITUM — Журнал сделок',
    '/journal.html': 'ORBITUM — Журнал сделок'
  };
  if (titles[path]) document.title = titles[path];

  const exact = new Map(Object.entries({
    'Sign In': 'Войти',
    'SIGN IN': 'Войти',
    'Sign Up': 'Регистрация',
    'SIGN UP': 'Регистрация',
    'Create account': 'Создать аккаунт',
    'Create Account': 'Создать аккаунт',
    'Continue with magic link': 'Войти по ссылке из письма',
    'Send magic link': 'Отправить ссылку для входа',
    'Back to sign in': 'Назад ко входу',
    'Back to site': 'На главную',
    'By signing up you agree to our terms of service.': 'Регистрируясь, вы принимаете условия использования.',
    'Sign in to continue to your journal': 'Войдите, чтобы открыть журнал сделок',
    'Password': 'Пароль',
    'Min 8 characters': 'Минимум 8 символов',
    'or': 'или',
    'Overview': 'Обзор',
    'Courses': 'Материалы',
    'Learn': 'Обучение',
    'AI Tools': 'ИИ-инструменты',
    'Tools': 'Инструменты',
    'Journal': 'Журнал',
    'Screener': 'Скринер',
    'Analyzer': 'Анализ сделки',
    'Settings': 'Настройки',
    'Sign Out': 'Выйти',
    'View Courses': 'Открыть материалы',
    'Profile': 'Профиль',
    'Plans': 'Программа',
    'Monthly': 'Ежемесячно',
    'Annual': 'На год',
    'Lifetime': 'Навсегда',
    'Free': 'Бесплатно',
    'Buy your execution edge.': 'Система, которая помогает исполнять план.',
    'Submit Request': 'Отправить заявку',
    'Cancel': 'Отмена',
    'Close': 'Закрыть',
    'Save': 'Сохранить',
    'Remove': 'Удалить',
    'Delete': 'Удалить',
    'Confirm': 'Подтвердить',
    'Search': 'Поиск',
    'All': 'Все',
    'Users': 'Пользователи',
    'Payments': 'Платежи',
    'Analytics': 'Аналитика',
    'Products': 'Продукты',
    'Education': 'Обучение',
    'Content': 'Контент',
    'Media & Images': 'Медиа и изображения',
    'Main Site': 'Главная страница',
    'Go to Journal': 'Открыть журнал',
    'Refresh': 'Обновить',
    'View All': 'Показать всё',
    'Save as Draft': 'Сохранить черновик',
    'Save Lesson': 'Сохранить урок',
    'Copy Markdown': 'Скопировать Markdown',
    'Insert into Content': 'Вставить в материал',
    'Add Section': 'Добавить раздел',
    'Mark as Complete': 'Отметить выполненным',
    'Completed': 'Выполнено',
    'ANALYZE TRADE': 'Проверить сделку',
    'Analyze Trade': 'Проверить сделку',
    'LONG': 'Лонг',
    'SHORT': 'Шорт',
    'Simulate': 'Смоделировать',
    'Entry': 'Вход',
    'Stop Loss': 'Стоп-лосс',
    'Take Profit': 'Тейк-профит',
    'Risk / Reward': 'Риск / прибыль',
    'Position Size': 'Размер позиции',
    'Leverage': 'Плечо',
    'Signal Screener': 'Скринер сигналов',
    'Breakout': 'Пробой',
    'Reversal': 'Разворот',
    'Vol Surge': 'Всплеск объёма',
    'Watch': 'Наблюдение',
    'UNLOCK PREMIUM': 'Открыть полный доступ'
  }));

  const partial = [
    [/Signing in\.\.\./gi, 'Входим…'],
    [/Creating account\.\.\./gi, 'Создаём аккаунт…'],
    [/Loading\.\.\./gi, 'Загрузка…'],
    [/Back to /gi, 'Назад: '],
    [/View All/gi, 'Показать всё'],
    [/Refresh All Data/gi, 'Обновить все данные'],
    [/Send Broadcast/gi, 'Отправить рассылку'],
    [/Export Users CSV/gi, 'Экспорт пользователей CSV'],
    [/Seed Default Products/gi, 'Создать базовые продукты'],
    [/Add Section/gi, 'Добавить раздел'],
    [/Get ([A-Za-z]+)/gi, 'Выбрать $1']
  ];

  function translateValue(value) {
    const normalized = value.trim();
    if (!normalized) return value;
    if (exact.has(normalized)) return value.replace(normalized, exact.get(normalized));
    let next = value;
    partial.forEach(([pattern, replacement]) => { next = next.replace(pattern, replacement); });
    return next;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(parent.tagName)) return;
      node.nodeValue = translateValue(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    ['placeholder', 'title', 'aria-label'].forEach((attr) => {
      if (node.hasAttribute?.(attr)) node.setAttribute(attr, translateValue(node.getAttribute(attr)));
    });
  }

  function translateTree(root = document.body) {
    if (!root) return;
    translateNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateNode(walker.currentNode);
  }

  function addContextCard() {
    if (document.querySelector('.orb-context') || path === '/' || path.endsWith('/index.html')) return;
    const configs = [
      { match: /login/, emoji: '🔐', title: 'Безопасный вход', text: 'После входа вы сразу попадёте в журнал сделок.' },
      { match: /pay/, emoji: '🧩', title: 'Выберите нужный набор инструментов', text: 'Начните с базового доступа и расширяйте его по мере необходимости.' },
      { match: /trade-analyzer/, emoji: '🧠', title: 'Проверка до входа', text: 'Заполните уровни — Orbitum покажет риск, потенциал и слабые места идеи.' },
      { match: /screener/, emoji: '📡', title: 'Рынок в одном экране', text: 'Отфильтруйте шум и откройте только подходящие вашей системе сигналы.' },
      { match: /cabinet/, emoji: '🗂️', title: 'Ваш рабочий центр', text: 'Материалы, инструменты и прогресс собраны в одном месте.' }
    ];
    const cfg = configs.find((item) => item.match.test(path));
    if (!cfg) return;
    const anchor = document.querySelector('.hero, .card, main, .page');
    if (!anchor) return;
    const card = document.createElement('div');
    card.className = 'orb-context';
    card.innerHTML = `<span class="orb-context__emoji" aria-hidden="true">${cfg.emoji}</span><span><strong>${cfg.title}</strong>${cfg.text}</span>`;
    if (anchor.matches('.card')) anchor.prepend(card);
    else anchor.insertBefore(card, anchor.firstChild);
  }

  function initHome() {
    if (!document.body.classList.contains('orbitum-home')) return;
    const burger = document.querySelector('[data-menu-button]');
    const nav = document.querySelector('[data-mobile-nav]');
    burger?.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => nav.classList.remove('is-open')));
    document.querySelectorAll('.faq-button').forEach((button) => button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      const open = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(open));
    }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    translateTree();
    addContextCard();
    initHome();

    const observer = new MutationObserver((mutations) => {
      observer.disconnect();
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => translateTree(node)));
      observer.observe(document.body, { childList: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
