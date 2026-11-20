import {icon} from './dom';
import {t} from './i18n';
import './viewer-count.css';

/** A live "N espectadores" badge; visible text and accessible status share the server's count. */
export class ViewerCounter {
  readonly element: HTMLSpanElement;

  constructor(value: unknown) {
    this.element = document.createElement('span'); this.element.className = 'viewer-counter';
    this.element.dataset.viewerCounter = ''; this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite'); this.element.setAttribute('aria-atomic', 'true');
    this.element.title = t('viewerCounterHelp'); this.element.innerHTML = icon('eye');
    const label = document.createElement('span'); label.dataset.viewerLabel = ''; this.element.append(label);
    this.update(value);
  }

  update(value: unknown): void {ViewerCounter.render(this.element, ViewerCounter.parse(value));}

  /** Server counts are untrusted JSON: anything that is not a safe, non-negative integer is 0. */
  static parse(value: unknown): number {
    const count = typeof value === 'number' ? value : 0;
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  /** Updates every badge on the page (studio, watch view and floating player) at once. */
  static updateAll(root: ParentNode, value: unknown): void {
    const count = ViewerCounter.parse(value);
    for (const badge of root.querySelectorAll<HTMLElement>('[data-viewer-counter]')) ViewerCounter.render(badge, count);
  }

  private static render(badge: HTMLElement, count: number): void {
    const label = t(count === 1 ? 'viewerCounterOne' : 'viewerCounterMany')
      .replace('{count}', new Intl.NumberFormat('es-CO').format(count));
    const text = badge.querySelector('[data-viewer-label]');
    if (text && text.textContent !== label) text.textContent = label;
    badge.setAttribute('aria-label', label);
  }
}
