// Utilitários de data/hora (sempre no fuso local do aparelho).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const pad = (n) => String(n).padStart(2, '0');
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const WD_CAP = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WD_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'YYYY-MM-DD' no fuso local */
export function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** timestamp de uma data ('YYYY-MM-DD') + minutos desde a meia-noite */
export function atMinutes(k, min) {
  const d = parseDateKey(k);
  d.setHours(0, min, 0, 0);
  return d.getTime();
}

export function minutesOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtHM(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtMin(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseHM(s) {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function startOfWeek(t, weekStartsOn = 0) {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

/** diferença em dias de calendário (a - b) */
export function dayDiff(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}

export function fmtDur(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h}h${pad(r)}` : `${h}h`;
}

export function dayLabel(t, now = Date.now()) {
  const n = dayDiff(t, now);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  if (n === -1) return 'Ontem';
  const d = new Date(t);
  const base = `${WD_CAP[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() !== new Date(now).getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

export function fmtDayLong(t) {
  const d = new Date(t);
  return `${cap(WD_LONG[d.getDay()])}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function fmtDateShort(t, now = Date.now()) {
  const d = new Date(t);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() !== new Date(now).getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

export function fmtRange(s, e) {
  const plus = dayDiff(e - 1, s);
  return `${fmtHM(s)}–${fmtHM(e)}${plus > 0 ? ` (+${plus})` : ''}`;
}

/** arredonda para cima no próximo múltiplo de `step` minutos (hora local) */
export function roundUp(t, step = 30) {
  const d = new Date(t);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const r = Math.ceil(m / step) * step;
  if (r !== m) d.setMinutes(r);
  return d.getTime();
}
