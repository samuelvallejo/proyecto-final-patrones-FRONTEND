import {ApiClient, ApiRequestError, apiOrigin} from './api';
import {object, rows, text, flag, mediaConfig, type Json, type Row, type LiveEvent} from './contracts';
import {panel, html, escape, input, area, field, button, checkbox, select, toast, empty, dialog, icon, showLiveEnded} from './dom';
import {t} from './i18n';
import {media} from './media';
import {CollaborationTile} from './collaboration';
import './collaboration.css';
import {constrain, validate, guidance} from './forms';
import {beginActivity} from './activity';
import {ModerationPolicyDraft} from './moderation-policy';
import './moderation-presets.css';
import './light.css';
import './blue.css';
import './dark.css';
import {toggleTheme, syncToggle} from './theme';
import {GeminiChatView} from './gemini-chat';
import {viewerCounter, viewerNumber, updateViewerCounters} from './viewer-count';
import {StudioInputs} from './studio-inputs';
import {browserCaptureEnvironment, mobileCaptureClient} from './capture';

type Screen = 'explore' | 'studio' | 'login' | 'register' | 'watch' | 'public-clips' | 'account' | 'moderation' | 'clips' | 'assistant' | 'gemini-chat' | 'settings' | 'admin';
const adminScreens: Screen[] = ['studio', 'moderation', 'clips', 'assistant', 'settings'];

/** Non-secret flag: "this browser probably has a session", so guests see the login form instantly. */
const sessionHintKey = 'streamguard.hasSession';
function hasSessionHint(): boolean {try {return localStorage.getItem(sessionHintKey) === '1';} catch {return true;}}
function setSessionHint(value: boolean): void {try {if (value) localStorage.setItem(sessionHintKey, '1'); else localStorage.removeItem(sessionHintKey);} catch {/* storage unavailable */}}
/** The last announcement this browser closed; a new announcement has a new id and shows again. */
const dismissedKey = 'streamguard.dismissedAnnouncement';
function dismissedAnnouncement(): string {try {return localStorage.getItem(dismissedKey) ?? '';} catch {return '';}}
function dismissAnnouncement(id: string): void {try {localStorage.setItem(dismissedKey, id);} catch {/* storage unavailable */}}
function eventWhen(value: string): string {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'});
  if (date.getTime() <= Date.now()) return t('eventLive');
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), diff = Math.round((day(date) - day(new Date())) / 86400000);
  if (diff === 0) return `${t('today')} · ${time}`;
  if (diff === 1) return `${t('tomorrow')} · ${time}`;
  return `${date.toLocaleDateString('es-CO', {weekday: 'short', day: 'numeric', month: 'short'})} · ${time}`;
}
function categoryIcon(slug: string): string {
  return ({'': 'grid', conversacion: 'chat', videojuegos: 'gamepad', tecnologia: 'chip', musica: 'music', arte: 'palette', educacion: 'book'} as Record<string, string>)[slug] ?? 'spark';
}
/** Responsive UI, authentication and workflows; server permissions remain authoritative. */
export class StreamGuardApp {
  private readonly api = new ApiClient();
  private readonly geminiChat = new GeminiChatView(this.api);
  private content = panel('page-content');
  private user: Row | null = null;
  private config: Row = {};
  /** Maintenance, registration and the global announcement, as the server reports them. */
  private platform: Row = {};
  private maintenanceScreen = false;
  private dashboard: Row = {};
  private categories: Row[] = [];
  private following: Row[] = [];
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
  private viewerCount = 0;
  private viewerStream = '';
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
    this.api.onMaintenance = () => this.showMaintenance();
    this.api.onUnauthorized = () => {
      this.geminiChat.clear();
      this.viewerCount = 0; this.viewerStream = '';
      this.user = null; setSessionHint(false);
      if (this.broadcasting) {media.stop(); this.broadcasting=false;}
      this.stopLocation(); this.configureMedia();
      if (!['login','register'].includes(this.screen)) this.route('login');
    };
  }
  async start(): Promise<void> {
    this.api.setToken('');
    // Wake a sleeping server right away; the login form does not need to wait for it.
    const ping = () => {void fetch('/api/ping', {cache: 'no-store'}).catch(() => {});};
    ping(); void this.loadPlatformStatus();
    // The free host sleeps after ~10 idle minutes. While the app is visible, a tiny ping every
    // 4 minutes keeps it awake (for example during a demo); hidden tabs stop pinging.
    window.setInterval(() => {if (document.visibilityState === 'visible') ping();}, 240000);
    document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'visible') ping();});
    if (hasSessionHint()) {
      const loading = panel('startup-loading'), message = document.createElement('p');
      loading.setAttribute('role', 'status'); const spinner=panel('spinner'); spinner.setAttribute('aria-hidden','true');
      message.textContent = t('bootPreparing'); loading.append(spinner, message); this.root.replaceChildren(loading);
      const slow = window.setTimeout(() => {message.textContent = t('serverWaking');}, 2500);
      try {await this.bootstrap();}
      catch (error) {
        // Maintenance keeps the session: the account simply waits until administrators finish.
        if (error instanceof ApiRequestError && error.code === 'MAINTENANCE') {window.clearTimeout(slow); this.showMaintenance(true); return;}
        this.user = null; setSessionHint(false);
      } finally {window.clearTimeout(slow);}
      if (this.user) this.screen = location.hash.startsWith('#clip=') ? 'public-clips' : 'explore';
    }
    this.configureMedia(); this.shell(); await this.render();
    window.setInterval(() => {
      if ((this.screen === 'studio' || this.screen === 'moderation') && this.channel) this.launch(() => this.loadDashboard(false));
    }, 15000);
  }
  /** Profile, configuration, categories and followed channels in a single round trip. */
  private async bootstrap(): Promise<void> {
    const data = object(await this.api.request('GET', '/bootstrap', undefined, true));
    this.user = object(data.user); this.config = object(data.config); this.platform = object(data.platform); this.categories = rows(data.categories); this.following = rows(data.following);
    setSessionHint(true); this.configureMedia();
  }
  private async loadFollowing(): Promise<void> {
    try {this.following = rows(await this.api.request('GET', '/discover/following', undefined, true));} catch {this.following = [];}
  }
  private configureMedia(): void {media.configure(apiOrigin, this.api.token, mediaConfig(this.config));}
  private launch(action: () => Promise<void>): void {void action().catch(error => toast(error instanceof Error ? error.message : t('uiOnErrorText04'), true));}
  private shell(): void {
    this.root.replaceChildren(); this.root.className = 'app-shell';
    if (!this.user) {
      this.root.className='auth-shell'; this.content=panel('auth-content');
      const floatingTheme = this.themeToggle(); floatingTheme.classList.add('theme-floating'); this.root.append(floatingTheme);
      this.root.append(html(`<aside class="auth-introduction"><a class="auth-brand" href="#">${icon('shield')}<span>StreamGuard</span></a><p class="eyebrow">${escape(t('authBrandEyebrow'))}</p><h1>${escape(t('authBrandTitle'))}</h1><p>${escape(t('authBrandDescription'))}</p><div class="auth-benefits">${icon('video')}<span>${escape(t('authBrandVideo'))}</span>${icon('shield')}<span>${escape(t('authBrandCommunity'))}</span></div></aside>`),this.content); return;
    }
    const skipLink = document.createElement('a'); skipLink.className = 'skip-link'; skipLink.href = '#page-content'; skipLink.textContent = t('skipToMainContent');
    const side = panel('sidebar'); side.append(html(t('uiShellText05') + icon('shield') + t('uiShellText06')));
    side.querySelector('.brand')?.addEventListener('click', event => {event.preventDefault(); this.route('explore');});
    const first = panel('nav-list'); first.append(this.navButton('explore', t('uiShellText08'), 'home'), this.navButton('studio', t('myStudio'), 'video'));
    const second = panel('nav-list'); second.append(this.navButton('moderation', t('uiShellText10'), 'shield'), this.navButton('clips', t('uiShellText11'), 'play'), this.navButton('assistant', t('uiShellText12'), 'spark'), this.navButton('settings', t('uiShellText13'), 'settings'));
    const navigation = document.createElement('nav'); navigation.id = 'main-navigation'; navigation.setAttribute('aria-label', t('mainNavigationLabel'));
    second.insertBefore(this.navButton('gemini-chat', t('geminiChatNavigation'), 'spark'), second.lastElementChild);
    navigation.append(html(t('uiShellText07')), first, html(t('uiShellText09')), second);
    if (this.isAdmin()) {
      const administration = panel('nav-list'); administration.append(this.navButton('admin', t('adminNav'), 'gauge'));
      navigation.append(html(`<p class='nav-label nav-second'>${escape(t('adminNavLabel'))}</p>`), administration);
    }
    const sideCategories = panel('side-categories');
    for (const [label, slug] of this.categoryOptions()) {
      const chip = button(label, `side-category${this.category === slug ? ' selected' : ''}`, () => {this.category = slug; this.route('explore');});
      chip.innerHTML = icon(categoryIcon(slug)) + `<span>${escape(label)}</span>`; chip.setAttribute('aria-label', label); sideCategories.append(chip);
    }
    const followed = panel('side-following');
    if (!this.following.length) followed.append(html(`<p class="side-empty">${escape(t('sidebarFollowingEmpty'))}</p>`));
    for (const channel of this.following.slice(0, 6)) {
      const live = Boolean(text(channel, 'stream_id')), name = text(channel, 'name');
      const row = button(name, `side-channel${live ? ' live' : ''}`, () => live ? this.openStream({id: text(channel, 'stream_id'), title: text(channel, 'title')}) : toast(t('channelOffline')));
      row.innerHTML = `<span class="avatar-chip small">${escape(name.slice(0, 1).toUpperCase())}</span><span class="side-channel-name"><strong>${escape(name)}</strong><small>${escape(live ? t('liveShort') : t('offline'))}</small></span>${live ? `<span class="side-channel-count">${escape(text(channel, 'viewers') || '0')}</span>` : ''}`;
      row.setAttribute('aria-label', name); followed.append(row);
    }
    navigation.append(html(t('sidebarFollowing')), followed, html(t('sidebarCategories')), sideCategories);
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
    const themeButton = this.themeToggle(); account.append(themeButton);
    if (!this.user) account.append(button(t('uiShellText18'), 'button primary small', () => this.route('login')));
    else {
      const badge = button(text(this.user, 'username').slice(0, 1).toUpperCase(), this.isAdmin() ? 'avatar admin-avatar' : 'avatar', () => this.route('account')); badge.setAttribute('aria-label', t('myAccount')); badge.title = t(this.isAdmin() ? 'roleAdmin' : 'roleUser');
      const bell = button(t('uiShellText19'), 'button icon-button', () => this.notifications()); bell.innerHTML = icon('bell'); bell.setAttribute('aria-label', t('uiShellText19'));
      account.append(bell, badge);
    }
    header.append(menu, find, account); this.content = panel('page-content'); this.content.id = 'page-content'; this.content.setAttribute('role', 'main'); this.content.tabIndex = -1;
    const notice = this.announcementBanner(); main.append(header);
    if (this.isAdmin() && flag(this.platform, 'maintenance')) main.append(html(`<div class="maintenance-strip" role="status">${icon('settings')}<span>${escape(t('maintenanceAdminStrip'))}</span></div>`));
    if (notice) main.append(notice);
    main.append(this.content); this.root.append(skipLink, side, main);
    if (this.broadcasting && this.screen !== 'studio') this.floatingPlayer();
  }
  private navButton(key: Screen, label: string, glyph: string): HTMLButtonElement {
    const control = button(label, `nav-item${this.screen === key ? ' active' : ''}`, () => this.route(key));
    control.innerHTML = icon(glyph) + `<span>${escape(label)}</span>` + (key === 'moderation' ? t('uiNavButtonText20') : '');
    control.setAttribute('aria-label', label); if (this.screen === key) control.setAttribute('aria-current', 'page'); return control;
  }
  private route(next: Screen): void {
    if (this.maintenanceScreen) return;
    if (!this.user && !['login','register'].includes(next)) next='login';
    if (next === 'admin' && !this.isAdmin()) next = 'explore';
    this.clearCollaboration();
    window.clearInterval(this.sharedLocationPoll); this.sharedLocationPoll=0;
    if (!this.broadcasting && this.screen === 'watch') media.stop();
    this.screen = next; this.mobileNav = false; this.epoch++; this.messageIds.clear();
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
    if (this.screen === 'gemini-chat') {
      this.title(t('geminiChatEyebrow'), t('geminiChatTitle'), t('geminiChatDescription'));
      const chat = panel('gemini-chat-container'); this.content.append(chat); await this.geminiChat.mount(chat); return;
    }
    if (this.screen === 'admin') return this.adminPanel();
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
    floating.querySelector('.floating-heading')?.append(viewerCounter(this.viewerCount));
    if (media.nativeScreenActive()) {
      const video = floating.querySelector('video'); if (video) video.style.display = 'none';
      const status = panel('capture-hint'); status.textContent = t('nativeScreenPreview'); floating.append(status);
    }
    floating.append(button(t('returnToStudio'),'button primary small',()=>this.route('studio')),button(t('pictureInPicture'),'button subtle small',async()=>{
      const video=floating.querySelector('video');
      if (!media.nativeScreenActive() && video && document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
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
  /** Sun/moon button; it is the same control on the login screen and in the top bar. */
  private themeToggle(): HTMLButtonElement {
    const control = button('', 'button icon-button theme-toggle', () => toggleTheme());
    syncToggle(control); return control;
  }
  private categoryOptions(): Array<[string, string]> {
    return [[t('allLabel'), ''], ...this.categories.map((row): [string, string] => [text(row, 'name'), text(row, 'slug')])];
  }
  /** Home dashboard modelled on the reference design, filled only with real platform data. */
  private async explore(): Promise<void> {
    const layout = panel('home-layout'), main = panel('home-main'), rail = panel('home-rail');
    const top = panel('home-top'), hero = panel('home-hero'), events = panel('quick-card events-card');
    hero.append(html(t('homeHeroDefault')));
    const heroActions = panel('hero-actions'); heroActions.append(button(t('openStudio'), 'button primary', () => this.route('studio')), button(t('uiExploreText23'), 'button glass', () => this.route('public-clips'))); hero.append(heroActions);
    const eventsTitle = panel('events-title'), eventList = panel('event-list');
    const addEvent = button(t('homeEventsAdd'), 'events-add', () => this.scheduleEvent(() => this.loadEvents(eventList)));
    addEvent.innerHTML = icon('plus'); addEvent.setAttribute('aria-label', t('homeEventsAdd'));
    eventsTitle.append(html(`<h2>${escape(t('homeEventsTitle'))}</h2>`), addEvent);
    eventList.append(html(`<p class="rail-empty light">${escape(t('processing'))}</p>`)); events.append(eventsTitle, eventList);
    top.append(hero, events);
    const recommended = panel('home-card'), recTitle = panel('home-card-title'), track = panel('stream-track');
    const scroll = (direction: number) => track.scrollBy({left: direction * Math.max(240, track.clientWidth * 0.8), behavior: 'smooth'});
    const arrows = panel('carousel-arrows'), prev = button(t('carouselPrev'), 'carousel-arrow', () => scroll(-1)), next = button(t('carouselNext'), 'carousel-arrow', () => scroll(1));
    prev.innerHTML = icon('chevron-left'); next.innerHTML = icon('chevron-right'); prev.setAttribute('aria-label', t('carouselPrev')); next.setAttribute('aria-label', t('carouselNext')); arrows.append(prev, next);
    recTitle.append(html(`<h2>${icon('spark')}${escape(t('homeRecommendedTitle'))}</h2>`), arrows);
    track.append(empty(t('uiExploreText26'), t('uiExploreText27'))); recommended.append(recTitle, track);
    const bottom = panel('home-bottom'), promo = panel('promo-card'), popular = panel('home-card'), tiles = panel('category-tiles');
    promo.append(html(icon('crown') + t('homePromo')), button(t('openStudio'), 'button', () => this.route('studio')));
    const popularTitle = panel('home-card-title');
    const allCategories = button(t('homeAllCategories'), 'text-button', () => {this.category = ''; this.route('explore');});
    allCategories.innerHTML = `${escape(t('homeAllCategories'))} ${icon('arrow')}`;
    popularTitle.append(html(`<h2>${icon('flame')}${escape(t('homeCategoriesTitle'))}</h2>`), allCategories);
    const drawTiles = (list: Row[]) => {
      tiles.replaceChildren();
      list.forEach((category, index) => {
        const slug = text(category, 'slug'), label = text(category, 'name'), count = Number(category.viewers ?? 0), live = Number(category.live_streams ?? 0);
        const tile = button(label, `category-tile${this.category === slug ? ' selected' : ''}`, () => {this.category = slug; this.route('explore');});
        tile.innerHTML = `<span class="category-art tone-${index % 7}">${icon(categoryIcon(slug))}</span><strong>${escape(label)}</strong><small><i></i>${escape(live ? `${live} ${t('homeChannelViewers')} · ${count} ${t('viewersShort')}` : t('categoryNoLive'))}</small>`;
        tile.setAttribute('aria-label', label); tiles.append(tile);
      });
    };
    drawTiles(this.categories);
    popular.append(popularTitle, tiles); bottom.append(promo, popular);
    main.append(top, recommended, bottom);
    const notices = panel('home-card'), noticeList = panel('rail-list'), noticeTitle = panel('home-card-title');
    noticeTitle.append(html(`<h2>${icon('bell')}${escape(t('homeNoticesTitle'))}</h2>`), button(t('homeNoticesAll'), 'text-button', () => this.notifications()));
    noticeList.append(html(`<p class="rail-empty">${escape(t('processing'))}</p>`)); notices.append(noticeTitle, noticeList);
    const featured = panel('home-card'), featuredList = panel('rail-list');
    featuredList.append(html(`<p class="rail-empty">${escape(t('processing'))}</p>`));
    featured.append(html(`<div class="home-card-title"><h2>${icon('crown')}${escape(t('homeFeaturedTitle'))}</h2></div>`), featuredList);
    const clips = button(t('homeClipsAction'), 'clips-card', () => this.route('public-clips'));
    clips.innerHTML = `<span>${icon('play')}</span><span><small>${escape(t('homeClipsEyebrow'))}</small><strong>${escape(t('homeClipsAction'))}</strong></span><span class="clips-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
    rail.append(notices, featured, clips); layout.append(main, rail); this.content.append(layout);
    this.launch(() => this.loadEvents(eventList));
    this.launch(async () => {
      const list = rows(await this.api.request('GET', '/discover/categories', undefined, true));
      if (tiles.isConnected && list.length) drawTiles(list);
    });
    this.launch(() => this.loadFeatured(featuredList));
    this.launch(async () => {
      // Listing notices here does not mark them as read; opening the full list does.
      const items = rows(await this.api.request('GET', '/notifications', undefined, true)).slice(0, 3);
      if (!noticeList.isConnected) return; noticeList.replaceChildren();
      if (!items.length) noticeList.append(html(`<p class="rail-empty">${escape(t('homeNoticesEmpty'))}</p>`));
      for (const item of items) {
        const created = new Date(text(item, 'created_at')), when = Number.isNaN(created.getTime()) ? '' : created.toLocaleString('es-CO', {dateStyle: 'medium', timeStyle: 'short'});
        noticeList.append(html(`<div class="notice-item${item.read_at ? '' : ' unread'}"><span>${icon('bell')}</span><div><strong>${escape(text(item, 'title'))}</strong><p>${escape(text(item, 'body'))}</p><time>${escape(when)}</time></div></div>`));
      }
    });
    try {
      const streams = rows(await this.api.request('GET', `/explore?q=${encodeURIComponent(this.search)}&category=${encodeURIComponent(this.category)}`));
      if (!track.isConnected) return; track.replaceChildren();
      arrows.hidden = streams.length < 2;
      if (!streams.length) track.append(empty(t('uiExploreText28'), this.search ? t('uiExploreText30') : t('uiExploreText29')));
      let featuredIndex = 0;
      const showFeatured = () => {
        const stream = streams[featuredIndex]; if (!stream) return;
        const channel = text(stream, 'channel_name'), category = text(stream, 'category');
        hero.replaceChildren(html(`<span class="hero-badge live">${escape(t('homeFeaturedLive'))}</span><span class="hero-viewers">${icon('eye')}${escape(text(stream, 'viewers') || '0')}</span>`
          + `<div class="hero-channel"><span class="avatar-chip">${escape(channel.slice(0, 1).toUpperCase())}</span><span>${escape(channel)} <span class="verified">\u2713</span><small>${escape(t('homeFeaturedLive'))}</small></span></div><h1>${escape(text(stream, 'title'))}</h1>`
          + (category ? `<div class="hero-tags"><span>${escape(category)}</span></div>` : '')));
        const actions = panel('hero-actions'), watch = button(t('homeWatchLive'), 'button primary watch-live', () => this.openStream(stream));
        watch.innerHTML = `${escape(t('homeWatchLive'))}<span class="watch-arrow">${icon('arrow')}</span>`; actions.append(watch); hero.append(actions);
        if (streams.length > 1) {
          const nextHero = button(t('homeNextLive'), 'hero-next', () => {featuredIndex = (featuredIndex + 1) % streams.length; showFeatured();});
          nextHero.innerHTML = icon('chevron-right'); nextHero.setAttribute('aria-label', t('homeNextLive')); hero.append(nextHero);
        }
      };
      showFeatured();
      streams.forEach((stream, index) => {
        const channel = text(stream, 'channel_name'), category = text(stream, 'category'), card = panel('rec-card');
        const cover = button(text(stream, 'title'), `rec-cover tone-${index % 7}`, () => this.openStream(stream));
        cover.innerHTML = `<span class="live-tag">${escape(t('homeFeaturedLive'))}</span>${icon('video')}<span class="viewer-tag">${icon('eye')}${escape(text(stream, 'viewers') || '0')}</span>`;
        cover.setAttribute('aria-label', `${t('uiExploreText32')} ${text(stream, 'title')}`);
        card.append(cover, html(`<div class="rec-body"><span class="avatar-chip small">${escape(channel.slice(0, 1).toUpperCase())}</span><div><strong>${escape(channel)} <span class="verified">\u2713</span></strong><p>${escape(text(stream, 'title'))}</p></div></div><div class="rec-tags">${category ? `<span>${escape(category)}</span>` : ''}<span>${escape(t('languageSpanish'))}</span></div>`));
        track.append(card);
      });
    } catch (error) {if (track.isConnected) {track.replaceChildren(empty(t('uiExploreText33'), t('uiExploreText34'))); throw error;}}
  }
  private async loadEvents(list: HTMLElement): Promise<void> {
    const items = rows(await this.api.request('GET', '/events/upcoming', undefined, true));
    if (!list.isConnected) return; list.replaceChildren();
    if (!items.length) list.append(html(`<p class="rail-empty light">${escape(t('homeEventsEmpty'))}</p>`));
    items.slice(0, 4).forEach((item, index) => {
      const row = panel('event-row');
      row.append(html(`<span class="event-icon tone-${index % 7}">${icon(categoryIcon(text(item, 'category_slug')))}</span><span class="event-copy"><strong>${escape(text(item, 'title'))}</strong><small>${escape(text(item, 'channel_name'))} · ${escape(eventWhen(text(item, 'starts_at')))}</small></span>`));
      if (item.mine === true) {
        const remove = button(t('eventDelete'), 'event-remove', async () => {
          await this.api.request('DELETE', `/events/${encodeURIComponent(text(item, 'id'))}`); toast(t('eventDeleted')); await this.loadEvents(list);
        });
        remove.innerHTML = icon('close'); remove.setAttribute('aria-label', `${t('eventDelete')}: ${text(item, 'title')}`); row.append(remove);
      }
      list.append(row);
    });
  }
  private scheduleEvent(done: () => Promise<void>): void {
    const modal = dialog(t('eventDialogTitle'));
    const title = input(t('eventFieldTitlePlaceholder')); title.maxLength = 140; title.required = true;
    const when = input(''); when.type = 'datetime-local'; when.required = true;
    const pad = (n: number) => String(n).padStart(2, '0'), soon = new Date(Date.now() + 3600000);
    when.value = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:00`; when.min = when.value.slice(0, 10) + 'T00:00';
    const category = select([[t('eventNoCategory'), ''], ...this.categories.map((row): [string, string] => [text(row, 'name'), text(row, 'id')])]);
    const save = button(t('eventSave'), 'button primary', async () => {
      const start = new Date(when.value);
      if (!title.value.trim() || Number.isNaN(start.getTime())) {toast(t('eventRequired'), true); return;}
      const body: Row = {title: title.value.trim(), startsAt: start.toISOString()}; if (category.value) body.categoryId = category.value;
      await this.api.request('POST', '/events', body); modal.close(); toast(t('eventSaved')); await done();
    });
    modal.form.append(field(t('eventFieldTitle'), title), field(t('eventFieldWhen'), when), field(t('eventFieldCategory'), category), save, button(t('eventCancel'), 'button subtle', modal.close));
  }
  private async loadFeatured(list: HTMLElement): Promise<void> {
    const channels = rows(await this.api.request('GET', '/discover/featured', undefined, true));
    if (!list.isConnected) return; list.replaceChildren();
    if (!channels.length) list.append(html(`<p class="rail-empty">${escape(t('featuredEmpty'))}</p>`));
    for (const channel of channels) {
      const name = text(channel, 'name'), live = Boolean(text(channel, 'stream_id')), item = panel(`channel-item${live ? '' : ' offline'}`);
      item.append(html(`<span class="avatar-chip">${escape(name.slice(0, 1).toUpperCase())}</span>`), html(`<strong>${escape(name)}</strong><small>${escape(live ? `${text(channel, 'viewers') || '0'} ${t('homeChannelViewers')}` : t('offline'))}</small>`));
      if (channel.mine !== true) {
        const following = channel.following === true, id = encodeURIComponent(text(channel, 'channel_id'));
        item.append(button(following ? t('followingLabel') : t('followLabel'), `button ${following ? 'subtle following' : 'follow'}`, async () => {
          await this.api.request(following ? 'DELETE' : 'POST', `/channels/${id}/follow`, following ? undefined : {});
          toast(following ? t('unfollowed') : t('followed')); await this.loadFollowing(); this.route('explore');
        }));
      }
      list.append(item);
    }
  }
  private authView(register: boolean): void {
    this.title(t('welcomeEyebrow'), register ? t('uiAuthViewText38') : t('uiAuthViewText39'), register ? t('uiAuthViewText40') : t('uiAuthViewText41'));
    const notices = panel('auth-notices'); if (register) notices.dataset.register = '1'; this.fillAuthNotices(notices); this.content.append(notices);
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
        await this.api.sealed(register ? '/auth/register' : '/auth/login', body);
        password.value=''; await this.bootstrap();
        this.geminiChat.clear(); this.channel = ''; this.dashboard = {}; toast(t('authSuccess')); this.route('explore');
      } catch (error) {
        // Server outages, duplicates (409) and rate limits (429) are not form mistakes: show their own message.
        const specific = error instanceof ApiRequestError && (error.unavailable || error.status === 409 || error.status === 429 || Boolean(error.code));
        toast(specific ? error.message : t('authFailed'), true);
      } finally {submit.disabled = false;}
    });
    password.addEventListener('keydown', event => {if (event.key === 'Enter') submit.click();});
    card.append(submit, button(register ? t('uiAuthViewText50') : t('uiAuthViewText51'), 'text-button', () => this.route(register ? 'login' : 'register')));
    guidance(card,register ? t('registerGuidance') : t('loginGuidance')); this.content.append(card); this.fillAuthNotices(notices);
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
    this.rememberViewers(object(snapshot.stream));
    if (!render && this.screen !== 'moderation') {this.updateStats(); for (const banner of this.content.querySelectorAll('.ai-provider-status')) banner.replaceWith(this.aiStatus()); return;}
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
  private rememberViewers(stream: Row): void {
    const id = text(stream, 'id'); if (!id) return;
    if (this.viewerStream !== id || typeof stream.viewers === 'number') {
      this.viewerStream = id; this.viewerCount = text(stream, 'status') === 'LIVE' ? viewerNumber(stream.viewers) : 0;
      updateViewerCounters(this.root, this.viewerCount);
    }
  }
  private studio(): void {
    this.clearCollaboration();
    this.title(t('uiStudioText74'), t('studioGreeting') + text(this.user, 'username') + ' ✦', t('uiStudioText75')); this.stats();
    const latest = object(this.dashboard.stream);
    if (!this.owner()) {
      this.content.append(html(t('uiStudioText76') + escape(text(object(this.dashboard.channel), 'name')) + '.</div>'));
      if (text(latest, 'status') === 'LIVE') this.content.append(button(t('uiStudioText77'), 'button primary', () => {this.stream = text(latest, 'id'); this.route('watch');})); return;
    }
    const layout = panel('studio-grid'), left = panel('surface'), right = panel('surface studio-assistant');
    const live = this.broadcasting || text(latest, 'status') === 'LIVE';
    left.append(html(t('uiStudioText78') + (live ? t('uiStudioText79') : t('uiStudioText80')) + "</span></div><div class='video-stage'><video id='live-video' autoplay playsinline muted></video><div class='video-placeholder' id='video-placeholder'>" + icon('video') + t('uiStudioText81')));
    if (live) {
      const heading = left.querySelector('.panel-heading'), status = heading?.querySelector('.tag');
      const indicators = panel('live-heading-status'); if (status) indicators.append(status);
      indicators.append(viewerCounter(this.viewerCount)); heading?.append(indicators);
    }
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
      if (!mobileCaptureClient(browserCaptureEnvironment()) || media.nativeScreenActive()) switchCamera.style.display = 'none';
      actions.append(button(t('uiStudioText82'), 'button primary', async () => {await this.api.request('POST', `/streams/${this.stream}/highlights`, {source: 'MANUAL', reason: t('uiStudioText83')}); toast(t('uiStudioText84'));}),
        microphone, camera, switchCamera, button(t('uiStudioText85'), 'button subtle', async () => {await media.captions(); toast(t('uiStudioText86'));}), button(t('uiStudioText87'), 'button danger', () => this.finish()));
      left.append(actions);
    } else if (text(latest, 'status') === 'LIVE') {
      left.append(html(t('uiStudioText88')), button(t('uiStudioText89'), 'button danger', async () => {await this.api.request('POST', `/streams/${text(latest, 'id')}/end`, {}); await this.loadDashboard(true);}));
    } else {
      const form = panel('stream-form'), name = input(t('uiStudioText90')), description = area(t('uiStudioText91'));
      const categories = select(this.categories.map(row => [text(row, 'name'), text(row, 'id')]));
      const shareScreen = checkbox(t('uiStudioText92')), shareScreenOnly = checkbox(t('studioScreenOnly')); const row = panel('form-row');
      // Either option shares the screen; only one can be on, and only one of them may show the webcam.
      shareScreen.control.addEventListener('change', () => {if (shareScreen.control.checked) shareScreenOnly.control.checked = false;});
      shareScreenOnly.control.addEventListener('change', () => {if (shareScreenOnly.control.checked) shareScreen.control.checked = false;});
      row.append(field(t('uiStudioText94'), categories), field(t('uiCreateChannelText64'), description));
      const cameraFacing = select([[t('mediaFrontCamera'), 'user'], [t('mediaRearCamera'), 'environment']]);
      const inputs = new StudioInputs();
      const syncScreenOptions = (): void => {
        shareScreen.control.disabled = shareScreenOnly.control.disabled = !media.screenSharingSupported() || inputs.mode.value !== 'browser';
        if (shareScreen.control.disabled) shareScreen.control.checked = shareScreenOnly.control.checked = false;
      };
      syncScreenOptions();
      const facingField = field(t('mediaCameraSelection'), cameraFacing);
      facingField.style.display = !inputs.mobile || inputs.mode.value === 'android' ? 'none' : '';
      form.append(field(t('uiStudioText93'), name), row, facingField, shareScreen.element, shareScreenOnly.element);
      form.append(inputs.element);
      inputs.mode.addEventListener('change', () => {facingField.style.display = !inputs.mobile || inputs.mode.value === 'android' ? 'none' : ''; syncScreenOptions();});
      const mediaHint = panel('capture-hint');
      mediaHint.textContent = inputs.mobile ? t('mediaMobileCameraHint') : t('mediaDevicePermissionsHint');
      form.append(mediaHint);
      constrain(name,{max:140,required:true},t('streamTitleHelp')); constrain(description,{max:2000},t('descriptionHelp')); guidance(form,t('streamGuidance'));
      const start = button(t('uiStudioText96'), 'button primary', async () => {
        if (!validate(form)) return; start.disabled = true;
        try {
          inputs.validate();
          const screenOnly = inputs.mode.value === 'browser' && shareScreenOnly.control.checked;
          await media.prepare(inputs.mode.value === 'browser' && (shareScreen.control.checked || screenOnly), cameraFacing.value === 'environment' ? 'environment' : 'user', inputs.camera.value, inputs.microphone.value, inputs.mode.value === 'android', screenOnly);
          if (media.usedCameraFallback()) toast(t('mediaScreenFallback'));
          const result = object(await this.api.request('POST', '/streams', {title: name.value, description: description.value, categoryId: categories.value}));
          this.stream = text(result, 'id'); this.viewerStream = this.stream; this.viewerCount = 0; this.broadcasting = true; media.connect(this.stream, true, event => this.realtime(event)); await this.loadDashboard(true);
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
    this.rememberViewers(stream);
    this.content.replaceChildren(); this.title(text(stream, 'channel_name'), text(stream, 'title'), text(stream, 'description'));
    const layout = panel('watch-grid'), player = panel('surface');
    player.append(html("<div class='video-stage'><video id='live-video' autoplay playsinline muted controls></video><div class='video-placeholder' id='video-placeholder'>" + icon('video') + t('uiWatchText108')));
    const actions = panel('action-row');
    actions.append(viewerCounter(this.viewerCount), button(t('uiWatchText109'), 'button primary small', async () => {
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
    sound.dataset.liveSound = ''; actions.append(sound);
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
    else this.showEndedLive();
    if (text(stream, 'status') === 'LIVE') {
      await this.syncCollaboration(this.stream);
      this.collaborationPoll = window.setInterval(() => this.launch(() => this.syncCollaboration(this.stream)), 10000);
    }
  }

  private showEndedLive(): void {
    const video = document.getElementById('live-video');
    if (video instanceof HTMLVideoElement) showLiveEnded(video);
    this.content.querySelector<HTMLElement>('[data-live-sound]')?.setAttribute('hidden', '');
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
        this.viewerStream = this.stream; this.viewerCount = viewerNumber(event.viewers);
        updateViewerCounters(this.root, this.viewerCount);
        if (event.hostOnline === false) toast(t('uiHostDisconnected'));
        break;
      case 'notice': toast(event.body ?? ''); break;
      case 'error': toast(typeof event.message === 'string' ? event.message : t('mediaEventFailed'), true); break;
      case 'ended':
        this.viewerCount = 0; updateViewerCounters(this.root, 0);
        this.broadcasting = false; toast(typeof event.message === 'string' ? event.message : t('uiFinishText104')); media.stop();
        this.root.querySelector('.floating-player')?.remove();
        if (this.screen === 'watch') this.showEndedLive();
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
      const row = panel('review-row'); row.append(html(`<div class="review-content"><div class="review-meta"><strong>@${escape(text(message, 'username'))}</strong><span class="tag">${escape(text(message, 'category'))}</span>${this.isAdmin() ? `<span class="muted">${escape(providerName(text(message, 'provider')))}</span>` : ''}</div><p class="quoted-message">${escape(text(message, 'content'))}</p><p class="muted">${escape(text(message, 'reason'))}</p></div>`));
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
    let draft: ModerationPolicyDraft;
    try {draft = ModerationPolicyDraft.fromServer(policy);} catch {throw new Error(t('presetLoadFailed'));}
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
          muteSeconds, reviewThreshold: draft.snapshot().reviewThreshold,
          blockThreshold: draft.snapshot().blockThreshold, allowLinks: links.control.checked, slowMode, autoClips: auto.control.checked,
          blockedWords: lines(words.value), blockedTopics: lines(topics.value)});
        toast(t('uiSettingsText191')); await this.loadDashboard(true);
      } finally {save.disabled = false;}
    });
    level.addEventListener('change', () => {
      try {
        const selected = rows(this.dashboard.moderationPresets).find(value => text(value, 'level') === level.value);
        draft = ModerationPolicyDraft.fromServer(selected).copy();
      } catch {level.value = draft.snapshot().level; toast(t('presetLoadFailed'), true);}
    });
    const applyPreset = button(t('applyModerationPreset'), 'button subtle', async () => {
      const channel = this.channel, selected = level.value;
      save.disabled = level.disabled = hide.control.disabled = mute.control.disabled = seconds.disabled = true;
      try {
        const value = await this.api.request('GET', `/channels/${channel}/policy-presets/${selected}`);
        let next: ModerationPolicyDraft;
        try {next = ModerationPolicyDraft.fromServer(value).copy();} catch {throw new Error(t('presetLoadFailed'));}
        if (!form.isConnected || channel !== this.channel) return;
        draft = next;
        const snapshot = draft.snapshot();
        level.value = snapshot.level; hide.control.checked = snapshot.autoHide;
        mute.control.checked = snapshot.autoMute; seconds.value = String(snapshot.muteSeconds);
        toast(t('moderationPresetReady'));
      } finally {save.disabled = level.disabled = hide.control.disabled = mute.control.disabled = seconds.disabled = false;}
    });
    const presetActions = panel('action-row preset-actions'); presetActions.append(applyPreset, save); form.append(presetActions);
    guidance(form, t('moderationPresetHelp'));
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
    const admin = this.isAdmin();
    this.content.append(html(`<div class="info-banner role-banner${admin ? ' admin-role' : ''}">${icon(admin ? 'gauge' : 'shield')}<div><strong>${escape(t('profileTypeLabel'))}: ${escape(t(admin ? 'roleAdmin' : 'roleUser'))}</strong><p>${escape(t(admin ? 'roleAdminHelp' : 'roleUserHelp'))}</p></div></div>`));
    if (admin) this.content.append(button(t('adminOpenPanel'), 'button primary', () => this.route('admin')));
    this.content.append(button(t('uiAccountText201'), 'button subtle', () => {this.channel = ''; this.route('studio');}), button(t('uiAccountText202'), 'button danger', async () => {
      if (this.broadcasting) {await media.finalizeRecording(); await this.api.request('POST', `/streams/${this.stream}/end`, {});}
      if (this.locationChannel) await this.api.request('PUT',`/channels/${this.locationChannel}/location`,{shared:false});
      this.stopLocation(); await this.api.request('POST', '/auth/logout', {}); setSessionHint(false); this.geminiChat.clear(); media.stop(); this.broadcasting = false; this.api.setToken(''); this.user = null; this.channel = ''; this.dashboard = {}; this.configureMedia(); this.route('login');
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
  /** The active global announcement as a closable banner, unless this browser already closed it. */
  private announcementBanner(): HTMLElement | null {
    const notice = object(this.platform.announcement), id = text(notice, 'id'), message = text(notice, 'message');
    if (!message || dismissedAnnouncement() === id) return null;
    const important = text(notice, 'level') === 'IMPORTANT';
    const banner = panel(`announcement-banner${important ? ' important' : ''}`); banner.setAttribute('role', 'status');
    banner.innerHTML = `${icon('bell')}<div><strong>${escape(t(important ? 'announcementImportant' : 'announcementInfo'))}</strong><p>${escape(message)}</p></div>`;
    const close = button('', 'announcement-close', () => {dismissAnnouncement(id); banner.remove();});
    close.innerHTML = icon('close'); close.setAttribute('aria-label', t('announcementDismiss')); banner.append(close);
    return banner;
  }
  /** Guests learn about the platform from the public status, without waiting for it to draw the form. */
  private async loadPlatformStatus(): Promise<void> {
    try {this.platform = object(await this.api.request('GET', '/platform/status', undefined, true));} catch {return;}
    for (const box of document.querySelectorAll<HTMLElement>('.auth-notices')) this.fillAuthNotices(box);
  }
  private fillAuthNotices(box: HTMLElement): void {
    box.replaceChildren(); const banner = this.announcementBanner(); if (banner) box.append(banner);
    const register = Boolean(box.dataset.register), maintenance = flag(this.platform, 'maintenance'), closed = this.platform.registrationOpen === false;
    const notice = (title: string, detail: string) => html(`<div class="info-banner platform-notice">${icon('settings')}<div><strong>${escape(title)}</strong><p>${escape(detail)}</p></div></div>`);
    if (maintenance) box.append(notice(t('maintenanceTitle'), t(register ? 'maintenanceRegisterHelp' : 'maintenanceLoginHelp')));
    else if (register && closed) box.append(notice(t('registrationClosedTitle'), t('registrationClosedHelp')));
    const submit = register ? box.parentElement?.querySelector<HTMLButtonElement>('.auth-card .button.primary') : null;
    if (submit) submit.disabled = maintenance || closed;
  }
  /** Shown to signed-in accounts that are not administrators while maintenance is on. */
  private showMaintenance(signedIn = Boolean(this.user)): void {
    if (!signedIn || this.isAdmin()) return;
    this.maintenanceScreen = true; this.platform = {...this.platform, maintenance: true};
    if (this.broadcasting) {media.stop(); this.broadcasting = false;}
    this.stopLocation();
    this.root.className = 'auth-shell maintenance-shell';
    const view = panel('maintenance-view');
    view.innerHTML = `<div class="maintenance-icon">${icon('settings')}</div><p class="eyebrow">${escape(t('maintenanceEyebrow'))}</p><h1>${escape(t('maintenanceTitle'))}</h1><p class="muted">${escape(t('maintenanceDetail'))}</p>`;
    const actions = panel('action-row');
    actions.append(button(t('maintenanceRetry'), 'button primary', () => location.reload()), button(t('uiAccountText202'), 'button subtle', async () => {
      try {await this.api.request('POST', '/auth/logout', {});} catch {/* the session may already be closed */}
      setSessionHint(false); location.reload();
    }));
    view.append(actions);
    const announcement = this.announcementBanner(); if (announcement) view.prepend(announcement);
    this.root.replaceChildren(view);
  }
  private isAdmin(): boolean {return text(this.user, 'role') === 'ADMIN';}
  /** A yes/no question in the app's own dialog; closing it counts as "no". */
  private confirmAction(heading: string, detail: string, label: string): Promise<boolean> {
    return new Promise(resolve => {
      const modal = dialog(heading); let answered = false;
      const finish = (value: boolean) => {if (answered) return; answered = true; resolve(value); modal.close();};
      const message = document.createElement('p'); message.className = 'muted'; message.textContent = detail;
      const actions = panel('action-row'); actions.append(button(label, 'button danger', () => finish(true)), button(t('uiEditClipText154'), 'button subtle', () => finish(false)));
      modal.form.append(message, actions); modal.element.addEventListener('close', () => {if (!answered) {answered = true; resolve(false);}});
    });
  }
  /** Administration panel: platform figures, technical status, accounts, live broadcasts and categories. The server checks the role again on every call. */
  private async adminPanel(): Promise<void> {
    this.title(t('adminEyebrow'), t('adminTitle'), t('adminDescription'));
    const epoch = this.epoch;
    const [overview, live, actions] = await Promise.all([this.api.request('GET', '/admin/overview'), this.api.request('GET', '/admin/streams'), this.api.request('GET', '/admin/actions')]);
    if (epoch !== this.epoch) return;
    const totals = object(object(overview).totals), system = object(object(overview).system);
    const figures = panel('stats-grid admin-stats');
    for (const [label, key] of [['adminFigureUsers', 'users'], ['adminFigureAdmins', 'admins'], ['adminFigureSuspended', 'suspended'], ['adminFigureChannels', 'channels'], ['adminFigureLive', 'live'], ['adminFigureStreams', 'streams'], ['adminFigureMessages', 'messages'], ['adminFigurePending', 'pending_reviews'], ['adminFigureClips', 'clips'], ['adminFigureEvents', 'upcoming_events']] as const)
      figures.append(html(`<article class="metric"><span>${escape(t(label))}</span><strong>${escape(text(totals, key) || '0')}</strong></article>`));
    this.content.append(figures);
    this.platform = object(object(overview).platform);
    const switches = panel('surface admin-section'); switches.append(html(`<div class="panel-heading"><h2>${escape(t('adminPlatformTitle'))}</h2></div><p class="muted">${escape(t('adminPlatformHelp'))}</p>`));
    const maintenance = checkbox(t('adminMaintenanceLabel'), flag(this.platform, 'maintenance')), registration = checkbox(t('adminRegistrationLabel'), this.platform.registrationOpen !== false);
    const saveSwitches = async (changed: 'maintenance' | 'registration') => {
      // The switch that changed already shows its new value; "before" is what to restore if saving fails.
      const before = {maintenance: changed === 'maintenance' ? !maintenance.control.checked : maintenance.control.checked, registrationOpen: changed === 'registration' ? !registration.control.checked : registration.control.checked};
      const next = {maintenance: maintenance.control.checked, registrationOpen: registration.control.checked};
      if (changed === 'maintenance' && next.maintenance && !await this.confirmAction(t('adminMaintenanceOnTitle'), t('adminMaintenanceOnDetail'), t('adminMaintenanceOn'))) {maintenance.control.checked = false; return;}
      maintenance.control.disabled = registration.control.disabled = true;
      try {
        this.platform = {...this.platform, ...object(await this.api.request('PUT', '/admin/platform', next))};
        toast(changed === 'maintenance' ? t(next.maintenance ? 'adminMaintenanceEnabled' : 'adminMaintenanceDisabled') : t(next.registrationOpen ? 'adminRegistrationOpened' : 'adminRegistrationClosed'));
        this.route('admin');
      } catch (error) {
        maintenance.control.checked = before.maintenance; registration.control.checked = before.registrationOpen; throw error;
      } finally {maintenance.control.disabled = registration.control.disabled = false;}
    };
    maintenance.control.addEventListener('change', () => this.launch(() => saveSwitches('maintenance')));
    registration.control.addEventListener('change', () => this.launch(() => saveSwitches('registration')));
    switches.append(maintenance.element, html(`<p class="muted switch-help">${escape(t('adminMaintenanceHelp'))}</p>`), registration.element, html(`<p class="muted switch-help">${escape(t('adminRegistrationHelp'))}</p>`));
    this.content.append(switches);
    const current = object(this.platform.announcement), currentImportant = text(current, 'level') === 'IMPORTANT';
    const announce = panel('surface admin-section'); announce.append(html(`<div class="panel-heading"><h2>${escape(t('adminAnnouncementTitle'))}</h2></div><p class="muted">${escape(t('adminAnnouncementHelp'))}</p>`));
    if (text(current, 'message')) {
      const active = panel('admin-row');
      active.append(html(`<div class="admin-row-main"><span class="tag ${currentImportant ? 'live-tag' : 'admin-tag'}">${escape(t(currentImportant ? 'announcementImportant' : 'announcementInfo'))}</span><div><strong>${escape(text(current, 'message'))}</strong><small class="muted">${escape(t('adminAnnouncementActive'))}</small></div></div>`));
      const remove = button(t('adminAnnouncementRemove'), 'button danger small', async () => {
        if (!await this.confirmAction(t('adminAnnouncementRemoveTitle'), t('adminAnnouncementRemoveDetail'), t('adminAnnouncementRemove'))) return;
        await this.api.request('DELETE', '/admin/announcement'); this.platform = {...this.platform, announcement: null}; toast(t('adminAnnouncementRemoved')); this.route('admin');
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
        const result = object(await this.api.request('POST', '/admin/announcement', {message: message.value.trim(), level: level.value, sendNotification: send.control.checked}));
        this.platform = object(result.platform);
        toast(send.control.checked ? t('adminAnnouncementSent').replace('{count}', text(result, 'notified')) : t('adminAnnouncementPublished')); this.route('admin');
      } finally {publish.disabled = false;}
    });
    const announceRow = panel('form-row'); announceRow.append(field(t('adminAnnouncementLevel'), level));
    announce.append(field(t('adminAnnouncementMessage'), message), counter, announceRow, send.element, publish);
    this.content.append(announce);

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
      const found = rows(await this.api.request('GET', `/admin/users?search=${encodeURIComponent(finder.value.trim())}`));
      if (!accounts.isConnected) return; accounts.replaceChildren();
      if (!found.length) accounts.append(html(`<p class="muted">${escape(t('adminUsersEmpty'))}</p>`));
      for (const person of found) accounts.append(this.adminUserRow(person, loadUsers));
    };
    let searchTimer = 0; finder.addEventListener('input', () => {window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => this.launch(loadUsers), 300);});

    const broadcasts = panel('surface admin-section'); broadcasts.append(html(`<div class="panel-heading"><h2>${escape(t('adminLiveTitle'))}</h2></div>`));
    const streams = rows(live);
    if (!streams.length) broadcasts.append(html(`<p class="muted">${escape(t('adminLiveEmpty'))}</p>`));
    for (const stream of streams) {
      const row = panel('admin-row'), title = text(stream, 'title'), started = new Date(text(stream, 'started_at')).toLocaleTimeString('es-CO', {hour: 'numeric', minute: '2-digit'});
      const category = text(stream, 'category');
      row.append(html(`<div class="admin-row-main"><span class="status-dot"></span><div><strong>${escape(title)}</strong><small class="muted">@${escape(text(stream, 'username'))} · ${escape(text(stream, 'channel_name'))}${category ? ' · ' + escape(category) : ''} · ${escape(t('adminSince'))} ${escape(started)}</small></div><div class="admin-tags"><span class="tag">${escape(text(stream, 'viewers') || '0')} ${escape(t('adminViewers'))}</span></div></div>`));
      const controls = panel('action-row');
      controls.append(button(t('adminWatch'), 'button subtle small', () => this.openStream({id: text(stream, 'id'), title})), button(t('adminEndStream'), 'button danger small', async () => {
        if (!await this.confirmAction(t('adminEndStreamTitle'), t('adminEndStreamDetail').replace('{title}', title), t('adminEndStream'))) return;
        await this.api.request('POST', `/admin/streams/${text(stream, 'id')}/end`, {}); toast(t('adminStreamEnded')); this.route('admin');
      }));
      row.append(controls); broadcasts.append(row);
    }

    const catalogue = panel('surface admin-section'); catalogue.append(html(`<div class="panel-heading"><h2>${escape(t('adminCategoriesTitle'))}</h2></div><p class="muted">${escape(t('adminCategoriesHelp'))}</p>`));
    const refreshCategories = async () => {this.categories = rows(await this.api.request('GET', '/categories')); this.route('admin');};
    for (const category of this.categories) {
      const row = panel('simple-row'), name = document.createElement('span'); name.textContent = text(category, 'name');
      row.append(name, button(t('adminRename'), 'button subtle small', () => {
        const modal = dialog(t('adminRenameTitle')), value = input(t('adminCategoryName'), text(category, 'name')); value.maxLength = 64;
        modal.form.append(field(t('adminCategoryName'), value), button(t('saveChanges'), 'button primary', async () => {
          if (!value.value.trim()) {value.focus(); return;}
          await this.api.request('PUT', `/admin/categories/${text(category, 'id')}`, {name: value.value.trim()}); modal.close(); toast(t('adminCategorySaved')); await refreshCategories();
        }), button(t('uiEditClipText154'), 'button subtle', modal.close)); value.focus();
      }));
      catalogue.append(row);
    }
    const newName = input(t('adminCategoryNew')); newName.maxLength = 64; newName.setAttribute('aria-label', t('adminCategoryNew'));
    const create = panel('admin-inline'); create.append(newName, button(t('adminCategoryCreate'), 'button primary small', async () => {
      if (!newName.value.trim()) {newName.focus(); return;}
      await this.api.request('POST', '/admin/categories', {name: newName.value.trim()}); toast(t('adminCategorySaved')); await refreshCategories();
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
    };
    for (const entry of entries) {
      const when = new Date(text(entry, 'created_at')).toLocaleString('es-CO', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
      const line = panel('simple-row'), what = document.createElement('span'), meta = document.createElement('small');
      what.textContent = `${actionNames[text(entry, 'action')] ?? text(entry, 'action')} ${text(entry, 'label')}`; meta.className = 'muted'; meta.textContent = `@${text(entry, 'admin')} · ${when}`;
      line.append(what, meta); activity.append(line);
    }
    const columns = panel('admin-columns'); columns.append(people, technical);
    this.content.append(columns, broadcasts, catalogue, activity);
    await loadUsers();
  }
  private adminUserRow(person: Row, reload: () => Promise<void>): HTMLDivElement {
    const row = panel('admin-row'), id = text(person, 'id'), username = text(person, 'username'), handle = '@' + username;
    const self = id === text(this.user, 'id'), admin = flag(person, 'admin'), suspended = text(person, 'status') === 'SUSPENDED', locked = flag(person, 'protected');
    const tags = [
      `<span class="tag${admin ? ' admin-tag' : ''}">${escape(t(admin ? 'roleAdmin' : 'roleUser'))}</span>`,
      suspended ? `<span class="tag suspended-tag">${escape(t('adminSuspendedTag'))}</span>` : '',
      flag(person, 'live') ? `<span class="tag live-tag">${escape(t('liveShort'))}</span>` : '',
      self ? `<span class="tag">${escape(t('adminYou'))}</span>` : '',
    ].join('');
    const channel = text(person, 'channel_name');
    row.append(html(`<div class="admin-row-main"><span class="avatar-chip small">${escape(username.slice(0, 1).toUpperCase())}</span><div><strong>${escape(handle)}</strong><small class="muted">${escape(text(person, 'display_name'))}${channel ? ' · ' + escape(channel) : ''}</small></div><div class="admin-tags">${tags}</div></div>`));
    const role = button(t(admin ? 'adminRevoke' : 'adminGrant'), 'button subtle small', async () => {
      const ok = await this.confirmAction(t(admin ? 'adminRevokeTitle' : 'adminGrantTitle'), t(admin ? 'adminRevokeDetail' : 'adminGrantDetail').replace('{user}', handle), t(admin ? 'adminRevoke' : 'adminGrant'));
      if (!ok) return;
      await this.api.request('PUT', `/admin/users/${id}/role`, {admin: !admin}); toast(t(admin ? 'adminRevoked' : 'adminGranted').replace('{user}', handle)); await reload();
    });
    role.disabled = admin ? self || locked : suspended;
    if (admin && locked) role.title = t('adminLockedHelp'); else if (admin && self) role.title = t('adminSelfHelp');
    const status = button(t(suspended ? 'adminReactivate' : 'adminSuspend'), suspended ? 'button subtle small' : 'button danger small', async () => {
      if (!suspended && !await this.confirmAction(t('adminSuspendTitle'), t('adminSuspendDetail').replace('{user}', handle), t('adminSuspend'))) return;
      await this.api.request('PUT', `/admin/users/${id}/status`, {status: suspended ? 'ACTIVE' : 'SUSPENDED'}); toast(t(suspended ? 'adminReactivated' : 'adminSuspendedDone').replace('{user}', handle)); await reload();
    });
    status.disabled = self || (admin && !suspended);
    if (!self && admin && !suspended) status.title = t('adminSuspendAdminHelp');
    const controls = panel('action-row'); controls.append(role, status); row.append(controls); return row;
  }
  private aiStatus(): HTMLDivElement {
    const capabilities = object(this.dashboard.assistantCapabilities);
    const configured = typeof capabilities.configured === 'boolean' ? flag(capabilities, 'configured') : flag(this.config, 'aiConfigured');
    const provider = text(capabilities, 'provider') || text(this.config, 'aiMode');
    const model = text(capabilities, 'model') || text(this.config, 'aiModel');
    const localModel = provider === 'OLLAMA';
    // Provider, model and infrastructure details are technical: only administrators see them.
    if (!this.isAdmin()) return html(`<div class="info-banner ai-provider-status${configured ? ' success-banner' : ''}">${icon('spark')}<div><strong>${escape(configured ? t('aiActiveSimple') : t('uiAiStatusText204'))}</strong><p>${escape(configured ? t('uiAiStatusText205') : t('uiAiStatusText206'))}</p></div></div>`);
    const label = configured ? `${t('aiProviderConfigured')}: ${providerName(provider)}` : t('uiAiStatusText204');
    return html(`<div class="info-banner ai-provider-status${configured ? ' success-banner' : ''}">${icon('spark')}<div><strong>${escape(label)}</strong>${configured ? `<p>${escape(t('aiModelLabel'))}: ${escape(model)}</p>` : ''}<p>${configured ? (localModel ? t('localAiAvailability') : t('uiAiStatusText205')) : t('uiAiStatusText206')}</p></div></div>`);
  }
}
function stringList(value: Json | undefined): string[] {return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];}
function lines(value: string): string[] {return value.split('\n').map(item => item.trim()).filter(Boolean);}
function levelName(level: string): string {return level === 'STRICT' ? t('uiLevelNameText207') : level === 'RELAXED' ? t('uiLevelNameText208') : t('uiLevelNameText209');}
function providerName(provider: string): string {return provider === 'OLLAMA' ? t('localAiProvider') : provider === 'GEMINI' ? 'Gemini' : provider === 'UNAVAILABLE' ? t('uiProviderNameText210') : t('uiProviderNameText211');}
function statusName(status: string): string {return status === 'APPROVED' ? t('uiStatusNameText212') : status === 'REJECTED' ? t('uiStatusNameText213') : t('uiStatusNameText214');}
