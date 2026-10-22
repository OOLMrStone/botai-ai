if (new URLSearchParams(location.search).get('theme') === 'dark')
  document.documentElement.dataset.theme = 'dark';
const PLANS = window.BOTAI_PAYWALL_PRICING.plans;
const BILLING_COPY = window.BOTAI_PAYWALL_PRICING.copy;
const state = { period: 'season', plan: 1, expanded: false, chosen: false, screen: 'paywall' };
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const iconClose =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const chevron =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>';
function topbar() {
  return `<header class="topbar"><span class="brand" aria-label="ботai">бот<span>ai</span></span>${state.screen !== 'practice' ? `<button class="close" data-action="close" aria-label="${state.screen === 'checkout' ? 'Вернуться к тарифу' : 'Вернуться к практике'}">${iconClose}</button>` : ''}</header>`;
}
function cardContent(index) {
  const p = PLANS[index];
  const season = state.period === 'season';
  const selected = state.plan === index;
  const badge = selected ? (state.chosen ? 'Твой тариф' : 'Рекомендуемый') : '';
  return `<span class="plan-badge" ${badge ? '' : 'hidden'}>${badge}</span><span class="radio" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 12 4 4 8-8"/></svg></span><div class="plan-title">${p.name}</div><div class="pricing"><div class="price-row"><span class="price">${p[state.period]}<span class="currency">₽</span></span><span class="price-period">${season ? BILLING_COPY.seasonUnit : BILLING_COPY.monthUnit}</span></div><div class="quota"><span class="included" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg></span><span class="quota-label">${season ? p.seasonQuota : p.quota} ${BILLING_COPY.quota[state.period]}</span></div></div><div class="card-footer"><p class="charge">${season ? BILLING_COPY.seasonNote : BILLING_COPY.monthNote}</p></div>`;
}
function card(index) {
  return `<div class="plan-wrap"><div class="plan-anchor"><button class="plan ${state.plan === index ? 'selected' : ''}" data-plan="${index}" aria-pressed="${state.plan === index}">${cardContent(index)}</button></div></div>`;
}
function paywall() {
  return `<div class="heading"><h1 tabindex="-1">Продолжай ботать!</h1><p class="access-warning">${new URLSearchParams(location.search).get('reason') === 'time' ? 'Три пробных дня закончились' : 'На бесплатном тарифе ты больше не сможешь проверять задания 2-й части'}</p></div><div class="period" data-selected="${state.period}" aria-label="Период оплаты"><span class="period-indicator" aria-hidden="true"></span><button data-period="month" class="${state.period === 'month' ? 'selected' : ''}" aria-pressed="${state.period === 'month'}">Месяц</button><button data-period="season" class="${state.period === 'season' ? 'selected' : ''}" aria-pressed="${state.period === 'season'}">Сезон</button></div><div class="plans-list ${state.expanded ? 'expanded' : ''}" id="plans-list">${
    state.expanded
      ? PLANS.map((_, i) => i)
          .map((i) => card(i))
          .join('')
      : card(state.plan)
  }</div>${state.expanded ? '' : `<button class="other" data-action="expand" aria-expanded="false" aria-controls="plans-list">Другие тарифы${chevron}</button>`}<div class="actions"><div class="cta-lemur-space"><div class="cta-anchor"><div class="lemur" data-lemur aria-hidden="true"><img data-poster src="lemur-alpha-poster.png" alt=""><video src="lemur-alpha.mp4?v=4" muted autoplay playsinline webkit-playsinline loop preload="auto" hidden></video><canvas width="1536" height="1024" hidden></canvas></div><button class="primary" data-action="checkout" disabled>Продолжить</button></div></div><div class="legal-text">${window.BOTAI_PAYWALL_LEGAL_LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join('<span aria-hidden="true">·</span>')}</div></div>`;
}
function updatePaywall(animatePrices = false) {
  const period = document.querySelector('.period');
  period.dataset.selected = state.period;
  period.querySelectorAll('button').forEach((button) => {
    const selected = button.dataset.period === state.period;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-plan]').forEach((button) => {
    const index = Number(button.dataset.plan);
    const selected = index === state.plan;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    const badge = button.querySelector('.plan-badge');
    badge.hidden = !selected;
    badge.textContent = state.chosen ? 'Твой тариф' : 'Рекомендуемый';
    if (animatePrices) {
      button.innerHTML = cardContent(index);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        button
          .querySelector('.price-row')
          .animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
    }
  });
}
function expandPlans(button) {
  const list = document.querySelector('#plans-list');
  const selected = list.querySelector('.plan-wrap');
  const actions = document.querySelector('.actions');
  const before = [selected, actions].map((element) => element.getBoundingClientRect().top);

  state.expanded = true;
  list.classList.add('expanded');
  selected.insertAdjacentHTML(
    'beforebegin',
    PLANS.slice(0, state.plan)
      .map((_, i) => card(i))
      .join(''),
  );
  selected.insertAdjacentHTML(
    'afterend',
    PLANS.slice(state.plan + 1)
      .map((_, i) => card(state.plan + i + 1))
      .join(''),
  );
  button.remove();
  selected.querySelector('button').focus({ preventScroll: true });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const timing = { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
  [selected, actions].forEach((element, index) => {
    const offset = before[index] - element.getBoundingClientRect().top;
    element.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
      timing,
    );
  });
  [...list.children]
    .filter((element) => element !== selected)
    .forEach((element) => {
      element.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { ...timing, delay: 90, fill: 'backwards' },
      );
    });
}
function checkout() {
  const p = PLANS[state.plan];
  return `<section class="flow-content"><h1 tabindex="-1">Всё верно?</h1><p class="subtitle">${state.period === 'season' ? p.seasonQuota : p.quota} ${BILLING_COPY.quota[state.period]}<br>Разбор решений и объяснение ошибок</p><div class="receipt"><div><span>Тариф</span><span>${p.name}</span></div><div><span>Период</span><span>${state.period === 'season' ? BILLING_COPY.seasonDeadline : BILLING_COPY.monthUnit}</span></div><div class="total"><span>К оплате</span><span>${money(p[state.period])}</span></div></div><button class="primary" data-action="confirm">Подтвердить в макете</button><button class="secondary" data-action="paywall">Вернуться к тарифу</button><p class="demo-note">Тестовый экран · Оплаты нет</p></section>`;
}
function practice() {
  return `<section class="flow-content"><p class="subtitle">Неравенства · задание 15</p><h1 tabindex="-1">Продолжим решать</h1><div class="task-panel"><p>Черновик на месте</p><div class="task-math">log₂(x − 1) ≥ 3</div><p class="subtitle">Практика и готовые решения бесплатны</p></div><button class="primary" data-action="paywall">Проверить с Бо</button></section>`;
}
function success() {
  return `<section class="flow-content text-center"><div class="success-mark">✓</div><h1 tabindex="-1">Тариф подключён</h1><p class="subtitle">Можно возвращаться к подготовке<br>Бо готов помочь с решениями</p><div class="actions"><button class="primary" data-action="close">Продолжить практику</button></div><p class="demo-note">Демонстрация · Деньги не списывались</p></section>`;
}

function render(focusTarget) {
  const views = { paywall, checkout, practice, success };
  document.querySelector('#app').innerHTML =
    `<div class="screen">${topbar()}${views[state.screen]()}</div>`;
  if (focusTarget) document.querySelector(focusTarget)?.focus({ preventScroll: true });
  window.syncPaywallLemur();
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.period) {
    state.period = button.dataset.period;
    updatePaywall(true);
  } else if (button.dataset.plan) {
    state.plan = Number(button.dataset.plan);
    state.chosen = true;
    updatePaywall();
  } else {
    const action = button.dataset.action;
    if (action === 'expand') {
      expandPlans(button);
      return;
    }
    state.screen =
      {
        close: state.screen === 'checkout' ? 'paywall' : 'practice',
        paywall: 'paywall',
        checkout: 'checkout',
        confirm: 'success',
      }[action] || state.screen;
    render('h1');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.screen !== 'practice') {
    state.screen = state.screen === 'checkout' ? 'paywall' : 'practice';
    render('h1');
  }
});
render();
