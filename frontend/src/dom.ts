import {t} from './i18n';
export function panel(style: string): HTMLDivElement {
  const element = document.createElement('div'); element.className = style; return element;
}
export function html(template: string): HTMLDivElement {
  const element = panel('html-block'); element.innerHTML = template; return element;
}
export function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char] ?? char));
}
export function input(placeholder: string, value = ''): HTMLInputElement {
  const element = document.createElement('input'); element.placeholder = placeholder; element.value = value; return element;
}
export function area(placeholder: string, value = ''): HTMLTextAreaElement {
  const element = document.createElement('textarea'); element.placeholder = placeholder; element.value = value; element.rows = 3; return element;
}
export function select(options: Array<[string, string]>, value?: string): HTMLSelectElement {
  const element = document.createElement('select');
  for (const [label, key] of options) element.add(new Option(label, key));
  if (value !== undefined) element.value = value; return element;
}
export function checkbox(label: string, value = false, style = 'setting-checkbox') {
  const element = document.createElement('label'); element.className = style;
  const control = input(''); control.type = 'checkbox'; control.checked = value;
  element.append(control, document.createTextNode(label)); return {element, control};
}
let fieldCounter = 0;
export function field(label: string, control: HTMLElement): HTMLDivElement {
  control.id = `field-${++fieldCounter}`;
  const container = panel('form-field'); const caption = document.createElement('label');
  caption.htmlFor = control.id; caption.textContent = label; container.append(caption, control); return container;
}
export function button(label: string, style: string, action: () => void | Promise<void>): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label; element.className = style;
  element.addEventListener('click', () => {if (!element.disabled) void Promise.resolve().then(action).catch(error => toast(error instanceof Error ? error.message : t('mediaConnectionFailed'), true));});
  return element;
}
let currentToast: HTMLElement | undefined;
export function toast(message: string, error = false): void {
  currentToast?.remove(); const notice = panel(`toast${error ? ' toast-error' : ''}`);
  currentToast = notice; notice.textContent = message; notice.setAttribute('role', error ? 'alert' : 'status');
  document.body.append(notice); window.setTimeout(() => notice.remove(), error ? 9000 : 5500);
}
export function empty(heading: string, body: string): HTMLDivElement {
  const element = html(`<div class="empty-state"><span class="empty-symbol">${icon('spark')}</span><h3>${escape(heading)}</h3><p>${escape(body)}</p></div>`);
  element.style.gridColumn = '1 / -1'; return element;
}
export function dialog(title: string) {
  const element = document.createElement('dialog'); element.className = 'app-dialog';
  const heading = document.createElement('h2'); heading.className = 'dialog-heading'; heading.textContent = title;
  const form = panel('dialog-form'); element.append(heading, form); document.body.append(element);
  element.addEventListener('close', () => element.remove()); element.showModal();
  return {element, form, close: () => element.close()};
}
export function icon(key: string): string {
  const paths: Record<string, string> = {
    shield: "<path d='M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z'/><path d='m8 12 3 3 5-6'/>",
    grid: "<rect x='3' y='3' width='7' height='7' rx='2'/><rect x='14' y='3' width='7' height='7' rx='2'/><rect x='3' y='14' width='7' height='7' rx='2'/><rect x='14' y='14' width='7' height='7' rx='2'/>",
    video: "<rect x='3' y='5' width='13' height='14' rx='3'/><path d='m16 9 5-3v12l-5-3Z'/>",
    play: "<rect x='3' y='3' width='18' height='18' rx='5'/><path d='m10 8 6 4-6 4Z'/>",
    search: "<circle cx='10' cy='10' r='6'/><path d='m15 15 6 6'/>",
    settings: "<path d='M4 7h16M4 17h16'/><circle cx='8' cy='7' r='3'/><circle cx='16' cy='17' r='3'/>",
    spark: "<path d='m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z'/><path d='m20 2 .8 2.2L23 5l-2.2.8L20 8l-.8-2.2L17 5l2.2-.8Z'/>",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] ?? paths.spark}</svg>`;
}
