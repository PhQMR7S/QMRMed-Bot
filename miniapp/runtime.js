(() => {
  'use strict';
  const tg = window.Telegram?.WebApp;
  const view = document.getElementById('view');
  const toast = document.getElementById('toast');
  const state = { route: 'home', me: null, plans: null, archive: null };
  const initData = tg?.initData || '';
  const headers = initData ? { 'X-Telegram-Init-Data': initData } : {};

  const icons = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    crown:'<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5z"/>',
    archive:'<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
    user:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21c.6-4 3.1-6 7.5-6s6.9 2 7.5 6"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    medical:'<path d="M12 3v6M9 6h6M6 11c0 6 6 10 6 10s6-4 6-10"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.1"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6v-2.6h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.6v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.6h-.2a1.7 1.7 0 0 0-1.5 1z"/>
  };
  const icon = (name) => `<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.info}</svg></span>`;
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const planName = p => p === 'PLUS' ? 'PLUS' : p === 'PRO' ? 'PRO' : 'FREE';
  const initials = m => ((m?.firstName || 'Q')[0] + (m?.lastName || '')[0]).toUpperCase();
  const api = async path => { const r = await fetch(path,{headers,cache:'no-store'}); const d = await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error || 'تعذر تحميل البيانات'); return d; };
  const notify = text => { toast.textContent=text; toast.classList.add('show'); clearTimeout(notify.t); notify.t=setTimeout(()=>toast.classList.remove('show'),2600); };

  async function loadBase(){
    if(!state.me) state.me=await api('/api/me');
    if(!state.plans) state.plans=await api('/api/plans');
  }
  function nav(){ document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.route===state.route)); }
  function go(route){ state.route=route; render(); }

  function home(){
    const m=state.me, p=m.progress||{};
    view.innerHTML=`<section class="hero"><div class="profile"><div class="avatar">${esc(initials(m))}</div><div><h1>مرحباً ${esc(m.firstName||'بك')} 👋</h1><p>${esc(m.department||'طلاب المجموعة الطبية')} · ${esc(m.stage?`المرحلة ${m.stage}`:'اختر مرحلتك')}</p><div class="plan-pill">${icon('crown')} ${esc(planName(m.plan))}</div></div></div><div class="stats"><div class="stat"><strong>${p.completed||0}</strong><span>دروس مكتملة</span></div><div class="stat"><strong>${p.attempts||0}</strong><span>محاولات</span></div><div class="stat"><strong>${p.accuracy||0}%</strong><span>الدقة</span></div></div></section><div class="section-title"><h2>QMRMed</h2><span>مساحتك التعليمية</span></div><div class="grid"><div class="card clickable" data-go="archive">${icon('archive')}<h3>أرشيفي</h3><p>${m.archiveCount||0} نتيجة محفوظة</p></div><div class="card clickable" data-go="account">${icon('user')}<h3>حسابي</h3><p>الملف والخطة والتقدم</p></div><div class="card clickable" data-go="plans">${icon('crown')}<h3>الاشتراك</h3><p>الخطة الحالية: ${esc(planName(m.plan))}</p></div><div class="card clickable" data-go="about">${icon('medical')}<h3>عن QMRMed</h3><p>الهدف والميزات وطريقة العمل</p></div></div><section class="progress-card"><div class="progress-top"><strong>تقدمك الحالي</strong><span>${p.accuracy||0}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,Number(p.accuracy||0))}%"></div></div><button class="button secondary" data-go="account">عرض تفاصيل التقدم</button></section><button class="button blue" data-url="https://t.me/QMRMed">${icon('arrow')} فتح QMRMed</button>`;
  }
  function plans(){
    view.innerHTML=`<div class="section-label">خطط الاشتراك</div>${(state.plans||[]).map(p=>`<section class="plan ${p.code==='PLUS'?'featured':''} ${p.code==='PRO'?'ultra':''} ${p.current?'current':''}">${p.current?'<div class="current-badge">الخطة الحالية</div>':''}<div class="plan-head"><div class="plan-icon">${icon(p.code==='FREE'?'medical':'crown')}</div><div><h2>${esc(p.name)}</h2></div></div><div class="sub">${esc(p.subtitle||'')}</div><ul>${(p.features||[]).map(f=>`<li>${esc(f)}</li>`).join('')}</ul><div class="price-line"><span>الاشتراك يتم من البوت</span><strong>${p.code==='FREE'?'مجاني':esc(p.code)}</strong></div><button class="button" data-plan="${esc(p.code)}" ${p.current?'disabled':''}>${p.current?'الخطة الحالية':`اختيار ${esc(p.name)}`}</button></section>`).join('')}<div class="notice">${icon('info')} الدفع وتفعيل الاشتراك يتمان بأمان من داخل QMRMed Bot.</div>`;
  }
  function account(){ const m=state.me,p=m.progress||{}; view.innerHTML=`<div class="section-label">حسابي</div><section class="hero"><div class="profile"><div class="avatar">${esc(initials(m))}</div><div><h1>${esc([m.firstName,m.lastName].filter(Boolean).join(' ')||'QMRMed User')}</h1><p>${m.username?esc('@'+m.username):'Telegram user'}</p><div class="plan-pill">${icon('crown')} ${esc(planName(m.plan))}</div></div></div></section><div class="list"><div class="list-row"><span>القسم</span><strong>${esc(m.department||'غير محدد')}</strong></div><div class="list-row"><span>المرحلة</span><strong>${esc(m.stage||'غير محددة')}</strong></div><div class="list-row"><span>الدروس المكتملة</span><strong>${p.completed||0}</strong></div><div class="list-row"><span>المحاولات</span><strong>${p.attempts||0}</strong></div><div class="list-row"><span>الدقة</span><strong>${p.accuracy||0}%</strong></div></div>`; }
  async function archive(){ state.archive=await api('/api/archive'); const items=Array.isArray(state.archive)?state.archive:(state.archive.items||[]); view.innerHTML=`<div class="section-label">الأرشيف</div>${items.length?items.map(x=>`<div class="card clickable" data-archive-id="${esc(x.id)}"><h3>${esc(x.sourceName||x.name||'ملف')}</h3><p>${esc(x.operation||'نتيجة AI')} · ${esc(x.createdAt||'')}</p></div>`).join(''):`<div class="empty">${icon('archive')}<br>لا توجد نتائج محفوظة حتى الآن.</div>`; }
  function menu(){ view.innerHTML=`<div class="section-label">المزيد</div><div class="list"><div class="list-row clickable" data-go="about">${icon('medical')}<span>عن QMRMed</span></div><div class="list-row clickable" data-go="settings">${icon('settings')}<span>الإعدادات</span></div><div class="list-row clickable" data-url="https://t.me/QMRMed">${icon('home')}<span>القناة الرئيسية</span></div><div class="list-row clickable" data-url="https://t.me/QMR7S">${icon('info')}<span>الأخبار</span></div><div class="list-row clickable" data-url="https://t.me/QMR7S1">${icon('info')}<span>الدعم</span></div><div class="list-row clickable" data-url="https://t.me/ID29i">${icon('user')}<span>المطور</span></div><div class="list-row clickable" data-url="https://instagram.com/qmr7s">${icon('info')}<span>Instagram</span></div></div>`; }
  function settings(){ view.innerHTML=`<div class="section-label">الإعدادات</div><div class="list"><div class="list-row"><span>المظهر</span><strong>داكن</strong></div><div class="list-row"><span>اللغة</span><strong>العربية</strong></div><div class="list-row"><span>الإشعارات</span><strong>مفعلة</strong></div></div>`; }
  function about(){ view.innerHTML=`<div class="section-label">عن QMRMed</div><section class="hero"><div class="profile"><div class="avatar">${icon('medical')}</div><div><h1>QMRMed</h1><p>For a Smarter Medical Future</p></div></div></section><div class="card"><h3>الهدف</h3><p>منصة تعليمية ذكية لطلاب المجموعة الطبية، تجمع الدراسة والأسئلة والاختبارات والذكاء الاصطناعي في تجربة واحدة.</p></div><div class="card"><h3>المزايا</h3><p>مساعد دراسة بالذكاء الاصطناعي، بنك أسئلة، أسئلة وزارية، حالات سريرية، نتائج وتقدم شخصي، وأرشيف للملفات.</p></div>`; }
  async function render(){ nav(); view.innerHTML='<div class="loading"><div class="spinner"></div></div>'; try{ await loadBase(); switch(state.route){case'home':home();break;case'plans':plans();break;case'archive':await archive();break;case'account':account();break;case'menu':menu();break;case'settings':settings();break;case'about':about();break;default:home();} bind(); }catch(e){ view.innerHTML=`<div class="empty">${icon('info')}<br>${esc(e.message)}<button class="button secondary" data-action="retry">إعادة المحاولة</button></div>`; bind(); } }
  function bind(){
    document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>go(b.dataset.route));
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
    document.querySelectorAll('[data-url]').forEach(b=>b.onclick=()=>{const u=b.dataset.url;if(tg?.openTelegramLink&&u.startsWith('https://t.me/'))tg.openTelegramLink(u);else if(tg?.openLink)tg.openLink(u);else location.href=u;});
    document.querySelectorAll('[data-action="retry"]').forEach(b=>b.onclick=()=>render());
    document.querySelectorAll('[data-plan]').forEach(b=>b.onclick=async()=>{try{const d=state.me?.links?.bot?.plans;if(d&&tg?.openTelegramLink)tg.openTelegramLink(d);else if(d&&tg?.openLink)tg.openLink(d);else notify('افتح QMRMed Bot لإكمال الاشتراك.');}catch{notify('تعذر فتح مسار الاشتراك.');}});
    document.querySelectorAll('[data-archive-id]').forEach(b=>b.onclick=async()=>{try{const d=await api('/api/archive/'+encodeURIComponent(b.dataset.archiveId));view.innerHTML=`<div class="section-label">نتيجة الأرشيف</div><section class="card"><h3>${esc(d.sourceName||'نتيجة')}</h3><p>${esc(d.result||'لا توجد نتيجة')}</p></section>`;bind();}catch(e){notify(e.message);}});
  }
  document.querySelector('[data-action="back"]')?.addEventListener('click',()=>{if(state.route!=='home')go('home');else tg?.close?.();});
  document.querySelector('[data-action="menu"]')?.addEventListener('click',()=>go('menu'));
  if(tg){tg.ready();tg.expand();tg.setHeaderColor?.('#05070b');tg.setBackgroundColor?.('#05070b');}
  window.__QMRMED_RUNTIME_READY__ = true;
  render();
})();
