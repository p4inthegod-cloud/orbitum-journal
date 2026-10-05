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

// Keep the ribbon quiet offscreen and while the tab is hidden.
const carousel = document.querySelector('.system-gallery');
if (carousel) {
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

// Drag changes the phase of the running CSS animation, without pausing it.
const carouselViewport = document.querySelector('.carousel-viewport');
const carouselTrack = document.querySelector('.carousel-track');
if (carouselViewport && carouselTrack) {
  let drag = null;
  carouselViewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    const animation = carouselTrack.getAnimations().find(item => item.animationName === 'screen-orbit');
    const loopWidth = carouselTrack.querySelector('.carousel-group').getBoundingClientRect().width;
    const duration = animation?.effect?.getTiming().duration;
    if (!animation || !loopWidth || typeof duration !== 'number' || duration <= 0) return;
    drag = { id: event.pointerId, x: event.clientX, animation, loopWidth, duration };
    carouselViewport.setPointerCapture(event.pointerId);
    carouselViewport.classList.add('is-dragging');
    event.preventDefault();
  });
  carouselViewport.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = event.clientX - drag.x;
    const phase = Number(drag.animation.currentTime) - delta * drag.duration / drag.loopWidth;
    drag.animation.currentTime = ((phase % drag.duration) + drag.duration) % drag.duration;
    drag.x = event.clientX;
  });
  const finishDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    carouselViewport.classList.remove('is-dragging');
    if (carouselViewport.hasPointerCapture(event.pointerId)) carouselViewport.releasePointerCapture(event.pointerId);
  };
  carouselViewport.addEventListener('pointerup', finishDrag);
  carouselViewport.addEventListener('pointercancel', finishDrag);
  carouselViewport.addEventListener('lostpointercapture', finishDrag);
}

// A deliberate walkthrough: real screens stay still while the visitor chooses a step.
const caseTabs = [...document.querySelectorAll('.case-tab')];
const casePanels = [...document.querySelectorAll('.case-panel')];
if (caseTabs.length && casePanels.length) {
  const selectStage = selected => {
    caseTabs.forEach(tab => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    casePanels.forEach(panel => {
      panel.hidden = panel.id !== selected.getAttribute('aria-controls');
    });
  };
  caseTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStage(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % caseTabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + caseTabs.length) % caseTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = caseTabs.length - 1;
      else return;
      event.preventDefault();
      selectStage(caseTabs[next]);
      caseTabs[next].focus();
    });
  });
} else if (casePanels.length) {
  casePanels.forEach(panel => { panel.hidden = false; });
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
