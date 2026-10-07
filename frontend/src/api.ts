import {object, text, type Json} from './contracts';
import {t} from './i18n';
export const apiOrigin = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080';
export class ApiClient {
  token = sessionStorage.getItem('streamguard.token') ?? '';
  onUnauthorized: () => void = () => {};
  setToken(value: string): void {
    this.token = value;
    if (value) sessionStorage.setItem('streamguard.token', value); else sessionStorage.removeItem('streamguard.token');
  }
  async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Json): Promise<Json> {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await fetch(`${apiOrigin}/api${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000)});
    } catch { throw new Error(t('uiOnErrorText03')); }
    const raw = await response.text(); let value: Json = {};
    try { if (raw) value = JSON.parse(raw) as Json; }
    catch { throw new Error(t('uiOnResponseReceivedText01')); }
    if (!response.ok) {
      if (response.status === 401) { this.setToken(''); this.onUnauthorized(); }
      throw new Error(text(object(value), 'error') || `${t('uiOnResponseReceivedText02')}${response.status})`);
    }
    return value;
  }
}
