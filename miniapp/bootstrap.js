(() => {
  const tg = window.Telegram?.WebApp;
  const allowed = new Set(['home', 'plans', 'archive', 'account', 'menu', 'settings', 'about', 'subscription']);
  const params = new URLSearchParams(location.search);
  const candidate = params.get('route') || tg?.initDataUnsafe?.start_param || 'home';
  const route = allowed.has(candidate) ? candidate : 'home';
  window.__QMRMED_DEEP_ROUTE__ = route;

  const target = route === 'subscription' ? 'plans' : route;
  const activateRoute = () => {
    if (target === 'home') return true;
    const button = document.querySelector(`.nav-item[data-route="${target}"]`);
    if (!button) return false;
    button.click();
    return true;
  };

  // app.js owns the actual rendering. Initialize it explicitly because the
  // standalone Mini App is also opened directly by its public URL.
  if (typeof window.render === 'function') window.render();

  if (!activateRoute()) {
    const observer = new MutationObserver(() => { if (activateRoute()) observer.disconnect(); });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  }

  const initData = tg?.initData || '';
  const headers = initData ? { 'X-Telegram-Init-Data': initData } : {};

  document.addEventListener('click', async (event) => {
    const targetElement = event.target instanceof Element ? event.target.closest('[data-plan]') : null;
    if (!targetElement || targetElement.hasAttribute('disabled')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const response = await fetch('/api/me', { headers, cache: 'no-store' });
      const data = await response.json();
      const link = data?.links?.bot?.plans;
      if (link && tg?.openTelegramLink) return tg.openTelegramLink(link);
      if (link && tg?.openLink) return tg.openLink(link);
      tg?.showAlert?.('افتح QMRMed Bot لإكمال أو تجديد الاشتراك.');
    } catch {
      tg?.showAlert?.('تعذر فتح مسار الاشتراك حاليًا. افتح QMRMed Bot وحاول مرة أخرى.');
    }
  }, true);
})();
