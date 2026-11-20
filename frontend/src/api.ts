import {object, text, type Json, type Row} from './contracts';
import {t} from './i18n';
import {beginActivity} from './activity';
export const apiOrigin = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080';
export const httpOrigin = '';
function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
/** HTTP failure with its status; `unavailable` means the StreamGuard backend itself did not answer. */
export class ApiRequestError extends Error {
  /** `code` comes from the server for errors meant to be shown as they are (MAINTENANCE, REGISTRATION_CLOSED). */
  constructor(message: string, readonly status: number, readonly unavailable = false, readonly code = '') { super(message); }
}
export class ApiClient {
  token = '';
  onUnauthorized: () => void = () => {};
  onMaintenance: () => void = () => {};
  setToken(value: string): void {
    this.token = value;
    sessionStorage.removeItem('streamguard.token'); localStorage.removeItem('streamguard.token');
  }
  async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Json, silent = false): Promise<Json> {
    const done = silent ? () => {} : beginActivity();
    try {return await this.send(method, path, body);} finally {done();}
  }
  /**
   * Sends login/registration fields without a readable body: a one-use XXXXX-YYYYY-ZZZZZ token
   * from the server, the fields encrypted with AES-256-GCM (bound to that token) and the AES key
   * encrypted with the server's RSA-OAEP public key. The token is consumed on first use.
   */
  async sealed(path: string, fields: Row): Promise<Json> {
    const done = beginActivity();
    try {
      const challenge = object(await this.send('POST', '/auth/challenge', {}));
      const token = text(challenge, 'token'), publicKey = text(challenge, 'publicKey');
      if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(token) || !publicKey) throw new Error(t('operationFailed'));
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) throw new Error(t('operationFailed'));
      const rsa = await subtle.importKey('spki', fromBase64(publicKey), {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
      const aes = await subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const data = await subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(token)}, aes, encoder.encode(JSON.stringify(fields)));
      const key = await subtle.encrypt({name: 'RSA-OAEP'}, rsa, await subtle.exportKey('raw', aes));
      return await this.send('POST', path, {token, key: toBase64(key), iv: toBase64(iv), data: toBase64(data)});
    } finally {done();}
  }
  private async send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Json): Promise<Json> {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    let response: Response;
    try {
      response = await fetch(`${httpOrigin}/api${path}`, {method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000)});
    } catch { throw new ApiRequestError(t('backendUnavailable'), 0, true); }
    const raw = await response.text(); let value: Json = {};
    // Gateways (Vercel/Railway) answer 404/5xx without the backend's {"error": ...} body when the service is down.
    const gatewayFailure = response.status === 404 || response.status >= 500;
    try { if (raw) value = JSON.parse(raw) as Json; }
    catch {
      if (!response.ok && gatewayFailure) throw new ApiRequestError(t('backendUnavailable'), response.status, true);
      throw new Error(t('uiOnResponseReceivedText01'));
    }
    if (!response.ok) {
      if (response.status === 401) { this.setToken(''); this.onUnauthorized(); }
      const message = text(object(value), 'error'), code = text(object(value), 'code');
      if (response.status === 503 && code === 'MAINTENANCE') this.onMaintenance();
      if (code) throw new ApiRequestError(message || t('operationFailed'), response.status, false, code);
      if (!message && gatewayFailure) throw new ApiRequestError(t('backendUnavailable'), response.status, true);
      throw new ApiRequestError(message || t('operationFailed'), response.status);
    }
    return value;
  }
}
export async function connectionTicket(): Promise<string> {
  const response = await fetch('/api/auth/connection-ticket', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: '{}'});
  if (!response.ok) throw new Error(t('operationFailed'));
  return text(object(await response.json()), 'ticket');
}
