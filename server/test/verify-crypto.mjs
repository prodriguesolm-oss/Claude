// Verifica a criptografia (RFC 8291) e o VAPID contra a implementação de referência (http_ece).
// Uso: cd server && npm install && npm test
import { createRequire } from 'module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const ece = require('http_ece');
const { encryptPayload, vapidAuthorization, generateVapidKeys, b64u } = await import('../src/webpush.js');
const ok = (c, m) => { if (!c) { console.error('✗', m); process.exit(1); } console.log('  ✓', m); };

for (let round = 0; round < 25; round++) {
  // "iPhone": par de chaves do navegador + segredo de autenticação
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://web.push.apple.com/QK7example', keys: { p256dh: b64u.encode(ua.getPublicKey()), auth: b64u.encode(auth) } };
  const msg = JSON.stringify({ title: 'Ópera Carmen ' + round, body: 'Começa em 1 hora — às 19:00 · Teatro Municipal ✓'.repeat(1 + (round % 5)) });
  const body = await encryptPayload(sub, msg);
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  if (plain.toString('utf8') !== msg) ok(false, 'decifrar rodada ' + round);
}
ok(true, '25 mensagens cifradas pelo servidor foram decifradas corretamente pela implementação de referência (RFC 8291)');

// VAPID: assinatura ES256 válida, aud/exp/sub corretos
const vapid = await generateVapidKeys();
const h = await vapidAuthorization('https://web.push.apple.com/QK7example', vapid, 'https://prodriguesolm-oss.github.io');
const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
ok(!!m, 'cabeçalho no formato "vapid t=..., k=..."');
const [, hd, cl, sig, k] = m;
const claims = JSON.parse(Buffer.from(b64u.decode(cl)).toString());
ok(claims.aud === 'https://web.push.apple.com', 'aud = origem do serviço de push da Apple');
ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'exp dentro de 24h');
ok(claims.sub === 'https://prodriguesolm-oss.github.io', 'sub = endereço do app');
ok(JSON.parse(Buffer.from(b64u.decode(hd)).toString()).alg === 'ES256', 'alg ES256');
const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.encode(b64u.decode(k).slice(1, 33)), y: b64u.encode(b64u.decode(k).slice(33, 65)) }, format: 'jwk' });
const valid = crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64u.decode(sig)));
ok(valid, 'assinatura JWT verificada com a chave pública VAPID');
ok(b64u.decode(vapid.publicKey).length === 65 && b64u.decode(vapid.publicKey)[0] === 4, 'chave pública no formato que o iPhone espera (65 bytes, não comprimida)');
