import {ApiClient, apiOrigin} from './api';
import {object, rows, text, flag, mediaConfig, type Json, type Row, type LiveEvent} from './contracts';
import {panel, html, escape, input, area, field, button, checkbox, select, toast, empty, dialog, icon} from './dom';
import {t} from './i18n';
import {media} from './media';
import {CollaborationTile} from './collaboration';
import './collaboration.css';
import {constrain, validate, guidance} from './forms';
import {beginActivity} from './activity';
import './light.css';

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
  private screen: Screen = 'login';
  private locationWatch: number | null = null;
  private locationChannel = '';
  private locationTimer = 0;
  private sharedLocationPoll = 0;
  private currentPosition: GeolocationPosition | null = null;
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
  private collaborationPlayer: HTMLDivElement | null = null;
  private collaborationCard: HTMLDivElement | null = null;

  constructor(private readonly root: HTMLElement) {
    this.api.onUnauthorized = () => {
      this.user = null;
      if (this.broadcasting) {media.stop(); this.broadcasting=false;}
      this.stopLocation(); this.configureMedia();
      if (!['login','register'].includes(this.screen)) this.route('login');
    };
  }
  async start(): Promise<void> {
    const loading = panel('startup-loading');
    loading.setAttribute('role', 'status'); const spinner=panel('spinner'); spinner.setAttribute('aria-hidden','true'); loading.append(spinner,document.createTextNode(t('processing')));
    this.root.replaceChildren(loading);
    this.api.setToken('');
    try {this.user=object(await this.api.request('GET','/users/me',undefined,true));} catch {this.user=null;}
    if (this.user) {await this.bootstrap(); this.screen=location.hash.startsWith('#clip=') ? 'public-clips' : 'explore';}
    this.configureMedia(); this.shell(); await this.render();
    window.setInterval(() => {
      if ((this.screen === 'studio' || this.screen === 'moderation') && this.channel) this.launch(() => this.loadDashboard(false));
    }, 15000);
  }
  private async bootstrap(): Promise<void> {
    const [config,categories] = await Promise.all([this.api.request('GET','/config'),this.api.request('GET','/categories')]);
    this.config=object(config); this.categories=rows(categories); this.configureMedia();
  }
  private configureMedia(): void {media.configure(apiOrigin, this.api.token, mediaConfig(this.config));}
  private launch(action: () => Promise<void>): void {void action().catch(error => toast(error instanceof Error ? error.message : t('uiOnErrorText04'), true));}
  private shell(): void {
    this.root.replaceChildren(); this.root.className = 'app-shell';
    if (!this.user) {
      this.root.className='auth-shell'; this.content=panel('auth-content');
      this.root.append(html(`<aside class="auth-introduction"><a class="auth-brand" href="#">${icon('shield')}<span>StreamGuard</span></a><p class="eyebrow">${escape(t('authBrandEyebrow'))}</p><h1>${escape(t('authBrandTitle'))}</h1><p>${escape(t('authBrandDescription'))}</p><div class="auth-benefits">${icon('video')}<span>${escape(t('authBrandVideo'))}</span>${icon('shield')}<span>${escape(t('authBrandCommunity'))}</span></div></aside>`),this.content); return;
    }
    const skipLink = document.createElement('a'); skipLink.className = 'skip-link'; skipLink.href = '#page-content'; skipLink.textContent = t('skipToMainContent');
    const side = panel('sidebar'); side.append(html(t('uiShellText05') + icon('shield') + t('uiShellText06')));
    side.querySelector('.brand')?.addEventListener('click', event => {event.preventDefault(); this.route('explore');});
    const first = panel('nav-list'); first.append(this.navButton('explore', t('uiShellText08'), 'grid'), this.navButton('studio', t('myStudio'), 'video'));
    const second = panel('nav-list'); second.append(this.navButton('moderation', t('uiShellText10'), 'shield'), this.navButton('clips', t('uiShellText11'), 'play'), this.navButton('assistant', t('uiShellText12'), 'spark'), this.navButton('settings', t('uiShellText13'), 'settings'));
    const navigation = document.createElement('nav'); navigation.id = 'main-navigation'; navigation.setAttribute('aria-label', t('mainNavigationLabel'));
    navigation.append(html(t('uiShellText07')), first, html(t('uiShellText09')), second);
    side.append(navigation, html(t('uiShellText14')));
    const main = panel('main-shell'), header = panel('topbar');
    const menu = button('☰', 'menu-button', () => {
      this.mobileNav = !this.mobileNav; this.root.className = `app-shell${this.mobileNav ? ' nav-open' : ''}`;
      menu.setAttribute('aria-expanded', String(this.mobileNav)); menu.setAttribute('aria-label', t(this.mobileNav ? 'uiMenuHide' : 'uiShellText15'));
    });
    menu.setAttribute('aria-label', t('uiShellText15')); menu.setAttribute('aria-expanded', String(this.mobileNav)); menu.setAttribute('aria-controls', 'main-navigation');
    const find = panel('global-search'), query = input(t('uiShellText16'), this.search); query.setAttribute('aria-label', t('uiShellText16'));
    query.maxLength=100;
    query.addEventListener('keydown', event => {if (event.key === 'Enter') {this.search = query.value; this.route('explore');}});
    find.append(html(icon('search')), query);
    const account = panel('account-actions'); account.append(html(t('uiShellText17')));
    if (!this.user) account.append(button(t('uiShellText18'), 'button primary small', () => this.route('login')));
    else {
      const badge = button(text(this.user, 'username').slice(0, 1).toUpperCase(), 'avatar', () => this.route('account')); badge.setAttribute('aria-label', t('myAccount'));
      account.append(button(t('uiShellText19'), 'button icon-button', () => this.notifications()), badge);
    }
    header.append(menu, find, account); this.content = panel('page-content'); this.content.id = 'page-content'; this.content.setAttribute('role', 'main'); this.content.tabIndex = -1;
    main.append(header, this.content); this.root.append(skipLink, side, main);
    if (this.broadcasting && this.screen !== 'studio') this.floatingPlayer();
  }
  private navButton(key: Screen, label: string, glyph: string): HTMLButtonElement {
    const control = button(label, `nav-item${this.screen === key ? ' active' : ''}`, () => this.route(key));
    control.innerHTML = icon(glyph) + `<span>${escape(label)}</span>` + (key === 'moderation' ? t('uiNavButtonText20') : '');
    control.setAttribute('aria-label', label); if (this.screen === key) control.setAttribute('aria-current', 'page'); return control;
  }
  private route(next: Screen): void {
    if (!this.user && !['login','register'].includes(next)) next='login';
    this.clearCollaboration();
    window.clearInterval(this.sharedLocationPoll); this.sharedLocationPoll=0;
    if (!this.broadcasting && this.screen === 'watch') media.stop();
    this.screen = next; this.mobileNav = false; this.epoch++; this.messageIds.clear(); this.audience = null;
    this.shell(); window.scrollTo(0,0); this.launch(() => this.render());
  }
  private async render(): Promise<void> {
    this.content.replaceChildren(); this.chatList = null;
    if (!this.user) {this.authView(this.screen==='register'); return;}
    if (this.screen === 'explore') return this.explore();
    if (this.screen === 'login' || this.screen === 'register') {this.authView(this.screen === 'register'); return;}
    if (this.screen === 'watch') return this.watch();
    if (this.screen === 'public-clips') return this.publicClips();
    if (!this.user) {this.authView(false); return;}
    if (this.screen === 'account') return this.account();
    if (!this.channel) {
      const epoch = this.epoch; const channels = rows(await this.api.request('GET', '/channels/mine'));
      if (epoch !== this.epoch) return;
      if (!channels.length) {this.createChannel(); return;}
      if (channels.length > 1) {this.chooseChannel(channels); return;}
      this.channel = text(channels[0] ?? {}, 'id');
    }
    await this.loadDashboard(true);
  }
  private floatingPlayer(): void {
    const floating=panel('floating-player');
    floating.append(html(`<div class="floating-heading"><span class="status-dot"></span><strong>${escape(t('floatingLive'))}</strong></div><video id="live-video" autoplay playsinline muted></video>`));
    floating.append(button(t('returnToStudio'),'button primary small',()=>this.route('studio')),button(t('pictureInPicture'),'button subtle small',async()=>{
      const video=floating.querySelector('video');
      if (video && document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
      else toast(t('pictureInPictureUnavailable'));
    }));
    this.root.append(floating); queueMicrotask(()=>media.attach());
  }
  private openStream(stream: Row): void {
    if (this.broadcasting) {
      const modal=dialog(text(stream,'title')), video=document.createElement('video'); video.autoplay=true; video.playsInline=true; video.controls=true;
      modal.form.append(video,button(t('closeWindow'),'button subtle',modal.close));
      const servers=Array.isArray(this.config.iceServers) ? this.config.iceServers as unknown as RTCIceServer[] : [];
      const tile=new CollaborationTile(video,apiOrigin,'',text(stream,'id'),servers); tile.start(); modal.element.addEventListener('close',()=>tile.stop());
    } else {this.stream=text(stream,'id'); this.route('watch');}
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
        card.append(button(t('uiExploreText32'), 'button subtle full', () => this.openStream(stream))); cards.append(card);
      }
    } catch (error) {if (cards.isConnected) {cards.replaceChildren(empty(t('uiExploreText33'), t('uiExploreText34'))); throw error;}}
  }
  private authView(register: boolean): void {
    this.title(t('welcomeEyebrow'), register ? t('uiAuthViewText38') : t('uiAuthViewText39'), register ? t('uiAuthViewText40') : t('uiAuthViewText41'));
    const card = panel('form-card auth-card'), username = input(t('uiAuthViewText42')), email = input(t('uiAuthViewText43')), password = input(register ? t('uiAuthViewText44') : t('uiAuthViewText47'));
    email.type = 'email'; email.autocomplete = 'email'; password.type = 'password'; password.autocomplete = register ? 'new-password' : 'current-password';
    password.minLength = register ? 10 : 0;
    const emailField = field(t('uiAuthViewText46'), email), emailHint = document.createElement('small');
    emailHint.className = 'form-hint'; emailHint.setAttribute('role', 'status'); emailHint.setAttribute('aria-live', 'polite');
    if (register) emailField.append(emailHint);
    const passwordField = field(t('uiAuthViewText47'), password), passwordHint = document.createElement('small');
    constrain(email,{max:254,required:true,pattern:'[^\\s@]+@(gmail\\.com|hotmail\\.com)'},t('authEmailHelp'));
    constrain(password,{max:72,min:register ? 10 : 1,bytes:72,required:true},register ? t('authPasswordHelp') : t('loginPasswordHelp'));
    const passwordBox=panel('password-control'); passwordBox.append(password);
    const reveal=button('', 'password-reveal',()=>{
      const visible=password.type==='password'; password.type=visible ? 'text' : 'password';
      reveal.innerHTML=icon(visible ? 'eye-off' : 'eye'); reveal.setAttribute('aria-label',t(visible ? 'hidePassword' : 'showPassword')); reveal.setAttribute('aria-pressed',String(visible));
    }); reveal.innerHTML=icon('eye'); reveal.setAttribute('aria-label',t('showPassword')); reveal.setAttribute('aria-pressed','false'); passwordBox.append(reveal);
    passwordField.querySelector('label')?.after(passwordBox);
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
    email.addEventListener('input',()=>{email.value=email.value.toLowerCase();});
    password.addEventListener('input', updatePasswordHint);
    const consent = checkbox(t('uiAuthViewText48'), false, 'consent');
    if (register) {
      const usernameField=field(t('uiAuthViewText45'),username); card.append(usernameField);
      constrain(username,{min:3,max:32,required:true,pattern:'[A-Za-z0-9_]{3,32}'},t('usernameHelp')); consent.control.required=true;
    }
    card.append(emailField, passwordField); if (register) card.append(consent.element);
    const submit = button(register ? t('createAccount') : t('signIn'), 'button primary full', async () => {
      if (!acceptedEmail()) {email.setCustomValidity(t('authProviderEmailRequired')); email.reportValidity(); return;}
      if (!validate(card)) return;
      submit.disabled = true;
      try {
        const body: Row = {email: email.value.trim(), password: password.value}; if (register) {body.username = username.value; body.aiConsent = consent.control.checked;}
        await this.api.request('POST', register ? '/auth/register' : '/auth/login', body);
        password.value=''; this.user=object(await this.api.request('GET','/users/me')); await this.bootstrap();
        this.channel = ''; this.dashboard = {}; toast(t('authSuccess')); this.route('explore');
      } catch {toast(t('authFailed'),true);
      } finally {submit.disabled = false;}
    });
    password.addEventListener('keydown', event => {if (event.key === 'Enter') submit.click();});
    card.append(submit, button(register ? t('uiAuthViewText50') : t('uiAuthViewText51'), 'text-button', () => this.route(register ? 'login' : 'register')));
    guidance(card,register ? t('registerGuidance') : t('loginGuidance')); this.content.append(card);
  }
  private chooseChannel(channels: Row[]): void {
    this.title(t('uiChooseChannelText52'), t('uiChooseChannelText53'), t('uiChooseChannelText54'));
    for (const channel of channels) this.content.append(button(text(channel, 'name') + (flag(channel, 'is_owner') ? t('uiChooseChannelText55') : t('moderatorSuffix')), 'button subtle', async () => {this.channel = text(channel, 'id'); await this.loadDashboard(true);}));
  }
  private createChannel(): void {
    this.content.replaceChildren(); this.title(t('uiCreateChannelText56'), t('uiCreateChannelText57'), t('uiCreateChannelText58'));
    const form = panel('form-card auth-card'), name = input(t('uiCreateChannelText59'));
    const description = area(t('uiCreateChannelText61'));
    form.append(field(t('uiCreateChannelText59'), name), field(t('uiCreateChannelText64'), description));
    constrain(name,{max:80,required:true},t('channelNameHelp')); constrain(description,{max:2000},t('descriptionHelp'));
    const shareLocation=checkbox(t('shareLocationLabel')), locationStatus=panel('location-status'); locationStatus.hidden=true;
    let position: GeolocationPosition | null=null;
    shareLocation.control.addEventListener('change',()=>{
      locationStatus.hidden=!shareLocation.control.checked; position=null;
      if (shareLocation.control.checked) {locationStatus.textContent=t('locationLoading'); void this.locate().then(value=>{
        if (!shareLocation.control.checked) return; position=value; locationStatus.textContent=t('locationReady');
      }).catch(()=>{shareLocation.control.checked=false; locationStatus.textContent=t('locationUnavailable'); toast(t('locationUnavailable'),true);});}
    });
    form.append(shareLocation.element,locationStatus); guidance(form,t('channelGuidance'));
    const submit = button(t('uiCreateChannelText65'), 'button primary', async () => {
      if (!validate(form)) return;
      if (shareLocation.control.checked && !position) {toast(t('locationLoading')); return;}
      submit.disabled = true;
      try {const result = object(await this.api.request('POST', '/channels', {name: name.value.trim(), description: description.value})); this.channel = text(result, 'id');
        if (shareLocation.control.checked && position) await this.startLocation(this.channel,position);
        toast(t('operationSuccess')); await this.loadDashboard(true);}
      finally {submit.disabled = false;}
    });
    form.append(submit); this.content.append(form);
  }
  private async locate(): Promise<GeolocationPosition> {
    const done=beginActivity();
    try {return await new Promise((resolve,reject)=>{
      if (!navigator.geolocation) {reject(new Error(t('locationUnavailable'))); return;}
      navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error(t('locationUnavailable'))),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
    });} finally {done();}
  }
  private async startLocation(channel: string, position: GeolocationPosition): Promise<void> {
    this.stopLocation(); this.locationChannel=channel; this.currentPosition=position;
    await this.sendLocation();
    this.locationWatch=navigator.geolocation.watchPosition(value=>{this.currentPosition=value;},()=>{this.stopLocation(); toast(t('locationUnavailable'),true);},{enableHighAccuracy:true,maximumAge:10000});
    this.locationTimer=window.setInterval(()=>this.launch(()=>this.sendLocation()),20000);
  }
  private async sendLocation(): Promise<void> {
    const p=this.currentPosition; if (!p || !this.locationChannel) return;
    await this.api.request('PUT',`/channels/${this.locationChannel}/location`,{shared:true,latitude:p.coords.latitude,longitude:p.coords.longitude},true);
  }
  private stopLocation(): void {
    if (this.locationWatch!==null) navigator.geolocation?.clearWatch(this.locationWatch);
    window.clearInterval(this.locationTimer); this.locationWatch=null; this.currentPosition=null; this.locationChannel='';
  }
  private async loadDashboard(render: boolean): Promise<void> {
    const epoch = this.epoch, channel = this.channel;
    const snapshot = object(await this.api.request('GET', `/channels/${channel}/dashboard`,undefined,!render));
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
    this.clearCollaboration();
    this.title(t('uiStudioText74'), t('studioGreeting') + text(this.user, 'username') + ' ✦', t('uiStudioText75')); this.stats();
    const latest = object(this.dashboard.stream);
    if (!this.owner()) {
      this.content.append(html(t('uiStudioText76') + escape(text(object(this.dashboard.channel), 'name')) + '.</div>'));
      if (text(latest, 'status') === 'LIVE') this.content.append(button(t('uiStudioText77'), 'button primary', () => {this.stream = text(latest, 'id'); this.route('watch');})); return;
    }
    const layout = panel('studio-grid'), left = panel('surface'), right = panel('surface studio-assistant');
    left.append(html(t('uiStudioText78') + (this.broadcasting ? t('uiStudioText79') : t('uiStudioText80')) + "</span></div><div class='video-stage'><video id='live-video' autoplay playsinline muted></video><div class='video-placeholder' id='video-placeholder'>" + icon('video') + t('uiStudioText81')));
    if (this.broadcasting) {
      const actions = panel('action-row');
      const microphone = button('', 'button subtle media-toggle', () => {
        const enabled = media.toggleMicrophone();
        microphone.innerHTML = icon(enabled ? 'microphone' : 'microphone-off') + `<span>${enabled ? t('uiStudioText104') : t('uiStudioText105')}</span>`;
        microphone.setAttribute('aria-pressed', String(enabled));
        microphone.setAttribute('aria-label', enabled ? t('uiStudioText104') : t('uiStudioText105'));
        microphone.title = enabled ? t('uiStudioText104') : t('uiStudioText105');
      });
      microphone.innerHTML = icon(media.microphoneEnabled() ? 'microphone' : 'microphone-off') + `<span>${media.microphoneEnabled() ? t('uiStudioText104') : t('uiStudioText105')}</span>`;
      microphone.setAttribute('aria-pressed', String(media.microphoneEnabled()));
      microphone.setAttribute('aria-label', media.microphoneEnabled() ? t('uiStudioText104') : t('uiStudioText105'));
      const camera = button('', 'button subtle media-toggle', () => {
        const enabled = media.toggleCamera();
        camera.innerHTML = icon(enabled ? 'camera' : 'camera-off') + `<span>${enabled ? t('uiStudioText119') : t('uiStudioText120')}</span>`;
        camera.setAttribute('aria-pressed', String(enabled));
        camera.setAttribute('aria-label', enabled ? t('uiStudioText119') : t('uiStudioText120'));
        camera.title = enabled ? t('uiStudioText119') : t('uiStudioText120');
      });
      camera.innerHTML = icon(media.cameraEnabled() ? 'camera' : 'camera-off') + `<span>${media.cameraEnabled() ? t('uiStudioText119') : t('uiStudioText120')}</span>`;
      camera.setAttribute('aria-pressed', String(media.cameraEnabled()));
      camera.setAttribute('aria-label', media.cameraEnabled() ? t('uiStudioText119') : t('uiStudioText120'));
      camera.disabled = !media.cameraAvailable();
      camera.title = camera.disabled ? t('mediaCameraMissing') : (media.cameraEnabled() ? t('uiStudioText119') : t('uiStudioText120'));
      const switchCamera = button('', 'button subtle media-toggle', async () => {
        switchCamera.disabled = true; camera.disabled = true;
        try {await media.switchCamera();}
        finally {
          switchCamera.disabled = !media.cameraAvailable(); camera.disabled = !media.cameraAvailable();
          updateCameraLabel();
        }
      });
      const updateCameraLabel = (): void => {
        switchCamera.innerHTML = icon('camera-switch') + `<span>${media.cameraFacing() === 'user' ? t('mediaUseRearCamera') : t('mediaUseFrontCamera')}</span>`;
        switchCamera.setAttribute('aria-label', switchCamera.textContent ?? '');
      };
      updateCameraLabel(); switchCamera.disabled = !media.cameraAvailable();
      actions.append(button(t('uiStudioText82'), 'button primary', async () => {await this.api.request('POST', `/streams/${this.stream}/highlights`, {source: 'MANUAL', reason: t('uiStudioText83')}); toast(t('uiStudioText84'));}),
        microphone, camera, switchCamera, button(t('uiStudioText85'), 'button subtle', async () => {await media.captions(); toast(t('uiStudioText86'));}), button(t('uiStudioText87'), 'button danger', () => this.finish()));
      left.append(actions);
    } else if (text(latest, 'status') === 'LIVE') {
      left.append(html(t('uiStudioText88')), button(t('uiStudioText89'), 'button danger', async () => {await this.api.request('POST', `/streams/${text(latest, 'id')}/end`, {}); await this.loadDashboard(true);}));
    } else {
      const form = panel('stream-form'), name = input(t('uiStudioText90')), description = area(t('uiStudioText91'));
      const categories = select(this.categories.map(row => [text(row, 'name'), text(row, 'id')]));
      const shareScreen = checkbox(t('uiStudioText92')); const row = panel('form-row');
      row.append(field(t('uiStudioText94'), categories), field(t('uiCreateChannelText64'), description));
      const cameraFacing = select([[t('mediaFrontCamera'), 'user'], [t('mediaRearCamera'), 'environment']]);
      shareScreen.control.disabled = !media.screenSharingSupported();
      if (shareScreen.control.disabled) shareScreen.control.checked = false;
      form.append(field(t('uiStudioText93'), name), row, field(t('mediaCameraSelection'), cameraFacing), shareScreen.element);
      const mediaHint = panel('capture-hint');
      mediaHint.textContent = shareScreen.control.disabled ? t('mediaMobileCameraHint') : t('mediaDevicePermissionsHint');
      form.append(mediaHint);
      constrain(name,{max:140,required:true},t('streamTitleHelp')); constrain(description,{max:2000},t('descriptionHelp')); guidance(form,t('streamGuidance'));
      const start = button(t('uiStudioText96'), 'button primary', async () => {
        if (!validate(form)) return; start.disabled = true;
        try {
          await media.prepare(shareScreen.control.checked, cameraFacing.value === 'environment' ? 'environment' : 'user');
          if (media.usedCameraFallback()) toast(t('mediaScreenFallback'));
          const result = object(await this.api.request('POST', '/streams', {title: name.value, description: description.value, categoryId: categories.value}));
          this.stream = text(result, 'id'); this.broadcasting = true; media.connect(this.stream, true, event => this.realtime(event)); await this.loadDashboard(true);
        } catch (error) {if (!this.broadcasting) media.stop(); throw error;} finally {start.disabled = false;}
      });
      form.append(start); left.append(form);
    }
    const level = text(object(this.dashboard.policy), 'level');
    right.append(html(t('uiStudioText98') + icon('spark') + '</div>'), this.aiStatus(), html("<div class='assistant-card'><span class='shield-orb'>" + icon('shield') + t('uiStudioText99') + escape(levelName(level)) + t('uiStudioText100')),
      button(t('uiStudioText101'), 'button subtle full', () => this.route('moderation')), button(t('uiStudioText102'), 'button subtle full', () => this.route('settings')), html(t('uiStudioText103')));
    layout.append(left);
    if (this.broadcasting) layout.append(this.chatPanel());
    else layout.style.gridTemplateColumns = 'minmax(0, 1fr)';
    this.content.append(layout, right);
    if (this.broadcasting) {this.launch(() => this.loadMessages()); media.attach();}
    if (this.broadcasting) {
      this.setupCollaboration(left, text(latest, 'channel_name') || text(this.user ?? {}, 'username'));
      this.content.append(this.collaborationPanel());
      this.launch(() => this.syncCollaboration(this.stream));
      this.collaborationPoll = window.setInterval(() => this.launch(() => this.syncCollaboration(this.stream)), 10000);
    }
  }
  private async finish(): Promise<void> {
    await media.finalizeRecording(); await this.api.request('POST', `/streams/${this.stream}/end`, {}); this.broadcasting = false; media.stop(); this.root.querySelector('.floating-player')?.remove(); toast(t('uiFinishText104')); await this.loadDashboard(true);
  }
  private async watch(): Promise<void> {
    this.clearCollaboration();
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
    const sharedLocation=document.createElement('a'); sharedLocation.className='shared-location'; sharedLocation.textContent=t('viewSharedLocation'); sharedLocation.target='_blank'; sharedLocation.rel='noopener noreferrer'; sharedLocation.hidden=true; player.append(sharedLocation);
    const refreshLocation=async()=>{
      const position=object(await this.api.request('GET',`/channels/${text(stream,'channel_id')}/location`,undefined,true));
      if (!sharedLocation.isConnected) return; sharedLocation.hidden=!flag(position,'shared');
      if (flag(position,'shared')) sharedLocation.href=`https://www.openstreetmap.org/?mlat=${encodeURIComponent(text(position,'latitude'))}&mlon=${encodeURIComponent(text(position,'longitude'))}`;
    };
    this.launch(refreshLocation); this.sharedLocationPoll=window.setInterval(()=>this.launch(refreshLocation),20000);
    this.setupCollaboration(player, text(stream, 'channel_name'));
    if (text(stream, 'status') === 'LIVE') {await this.loadMessages(); media.connect(this.stream, false, event => this.realtime(event));}
    else toast(t('uiWatchText112'));
    if (text(stream, 'status') === 'LIVE') {
      await this.syncCollaboration(this.stream);
      this.collaborationPoll = window.setInterval(() => this.launch(() => this.syncCollaboration(this.stream)), 10000);
    }
  }

  private setupCollaboration(player: HTMLDivElement, name: string): void {
    this.collaborationStage = player.querySelector('.video-stage');
    this.collaborationPlayer = this.collaborationStage?.parentElement as HTMLDivElement | null;
    this.collaborationSection = panel('collaboration-section');
    const title = panel('panel-heading'); title.append(html(`<h2>${escape(t('collaborationPerspectives'))}</h2>`));
    this.collaborationPrimary = panel('collaboration-tile');
    const label = document.createElement('strong'); label.textContent = name; this.collaborationPrimary.append(label);
    this.collaborationGrid = panel('collaboration-grid'); this.collaborationGrid.append(this.collaborationPrimary);
    this.collaborationSection.append(title, this.collaborationGrid); this.collaborationSection.hidden = true;
    this.collaborationPlayer?.insertBefore(this.collaborationSection, this.collaborationStage);
  }

  private collaborationPanel(): HTMLDivElement {
    const card = panel('surface collaboration-card'), heading = panel('panel-heading');
    this.collaborationCard = card;
    heading.append(html(`<h2>${escape(t('collaborationTitle'))}</h2>`));
    card.append(heading, html(`<p class="collaboration-copy">${escape(t('collaborationDescription'))}</p>`));
    const actions = panel('action-row'), create = button(t('collaborationCreate'), 'button primary small', async () => {
      create.disabled = true;
      try {
        const result = object(await this.api.request('POST', `/streams/${this.stream}/collaborations`, {}));
        const code = text(result, 'inviteCode');
        if (code) sessionStorage.setItem(`streamguard.invite.${text(result, 'id')}`, code);
        if (code) {codeInput.value = code; codeInput.dispatchEvent(new Event('input')); toast(t('collaborationCreated'));}
        await this.showInvite(card, code); await this.syncCollaboration(this.stream);
      } finally {create.disabled = false;}
    });
    const codeInput = input(t('collaborationCodePlaceholder')); codeInput.maxLength = 80;
    codeInput.setAttribute('aria-label',t('collaborationInviteCode'));
    const join = button(t('collaborationJoin'), 'button subtle small', async () => {
      if (!codeInput.value.trim()) return;
      join.disabled = true;
      try {await this.api.request('POST', '/collaborations/join', {code: codeInput.value.trim()}); toast(t('collaborationJoined')); await this.showInvite(card, ''); await this.syncCollaboration(this.stream);}
      finally {join.disabled = false;}
    });
    create.dataset.collaborationAction = 'create'; join.dataset.collaborationAction = 'join';
    const codeRow = panel('collaboration-code-row'); codeRow.append(codeInput, join);
    actions.append(create); card.append(actions, codeRow);
    guidance(card,t('collaborationGuidance'));
    this.launch(async () => {
      const state = object(await this.api.request('GET', `/streams/${this.stream}/collaboration`));
      if (state.active) await this.showInvite(card, '');
    });
    return card;
  }

  private async showInvite(card: HTMLDivElement, code: string): Promise<void> {
    const existing = card.querySelector('.collaboration-invite'); existing?.remove();
    const state = object(await this.api.request('GET', `/streams/${this.stream}/collaboration`));
    if (!card.isConnected) return;
    code ||= sessionStorage.getItem(`streamguard.invite.${text(state, 'id')}`) ?? '';
    const participants = rows(state.participants);
    const invite = panel('collaboration-invite');
    const summary = document.createElement('p'); summary.textContent = `${participants.length}/${text(state, 'max_participants') || '4'} ${t('collaborationParticipants')}`;
    invite.append(summary);
    if (code) {
      const entry = input(''); entry.readOnly = true; entry.value = code; entry.setAttribute('aria-label', t('collaborationInviteCode'));
      invite.append(entry, button(t('collaborationCopy'), 'button subtle small', async () => {await navigator.clipboard.writeText(code); toast(t('collaborationCopied'));}));
    }
    if (text(state, 'id')) invite.append(button(t('collaborationLeave'), 'button danger small', async () => {
      await this.api.request('POST', `/collaborations/${text(state, 'id')}/leave`, {});
      sessionStorage.removeItem(`streamguard.invite.${text(state, 'id')}`); toast(t('collaborationLeft')); invite.remove(); await this.syncCollaboration(this.stream);
    }));
    card.append(invite);
  }

  private async syncCollaboration(stream: string): Promise<void> {
    if (!this.collaborationGrid || !this.collaborationSection || !['watch', 'studio'].includes(this.screen)) return;
    const state = object(await this.api.request('GET', `/streams/${stream}/collaboration`));
    if (stream !== this.stream || !this.collaborationGrid || !this.collaborationSection || !['watch', 'studio'].includes(this.screen)) return;
    if (this.collaborationCard) {
      const summary = this.collaborationCard.querySelector('.collaboration-invite p');
      if (summary) summary.textContent = `${rows(state.participants).length}/${text(state, 'max_participants') || '4'} ${t('collaborationParticipants')}`;
      if (!state.active) this.collaborationCard.querySelector('.collaboration-invite')?.remove();
      for (const button of this.collaborationCard.querySelectorAll<HTMLButtonElement>('[data-collaboration-action]')) button.disabled = Boolean(state.active);
    }
    const participants = rows(state.participants).filter(row => text(row, 'stream_id') !== stream);
    const active = Boolean(state.active) && participants.length > 0;
    this.collaborationSection.hidden = !active;
    if (active && this.collaborationStage && this.collaborationStage.parentElement !== this.collaborationPrimary) this.collaborationPrimary?.append(this.collaborationStage);
    if (!active && this.collaborationStage && this.collaborationStage.parentElement !== this.collaborationPlayer) {
      this.collaborationPlayer?.append(this.collaborationStage);
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
    this.collaborationStage = null; this.collaborationPrimary = null; this.collaborationGrid = null; this.collaborationSection = null; this.collaborationPlayer = null;
    this.collaborationCard = null;
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
    const row = panel('chat-message'); row.append(html(`<span class="chat-author">${escape(text(message, 'username'))}</span><span>${escape(text(message, 'content'))}</span>`));
    const author = text(message, 'user_id');
    // The channel owner can ban from the chat itself. The backend checks again who is allowed.
    if (this.screen === 'studio' && this.channel && this.user && author && author !== text(this.user, 'id')) {
      const ban = button(t('banUser'), 'button danger small', async () => {
        if (!window.confirm(t('banConfirm'))) return; ban.disabled = true;
        try {await this.api.request('POST', `/channels/${this.channel}/sanctions`, {userId: author, type: 'BAN', seconds: 30, reason: t('uiModerationText128')}); toast(t('banApplied'));}
        catch (error) {ban.disabled = false; throw error;}
      });
      row.append(ban);
    }
    this.chatList.append(row);
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
        button(t('muteFiveMinutes'), 'button subtle small', async () => {await this.api.request('POST', `/channels/${this.channel}/sanctions`, {userId: text(message, 'user_id'), type: 'MUTE', seconds: 300, reason: t('uiModerationText128')}); toast(t('uiModerationText129')); await this.loadDashboard(true);}),
        button(t('banUser'), 'button danger small', async () => {await this.api.request('POST', `/channels/${this.channel}/sanctions`, {userId: text(message, 'user_id'), type: 'BAN', seconds: 30, reason: t('uiModerationText128')}); toast(t('banApplied')); await this.loadDashboard(true);}));
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
        if (!validate(modal.form)) return;
        const from = Number(start.value), until = Number(end.value);
        if (!start.value || !end.value || !Number.isFinite(from) || !Number.isFinite(until) || until<=from) {toast(t('uiEditClipText153'), true); return;}
        await this.api.request('PUT', `/clips/${text(clip, 'id')}`, {title: title.value, description: description.value, start: from, end: until}); modal.close(); await this.loadDashboard(true);
      }), button(t('uiEditClipText154'), 'button subtle', modal.close));
    constrain(title,{max:140,required:true},t('streamTitleHelp')); constrain(description,{max:2000},t('descriptionHelp'));
    const duration=Math.max(0,Number(text(clip,'end_seconds'))-Number(text(clip,'start_seconds')));
    constrain(start,{min:0,max:duration,required:true,step:'0.1'},t('trimHelp')); constrain(end,{min:0,max:duration,required:true,step:'0.1'},t('trimHelp'));
    guidance(modal.form,t('clipGuidance')); title.focus();
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
      if (!validate(form)) return;
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
    constrain(seconds,{min:30,max:86400,required:true},t('muteDurationHelp')); constrain(slow,{min:0,max:120,required:true},t('slowModeHelp'));
    constrain(words,{max:4049,lines:50,lineLength:80},t('blockedWordsHelp')); constrain(topics,{max:3629,lines:30,lineLength:120},t('blockedTopicsHelp')); guidance(form,t('settingsGuidance'));
    const sharing=checkbox(t('shareLocationLabel'),this.locationChannel===this.channel); form.append(sharing.element);
    sharing.control.addEventListener('change',()=>{
      if (sharing.control.checked) this.launch(async()=>{try {await this.startLocation(this.channel,await this.locate()); toast(t('locationReady'));} catch {sharing.control.checked=false; toast(t('locationUnavailable'),true);}});
      else {this.stopLocation(); this.launch(async()=>{await this.api.request('PUT',`/channels/${this.channel}/location`,{shared:false}); toast(t('operationSuccess'));});}
    });
    const moderators = panel('surface settings-form'), username = input(t('uiAuthViewText45')); moderators.append(html(t('uiSettingsText193')), field(t('uiSettingsText195'), username),
      button(t('addModerator'), 'button subtle', async () => {if (!validate(moderators)) return; await this.api.request('POST', `/channels/${this.channel}/moderators`, {username: username.value}); await this.loadDashboard(true);}));
    constrain(username,{min:3,max:32,required:true,pattern:'[A-Za-z0-9_]{3,32}'},t('usernameHelp')); guidance(moderators,t('moderatorGuidance'));
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
  private async account(): Promise<void> {
    this.title(t('uiAccountText200'), '@' + text(this.user, 'username'), t('profileDescription'));
    this.content.append(button(t('uiAccountText201'), 'button subtle', () => {this.channel = ''; this.route('studio');}), button(t('uiAccountText202'), 'button danger', async () => {
      if (this.broadcasting) {await media.finalizeRecording(); await this.api.request('POST', `/streams/${this.stream}/end`, {});}
      if (this.locationChannel) await this.api.request('PUT',`/channels/${this.locationChannel}/location`,{shared:false});
      this.stopLocation(); await this.api.request('POST', '/auth/logout', {}); media.stop(); this.broadcasting = false; this.api.setToken(''); this.user = null; this.channel = ''; this.dashboard = {}; this.configureMedia(); this.route('login');
    }));
    const history=panel('profile-history'); this.content.append(history);
    const streams=rows(await this.api.request('GET','/users/me/streams')); if (!history.isConnected) return;
    history.append(html(`<h2>${escape(t('profileHistoryTitle'))}</h2><p class="muted">${escape(t('profileHistoryHelp'))}</p>`));
    if (!streams.length) history.append(empty(t('profileNoStreams'),t('profileNoStreamsHelp')));
    for (const stream of streams) {
      const card=panel('surface profile-stream'); const started=new Date(text(stream,'started_at')).toLocaleString('es-CO');
      card.append(html(`<h3>${escape(text(stream,'title'))}</h3><p class="muted">${escape(started)} · ${escape(text(stream,'status')==='LIVE' ? t('floatingLive') : t('recordingEnded'))}</p>`));
      if (text(stream,'status')==='LIVE') card.append(button(t('returnToStudio'),'button primary small',()=>this.route('studio')));
      if (Number(text(stream,'recording_parts'))>0) card.append(button(t('viewRecording'),'button subtle small',()=>this.recording(text(stream,'id'),text(stream,'title'))));
      else card.append(html(`<p class="muted">${escape(t('recordingNotAvailable'))}</p>`));
      history.append(card);
    }
  }
  private async recording(id: string, title: string): Promise<void> {
    const parts=rows(await this.api.request('GET',`/streams/${id}/recording`));
    if (!parts.length) {toast(t('recordingNotAvailable')); return;}
    const modal=dialog(title), video=document.createElement('video'); video.controls=true; video.playsInline=true; video.className='recording-video';
    const status=panel('recording-status'), actions=panel('action-row'); let index=0;
    const load=()=>{video.src=`/api/media/${encodeURIComponent(text(parts[index] ?? {},'asset_id'))}`; status.textContent=t('recordingPart').replace('{current}',String(index+1)).replace('{total}',String(parts.length)); void video.play().catch(()=>{});};
    video.onended=()=>{if (index+1<parts.length) {index++;load();}};
    actions.append(button(t('previousPart'),'button subtle small',()=>{if (index>0) {index--;load();}}),button(t('nextPart'),'button subtle small',()=>{if (index+1<parts.length) {index++;load();}}),button(t('closeWindow'),'button subtle small',modal.close));
    modal.form.append(video,status,actions); modal.element.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();}); load();
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
