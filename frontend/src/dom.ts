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
  element.addEventListener('click', () => {
    if (element.disabled) return;
    let result: void | Promise<void>;
    try {result = action();} catch (error) {toast(error instanceof Error ? error.message : t('operationFailed'), true); return;}
    if (result instanceof Promise) {
      element.disabled = true; element.setAttribute('aria-busy', 'true'); const spinner = panel('spinner button-spinner'); spinner.setAttribute('aria-hidden', 'true'); element.prepend(spinner);
      void result.catch(error => toast(error instanceof Error ? error.message : t('operationFailed'), true)).finally(() => {spinner.remove(); element.disabled = false; element.removeAttribute('aria-busy');});
    }
  });
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
export function showLiveEnded(video: HTMLVideoElement): void {
  const stage = video.closest('.video-stage'); if (!stage) return;
  video.onplaying = null; video.onended = null;
  video.pause(); video.srcObject = null; video.removeAttribute('src');
  video.controls = false; video.hidden = true; video.load(); stage.classList.add('stream-ended');
  const notice = stage.querySelector<HTMLElement>('.video-placeholder, .collaboration-video-status') ?? panel('video-placeholder');
  notice.className = 'video-placeholder stream-ended-notice'; notice.hidden = false; notice.style.display = '';
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  notice.replaceChildren(html(`<span class="stream-ended-symbol">${icon('camera-off')}</span><h3>${escape(t('liveEndedTitle'))}</h3><p>${escape(t('liveEndedDescription'))}</p>`));
  if (!notice.parentElement) stage.append(notice);
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
    microphone: "<rect x='9' y='2' width='6' height='12' rx='3'/><path d='M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8'/>",
    'microphone-off': "<path d='M9 9V5a3 3 0 0 1 5.8-1M15 9v3M5 10a7 7 0 0 0 11.7 5.2M19 10a7 7 0 0 1-.5 2.6M12 17v5M8 22h8M3 3l18 18'/>",
    camera: "<rect x='3' y='6' width='13' height='12' rx='3'/><path d='m16 10 5-3v10l-5-3Z'/>",
    'camera-switch': "<path d='M4 7h3l2-3h6l2 3h3v13H4Z'/><path d='M8 12a4 4 0 0 1 7-1M16 15a4 4 0 0 1-7 1M15 8v3h-3M9 19v-3h3'/>",
    'camera-off': "<path d='m3 3 18 18M10 6h6a3 3 0 0 1 3 3v1l2-1v8l-3-2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3'/>",
    play: "<rect x='3' y='3' width='18' height='18' rx='5'/><path d='m10 8 6 4-6 4Z'/>",
    search: "<circle cx='10' cy='10' r='6'/><path d='m15 15 6 6'/>",
    settings: "<path d='M4 7h16M4 17h16'/><circle cx='8' cy='7' r='3'/><circle cx='16' cy='17' r='3'/>",
    spark: "<path d='m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z'/><path d='m20 2 .8 2.2L23 5l-2.2.8L20 8l-.8-2.2L17 5l2.2-.8Z'/>",
    eye: "<path d='M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>",
    home: "<path d='M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z'/>",
    bell: "<path d='M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7ZM10 20a2 2 0 0 0 4 0'/>",
    gamepad: "<rect x='2' y='7' width='20' height='11' rx='5'/><path d='M7 11v3M5.5 12.5h3M15.5 11.5h.01M18 13.5h.01'/>",
    music: "<path d='M9 18V5l11-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='17' cy='16' r='3'/>",
    palette: "<path d='M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5S14.500 15 16 15h2a3 3 0 0 0 3-3c0-5-4-9-9-9Z'/><path d='M7.5 11.5h.01M10 7.5h.01M15 7.5h.01'/>",
    chip: "<rect x='6' y='6' width='12' height='12' rx='2'/><path d='M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4'/>",
    book: "<path d='M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2ZM4 20a2 2 0 0 0 2 2h13'/>",
    chat: "<path d='M4 5h16v11H9l-5 4Z'/><path d='M8 9h8M8 12h5'/>",
    arrow: "<path d='M5 12h14M13 6l6 6-6 6'/>",
    gauge: "<path d='M12 14l4-4'/><path d='M3.3 19a9 9 0 1 1 17.4 0'/><circle cx='12' cy='14' r='1.5'/>",
    sun: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
    moon: "<path d='M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z'/>",
    plus: "<path d='M12 5v14M5 12h14'/>",
    close: "<path d='M6 6l12 12M18 6 6 18'/>",
    'chevron-left': "<path d='m15 6-6 6 6 6'/>",
    'chevron-right': "<path d='m9 6 6 6-6 6'/>",
    crown: "<path d='m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z'/>",
    flame: "<path d='M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 1.5-4s.5 2 2 2.5C10.5 8 12 3 12 3Z'/>",
    'eye-off': "<path d='M3 3l18 18M7 6a11 11 0 0 1 5-1c7 0 10 7 10 7s-1 3-4 5M14 19h-2C5 19 2 12 2 12s1-3 4-5'/>",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] ?? paths.spark}</svg>`;
}
