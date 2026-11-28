// Notificações: inscrição no Web Push do iPhone e sincronização dos lembretes com o servidor.
// O servidor (Cloudflare Worker, ver /server) guarda só título, texto e horário de cada aviso
// e envia a notificação na hora — com o app fechado.
import { state, updateSettings } from './store.js';
import { computeReminders } from './schedule.js';
import { uid, isIOS, isStandalone } from './util.js';

export const pushStatus = { syncing: false, lastSync: null, lastError: null, count: 0 };
const listeners = new Set();
export function onPushStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => { try { fn(pushStatus); } catch { /* ignore */ } });

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
export const pushReady = () => state.settings.pushEnabled && pushSupported() && permission() === 'granted';

export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
}

function b64uToBytes(b64) {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function sameKey(buf, b64) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = b64uToBytes(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function api(path, body) {
  const res = await fetch(state.settings.pushServer + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.status ? `Serviço de push respondeu ${data.status} ${data.text || ''}`.trim() : `Servidor respondeu ${res.status}`));
  return data;
}

/** Liga as notificações. Precisa ser chamada direto de um toque do usuário (exigência do iOS). */
export async function enablePush(serverInput) {
  if (!pushSupported()) {
    throw new Error(isIOS() && !isStandalone()
      ? 'No iPhone, as notificações só funcionam no app aberto pelo ícone da Tela de Início (iOS 16.4 ou mais novo).'
      : 'Este aparelho não oferece notificações para web apps. No iPhone, é preciso iOS 16.4 ou mais novo e abrir pelo ícone.');
  }
  const server = normalizeServer(serverInput);
  if (!server) throw new Error('Cole primeiro o endereço do seu servidor (ex.: https://agentonator-push.seu-nome.workers.dev).');
  const perm = await Notification.requestPermission(); // primeira coisa após o toque
  if (perm !== 'granted') throw new Error('Permissão negada. Para liberar: Ajustes do iPhone → Notificações → Agentonator → Permitir Notificações.');
  const device = state.settings.pushDevice || `${uid()}${uid()}`;
  let publicKey;
  try {
    const res = await fetch(`${server}/vapid?device=${device}`);
    if (!res.ok) throw new Error();
    ({ publicKey } = await res.json());
  } catch {
    throw new Error('Não consegui falar com o servidor. Confira o endereço e a internet.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, publicKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  await updateSettings({ pushServer: server, pushEnabled: true, pushDevice: device });
  lastHash = '';
  await syncNow();
  if (pushStatus.lastError) throw new Error(pushStatus.lastError);
}

let timer = null;
let running = false;
let again = false;
let lastHash = '';

/** agenda uma sincronização (chamada a cada mudança de dados e ao abrir o app) */
export function scheduleSync(delay = 1200) {
  if (!state.settings.pushEnabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

export async function syncNow({ force = false } = {}) {
  const s = state.settings;
  if (!s.pushEnabled || !s.pushServer || !s.pushDevice || !pushSupported() || permission() !== 'granted') return;
  if (running) { again = true; return; }
  running = true;
  pushStatus.syncing = true;
  notify();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) throw new Error('A inscrição de notificações foi perdida. Toque em "Desativar" e depois em "Ativar notificações".');
    const reminders = computeReminders(state);
    const subscription = sub.toJSON();
    const hash = JSON.stringify([subscription.endpoint, reminders]);
    if (force || hash !== lastHash) {
      await api('/sync', { device: s.pushDevice, subscription, reminders });
      lastHash = hash;
    }
    pushStatus.lastSync = Date.now();
    pushStatus.count = reminders.length;
    pushStatus.lastError = null;
  } catch (e) {
    pushStatus.lastError = e?.message || String(e);
  } finally {
    running = false;
    pushStatus.syncing = false;
    notify();
    if (again) { again = false; scheduleSync(300); }
  }
}

export async function sendTest() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return api('/test', { device: state.settings.pushDevice, subscription: sub?.toJSON() });
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch { /* ignore */ }
  try {
    if (state.settings.pushServer && state.settings.pushDevice) await api('/disable', { device: state.settings.pushDevice });
  } catch { /* servidor fora do ar: o app esquece mesmo assim */ }
  lastHash = '';
  pushStatus.count = 0;
  pushStatus.lastError = null;
  await updateSettings({ pushEnabled: false });
}
