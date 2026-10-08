import {ApiClient, apiOrigin} from './api';
import {object, rows, text, flag, mediaConfig, type Json, type Row, type LiveEvent} from './contracts';
import {panel, html, escape, input, area, field, button, checkbox, select, toast, empty, dialog, icon} from './dom';
import {t} from './i18n';
import {media} from './media';
import {CollaborationTile} from './collaboration';
import './collaboration.css';

type Screen = 'explore' | 'studio' | 'login' | 'register' | 'watch' | 'public-clips' | 'account' | 'moderation' | 'clips' | 'assistant' | 'settings';
const adminScreens: Screen[] = ['studio', 'moderation', 'clips', 'assistant', 'settings'];

/** Responsive UI, authentication and workflows; server permissions remain authoritative. */
export class StreamGuardApp {
  private readonly api = new ApiClient();
  private content = panel('page-content');
  private user: Row | null = null;
  private config: Row = {};
  private dashboard: Row = {};
  private categories: Row[] = [];
  private screen: Screen = location.hash.startsWith('#clip=') ? 'public-clips' : 'explore';
  private channel = '';
  private stream = '';
  private search = '';
  private category = '';
  private broadcasting = false;
  private mobileNav = false;
  private chatList: HTMLDivElement | null = null;
  private audience: HTMLSpanElement | null = null;
  private readonly messageIds = new Set<string>();
  private epoch = 0;
  private collaborationTiles = new Map<string, CollaborationTile>();
  private collaborationPoll = 0;
  private collaborationStage: HTMLElement | null = null;
  private collaborationPrimary: HTMLDivElement | null = null;
  private collaborationGrid: HTMLDivElement | null = null;
  private collaborationSection: HTMLDivElement | null = null;

  constructor(private readonly root: HTMLElement) {
    this.api.onUnauthorized = () => {this.user = null; this.configureMedia();};
  }
  async start(): Promise<void> {
    const loading = panel('startup-loading');
    loading.setAttribute('role', 'status'); loading.textContent = t('uiExploreText26');
    this.root.replaceChildren(loading);
    const results = await Promise.allSettled([
      this.api.request('GET', '/config'), this.api.request('GET', '/categories'),
      this.api.token ? this.api.request('GET', '/auth/me') : Promise.resolve(null),
    ]);
    const [config, categories, user] = results;
    if (config?.status === 'fulfilled') this.config = object(config.value);
    if (categories?.status === 'fulfilled') this.categories = rows(categories.value);
    if (user?.status === 'fulfilled' && user.value) this.user = object(user.value);
    this.configureMedia(); this.shell(); await this.render();
    window.setInterval(() => {
      if ((this.screen === 'studio' || this.screen === 'moderation') && this.channel) this.launch(() => this.loadDashboard(false));
    }, 15000);
  }
  private configureMedia(): void {media.configure(apiOrigin, this.api.token, mediaConfig(this.config));}
  private launch(action: () => Promise<void>): void {void action().catch(error => toast(error instanceof Error ? error.message : t('uiOnErrorText04'), true));}
  private shell(): void {
    this.root.replaceChildren(); this.root.className = 'app-shell';
    const side = panel('sidebar'); side.append(html(t('uiShellText05') + icon('shield') + t('uiShellText06')), html(t('uiShellText07')));
    side.querySelector('.brand')?.addEventListener('click', event => {event.preventDefault(); this.route('explore');});
    const first = panel('nav-list'); first.append(this.navButton('explore', t('uiShellText08'), 'grid'), this.navButton('studio', t('myStudio'), 'video'));
    const second = panel('nav-list'); second.append(this.navButton('moderation', t('uiShellText10'), 'shield'), this.navButton('clips', t('uiShellText11'), 'play'), this.navButton('assistant', t('uiShellText12'), 'spark'), this.navButton('settings', t('uiShellText13'), 'settings'));
    side.append(first, html(t('uiShellText09')), second, html(t('uiShellText14')));
    const main = panel('main-shell'), header = panel('topbar');
    const menu = button('☰', 'menu-button', () => {this.mobileNav = !this.mobileNav; this.root.className = `app-shell${this.mobileNav ? ' nav-open' : ''}`;});
    menu.setAttribute('aria-label', t('uiShellText15'));
    const find = panel('global-search'), query = input(t('uiShellText16'), this.search);
    query.addEventListener('keydown', event => {if (event.key === 'Enter') {this.search = query.value; this.route('explore');}});
    find.append(html(icon('search')), query);
    const account = panel('account-actions'); account.append(html(t('uiShellText17')));
    if (!this.user) account.append(button(t('uiShellText18'), 'button primary small', () => this.route('login')));
    else {
      const badge = button(text(this.user, 'username').slice(0, 1).toUpperCase(), 'avatar', () => this.route('account')); badge.setAttribute('aria-label', t('myAccount'));
      account.append(button(t('uiShellText19'), 'button icon-button', () => this.notifications()), badge);
    }
    header.append(menu, find, account); this.content = panel('page-content'); main.append(header, this.content); this.root.append(side, main);
  }
  private navButton(key: Screen, label: string, glyph: string): HTMLButtonElement {
    const control = button(label, `nav-item${this.screen === key ? ' active' : ''}`, () => this.route(key));
    control.innerHTML = icon(glyph) + `<span>${escape(label)}</span>` + (key === 'moderation' ? t('uiNavButtonText20') : '');
    control.setAttribute('aria-label', label); return control;
  }
  private route(next: Screen): void {
    if (next !== 'watch') this.clearCollaboration();
    if (!this.broadcasting && this.screen === 'watch') media.stop();
    this.screen = next; this.mobileNav = false; this.epoch++; this.messageIds.clear(); this.audience = null;
    this.shell(); this.launch(() => this.render());
  }
  private async render(): Promise<void> {
    this.content.replaceChildren(); this.chatList = null;
    if (this.screen === 'explore') return this.explore();
    if (this.screen === 'login' || this.screen === 'register') {this.authView(this.screen === 'register'); return;}
    if (this.screen === 'watch') return this.watch();
    if (this.screen === 'public-clips') return this.publicClips();
    if (!this.user) {this.authView(false); return;}
    if (this.screen === 'account') {this.account(); return;}
    if (!this.channel) {
      const epoch = this.epoch; const channels = rows(await this.api.request('GET', '/channels/mine'));
      if (epoch !== this.epoch) return;
      if (!channels.length) {this.createChannel(); return;}
      if (channels.length > 1) {this.chooseChannel(channels); return;}
      this.channel = text(channels[0] ?? {}, 'id');
    }
    await this.loadDashboard(true);
  }
  private title(eyebrow: string, heading: string, detail: string): void {
    this.content.append(html(`<div class="page-heading"><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(heading)}</h1><p class="muted">${escape(detail)}</p></div>`));
  }
  private async explore(): Promise<void> {
    const hero = panel('hero'); hero.append(html(t('uiExploreText21') + icon('shield') + "</div><div class='floating-label label-top'>" + icon('spark') + t('uiExploreText22')));
    const actions = panel('hero-actions'); actions.append(button(t('openStudio'), 'button primary', () => this.route('studio')), button(t('uiExploreText23'), 'button subtle', () => this.route('public-clips'))); hero.append(actions);
    const filters = panel('category-row');
    for (const [label, slug] of [[t('uiExploreText24'), ''], ...this.categories.map(row => [text(row, 'name'), text(row, 'slug')])]) {
      if (label === undefined || slug === undefined) continue;
      filters.append(button(label, `category-chip${this.category === slug ? ' selected' : ''}`, () => {this.category = slug; this.route('explore');}));
    }
    const section = panel('section-title'); section.append(html(t('uiExploreText25')), html(`<span class="live-pill"><span class="status-dot"></span>${t('liveNow')}</span>`));
    const cards = panel('stream-grid'); cards.append(empty(t('uiExploreText26'), t('uiExploreText27')));
    this.content.append(hero, filters, section, cards, html("<div class='feature-strip'><article>" + icon('shield') + t('uiExploreText35') + icon('play') + t('uiExploreText36') + icon('video') + t('uiExploreText37')));
    try {
      const streams = rows(await this.api.request('GET', `/explore?q=${encodeURIComponent(this.search)}&category=${encodeURIComponent(this.category)}`));
      if (!cards.isConnected) return; cards.replaceChildren();
      if (!streams.length) cards.append(empty(t('uiExploreText28'), this.search ? t('uiExploreText30') : t('uiExploreText29')));
      for (const stream of streams) {
        const card = panel('stream-card');
        card.append(html(t('uiExploreText31') + icon('video') + `<span class='viewer-tag'>${escape(text(stream, 'viewers'))}` + t('streamViewerCountSuffix') + `${escape(text(stream, 'category'))}</span><h3>${escape(text(stream, 'title'))}</h3><p>${escape(text(stream, 'channel_name'))} <span class='verified'>✓</span></p></div>`));
        card.append(button(t('uiExploreText32'), 'button subtle full', () => {this.stream = text(stream, 'id'); this.route('watch');})); cards.append(card);
      }
    } catch (error) {if (cards.isConnected) {cards.replaceChildren(empty(t('uiExploreText33'), t('uiExploreText34'))); throw error;}}
  }
  private authView(register: boolean): void {
    this.title(t('welcomeEyebrow'), register ? t('uiAuthViewText38') : t('uiAuthViewText39'), register ? t('uiAuthViewText40') : t('uiAuthViewText41'));
    const card = panel('form-card auth-card'), username = input(t('uiAuthViewText42')), email = input(t('uiAuthViewText43')), password = input(t('uiAuthViewText44'));
    email.type = 'email'; email.autocomplete = 'email'; password.type = 'password'; password.autocomplete = register ? 'new-password' : 'current-password';
    password.minLength = register ? 10 : 0;
    const emailField = field(t('uiAuthViewText46'), email), emailHint = document.createElement('small');
    emailHint.className = 'form-hint'; emailHint.setAttribute('role', 'status'); emailHint.setAttribute('aria-live', 'polite');
    if (register) emailField.append(emailHint);
    const passwordField = field(t('uiAuthViewText47'), password), passwordHint = document.createElement('small');
    passwordHint.className = 'password-strength'; passwordHint.setAttribute('role', 'status'); passwordHint.setAttribute('aria-live', 'polite');
    if (register) {passwordHint.textContent = t('authPasswordStrengthHint'); passwordField.append(passwordHint);}
    const acceptedEmail = () => /^[^\s@]+@(gmail\.com|hotmail\.com)$/i.test(email.value.trim());
    const updateEmailHint = () => {
      const invalid = register && email.value.length > 0 && !acceptedEmail();
      emailHint.textContent = invalid ? t('authProviderEmailRequired') : '';
      emailHint.classList.toggle('field-error', invalid);
    };
    const updatePasswordHint = () => {
      const value = password.value, characterGroups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(pattern => pattern.test(value)).length;
      const low = value.length < 12 || characterGroups < 3;
      passwordHint.textContent = !value ? t('authPasswordStrengthHint') : low ? t('authPasswordStrengthLow')
        : value.length >= 15 && characterGroups === 4 ? t('authPasswordStrengthHigh') : t('authPasswordStrengthMedium');
      passwordHint.className = `password-strength ${!value ? '' : low ? 'strength-low' : value.length >= 15 && characterGroups === 4 ? 'strength-high' : 'strength-medium'}`;
    };
    email.addEventListener('input', updateEmailHint);
    password.addEventListener('input', updatePasswordHint);
    const consent = checkbox(t('uiAuthViewText48'), false, 'consent');
    if (register) card.append(field(t('uiAuthViewText45'), username));
    card.append(emailField, passwordField); if (register) card.append(consent.element);
    const submit = button(register ? t('createAccount') : t('signIn'), 'button primary full', async () => {
      if (register && !acceptedEmail()) {updateEmailHint(); emailHint.textContent = t('authProviderEmailRequired'); emailHint.classList.add('field-error'); email.focus(); return;}
      if (register && (username.value.length < 3 || password.value.length < 10 || !consent.control.checked)) {toast(t('uiAuthViewText49'), true); return;}
      submit.disabled = true;
      try {
        const body: Row = {email: email.value.trim(), password: password.value}; if (register) {body.username = username.value; body.aiConsent = consent.control.checked;}
        const data = object(await this.api.request('POST', register ? '/auth/register' : '/auth/login', body));
        this.api.setToken(text(data, 'token')); this.user = object(data.user); this.configureMedia(); this.channel = ''; this.dashboard = {}; this.route('studio');
      } finally {submit.disabled = false;}
    });
    password.addEventListener('keydown', event => {if (event.key === 'Enter') submit.click();});
    card.append(submit, button(register ? t('uiAuthViewText50') : t('uiAuthViewText51'), 'text-button', () => this.route(register ? 'login' : 'register'))); this.content.append(card);
  }
  private chooseChannel(channels: Row[]): void {
    this.title(t('uiChooseChannelText52'), t('uiChooseChannelText53'), t('uiChooseChannelText54'));
    for (const channel of channels) this.content.append(button(text(channel, 'name') + (flag(channel, 'is_owner') ? t('uiChooseChannelText55') : t('moderatorSuffix')), 'button subtle', async () => {this.channel = text(channel, 'id'); await this.loadDashboard(true);}));
  }
  private createChannel(): void {
    this.content.replaceChildren(); this.title(t('uiCreateChannelText56'), t('uiCreateChannelText57'), t('uiCreateChannelText58'));
    const form = panel('form-card auth-card'), name = input(t('uiCreateChannelText59'));
    const slug = input(t('uiCreateChannelText60'), text(this.user, 'username').toLowerCase().replaceAll('_', '-')), description = area(t('uiCreateChannelText61'));
    form.append(field(t('uiCreateChannelText59'), name), field(t('uiCreateChannelText63'), slug), field(t('uiCreateChannelText64'), description));
    const submit = button(t('uiCreateChannelText65'), 'button primary', async () => {
      submit.disabled = true;
      try {const result = object(await this.api.request('POST', '/channels', {name: name.value, slug: slug.value, description: description.value})); this.channel = text(result, 'id'); await this.loadDashboard(true);}
      finally {submit.disabled = false;}
    });
    form.append(submit); this.content.append(form);
  }
  private async loadDashboard(render: boolean): Promise<void> {
    const epoch = this.epoch, channel = this.channel;
    const snapshot = object(await this.api.request('GET', `/channels/${channel}/dashboard`));
    if (epoch !== this.epoch || channel !== this.channel || !adminScreens.includes(this.screen)) return;
    this.dashboard = snapshot;
    if (!render && this.screen !== 'moderation') {this.updateStats(); return;}
    this.content.replaceChildren(); this.chatList = null;
    switch (this.screen) {
      case 'settings': this.settings(); break;
      case 'moderation': this.moderation(); break;
      case 'clips': this.clips(); break;
      case 'assistant': this.assistant(); break;
      default: this.studio();
    }
  }
  private stats(): void {
    const stats = object(this.dashboard.stats), grid = panel('stats-grid');
    const definitions = [
      [t('uiStatsText66'), 'followers', t('uiStatsText67')], [t('uiStatsText68'), 'messages', t('uiStatsText69')],
      [t('uiStatsText70'), 'blocked', t('uiStatsText71')], [t('uiStatsText72'), 'pending_clips', t('uiStatsText73')],
    ];
    for (const [label, key, hint] of definitions) {
      if (!key || !label || !hint) continue;
      grid.append(html(`<article class="metric"><span>${escape(label)}</span><strong data-stat="${key}">${escape(text(stats, key))}</strong><small>${escape(hint)}</small></article>`));
    }
    this.content.append(grid);
  }
  private updateStats(): void {
    const stats = object(this.dashboard.stats);
    for (const element of this.content.querySelectorAll<HTMLElement>('[data-stat]')) element.textContent = text(stats, element.dataset.stat ?? '');
  }
  private owner(): boolean {return this.user !== null && text(object(this.dashboard.channel), 'owner_id') === text(this.user, 'id');}
  private studio(): void {
    this.title(t('uiStudioText74'), t('studioGreeting') + text(this.user, 'username') + ' ✦', t('uiStudioText75')); this.stats();
    const latest = object(this.dashboard.stream);
    if (!this.owner()) {
      this.content.append(html(t('uiStudioText76') + escape(text(object(this.dashboard.channel), 'name')) + '.</div>'));
      if (text(latest, 'status') === 'LIVE') this.content.append(button(t('uiStudioText77'), 'button primary', () => {this.stream = text(latest, 'id'); this.route('watch');})); return;
    }
    const layout = panel('studio-grid'), left = panel('surface'), right = panel('surface studio-side');
    left.append(html(t('uiStudioText78') + (this.broadcasting ? t('uiStudioText79') : t('uiStudioText80')) + "</span></div><div class='video-stage'><video id='live-video' autoplay playsinline muted></video><div class='video-placeholder' id='video-placeholder'>" + icon('video') + t('uiStudioText81')));
    if (this.broadcasting) {
      const actions = panel('action-row');
      const microphone = button(media.microphoneEnabled() ? t('uiStudioText104') : t('uiStudioText105'), 'button subtle', () => {
        const enabled = media.toggleMicrophone();
        microphone.textContent = enabled ? t('uiStudioText104') : t('uiStudioText105');
        microphone.setAttribute('aria-pressed', String(enabled));
      });
      microphone.setAttribute('aria-pressed', String(media.microphoneEnabled()));
      actions.append(button(t('uiStudioText82'), 'button primary', async () => {await this.api.request('POST', `/streams/${this.stream}/highlights`, {source: 'MANUAL', reason: t('uiStudioText83')}); toast(t('uiStudioText84'));}),
        microphone, button(t('uiStudioText85'), 'button subtle', async () => {await media.captions(); toast(t('uiStudioText86'));}), button(t('uiStudioText87'), 'button danger', () => this.finish()));
      left.append(actions);
    } else if (text(latest, 'status') === 'LIVE') {
      left.append(html(t('uiStudioText88')), button(t('uiStudioText89'), 'button danger', async () => {await this.api.request('POST', `/streams/${text(latest, 'id')}/end`, {}); await this.loadDashboard(true);}));
    } else {
      const form = panel('stream-form'), name = input(t('uiStudioText90')), description = area(t('uiStudioText91'));
      const categories = select(this.categories.map(row => [text(row, 'name'), text(row, 'id')]));
      const shareScreen = checkbox(t('uiStudioText92')); const row = panel('form-row');
      row.append(field(t('uiStudioText94'), categories), field(t('uiCreateChannelText64'), description));
      form.append(field(t('uiStudioText93'), name), row, shareScreen.element);
      const start = button(t('uiStudioText96'), 'button primary', async () => {
        if (!name.value.trim()) {toast(t('uiStudioText97'), true); return;} start.disabled = true;
        try {
          await media.prepare(shareScreen.control.checked);
          const result = object(await this.api.request('POST', '/streams', {title: name.value, description: description.value, categoryId: categories.value}));
          this.stream = text(result, 'id'); this.broadcasting = true; media.connect(this.stream, true, event => this.realtime(event)); await this.loadDashboard(true);
        } catch (error) {if (!this.broadcasting) media.stop(); throw error;} finally {start.disabled = false;}
      });
      form.append(start); left.append(form);
    }
    const level = text(object(this.dashboard.policy), 'level');
    right.append(html(t('uiStudioText98') + icon('spark') + '</div>'), this.aiStatus(), html("<div class='assistant-card'><span class='shield-orb'>" + icon('shield') + t('uiStudioText99') + escape(levelName(level)) + t('uiStudioText100')),
      button(t('uiStudioText101'), 'button subtle full', () => this.route('moderation')), button(t('uiStudioText102'), 'button subtle full', () => this.route('settings')), html(t('uiStudioText103')));
    layout.append(left, right); this.content.append(layout);
    if (this.broadcasting) {this.content.append(this.chatPanel()); this.launch(() => this.loadMessages()); media.attach();}
    if (this.broadcasting) this.content.append(this.collaborationPanel());
  }
  private async finish(): Promise<void> {
    await this.api.request('POST', `/streams/${this.stream}/end`, {}); this.broadcasting = false; media.stop(); toast(t('uiFinishText104')); await this.loadDashboard(true);
  }
  private async watch(): Promise<void> {
    this.title(t('uiWatchText105'), t('uiWatchText106'), t('uiWatchText107')); const epoch = this.epoch;
    const stream = object(await this.api.request('GET', `/streams/${this.stream}`)); if (epoch !== this.epoch) return;
    this.content.replaceChildren(); this.title(text(stream, 'channel_name'), text(stream, 'title'), text(stream, 'description'));
    const layout = panel('watch-grid'), player = panel('surface');
    player.append(html("<div class='video-stage'><video id='live-video' autoplay playsinline muted controls></video><div class='video-placeholder' id='video-placeholder'>" + icon('video') + t('uiWatchText108')));
    const actions = panel('action-row'); this.audience = document.createElement('span'); this.audience.textContent = text(stream, 'viewers') + t('viewerCountSuffix');
    actions.append(this.audience, button(t('uiWatchText109'), 'button primary small', async () => {
      if (!this.user) {toast(t('uiWatchText110'), true); return;}
      await this.api.request('POST', `/channels/${text(stream, 'channel_id')}/follow`, {}); toast(t('uiWatchText111'));
    }));
    const sound = button(t('mediaEnableSound'), 'button subtle small', () => {
      const video = document.getElementById('live-video');
      if (video instanceof HTMLVideoElement) {
        video.muted = !video.muted; sound.textContent = video.muted ? t('mediaEnableSound') : t('mediaDisableSound');
        void video.play().catch(() => {});
      }
    });
    actions.append(sound);
    player.append(actions); layout.append(player, this.chatPanel()); this.content.append(layout);
    this.collaborationStage = player.querySelector('.video-stage');
    this.collaborationSection = panel('collaboration-section');
    const title = panel('panel-heading'); title.append(html(`<h2>${escape(t('collaborationPerspectives'))}</h2>`));
    this.collaborationPrimary = panel('collaboration-tile');
    const label = document.createElement('strong'); label.textContent = text(stream, 'channel_name');
    if (this.collaborationStage) this.collaborationPrimary.append(label, this.collaborationStage);
    this.collaborationGrid = panel('collaboration-grid'); this.collaborationGrid.append(this.collaborationPrimary);
    this.collaborationSection.append(title, this.collaborationGrid); this.content.append(this.collaborationSection);
    if (text(stream, 'status') === 'LIVE') {await this.loadMessages(); media.connect(this.stream, false, event => this.realtime(event));}
    else toast(t('uiWatchText112'));
    if (text(stream, 'status') === 'LIVE') {
      await this.syncCollaboration(this.stream);
      this.collaborationPoll = window.setInterval(() => this.launch(() => this.syncCollaboration(this.stream)), 10000);
    }
  }

  private collaborationPanel(): HTMLDivElement {
    const card = panel('surface collaboration-card'), heading = panel('panel-heading');
    heading.append(html(`<h2>${escape(t('collaborationTitle'))}</h2>`));
    card.append(heading, html(`<p class="collaboration-copy">${escape(t('collaborationDescription'))}</p>`));
    const actions = panel('action-row'), create = button(t('collaborationCreate'), 'button primary small', async () => {
      create.disabled = true;
      try {
        const result = object(await this.api.request('POST', `/streams/${this.stream}/collaborations`, {}));
        const code = text(result, 'inviteCode');
        if (code) {codeInput.value = code; codeInput.dispatchEvent(new Event('input')); toast(t('collaborationCreated'));}
        await this.showInvite(card, code);
      } finally {create.disabled = false;}
    });
    const codeInput = input(t('collaborationCodePlaceholder')); codeInput.maxLength = 80;
    const join = button(t('collaborationJoin'), 'button subtle small', async () => {
      if (!codeInput.value.trim()) return;
      join.disabled = true;
      try {await this.api.request('POST', '/collaborations/join', {code: codeInput.value.trim()}); toast(t('collaborationJoined')); await this.showInvite(card, '');}
      finally {join.disabled = false;}
    });
    const codeRow = panel('collaboration-code-row'); codeRow.append(codeInput, join);
    actions.append(create); card.append(actions, codeRow);
    this.launch(async () => {
      const state = object(await this.api.request('GET', `/streams/${this.stream}/collaboration`));
      if (state.active) await this.showInvite(card, '');
    });
    return card;
  }

  private async showInvite(card: HTMLDivElement, code: string): Promise<void> {
    const existing = card.querySelector('.collaboration-invite'); existing?.remove();
    const state = object(await this.api.request('GET', `/streams/${this.stream}/collaboration`));
    const participants = rows(state.participants);
    const invite = panel('collaboration-invite');
    const summary = document.createElement('p'); summary.textContent = `${participants.length}/${text(state, 'max_participants') || '4'} ${t('collaborationParticipants')}`;
    invite.append(summary);
    if (code) {
      const entry = input(''); entry.readOnly = true; entry.value = code; entry.setAttribute('aria-label', t('collaborationInviteCode'));
      invite.append(entry, button(t('collaborationCopy'), 'button subtle small', async () => {await navigator.clipboard.writeText(code); toast(t('collaborationCopied'));}));
    }
    if (text(state, 'id')) invite.append(button(t('collaborationLeave'), 'button danger small', async () => {
      await this.api.request('POST', `/collaborations/${text(state, 'id')}/leave`, {}); toast(t('collaborationLeft')); invite.remove();
    }));
    card.append(invite);
  }

  private async syncCollaboration(stream: string): Promise<void> {
    if (!this.collaborationGrid || !this.collaborationSection || this.screen !== 'watch') return;
    const state = object(await this.api.request('GET', `/streams/${stream}/collaboration`));
    const participants = rows(state.participants).filter(row => text(row, 'stream_id') !== stream);
    const active = Boolean(state.active) && participants.length > 0;
    this.collaborationSection.hidden = !active;
    if (active && this.collaborationStage && !this.collaborationStage.isConnected) this.collaborationPrimary?.append(this.collaborationStage);
    if (!active && this.collaborationStage && this.collaborationStage.parentElement !== this.collaborationGrid) {
      const player = this.content.querySelector('.watch-grid > .surface'); player?.prepend(this.collaborationStage);
    }
    for (const [id, tile] of this.collaborationTiles) {
      if (!participants.some(row => text(row, 'stream_id') === id)) {tile.stop(); this.collaborationTiles.delete(id); this.collaborationGrid.querySelector(`[data-collaboration-stream="${CSS.escape(id)}"]`)?.remove();}
    }
    for (const participant of participants) {
      const id = text(participant, 'stream_id'); if (!id || this.collaborationTiles.has(id)) continue;
      const item = panel('collaboration-tile'); item.dataset.collaborationStream = id;
      const label = document.createElement('strong'); label.textContent = `${text(participant, 'channel_name')} · ${text(participant, 'title')}`;
      const stage = panel('video-stage collaboration-video-stage'), video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.controls = true;
      const status = document.createElement('div'); status.className = 'collaboration-video-status'; status.textContent = t('collaborationConnecting');
      stage.append(video, status); item.append(label, stage); this.collaborationGrid.append(item);
      const iceServers = Array.isArray(this.config.iceServers) ? this.config.iceServers as unknown as RTCIceServer[] : [{urls: 'stun:stun.l.google.com:19302'}];
      const tile = new CollaborationTile(video, apiOrigin, this.api.token, id, iceServers);
      this.collaborationTiles.set(id, tile); tile.start();
    }
  }

  private clearCollaboration(): void {
    window.clearInterval(this.collaborationPoll); this.collaborationPoll = 0;
    for (const tile of this.collaborationTiles.values()) tile.stop(); this.collaborationTiles.clear();
    this.collaborationStage = null; this.collaborationPrimary = null; this.collaborationGrid = null; this.collaborationSection = null;
  }
  private chatPanel(): HTMLDivElement {
    this.messageIds.clear(); const container = panel('surface chat-panel');
    container.append(html(t('uiChatPanelText113') + icon('shield') + t('chatModeratedSuffix'))); this.chatList = panel('chat-list'); container.append(this.chatList);
    const message = input(this.user ? t('uiChatPanelText115') : t('uiChatPanelText114')); message.maxLength = 1000;
    const compose = panel('chat-compose'), submit = button(t('uiChatPanelText116'), 'button primary small', async () => {
      if (!this.user) {toast(t('uiChatPanelText117'), true); return;} if (!message.value.trim()) return; submit.disabled = true;
      try {const result = object(await this.api.request('POST', `/streams/${this.stream}/messages`, {content: message.value})); message.value = ''; if (text(result, 'status') !== 'VISIBLE') toast(text(result, 'reason'));}
      finally {submit.disabled = false;}
    });
    message.addEventListener('keydown', event => {if (event.key === 'Enter') submit.click();}); compose.append(message, submit); container.append(compose, html(t('uiChatPanelText118'))); return container;
  }
  private async loadMessages(): Promise<void> {
    if (!this.stream) return; const list = this.chatList; const messages = rows(await this.api.request('GET', `/streams/${this.stream}/messages`));
    if (list !== this.chatList) return; for (const message of messages.reverse()) this.appendMessage(message);
  }
  private appendMessage(message: Row): void {
    if (!this.chatList) return; const id = text(message, 'id'); if (this.messageIds.has(id)) return; this.messageIds.add(id);
    const row = panel('chat-message'); row.append(html(`<span class="chat-author">${escape(text(message, 'username'))}</span><span>${escape(text(message, 'content'))}</span>`)); this.chatList.append(row);
    if (this.chatList.children.length > 100) this.chatList.firstElementChild?.remove(); this.chatList.scrollTop = this.chatList.scrollHeight;
  }
  private realtime(event: LiveEvent): void {
    switch (event.type) {
      case 'message': this.appendMessage(object(event.message)); break;
      case 'presence':
        if (this.audience) this.audience.textContent = String(event.viewers ?? 0) + t('viewerCountSuffix');
        if (event.hostOnline === false) toast(t('uiHostDisconnected'));
        break;
      case 'notice': toast(event.body ?? ''); break;
      case 'error': toast(typeof event.message === 'string' ? event.message : t('mediaEventFailed'), true); break;
      case 'ended':
        this.broadcasting = false; toast(typeof event.message === 'string' ? event.message : t('uiFinishText104')); media.stop();
        if (this.screen === 'studio') this.launch(() => this.loadDashboard(true)); break;
      case 'queue-updated': if (this.screen === 'moderation') this.launch(() => this.loadDashboard(true)); break;
      case 'clips-updated': toast(t('uiRealtimeText119')); if (this.screen === 'clips') this.launch(() => this.loadDashboard(true)); break;
      case 'capture-status': toast(typeof event.message === 'string' ? event.message : '', event.error); break;
    }
  }
  private moderation(): void {
    this.title(t('uiModerationText120'), t('uiShellText10'), t('uiModerationText122')); this.stats(); this.content.append(this.aiStatus());
    const queue = rows(this.dashboard.queue), list = panel('surface moderation-list'); list.append(html(t('uiModerationText123') + queue.length + '</span></div>'));
    if (!queue.length) list.append(empty(t('uiModerationText124'), t('uiModerationText125')));
    for (const message of queue) {
      const row = panel('review-row'); row.append(html(`<div class="review-content"><div class="review-meta"><strong>@${escape(text(message, 'username'))}</strong><span class="tag">${escape(text(message, 'category'))}</span><span class="muted">${escape(providerName(text(message, 'provider')))}</span></div><p class="quoted-message">${escape(text(message, 'content'))}</p><p class="muted">${escape(text(message, 'reason'))}</p></div>`));
      const actions = panel('action-row'); actions.append(button(t('uiModerationText126'), 'button primary small', () => this.reviewMessage(message, true)), button(t('uiModerationText127'), 'button danger small', () => this.reviewMessage(message, false)),
        button(t('muteFiveMinutes'), 'button subtle small', async () => {await this.api.request('POST', `/channels/${this.channel}/sanctions`, {userId: text(message, 'user_id'), type: 'MUTE', seconds: 300, reason: t('uiModerationText128')}); toast(t('uiModerationText129')); await this.loadDashboard(true);}));
      row.append(actions); list.append(row);
    }
    const sanctions = panel('surface'); sanctions.append(html(`<div class="panel-heading"><h2>${t('activeSanctions')}</h2></div>`)); const entries = rows(this.dashboard.sanctions);
    if (!entries.length) sanctions.append(html(t('uiModerationText130')));
    for (const sanction of entries) {
      const row = panel('simple-row'), label = document.createElement('span'); label.textContent = `@${text(sanction, 'username')} · ${text(sanction, 'type') === 'BAN' ? t('uiModerationText131') : t('uiModerationText132')} · ${text(sanction, 'expires_at')}`;
      row.append(label, button(t('uiModerationText133'), 'button subtle small', async () => {await this.api.request('DELETE', `/sanctions/${text(sanction, 'id')}`); await this.loadDashboard(true);})); sanctions.append(row);
    }
    this.content.append(list, sanctions);
  }
  private async reviewMessage(message: Row, approve: boolean): Promise<void> {
    await this.api.request('POST', `/moderation/${text(message, 'id')}/review`, {approve}); toast(approve ? t('uiReviewMessageText134') : t('uiReviewMessageText135')); await this.loadDashboard(true);
  }
  private clips(): void {
    this.title(t('uiClipsText136'), t('uiClipsText137'), t('uiClipsText138')); const grid = panel('clip-grid'), clips = rows(this.dashboard.clips);
    if (!clips.length) grid.append(empty(t('uiClipsText139'), t('uiClipsText140')));
    for (const clip of clips) grid.append(this.clipCard(clip, this.owner())); this.content.append(grid);
  }
  private clipCard(clip: Row, manage: boolean): HTMLDivElement {
    const card = panel('surface clip-card'), asset = text(clip, 'asset_id'), id = `clip-${text(clip, 'id')}`;
    card.append(html(`<div class="clip-stage"><video id="${escape(id)}" playsinline controls></video></div><div class="clip-copy"><div class="review-meta"><span class="tag">${escape(statusName(text(clip, 'status')))}</span><span class="muted">${escape(text(clip, 'start_seconds'))} – ${escape(text(clip, 'end_seconds'))} s</span></div><h3>${escape(text(clip, 'title'))}</h3><p class="muted">${escape(text(clip, 'description'))}</p></div>`));
    const actions = panel('action-row clip-actions'); actions.append(button(t('viewVideo'), 'button subtle small', () => media.playback(asset, id, false)), button(t('uiClipCardText141'), 'button subtle small', () => media.playback(asset, id, true)));
    if (manage) actions.append(button(t('uiClipCardText142'), 'button subtle small', () => this.editClip(clip)), button(t('uiClipCardText143'), 'button primary small', () => this.clipReview(clip, true)), button(t('uiClipCardText144'), 'button danger small', () => this.clipReview(clip, false)));
    if (text(clip, 'status') === 'APPROVED') actions.append(button(t('uiClipCardText145'), 'button subtle small', async () => {if (await media.share(asset, text(clip, 'title'))) toast(t('uiClipCardText146'));})); card.append(actions); return card;
  }
  private async clipReview(clip: Row, approve: boolean): Promise<void> {
    await this.api.request('POST', `/clips/${text(clip, 'id')}/review`, {approve}); toast(approve ? t('clipPublished') : t('clipRejected')); await this.loadDashboard(true);
  }
  private editClip(clip: Row): void {
    const modal = dialog(t('editClip')), title = input(t('uiEditClipText147'), text(clip, 'title')), description = area(t('uiCreateChannelText64'), text(clip, 'description'));
    const start = input('0', '0'), end = input(t('uiEditClipText149'), String(Math.floor(Number(text(clip, 'end_seconds')) - Number(text(clip, 'start_seconds')))));
    start.type = end.type = 'number'; start.step = end.step = '0.1'; const row = panel('form-row'); row.append(field(t('trimStart'), start), field(t('trimEnd'), end));
    modal.form.append(field(t('uiEditClipText147'), title), field(t('uiCreateChannelText64'), description), html(t('uiEditClipText152')), row,
      button(t('saveChanges'), 'button primary', async () => {
        const from = Number(start.value), until = Number(end.value);
        if (!start.value || !end.value || !Number.isFinite(from) || !Number.isFinite(until)) {toast(t('uiEditClipText153'), true); return;}
        await this.api.request('PUT', `/clips/${text(clip, 'id')}`, {title: title.value, description: description.value, start: from, end: until}); modal.close(); await this.loadDashboard(true);
      }), button(t('uiEditClipText154'), 'button subtle', modal.close)); title.focus();
  }
  private async publicClips(): Promise<void> {
    this.title(t('uiPublicClipsText155'), t('uiPublicClipsText156'), t('uiPublicClipsText157')); const grid = panel('clip-grid'); this.content.append(grid);
    const clips = rows(await this.api.request('GET', '/clips/public')); if (!grid.isConnected) return;
    if (!clips.length) grid.append(empty(t('uiPublicClipsText158'), t('uiPublicClipsText159')));
    for (const clip of clips) grid.append(this.clipCard(clip, false));
    if (location.hash.startsWith('#clip=')) {
      const asset = decodeURIComponent(location.hash.slice(6)), match = clips.find(clip => text(clip, 'asset_id') === asset);
      if (match) await media.playback(asset, `clip-${text(match, 'id')}`, false);
    }
  }
  private assistant(): void {
    this.title(t('uiAssistantText160'), t('uiAssistantText161'), t('uiAssistantText162')); this.content.append(this.aiStatus()); const latest = object(this.dashboard.stream);
    if (!text(latest, 'id')) {this.content.append(empty(t('uiAssistantText163'), t('uiAssistantText164'))); return;}
    const generate = button(t('uiAssistantText165'), 'button primary', async () => {
      generate.disabled = true;
      try {const result = object(await this.api.request('POST', `/streams/${text(latest, 'id')}/summary`, {})); toast(t('uiAssistantText166') + providerName(text(result, 'provider'))); await this.loadDashboard(true);}
      finally {generate.disabled = false;}
    }); this.content.append(generate);
    const ai = object(this.dashboard.ai), summaries = rows(ai.summaries), surface = panel('surface assistant-summary');
    surface.append(html(t('uiAssistantText167') + icon('spark') + '</div>'), html(`<p class="summary-text">${escape(summaries[0] ? text(summaries[0], 'content') : t('uiAssistantText168'))}</p>`));
    const tags = panel('category-row'); for (const topic of rows(ai.topics)) tags.append(html(`<span class="category-chip">${escape(text(topic, 'label'))}</span>`)); surface.append(tags);
    const faqs = panel('surface assistant-summary'); faqs.append(html(t('uiAssistantText169'))); const questions = rows(ai.faqs);
    if (!questions.length) faqs.append(html(t('uiAssistantText170')));
    for (const question of questions) faqs.append(html(`<article class="faq-item"><h3>${escape(text(question, 'question'))}</h3><p>${escape(text(question, 'answer'))}</p></article>`));
    this.content.append(surface, faqs, html(t('uiAssistantText171')));
  }
  private settings(): void {
    this.title(t('uiSettingsText172'), t('uiSettingsText173'), t('uiSettingsText174'));
    if (!this.owner()) {this.content.append(empty(t('uiSettingsText175'), t('uiSettingsText176'))); return;}
    const policy = object(this.dashboard.policy), settings = object(this.dashboard.settings), form = panel('surface settings-form');
    const level = select([[t('uiSettingsText177'), 'RELAXED'], [t('uiSettingsText178'), 'BALANCED'], [t('uiSettingsText179'), 'STRICT']], text(policy, 'level'));
    const hide = checkbox(t('uiSettingsText181'), flag(policy, 'autoHide')), mute = checkbox(t('uiSettingsText182'), flag(policy, 'autoMute'));
    const links = checkbox(t('uiSettingsText183'), flag(policy, 'allowLinks')), auto = checkbox(t('uiSettingsText184'), flag(settings, 'auto_clips'));
    const seconds = input('300', text(policy, 'muteSeconds')), slow = input('0', text(settings, 'slow_mode_seconds')); seconds.type = slow.type = 'number';
    const row = panel('form-row'); row.append(field(t('uiSettingsText185'), seconds), field(t('uiSettingsText186'), slow));
    const words = area(t('uiSettingsText187'), stringList(policy.blockedWords).join('\n')), topics = area(t('uiSettingsText188'), stringList(policy.blockedTopics).join('\n'));
    form.append(field(t('uiSettingsText180'), level), hide.element, mute.element, links.element, auto.element, row, field(t('restrictedWords'), words), field(t('uiSettingsText189'), topics));
    const save = button(t('uiSettingsText190'), 'button primary', async () => {
      const muteSeconds = Number(seconds.value), slowMode = Number(slow.value);
      if (!seconds.value || !slow.value || !Number.isInteger(muteSeconds) || !Number.isInteger(slowMode)) {toast(t('uiSettingsText192'), true); return;} save.disabled = true;
      try {
        await this.api.request('PUT', `/channels/${this.channel}/policy`, {level: level.value, autoHide: hide.control.checked, autoMute: mute.control.checked,
          muteSeconds, reviewThreshold: level.value === 'STRICT' ? .4 : level.value === 'RELAXED' ? .7 : .55,
          blockThreshold: level.value === 'STRICT' ? .7 : level.value === 'RELAXED' ? .95 : .85, allowLinks: links.control.checked, slowMode, autoClips: auto.control.checked,
          blockedWords: lines(words.value), blockedTopics: lines(topics.value)});
        toast(t('uiSettingsText191')); await this.loadDashboard(true);
      } finally {save.disabled = false;}
    }); form.append(save);
    const moderators = panel('surface settings-form'), username = input(t('uiAuthViewText45')); moderators.append(html(t('uiSettingsText193')), field(t('uiSettingsText195'), username),
      button(t('addModerator'), 'button subtle', async () => {await this.api.request('POST', `/channels/${this.channel}/moderators`, {username: username.value}); await this.loadDashboard(true);}));
    for (const moderator of rows(this.dashboard.moderators)) {
      const row = panel('simple-row'), label = document.createElement('span'); label.textContent = '@' + text(moderator, 'username');
      row.append(label, button(t('uiSettingsText196'), 'button danger small', async () => {await this.api.request('DELETE', `/channels/${this.channel}/moderators/${text(moderator, 'user_id')}`); await this.loadDashboard(true);})); moderators.append(row);
    }
    this.content.append(form, moderators);
  }
  private async notifications(): Promise<void> {
    const modal = dialog(t('uiNotificationsText197')); modal.form.append(button(t('uiNotificationsText198'), 'button subtle', modal.close));
    const notices = rows(await this.api.request('GET', '/notifications')); if (!modal.element.isConnected) return;
    if (!notices.length) modal.form.append(document.createTextNode(t('uiNotificationsText199')));
    for (const notice of notices) {
      modal.form.append(html(`<article class="faq-item"><h3>${escape(text(notice, 'title'))}</h3><p>${escape(text(notice, 'body'))}</p></article>`));
      this.launch(async () => {await this.api.request('POST', `/notifications/${text(notice, 'id')}/read`, {});});
    }
  }
  private account(): void {
    this.title(t('uiAccountText200'), '@' + text(this.user, 'username'), text(this.user, 'email'));
    this.content.append(button(t('uiAccountText201'), 'button subtle', () => {this.channel = ''; this.route('studio');}), button(t('uiAccountText202'), 'button danger', async () => {
      if (this.broadcasting) await this.api.request('POST', `/streams/${this.stream}/end`, {});
      await this.api.request('POST', '/auth/logout', {}); media.stop(); this.broadcasting = false; this.api.setToken(''); this.user = null; this.channel = ''; this.dashboard = {}; this.configureMedia(); this.route('explore');
    }));
  }
  private aiStatus(): HTMLDivElement {
    const configured = flag(this.config, 'aiConfigured');
    const localModel = text(this.config, 'aiMode') === 'OLLAMA';
    return html(`<div class="info-banner${configured ? ' success-banner' : ''}">${icon('spark')}<div><strong>${configured ? (localModel ? t('localAiConfigured') : t('uiAiStatusText203')) : t('uiAiStatusText204')}</strong><p>${configured ? (localModel ? t('localAiAvailability') : t('uiAiStatusText205')) : t('uiAiStatusText206')}</p></div></div>`);
  }
}
function stringList(value: Json | undefined): string[] {return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];}
function lines(value: string): string[] {return value.split('\n').map(item => item.trim()).filter(Boolean);}
function levelName(level: string): string {return level === 'STRICT' ? t('uiLevelNameText207') : level === 'RELAXED' ? t('uiLevelNameText208') : t('uiLevelNameText209');}
function providerName(provider: string): string {return provider === 'OLLAMA' ? t('localAiProvider') : provider === 'GEMINI' ? 'Gemini' : provider === 'UNAVAILABLE' ? t('uiProviderNameText210') : t('uiProviderNameText211');}
function statusName(status: string): string {return status === 'APPROVED' ? t('uiStatusNameText212') : status === 'REJECTED' ? t('uiStatusNameText213') : t('uiStatusNameText214');}
