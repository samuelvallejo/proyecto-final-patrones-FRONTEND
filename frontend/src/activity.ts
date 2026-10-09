import {t} from './i18n';
let pending = 0;
let indicator: HTMLElement | null = null;
/** One status for concurrent API work; silent polling never flashes the UI. */
export function beginActivity(): () => void {
  if (++pending === 1) {
    indicator = document.createElement('div'); indicator.className = 'activity-indicator';
    indicator.setAttribute('role', 'status'); indicator.setAttribute('aria-live', 'polite');
    const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true');
    indicator.append(spinner, document.createTextNode(t('processing'))); document.body.append(indicator);
  }
  let finished = false;
  return () => {if (finished) return; finished = true; if (--pending === 0) {indicator?.remove(); indicator = null;}};
}
