// Ponto de entrada: monta a estrutura, abas, inicia o armazenamento e a varredura periódica.
import { init, subscribe, runSweep } from './store.js';
import { scheduleSync } from './push.js';
import { html, ic, setHTML, overlayCount, alertDialog } from './ui.js';
import { createAgendaView } from './views/agenda.js';
import { createCommitmentsView, createFavoritesView, createHistoryView } from './views/lists.js';
import { createExploreView } from './views/explore.js';
import { createTodosView } from './views/todos.js';

const TABS = [
  { id: 'agenda', label: 'Agenda', icon: 'calendar', make: createAgendaView },
  { id: 'todos', label: 'Afazeres', icon: 'checklist', make: createTodosView },
  { id: 'explore', label: 'Explorar', icon: 'compass', make: createExploreView }, // Locais | Eventos
  { id: 'commitments', label: 'Compromissos', icon: 'repeat', make: createCommitmentsView },
  { id: 'favorites', label: 'Favoritos', icon: 'star', make: createFavoritesView },
  { id: 'history', label: 'Histórico', icon: 'history', make: createHistoryView },
];

const views = new Map(); // id -> { view, el, dirty }
let current = null;

function shell() {
  const app = document.getElementById('app');
  setHTML(app, html`
    <main id="views">${TABS.map((t) => html`<section class="view" data-view="${t.id}" hidden></section>`)}</main>
    <nav class="tabbar" role="tablist" aria-label="Abas">
      ${TABS.map((t) => html`<button type="button" class="tab" role="tab" data-tab="${t.id}" aria-label="${t.label}">${ic(t.icon, 'i tab-ic')}<span>${t.label}</span></button>`)}
    </nav>
    <div id="overlays"></div>`);
  app.querySelector('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === current) {
      // tocar na aba atual volta ao topo (como no iOS)
      const el = views.get(current)?.el;
      el?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    show(b.dataset.tab);
  });
}

function ensure(id) {
  if (views.has(id)) return views.get(id);
  const tab = TABS.find((t) => t.id === id);
  const el = document.querySelector(`[data-view="${id}"]`);
  const view = tab.make();
  view.mount(el);
  const entry = { view, el, dirty: true };
  views.set(id, entry);
  return entry;
}

export function show(id, opts = {}) {
  const entry = ensure(id);
  for (const [vid, v] of views) v.el.hidden = vid !== id;
  entry.el.hidden = false;
  current = id;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (opts.date != null && entry.view.goToDate) entry.view.goToDate(opts.date);
  else if (entry.dirty) { entry.view.update(); }
  entry.dirty = false;
  entry.view.onShow?.();
}

function onStoreChange() {
  for (const [id, v] of views) {
    if (id === current) v.view.update();
    else v.dirty = true;
  }
}

// mantém as folhas acima do teclado do iPhone
function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const root = document.documentElement;
    root.style.setProperty('--vv-h', `${vv.height}px`);
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

function fatal(err) {
  console.error(err);
  const app = document.getElementById('app');
  setHTML(app, html`<div class="fatal">
    <div class="empty-ic">${ic('alert', 'i xl')}</div>
    <h2>Não foi possível abrir seus dados</h2>
    <p>${err?.message || String(err)}</p>
    <p class="muted">Seus dados não foram apagados. Feche o app por completo (deslize para cima no seletor de apps) e abra de novo.</p>
    <button type="button" class="btn primary" onclick="location.reload()">Tentar novamente</button>
  </div>`);
}

// Se alguma gravação falhar fora de um formulário (ex.: favoritar), avisa em vez de falhar em silêncio.
let lastErrorAt = 0;
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (Date.now() - lastErrorAt < 3000) return;
  lastErrorAt = Date.now();
  alertDialog({
    title: 'Não foi possível concluir',
    message: `A última ação não foi gravada. O que já estava salvo continua salvo.\n\nDetalhe: ${e.reason?.message || e.reason}`,
  });
});

// ---------- atualizações ----------
// O iPhone costuma só "acordar" o app (sem recarregar), e aí ele nunca procura versão nova.
// Por isso: procura atualização sempre que o app volta para a tela e, quando a nova versão
// assume, recarrega sozinho (esperando fechar qualquer janela aberta, para não perder nada).
function setupUpdates() {
  const sw = navigator.serviceWorker;
  const wasControlled = !!sw.controller;
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return; // 1ª instalação: nada a recarregar
    reloading = true;
    const tryReload = () => {
      if (overlayCount()) { setTimeout(tryReload, 1500); return; }
      location.reload();
    };
    tryReload();
  });
  sw.register('./sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60_000);
    window.__agentonatorCheckUpdate = async () => {
      await reg.update();
      return !!(reg.installing || reg.waiting);
    };
  }).catch((e) => console.warn('SW', e));
}

async function boot() {
  shell();
  trackVisualViewport();
  try {
    await init();
  } catch (err) {
    fatal(err);
    return;
  }
  document.documentElement.classList.add('ready');
  subscribe(onStoreChange);
  subscribe(() => scheduleSync()); // qualquer mudança -> atualiza os avisos no servidor
  show('agenda');
  scheduleSync(800);

  // a cada minuto: conclui o que passou e atualiza a linha do "agora"
  setInterval(async () => {
    await runSweep().catch(console.error);
    if (current === 'agenda' && !overlayCount()) views.get('agenda')?.view.update();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runSweep().then(() => { const v = views.get(current); if (v && !overlayCount()) v.view.update(); }).catch(console.error);
      scheduleSync(300);
    }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') setupUpdates();
}

boot();
