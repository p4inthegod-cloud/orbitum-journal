const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
function closeMenu() {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  mobileNav.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
mobileNav.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
document.getElementById('year').textContent = String(new Date().getFullYear());

// Keep the ribbon quiet offscreen; its pause control also works on touch.
const carousel = document.querySelector('.system-gallery');
const carouselToggle = document.querySelector('.carousel-toggle');
if (carousel && carouselToggle) {
  carouselToggle.addEventListener('click', () => {
    const paused = carousel.dataset.paused !== 'true';
    carousel.dataset.paused = String(paused);
    carouselToggle.setAttribute('aria-pressed', String(paused));
    carouselToggle.setAttribute('aria-label', paused ? 'Продолжить прокрутку скриншотов' : 'Приостановить прокрутку скриншотов');
    carouselToggle.querySelector('.motion-label').textContent = paused ? 'Продолжить' : 'Приостановить';
    carouselToggle.querySelector('.motion-symbol').textContent = paused ? '▷' : 'Ⅱ';
  });
  const syncVisibility = () => carousel.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
  if ('IntersectionObserver' in window) {
    const bounds = carousel.getBoundingClientRect();
    carousel.classList.toggle('is-offscreen', bounds.bottom <= 0 || bounds.top >= window.innerHeight);
    new IntersectionObserver(entries => {
      carousel.classList.toggle('is-offscreen', !entries[0].isIntersecting);
    }).observe(carousel);
  }
}

// One-time, transform/opacity-only reveals; content stays visible without JS.
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: '0px 0px 30px 0px' });
  document.querySelectorAll('.intro, .section-heading, .tool-card, .workflow, .entry').forEach(node => {
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    node.classList.add('reveal-ready');
    observer.observe(node);
  });
}
