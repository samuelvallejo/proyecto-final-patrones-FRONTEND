import './styles.css';
import {StreamGuardApp} from './app';
import {t} from './i18n';
import {toast} from './dom';

document.title = t('pageTitle');
document.querySelector('meta[name="description"]')?.setAttribute('content', t('pageDescription'));
const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const status = document.createElement('p'); status.textContent = t('bootPreparing'); status.setAttribute('role', 'status'); root.append(status);
void new StreamGuardApp(root).start().catch(error => {
  toast(error instanceof Error ? error.message : t('bootFailed'), true);
});
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
