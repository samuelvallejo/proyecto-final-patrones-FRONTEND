import {t} from './i18n';
import {icon} from './dom';

export type Theme = 'light' | 'dark';

/** Light is always the default; the dark theme is an explicit, remembered choice. */
export class ThemeManager {
  private static readonly storageKey = 'streamguard.theme';
  private static readonly colors: Record<Theme, string> = {light: '#eef4fd', dark: '#0a1226'};
  private active: Theme = 'light';

  get current(): Theme {return this.active;}

  /** Applies the remembered choice before anything is drawn. */
  init(): void {this.apply(this.stored(), false);}

  toggle(): void {this.apply(this.active === 'dark' ? 'light' : 'dark');}

  apply(theme: Theme, remember = true): void {
    this.active = theme;
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ThemeManager.colors[theme]);
    if (remember) this.remember(theme);
    for (const control of document.querySelectorAll<HTMLElement>('.theme-toggle')) this.syncToggle(control);
  }

  /** Keeps a toggle button's icon and accessible name in step with the active theme. */
  syncToggle(control: HTMLElement): void {
    const dark = this.active === 'dark';
    control.innerHTML = icon(dark ? 'sun' : 'moon');
    const label = t(dark ? 'themeSwitchToLight' : 'themeSwitchToDark');
    control.setAttribute('aria-label', label); control.setAttribute('title', label); control.setAttribute('aria-pressed', String(dark));
  }

  private stored(): Theme {
    try {return localStorage.getItem(ThemeManager.storageKey) === 'dark' ? 'dark' : 'light';} catch {return 'light';}
  }

  private remember(theme: Theme): void {
    try {
      if (theme === 'dark') localStorage.setItem(ThemeManager.storageKey, 'dark');
      else localStorage.removeItem(ThemeManager.storageKey);
    } catch {/* storage unavailable: the choice lasts until the page closes */}
  }
}

/** The page has one theme, so the app shares one manager. */
export const theme = new ThemeManager();
