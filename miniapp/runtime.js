(function () {
  'use strict';

  var view = document.getElementById('view');
  var toast = document.getElementById('toast');
  var tg = window.Telegram && window.Telegram.WebApp;
  var state = { route: 'home', me: null, plans: null, archive: null };
  var initData = tg && tg.initData ? tg.initData : '';
  var headers = initData ? { 'X-Telegram-Init-Data': initData } : {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[c];
    });
  }

  function icon(name) {
    var paths = {
      home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      crown:'<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5z"/>',
      archive:'<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
      user:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21c.6-4 3.1-6 7.5-6s6.9 2 7.5 6"/>',
      menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
      medical:'<path d="M12 3v6M9 6h6M6 11c0 6 6 10 6 10s6-4 6-10"/>',
      info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.1"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.5a7 7 0 0 0-.8-1.9l1.1-1.7-2.1-2.1-1.7 1.1A7 7 0 0 0 11.5 5L11 3H8l-.5 2a7 7 0 0 0-1.9.8L4 4.7 1.9 6.8 3 8.5a7 7 0 0 0-.8 1.9L0 11v3l2.2.5a7 7 0 0 0 .8 1.9l-1.1 1.7L4 20.2l1.7-1.1a7 7 0 0 0 1.9.8l.5 2h3l.5-2a7 7 0 0 0 1.9-.8l1.7 1.1 2.1-2.1-1.1-1.7a7 7 0 0 0 .8-1.9z"/>
    };
    return '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.info) + '</svg></span>';
  }

  function api(path) {
    return fetch(path, { headers: headers, cache: 'no-store' }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل البيانات');
        return data;
      });
    });
  }

  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
  }

  function openUrl(url) {
    if (!url) return;
    if (tg && tg.openTelegramLink && url.indexOf('https://t.me/') === 0) tg.openTelegramLink(url);
    else if (tg && tg.openLink) tg.openLink(url);
    else window.location.href = url;
  }

  function routeFromTelegram() {
    var params = new URLSearchParams(window.location.search || '');
    var route = params.get('route');
    if (!route && tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) route = tg.initDataUnsafe.start_param;
    var allowed = ['home','plans','archive','account','menu','settings','about','subscription'];
    if (allowed.indexOf(route) !== -1) state.route = route === 'subscription' ? 'plans' : route;
  }

  function go(route) {
    state.route = route;
    render();
    if (route === 'archive' && state.archive === null) loadArchive();
  }

  function nav() {
    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.onclick = function () { go(button.getAttribute('data-route')); };
      button.classList.toggle('active', button.getAttribute('data-route') === state.route);
    });
  }

  function bind() {
    document.querySelectorAll('[data-go]').forEach(function (button) {
      button.onclick = function () { go(button.getAttribute('data-go')); };
    });
    document.querySelectorAll('[data-url]').forEach(function (button) {
      button.onclick = function () { openUrl(button.getAttribute('data-url')); };
    });
    document.querySelectorAll('[data-plan]').forEach(function (button) {
      button.onclick = function () {
        var url = state.me && state.me.links && state.me.links.bot && state.me.links.bot.plans;
        if (url) openUrl(url);
        else notify('افتح QMRMed Bot لإكمال الاشتراك.');
      };
    });
    document.querySelectorAll('[data-archive-id]').forEach(function (button) {
      button.onclick = function () { loadArchiveDetail(button.getAttribute('data-archive-id')); };
    });
    var back = document.querySelector('[data-action="back"]');
    if (back) back.onclick = function () { if (state.route !== 'home') go('home'); else if (tg && tg.close) tg.close(); };
    var more = document.querySelector('[data-action="menu"]');
    if (more) more.onclick = function () { go('menu'); };
    var brand = document.querySelector('.brand');
    if (brand) brand.onclick = function () { go('home'); };
  }

  function home() {
    var m = state.me || { firstName:'بك', plan:'FREE', archiveCount:0, progress:{completed:0,attempts:0,accuracy:0} };
    var p = m.progress || {};
    view.innerHTML = '<section class="hero"><div class="profile"><div class="avatar">Q</div><div><h1>مرحباً ' + esc(m.firstName || 'بك') + ' 👋</h1><p>' + esc(m.department || 'طلاب المجموعة الطبية') + ' · ' + esc(m.stage ? 'المرحلة ' + m.stage : 'اختر مرحلتك') + '</p><div class="plan-pill">' + icon('crown') + ' ' + esc(m.plan || 'FREE') + '</div></div></div><div class="stats"><div class="stat"><strong>' + (p.completed || 0) + '</strong><span>دروس مكتملة</span></div><div class="stat"><strong>' + (p.attempts || 0) + '</strong><span>محاولات</span></div><div class="stat"><strong>' + (p.accuracy || 0) + '%</strong><span>الدقة</span></div></div></section><div class="section-title"><h2>QMRMed</h2><span>مساحتك التعليمية</span></div><div class="grid"><div class="card clickable" data-go="archive">' + icon('archive') + '<h3>أرشيفي</h3><p>' + (m.archiveCount || 0) + ' نتيجة محفوظة</p></div><div class="card clickable" data-go="account">' + icon('user') + '<h3>حسابي</h3><p>الملف والخطة والتقدم</p></div><div class="card clickable" data-go="plans">' + icon('crown') + '<h3>الاشتراك</h3><p>الخطة الحالية: ' + esc(m.plan || 'FREE') + '</p></div><div class="card clickable" data-go="about">' + icon('medical') + '<h3>عن QMRMed</h3><p>الهدف والميزات وطريقة العمل</p></div></div><section class="progress-card"><div class="progress-top"><strong>تقدمك الحالي</strong><span>' + (p.accuracy || 0) + '%</span></div><div class="progress-track"><div class="progress-fill" style="width:' + Math.min(100, Number(p.accuracy || 0)) + '%"></div></div><button class="button secondary" data-go="account">عرض تفاصيل التقدم</button></section><button class="button blue" data-url="https://t.me/QMRMed">فتح QMRMed</button>';
  }

  function plans() {
    var plans = state.plans || [
      {code:'FREE',name:'Free',subtitle:'البداية الأساسية مع تجربة QMRMed.',features:['تجربة المنصة التعليمية','الوصول إلى المحتوى المجاني','الحساب والأرشيف الشخصي'],current:false},
      {code:'PLUS',name:'PLUS',subtitle:'كل مزايا Free مع حدود وميزات موسعة.',features:['حدود AI أعلى','ميزات تعليمية موسعة','أرشيف موسع'],current:false},
      {code:'PRO',name:'PRO',subtitle:'كل مزايا PLUS مع أعلى مستوى من المنصة.',features:['أولوية أعلى للذكاء الاصطناعي','ميزات متقدمة','أعلى حدود للاستخدام والأرشيف'],current:false}
    ];
    view.innerHTML = '<div class="section-label">خطط الاشتراك</div>' + plans.map(function (p) {
      var current = p.current || (state.me && state.me.plan === p.code);
      return '<section class="plan ' + (p.code === 'PLUS' ? 'featured ' : '') + (p.code === 'PRO' ? 'ultra ' : '') + (current ? 'current' : '') + '">' + (current ? '<div class="current-badge">الخطة الحالية</div>' : '') + '<div class="plan-head"><div class="plan-icon">' + icon(p.code === 'FREE' ? 'medical' : 'crown') + '</div><div><h2>' + esc(p.name) + '</h2></div></div><div class="sub">' + esc(p.subtitle || '') + '</div><ul>' + (p.features || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><div class="price-line"><span>الاشتراك يتم من البوت</span><strong>' + (p.code === 'FREE' ? 'مجاني' : esc(p.code)) + '</strong></div><button class="button" data-plan="' + esc(p.code) + '" ' + (current ? 'disabled' : '') + '>' + (current ? 'الخطة الحالية' : 'اختيار ' + esc(p.name)) + '</button></section>';
    }).join('') + '<div class="notice">' + icon('info') + ' الدفع وتفعيل الاشتراك يتمان بأمان من داخل QMRMed Bot.</div>';
  }

  function account() {
    var m = state.me || {firstName:'QMRMed User',plan:'FREE'}, p = m.progress || {}, s = m.subscription || {};
    view.innerHTML = '<div class="section-label">حسابي</div><section class="hero"><div class="profile"><div class="avatar">Q</div><div><h1>' + esc([m.firstName,m.lastName].filter(Boolean).join(' ') || 'QMRMed User') + '</h1><p>' + esc(m.username ? '@' + m.username : 'Telegram user') + '</p><div class="plan-pill">' + icon('crown') + ' ' + esc(m.plan || 'FREE') + '</div></div></div></section><div class="list"><div class="row"><span>القسم</span><strong>' + esc(m.department || 'غير محدد') + '</strong></div><div class="row"><span>المرحلة</span><strong>' + esc(m.stage || 'غير محددة') + '</strong></div><div class="row"><span>حالة الاشتراك</span><strong>' + esc(s.label || 'مجاني') + '</strong></div><div class="row"><span>المتبقي</span><strong>' + (s.daysRemaining || 0) + ' يوم</strong></div><div class="row"><span>الدروس المكتملة</span><strong>' + (p.completed || 0) + '</strong></div><div class="row"><span>المحاولات</span><strong>' + (p.attempts || 0) + '</strong></div><div class="row"><span>الدقة</span><strong>' + (p.accuracy || 0) + '%</strong></div></div>';
  }

  function archive() {
    if (state.archive === null) {
      view.innerHTML = '<div class="section-label">الأرشيف</div><div class="empty"><div class="spinner"></div><br>جارٍ تحميل الأرشيف…</div>';
      return;
    }
    var items = Array.isArray(state.archive) ? state.archive : [];
    view.innerHTML = '<div class="section-label">الأرشيف</div>' + (items.length ? items.map(function (item) { return '<div class="card clickable" data-archive-id="' + esc(item.id) + '"><h3>' + esc(item.sourceName || 'ملف') + '</h3><p>' + esc(item.operationLabel || item.operation || 'نتيجة AI') + ' · ' + esc(item.createdAt || '') + '</p></div>'; }).join('') : '<div class="empty">' + icon('archive') + '<br>لا توجد نتائج محفوظة حتى الآن.</div>');
  }

  function menu() {
    view.innerHTML = '<div class="section-label">المزيد</div><div class="list"><div class="row" data-go="about">' + icon('medical') + '<span>عن QMRMed</span></div><div class="row" data-go="settings">' + icon('settings') + '<span>الإعدادات</span></div><div class="row" data-url="https://t.me/QMRMed">' + icon('home') + '<span>القناة الرئيسية</span></div><div class="row" data-url="https://t.me/QMR7S">' + icon('info') + '<span>الأخبار</span></div><div class="row" data-url="https://t.me/QMR7S1">' + icon('info') + '<span>الدعم</span></div><div class="row" data-url="https://t.me/ID29i">' + icon('user') + '<span>المطور</span></div><div class="row" data-url="https://instagram.com/qmr7s">' + icon('info') + '<span>Instagram</span></div></div>';
  }

  function settings() {
    view.innerHTML = '<div class="section-label">الإعدادات</div><div class="list"><div class="row"><span>المظهر</span><strong>داكن</strong></div><div class="row"><span>اللغة</span><strong>العربية</strong></div><div class="row"><span>الإشعارات</span><strong>مفعلة</strong></div></div>';
  }

  function about() {
    view.innerHTML = '<div class="section-label">عن QMRMed</div><section class="hero"><div class="profile"><div class="avatar">' + icon('medical') + '</div><div><h1>QMRMed</h1><p>For a Smarter Medical Future</p></div></div></section><div class="card"><h3>الهدف</h3><p>منصة تعليمية ذكية لطلاب المجموعة الطبية، تجمع الدراسة والأسئلة والاختبارات والذكاء الاصطناعي في تجربة واحدة.</p></div><div class="card"><h3>المزايا</h3><p>مساعد دراسة بالذكاء الاصطناعي، بنك أسئلة، أسئلة وزارية، حالات سريرية، نتائج وتقدم شخصي، وأرشيف للملفات.</p></div>';
  }

  function render() {
    nav();
    if (state.route === 'home') home();
    else if (state.route === 'plans') plans();
    else if (state.route === 'account') account();
    else if (state.route === 'menu') menu();
    else if (state.route === 'settings') settings();
    else if (state.route === 'about') about();
    else if (state.route === 'archive') archive();
    else home();
    bind();
  }

  function loadUser() {
    api('/api/me').then(function (data) {
      state.me = data;
      render();
    }).catch(function (error) {
      notify(error.message || 'بيانات Telegram غير متاحة');
    });
    api('/api/plans').then(function (data) {
      state.plans = data;
      if (state.route === 'plans') render();
    }).catch(function () {});
  }

  function loadArchive() {
    api('/api/archive').then(function (data) {
      state.archive = data;
      render();
    }).catch(function (error) {
      state.archive = [];
      render();
      notify(error.message || 'تعذر تحميل الأرشيف');
    });
  }

  function loadArchiveDetail(id) {
    api('/api/archive/' + encodeURIComponent(id)).then(function (data) {
      view.innerHTML = '<div class="section-label">نتيجة الأرشيف</div><section class="article"><h3>' + esc(data.sourceName || 'نتيجة') + '</h3><p>' + esc(data.operationLabel || data.operation || '') + '</p><hr><div>' + esc(data.result || 'لا توجد نتيجة') + '</div></section><button class="button secondary" data-go="archive">العودة إلى الأرشيف</button>';
      bind();
    }).catch(function (error) { notify(error.message || 'تعذر فتح النتيجة'); });
  }

  routeFromTelegram();
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#05070b');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#05070b');
  }
  window.__QMRMED_RUNTIME_READY__ = true;
  render();
  loadUser();
  if (state.route === 'archive') loadArchive();
}());
