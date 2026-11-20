import type {AdminPanelHost} from './admin-panel';
import {object, rows, text, flag, type Row} from './contracts';
import {panel, html, escape, input, area, field, button, checkbox, select, toast, dialog} from './dom';
import {t} from './i18n';

/**
 * Two sections of the administration panel: logical takedown of streams and clips, and the
 * rules of the AI gateway proxy. Every change asks for a reason, which the server audits.
 */
export class AdminContentSections {
  private type = 'CLIP';
  private state = 'ALL';
  private query = '';
  private readonly list = panel('admin-list');

  constructor(private readonly host: AdminPanelHost) {}

  async render(): Promise<HTMLElement[]> {
    return [this.contentSection(), await this.aiSection()];
  }

  /** Ask for the reason of a change; closing the dialog cancels it. */
  private reason(heading: string, detail: string, label: string): Promise<string | null> {
    return new Promise(resolve => {
      const modal = dialog(heading); let answered = false;
      const finish = (value: string | null) => {if (answered) return; answered = true; resolve(value); modal.close();};
      const message = document.createElement('p'); message.className = 'muted'; message.textContent = detail;
      const why = area(t('adminReasonPlaceholder')); why.maxLength = 500; why.rows = 3;
      const actions = panel('action-row');
      actions.append(button(label, 'button danger', () => {
        if (!why.value.trim()) {toast(t('adminReasonRequired'), true); return;}
        finish(why.value.trim());
      }), button(t('uiEditClipText154'), 'button subtle', () => finish(null)));
      modal.form.append(message, field(t('adminReason'), why), actions);
      modal.element.addEventListener('close', () => {if (!answered) {answered = true; resolve(null);}});
    });
  }

  private contentSection(): HTMLElement {
    const section = panel('surface admin-section');
    section.append(html(`<div class="panel-heading"><h2>${escape(t('adminContentTitle'))}</h2></div><p class="muted">${escape(t('adminContentHelp'))}</p>`));
    const type = select([[t('adminContentClips'), 'CLIP'], [t('adminContentStreams'), 'STREAM']], this.type);
    const state = select([[t('adminContentAll'), 'ALL'], [t('adminContentPublished'), 'ACTIVE'], [t('adminContentRemoved'), 'REMOVED']], this.state);
    const search = input(t('adminContentSearch'), this.query); search.maxLength = 100; search.type = 'search'; search.setAttribute('aria-label', t('adminContentSearch'));
    type.style.flex = state.style.flex = '0 1 200px'; search.style.flex = '1 1 240px';
    const apply = () => {this.type = type.value; this.state = state.value; this.query = search.value.trim(); this.host.launch(() => this.load());};
    type.addEventListener('change', apply); state.addEventListener('change', apply);
    search.addEventListener('keydown', event => {if (event.key === 'Enter') apply();});
    const filters = panel('admin-inline'); filters.append(type, state, search, button(t('adminContentFilter'), 'button primary small', apply));
    section.append(filters, this.list);
    this.host.launch(() => this.load());
    return section;
  }

  private async load(): Promise<void> {
    const epoch = this.host.epoch;
    const items = rows(await this.host.api.request('GET', `/admin/content?type=${this.type}&state=${this.state}&q=${encodeURIComponent(this.query)}`));
    if (epoch !== this.host.epoch) return;
    this.list.replaceChildren();
    if (!items.length) {this.list.append(html(`<p class="muted">${escape(t('adminContentEmpty'))}</p>`)); return;}
    for (const item of items) this.list.append(this.contentRow(item));
  }

  private contentRow(item: Row): HTMLDivElement {
    const row = panel('admin-row'), id = text(item, 'id'), title = text(item, 'title'), removed = Boolean(text(item, 'removed_at'));
    const when = new Date(text(item, 'created_at')).toLocaleString('es-CO', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
    const tag = removed
      ? `<span class="tag suspended-tag">${escape(t('adminContentRemovedTag'))}</span>`
      : `<span class="tag">${escape(t('adminContentPublishedTag'))}</span>`;
    const why = removed ? `<small class="muted">${escape(t('adminReason'))}: ${escape(text(item, 'removed_reason'))}</small>` : '';
    row.append(html(`<div class="admin-row-main"><div><strong>${escape(title)}</strong><small class="muted">@${escape(text(item, 'username'))} · ${escape(text(item, 'channel_name'))} · ${escape(when)}</small>${why}</div><div class="admin-tags">${tag}</div></div>`));
    const controls = panel('action-row');
    const asset = text(item, 'asset_id');
    if (asset) controls.append(button(t('adminContentWatch'), 'button subtle small', () => this.preview(title, asset)));
    controls.append(button(removed ? t('adminContentRestore') : t('adminContentTakedown'), removed ? 'button subtle small' : 'button danger small', async () => {
      const reason = await this.reason(t(removed ? 'adminContentRestoreTitle' : 'adminContentTakedownTitle'), title, t(removed ? 'adminContentRestore' : 'adminContentTakedown'));
      if (reason === null) return;
      await this.host.api.request('POST', `/admin/content/${this.type}/${id}/${removed ? 'restore' : 'takedown'}`, {reason});
      toast(t(removed ? 'adminContentRestored' : 'adminContentTakenDown')); await this.load();
    }));
    row.append(controls); return row;
  }

  private preview(title: string, asset: string): void {
    const modal = dialog(title), video = document.createElement('video');
    video.controls = true; video.style.width = '100%'; video.style.maxHeight = '60vh'; video.src = `/api/media/${encodeURIComponent(asset)}`;
    modal.form.append(video, button(t('adminContentClose'), 'button subtle', () => modal.close()));
  }

  /** The AI gateway proxy: switch it off or limit how many requests per hour reach the provider. */
  private async aiSection(): Promise<HTMLElement> {
    const data = object(await this.host.api.request('GET', '/admin/ai')), gateway = object(data.gateway);
    const section = panel('surface admin-section');
    section.append(html(`<div class="panel-heading"><h2>${escape(t('adminAiTitle'))}</h2></div><p class="muted">${escape(t('adminAiHelp'))}</p>`));
    const facts = document.createElement('dl'); facts.className = 'admin-facts';
    for (const [label, value] of [[t('adminAiForwarded'), text(gateway, 'forwarded') || '0'], [t('adminAiRefused'), text(gateway, 'refused') || '0'],
      [t('adminAiLastHour'), `${text(gateway, 'lastHour') || '0'} / ${text(data, 'hourlyLimit')}`]] as Array<[string, string]>) {
      const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; facts.append(term, detail);
    }
    const enabled = checkbox(t('adminAiEnabled'), flag(data, 'enabled'));
    const limit = input('600', text(data, 'hourlyLimit')); limit.type = 'number'; limit.min = '0'; limit.max = '100000';
    const save = button(t('adminAiSave'), 'button primary small', async () => {
      const hourlyLimit = Math.round(Number(limit.value));
      if (!Number.isFinite(hourlyLimit) || hourlyLimit < 0 || hourlyLimit > 100000) {toast(t('adminAiInvalid'), true); return;}
      await this.host.api.request('PUT', '/admin/ai', {enabled: enabled.control.checked, hourlyLimit}); toast(t('adminAiSaved')); this.host.reload();
    });
    section.append(facts, enabled.element, field(t('adminAiLimit'), limit), save);
    return section;
  }
}
