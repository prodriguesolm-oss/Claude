// Utilitários gerais.

export function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  } catch { /* contexto não seguro */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/** normaliza para busca: sem acentos, minúsculas */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Pontuação de busca. 0 = não bate. Prioriza "começa com" no primeiro campo (nome),
 * depois início de palavra, depois "contém".
 */
export function matchScore(q, ...fields) {
  const nq = norm(q);
  if (!nq) return 1;
  let best = 0;
  fields.forEach((f, i) => {
    const nf = norm(f);
    if (!nf) return;
    const primary = i === 0;
    if (nf.startsWith(nq)) best = Math.max(best, primary ? 4 : 2);
    else if (nf.split(/[\s,.\-/]+/).some((w) => w.startsWith(nq))) best = Math.max(best, primary ? 3 : 1.5);
    else if (nf.includes(nq)) best = Math.max(best, primary ? 2.5 : 1);
  });
  return best;
}

export const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
export const byName = (a, b) => collator.compare(a.name || '', b.name || '');

export const CATEGORIES = [
  { v: 'cultura', label: 'Cultura' },
  { v: 'aventura', label: 'Aventura' },
  { v: 'bares', label: 'Bares e restaurantes' },
  { v: 'outros', label: 'Outros' },
];
export const catLabel = (v) => CATEGORIES.find((c) => c.v === v)?.label || '';

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
}

export function haptic() {
  try { navigator.vibrate?.(8); } catch { /* iOS não suporta */ }
}

/** cor estável derivada de um texto (para miniaturas sem foto) */
export function hueOf(s) {
  let h = 0;
  for (const ch of String(s || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const main = words.filter((w) => !/^(da|de|do|das|dos|e|a|o|the|of)$/i.test(w));
  const parts = main.length ? main : words;
  if (!parts.length) return '?';
  const a = parts[0][0];
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
