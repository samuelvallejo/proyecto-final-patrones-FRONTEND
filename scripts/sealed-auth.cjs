/* Seals login/registration fields exactly like the browser: one-use token + RSA-OAEP-256 + AES-256-GCM. */
const {webcrypto} = require('node:crypto');
const {subtle} = webcrypto;

/** Returns the request body for /api/auth/register or /api/auth/login using a Playwright request context. */
async function sealedBody(request, base, fields) {
  const challenge = await (await request.post(base + '/api/auth/challenge', {data: {}})).json();
  if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(challenge.token)) throw new Error('Unexpected credential token format');
  const encoder = new TextEncoder();
  const rsa = await subtle.importKey('spki', Buffer.from(challenge.publicKey, 'base64'), {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
  const aes = await subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(challenge.token)}, aes, encoder.encode(JSON.stringify(fields)));
  const key = await subtle.encrypt({name: 'RSA-OAEP'}, rsa, await subtle.exportKey('raw', aes));
  const b64 = value => Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64');
  return {token: challenge.token, key: b64(key), iv: b64(iv), data: b64(data)};
}

module.exports = {sealedBody};
