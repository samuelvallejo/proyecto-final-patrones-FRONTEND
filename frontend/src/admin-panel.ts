import type {ApiClient} from './api';
import {object, rows, text, flag, type Row} from './contracts';
import {panel, html, escape, input, area, field, button, checkbox, select, toast, dialog} from './dom';
import {t} from './i18n';
import {AdminContentSections} from './admin-content';

/** Display name of an AI provider, shared by the panel and the studio's AI banner. */
export function providerName(provider: string): string {return provider === 'OLLAMA' ? t('localAiProvider') : provider === 'GEMINI' ? 'Gemini' : provider === 'UNAVAILABLE' ? t('uiProviderNameText210') : t('uiProviderNameText211');}

/** The part of the app shell the administration panel is allowed to use. */
export interface AdminPanelHost {
  readonly api: ApiClient;
  readonly content: HTMLElement;
  readonly userId: string;
  /** Changes on every navigation; a late response for an old screen is dropped. */
  readonly epoch: number;
  categories: Row[];
  platform: Row;
  title(eyebrow: string, heading: string, detail: string): void;
  /** Draws the panel again (after a change). */
  reload(): void;
  openStream(stream: Row): void;
  launch(action: () => Promise<void>): void;
}

/**
 * Administration screen: platform switches, the global announcement, figures, technical status,
 * accounts, live broadcasts, categories and the activity log. A new view is built on each visit;
 * the server checks the ADMIN role again on every call it makes.
 */
export class AdminPanelView {
  constructor(private readonly host: AdminPanelHost) {}

  /** A yes/no question in the app's own dialog; closing it counts as "no". */
  private confirm(heading: string, detail: string, label: string): Promise<boolean> {
    return new Promise(resolve => {
      const modal = dialog(heading); let answered = false;
      const finish = (value: boolean) => {if (answered) return; answered = true; resolve(value); modal.close();};
      const message = document.createElement('p'); message.className = 'muted'; message.textContent = detail;
      const actions = panel('action-row'); actions.append(button(label, 'button danger', () => finish(true)), button(t('uiEditClipText154'), 'button subtle', () => finish(false)));
      modal.form.append(message, actions); modal.element.addEventListener('close', () => {if (!answered) {answered = true; resolve(false);}});
    });
  }
  async render(): Promise<void> {
    this.host.title(t('adminEyebrow'), t('adminTitle'), t('adminDescription'));
    const epoch = this.host.epoch;
    const [overview, live, actions] = await Promise.all([this.host.api.request('GET', '/admin/overview'), this.host.api.request('GET', '/admin/streams'), this.host.api.request('GET', '/admin/actions')]);
    if (epoch !== this.host.epoch) return;
    const totals = object(object(overview).totals), system = object(object(overview).system);
    const figures = panel('stats-grid admin-stats');
    for (const [label, key] of [['adminFigureUsers', 'users'], ['adminFigureAdmins', 'admins'], ['adminFigureSuspended', 'suspended'], ['adminFigureChannels', 'channels'], ['adminFigureLive', 'live'], ['adminFigureStreams', 'streams'], ['adminFigureMessages', 'messages'], ['adminFigurePending', 'pending_reviews'], ['adminFigureClips', 'clips'], ['adminFigureEvents', 'upcoming_events']] as const)
      figures.append(html(`<article class="metric"><span>${escape(t(label))}</span><strong>${escape(text(totals, key) || '0')}</strong></article>`));
    this.host.content.append(figures);
    this.host.platform = object(object(overview).platform);
    const switches = panel('surface admin-section'); switches.append(html(`<div class="panel-heading"><h2>${escape(t('adminPlatformTitle'))}</h2></div><p class="muted">${escape(t('adminPlatformHelp'))}</p>`));
    const maintenance = checkbox(t('adminMaintenanceLabel'), flag(this.host.platform, 'maintenance')), registration = checkbox(t('adminRegistrationLabel'), this.host.platform.registrationOpen !== false);
    const saveSwitches = async (changed: 'maintenance' | 'registration') => {
      // The switch that changed already shows its new value; "before" is what to restore if saving fails.
      const before = {maintenance: changed === 'maintenance' ? !maintenance.control.checked : maintenance.control.checked, registrationOpen: changed === 'registration' ? !registration.control.checked : registration.control.checked};
      const next = {maintenance: maintenance.control.checked, registrationOpen: registration.control.checked};
      if (changed === 'maintenance' && next.maintenance && !await this.confirm(t('adminMaintenanceOnTitle'), t('adminMaintenanceOnDetail'), t('adminMaintenanceOn'))) {maintenance.control.checked = false; return;}
      maintenance.control.disabled = registration.control.disabled = true;
      try {
        this.host.platform = {...this.host.platform, ...object(await this.host.api.request('PUT', '/admin/platform', next))};
        toast(changed === 'maintenance' ? t(next.maintenance ? 'adminMaintenanceEnabled' : 'adminMaintenanceDisabled') : t(next.registrationOpen ? 'adminRegistrationOpened' : 'adminRegistrationClosed'));
        this.host.reload();
      } catch (error) {
        maintenance.control.checked = before.maintenance; registration.control.checked = before.registrationOpen; throw error;
      } finally {maintenance.control.disabled = registration.control.disabled = false;}
    };
    maintenance.control.addEventListener('change', () => this.host.launch(() => saveSwitches('maintenance')));
    registration.control.addEventListener('change', () => this.host.launch(() => saveSwitches('registration')));
    switches.append(maintenance.element, html(`<p class="muted switch-help">${escape(t('adminMaintenanceHelp'))}</p>`), registration.element, html(`<p class="muted switch-help">${escape(t('adminRegistrationHelp'))}</p>`));
    this.host.content.append(switches);
    const current = object(this.host.platform.announcement), currentImportant = text(current, 'level') === 'IMPORTANT';
    const announce = panel('surface admin-section'); announce.append(html(`<div class="panel-heading"><h2>${escape(t('adminAnnouncementTitle'))}</h2></div><p class="muted">${escape(t('adminAnnouncementHelp'))}</p>`));
    if (text(current, 'message')) {
      const active = panel('admin-row');
      active.append(html(`<div class="admin-row-main"><span class="tag ${currentImportant ? 'live-tag' : 'admin-tag'}">${escape(t(currentImportant ? 'announcementImportant' : 'announcementInfo'))}</span><div><strong>${escape(text(current, 'message'))}</strong><small class="muted">${escape(t('adminAnnouncementActive'))}</small></div></div>`));
      const remove = button(t('adminAnnouncementRemove'), 'button danger small', async () => {
        if (!await this.confirm(t('adminAnnouncementRemoveTitle'), t('adminAnnouncementRemoveDetail'), t('adminAnnouncementRemove'))) return;
        await this.host.api.request('DELETE', '/admin/announcement'); this.host.platform = {...this.host.platform, announcement: null}; toast(t('adminAnnouncementRemoved')); this.host.reload();
      });
      const removeRow = panel('action-row'); removeRow.append(remove); active.append(removeRow); announce.append(active);
    }
    const message = area(t('adminAnnouncementPlaceholder')); message.maxLength = 280; message.rows = 3;
    const level = select([[t('announcementInfo'), 'INFO'], [t('announcementImportant'), 'IMPORTANT']], 'INFO');
    const send = checkbox(t('adminAnnouncementNotify'), true);
    const counter = document.createElement('small'); counter.className = 'muted';
    const count = () => {counter.textContent = `${message.value.length} / 280`;}; count(); message.addEventListener('input', count);
    const publish = button(t(text(current, 'message') ? 'adminAnnouncementReplace' : 'adminAnnouncementPublish'), 'button primary', async () => {
      if (!message.value.trim()) {message.focus(); return;}
      publish.disabled = true;
      try {
        const result = object(await this.host.api.request('POST', '/admin/announcement', {message: message.value.trim(), level: level.value, sendNotification: send.control.checked}));
        this.host.platform = object(result.platform);
        toast(send.control.checked ? t('adminAnnouncementSent').replace('{count}', text(result, 'notified')) : t('adminAnnouncementPublished')); this.host.reload();
      } finally {publish.disabled = false;}
    });
    const announceRow = panel('form-row'); announceRow.append(field(t('adminAnnouncementLevel'), level));
    announce.append(field(t('adminAnnouncementMessage'), message), counter, announceRow, send.element, publish);
    this.host.content.append(announce);

    const technical = panel('surface admin-section'); technical.append(html(`<div class="panel-heading"><h2>${escape(t('adminSystemTitle'))}</h2></div><p class="muted">${escape(t('adminSystemHelp'))}</p>`));
    const yes = (value: boolean) => value ? t('adminYes') : t('adminNo');
    const uptime = Number(text(system, 'uptimeSeconds')) || 0, hours = Math.floor(uptime / 3600), minutes = Math.floor(uptime % 3600 / 60);
    const facts: Array<[string, string]> = [
      [t('adminAiProvider'), providerName(text(system, 'aiProvider'))], [t('aiModelLabel'), text(system, 'aiModel') || '—'],
      [t('adminAiConfigured'), yes(flag(system, 'aiConfigured'))], [t('adminGemini'), flag(system, 'geminiConfigured') ? t('adminGeminiReady') : t('adminGeminiMissing')],
      [t('adminUptime'), `${hours} h ${minutes} min`], [t('adminMemory'), `${text(system, 'memoryUsedMb')} / ${text(system, 'memoryMaxMb')} MB`],
      [t('adminProcessors'), text(system, 'processors')], [t('adminJava'), text(system, 'javaVersion')],
      [t('adminDatabase'), `PostgreSQL ${text(system, 'databaseVersion')} · ${text(system, 'databaseSizeMb')} MB`], [t('adminSchema'), text(system, 'schemaVersion') ? 'V' + text(system, 'schemaVersion') : '—'],
    ];
    const list = document.createElement('dl'); list.className = 'admin-facts';
    for (const [label, value] of facts) {const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; list.append(term, detail);}
    technical.append(list);

    const people = panel('surface admin-section'); people.append(html(`<div class="panel-heading"><h2>${escape(t('adminUsersTitle'))}</h2></div><p class="muted">${escape(t('adminUsersHelp'))}</p>`));
    const finder = input(t('adminUsersSearch')); finder.maxLength = 64; finder.type = 'search'; finder.setAttribute('aria-label', t('adminUsersSearch'));
    const accounts = panel('admin-list'); people.append(finder, accounts);
    const loadUsers = async () => {
      const found = rows(await this.host.api.request('GET', `/admin/users?search=${encodeURIComponent(finder.value.trim())}`));
      if (!accounts.isConnected) return; accounts.replaceChildren();
      if (!found.length) accounts.append(html(`<p class="muted">${escape(t('adminUsersEmpty'))}</p>`));
      for (const person of found) accounts.append(this.userRow(person, loadUsers));
    };
    let searchTimer = 0; finder.addEventListener('input', () => {window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => this.host.launch(loadUsers), 300);});

    const broadcasts = panel('surface admin-section'); broadcasts.append(html(`<div class="panel-heading"><h2>${escape(t('adminLiveTitle'))}</h2></div>`));
    const streams = rows(live);
    if (!streams.length) broadcasts.append(html(`<p class="muted">${escape(t('adminLiveEmpty'))}</p>`));
    for (const stream of streams) {
      const row = panel('admin-row'), title = text(stream, 'title'), started = new Date(text(stream, 'started_at')).toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'});
      const category = text(stream, 'category');
      row.append(html(`<div class="admin-row-main"><span class="status-dot"></span><div><strong>${escape(title)}</strong><small class="muted">@${escape(text(stream, 'username'))} · ${escape(text(stream, 'channel_name'))}${category ? ' · ' + escape(category) : ''} · ${escape(t('adminSince'))} ${escape(started)}</small></div><div class="admin-tags"><span class="tag">${escape(text(stream, 'viewers') || '0')} ${escape(t('adminViewers'))}</span></div></div>`));
      const controls = panel('action-row');
      controls.append(button(t('adminWatch'), 'button subtle small', () => this.host.openStream({id: text(stream, 'id'), title})), button(t('adminEndStream'), 'button danger small', async () => {
        if (!await this.confirm(t('adminEndStreamTitle'), t('adminEndStreamDetail').replace('{title}', title), t('adminEndStream'))) return;
        await this.host.api.request('POST', `/admin/streams/${text(stream, 'id')}/end`, {}); toast(t('adminStreamEnded')); this.host.reload();
      }));
      row.append(controls); broadcasts.append(row);
    }

    const catalogue = panel('surface admin-section'); catalogue.append(html(`<div class="panel-heading"><h2>${escape(t('adminCategoriesTitle'))}</h2></div><p class="muted">${escape(t('adminCategoriesHelp'))}</p>`));
    const refreshCategories = async () => {this.host.categories = rows(await this.host.api.request('GET', '/categories')); this.host.reload();};
    for (const category of this.host.categories) {
      const row = panel('simple-row'), name = document.createElement('span'); name.textContent = text(category, 'name');
      row.append(name, button(t('adminRename'), 'button subtle small', () => {
        const modal = dialog(t('adminRenameTitle')), value = input(t('adminCategoryName'), text(category, 'name')); value.maxLength = 64;
        modal.form.append(field(t('adminCategoryName'), value), button(t('saveChanges'), 'button primary', async () => {
          if (!value.value.trim()) {value.focus(); return;}
          await this.host.api.request('PUT', `/admin/categories/${text(category, 'id')}`, {name: value.value.trim()}); modal.close(); toast(t('adminCategorySaved')); await refreshCategories();
        }), button(t('uiEditClipText154'), 'button subtle', modal.close)); value.focus();
      }));
      catalogue.append(row);
    }
    const newName = input(t('adminCategoryNew')); newName.maxLength = 64; newName.setAttribute('aria-label', t('adminCategoryNew'));
    const create = panel('admin-inline'); create.append(newName, button(t('adminCategoryCreate'), 'button primary small', async () => {
      if (!newName.value.trim()) {newName.focus(); return;}
      await this.host.api.request('POST', '/admin/categories', {name: newName.value.trim()}); toast(t('adminCategorySaved')); await refreshCategories();
    }));
    catalogue.append(create);

    const activity = panel('surface admin-section'); activity.append(html(`<div class="panel-heading"><h2>${escape(t('adminActivityTitle'))}</h2></div>`));
    const entries = rows(actions);
    if (!entries.length) activity.append(html(`<p class="muted">${escape(t('adminActivityEmpty'))}</p>`));
    const actionNames: Record<string, string> = {
      ADMIN_GRANT: t('adminActionGrant'), ADMIN_REVOKE: t('adminActionRevoke'), ADMIN_SUSPEND: t('adminActionSuspend'),
      ADMIN_REACTIVATE: t('adminActionReactivate'), ADMIN_END_STREAM: t('adminActionEndStream'),
      ADMIN_CATEGORY_CREATE: t('adminActionCategoryCreate'), ADMIN_CATEGORY_RENAME: t('adminActionCategoryRename'),
      ADMIN_ANNOUNCE: t('adminActionAnnounce'), ADMIN_ANNOUNCE_REMOVE: t('adminActionAnnounceRemove'),
      ADMIN_MAINTENANCE_ON: t('adminActionMaintenanceOn'), ADMIN_MAINTENANCE_OFF: t('adminActionMaintenanceOff'),
      ADMIN_REGISTRATION_OPEN: t('adminActionRegistrationOpen'), ADMIN_REGISTRATION_CLOSE: t('adminActionRegistrationClose'),
      ADMIN_TAKEDOWN: t('adminActionTakedown'), ADMIN_RESTORE: t('adminActionRestore'), ADMIN_AI_RULES: t('adminActionAiRules'),
    };
    for (const entry of entries) {
      const when = new Date(text(entry, 'created_at')).toLocaleString('es-CO', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
      const line = panel('simple-row'), what = document.createElement('span'), meta = document.createElement('small');
      what.textContent = `${actionNames[text(entry, 'action')] ?? text(entry, 'action')} ${text(entry, 'label')}`; meta.className = 'muted'; meta.textContent = `@${text(entry, 'admin')} · ${when}`;
      line.append(what, meta); activity.append(line);
    }
    const columns = panel('admin-columns'); columns.append(people, technical);
    const moderation = await new AdminContentSections(this.host).render();
    if (epoch !== this.host.epoch) return;
    this.host.content.append(columns, broadcasts, ...moderation, catalogue, activity);
    await loadUsers();
  }
  private userRow(person: Row, reload: () => Promise<void>): HTMLDivElement {
    const row = panel('admin-row'), id = text(person, 'id'), username = text(person, 'username'), handle = '@' + username;
    const self = id === this.host.userId, admin = flag(person, 'admin'), suspended = text(person, 'status') === 'SUSPENDED', locked = flag(person, 'protected');
    const tags = [
      `<span class="tag${admin ? ' admin-tag' : ''}">${escape(t(admin ? 'roleAdmin' : 'roleUser'))}</span>`,
      suspended ? `<span class="tag suspended-tag">${escape(t('adminSuspendedTag'))}</span>` : '',
      flag(person, 'live') ? `<span class="tag live-tag">${escape(t('liveShort'))}</span>` : '',
      self ? `<span class="tag">${escape(t('adminYou'))}</span>` : '',
    ].join('');
    const channel = text(person, 'channel_name');
    row.append(html(`<div class="admin-row-main"><span class="avatar-chip small">${escape(username.slice(0, 1).toUpperCase())}</span><div><strong>${escape(handle)}</strong><small class="muted">${escape(text(person, 'display_name'))}${channel ? ' · ' + escape(channel) : ''}</small></div><div class="admin-tags">${tags}</div></div>`));
    const role = button(t(admin ? 'adminRevoke' : 'adminGrant'), 'button subtle small', async () => {
      const ok = await this.confirm(t(admin ? 'adminRevokeTitle' : 'adminGrantTitle'), t(admin ? 'adminRevokeDetail' : 'adminGrantDetail').replace('{user}', handle), t(admin ? 'adminRevoke' : 'adminGrant'));
      if (!ok) return;
      await this.host.api.request('PUT', `/admin/users/${id}/role`, {admin: !admin}); toast(t(admin ? 'adminRevoked' : 'adminGranted').replace('{user}', handle)); await reload();
    });
    role.disabled = admin ? self || locked : suspended;
    if (admin && locked) role.title = t('adminLockedHelp'); else if (admin && self) role.title = t('adminSelfHelp');
    const status = button(t(suspended ? 'adminReactivate' : 'adminSuspend'), suspended ? 'button subtle small' : 'button danger small', async () => {
      if (!suspended && !await this.confirm(t('adminSuspendTitle'), t('adminSuspendDetail').replace('{user}', handle), t('adminSuspend'))) return;
      await this.host.api.request('PUT', `/admin/users/${id}/status`, {status: suspended ? 'ACTIVE' : 'SUSPENDED'}); toast(t(suspended ? 'adminReactivated' : 'adminSuspendedDone').replace('{user}', handle)); await reload();
    });
    status.disabled = self || (admin && !suspended);
    if (!self && admin && !suspended) status.title = t('adminSuspendAdminHelp');
    const controls = panel('action-row'); controls.append(role, status); row.append(controls); return row;
  }
}
