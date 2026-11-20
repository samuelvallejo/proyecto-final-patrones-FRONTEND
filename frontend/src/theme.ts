import {t} from './i18n';
import {icon} from './dom';

/** Light is always the default; the dark theme is an explicit, remembered choice. */
export type Theme = 'light' | 'dark';
const storageKey = 'streamguard.theme';
const colors: Record<Theme, string> = {light: '#eef4fd', dark: '#0a1226'};
let current: Theme = 'light';
function stored(): Theme {
  try {return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';} catch {return 'light';}
}
export function currentTheme(): Theme {return current;}
export function applyTheme(theme: Theme, remember = true): void {
  current = theme;
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
  if (remember) {try {if (theme === 'dark') localStorage.setItem(storageKey, 'dark'); else localStorage.removeItem(storageKey);} catch {/* storage unavailable */}}
  for (const control of document.querySelectorAll<HTMLElement>('.theme-toggle')) syncToggle(control);
}
export function toggleTheme(): void {applyTheme(current === 'dark' ? 'light' : 'dark');}
/** Applies the remembered choice before anything is drawn. */
export function initTheme(): void {applyTheme(stored(), false);}
/** Keeps a toggle button's icon and accessible name in step with the active theme. */
export function syncToggle(control: HTMLElement): void {
  const dark = current === 'dark';
  control.innerHTML = icon(dark ? 'sun' : 'moon');
  const label = t(dark ? 'themeSwitchToLight' : 'themeSwitchToDark');
  control.setAttribute('aria-label', label); control.setAttribute('title', label); control.setAttribute('aria-pressed', String(dark));
}
