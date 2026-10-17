import {icon} from './dom';
import {t} from './i18n';
import './viewer-count.css';

export function viewerNumber(value: unknown): number {
  const count = typeof value === 'number' ? value : 0;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** Visible text and accessible status share the same live, server-supplied count. */
export function viewerCounter(value: unknown): HTMLSpanElement {
  const badge = document.createElement('span'); badge.className = 'viewer-counter';
  badge.dataset.viewerCounter = ''; badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite'); badge.setAttribute('aria-atomic', 'true');
  badge.title = t('viewerCounterHelp'); badge.innerHTML = icon('eye');
  const label = document.createElement('span'); label.dataset.viewerLabel = ''; badge.append(label);
  updateCounter(badge, viewerNumber(value)); return badge;
}

function updateCounter(badge: HTMLElement, count: number): void {
  const label = t(count === 1 ? 'viewerCounterOne' : 'viewerCounterMany')
    .replace('{count}', new Intl.NumberFormat('es-CO').format(count));
  const text = badge.querySelector('[data-viewer-label]');
  if (text && text.textContent !== label) text.textContent = label;
  badge.setAttribute('aria-label', label);
}

export function updateViewerCounters(root: ParentNode, value: unknown): void {
  const count = viewerNumber(value);
  for (const badge of root.querySelectorAll<HTMLElement>('[data-viewer-counter]')) updateCounter(badge, count);
}
