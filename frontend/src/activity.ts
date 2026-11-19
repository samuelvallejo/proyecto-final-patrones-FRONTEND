import {t} from './i18n';
let pending = 0;
let indicator: HTMLElement | null = null;
let showTimer = 0, slowTimer = 0;
/** One status for concurrent API work. It appears only for slow requests, so fast actions never flash. */
export function beginActivity(): () => void {
  if (++pending === 1) {
    showTimer = window.setTimeout(() => {
      indicator = document.createElement('div'); indicator.className = 'activity-indicator';
      indicator.setAttribute('role', 'status'); indicator.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = t('processing');
      indicator.append(spinner, label); document.body.append(indicator);
      slowTimer = window.setTimeout(() => {label.textContent = t('serverWaking');}, 2500);
    }, 400);
  }
  let finished = false;
  return () => {
    if (finished) return; finished = true;
    if (--pending === 0) {window.clearTimeout(showTimer); window.clearTimeout(slowTimer); indicator?.remove(); indicator = null;}
  };
}
