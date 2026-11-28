// Web Push sem bibliotecas, só com WebCrypto (funciona no Cloudflare Workers e no Node 20+).
// - VAPID (RFC 8292): JWT ES256 que identifica este servidor para o serviço de push (Apple, Google, Mozilla)
// - Criptografia da mensagem (RFC 8291, "aes128gcm"): só o iPhone inscrito consegue ler o conteúdo

const enc = new TextEncoder();

export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/** novo par de chaves VAPID: { publicKey: base64url (65 bytes, formato raw), privateJwk } */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u.encode(pub), privateJwk };
}

/** cabeçalho Authorization: vapid t=<jwt>, k=<chave pública> */
export async function vapidAuthorization(endpoint, vapid, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // A assinatura ECDSA do WebCrypto já vem no formato r||s (64 bytes), que é o que o JWT ES256 exige.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * Criptografa a mensagem para uma inscrição (RFC 8291 / RFC 8188, um único registro).
 * `salt` e `localKeyPair` só são passados em testes.
 */
export async function encryptPayload(subscription, plaintext, { salt, localKeyPair } = {}) {
  const uaPublic = b64u.decode(subscription.keys.p256dh);
  const authSecret = b64u.decode(subscription.keys.auth);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const local = localKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(s, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2])); // 0x02 = último registro
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, data));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096); // tamanho do registro
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** envia uma notificação. Retorna { ok, status, gone, text } — gone = inscrição expirou/foi removida */
export async function sendPush(subscription, payload, vapid, { subject, ttl = 3600, urgency = 'high' } = {}) {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(Math.max(0, Math.floor(ttl))),
      Urgency: urgency,
      Authorization: await vapidAuthorization(subscription.endpoint, vapid, subject),
    },
    body,
  });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text };
}
