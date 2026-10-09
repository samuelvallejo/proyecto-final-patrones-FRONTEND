import {object, text, type Json} from './contracts';
import {t} from './i18n';
import {beginActivity} from './activity';
export const apiOrigin = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080';
export const httpOrigin = '';
export class ApiClient {
  token = '';
  onUnauthorized: () => void = () => {};
  setToken(value: string): void {
    this.token = value;
    sessionStorage.removeItem('streamguard.token'); localStorage.removeItem('streamguard.token');
  }
  async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Json, silent = false): Promise<Json> {
    const done = silent ? () => {} : beginActivity();
    try {return await this.send(method, path, body);} finally {done();}
  }
  private async send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: Json): Promise<Json> {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    let response: Response;
    try {
      response = await fetch(`${httpOrigin}/api${path}`, {method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000)});
    } catch { throw new Error(t('uiOnErrorText03')); }
    const raw = await response.text(); let value: Json = {};
    try { if (raw) value = JSON.parse(raw) as Json; }
    catch { throw new Error(t('uiOnResponseReceivedText01')); }
    if (!response.ok) {
      if (response.status === 401) { this.setToken(''); this.onUnauthorized(); }
      throw new Error(text(object(value), 'error') || t('operationFailed'));
    }
    return value;
  }
}
export async function connectionTicket(): Promise<string> {
  const response = await fetch('/api/auth/connection-ticket', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: '{}'});
  if (!response.ok) throw new Error(t('operationFailed'));
  return text(object(await response.json()), 'ticket');
}
