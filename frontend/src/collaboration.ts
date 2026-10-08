import {t} from './i18n';

type SignalPayload = {description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit};

/** A signaling peer dedicated to one secondary collaboration perspective. */
export class CollaborationTile {
  private socket: WebSocket | null = null;
  private relaySocket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private fragments: ArrayBuffer[] = [];
  private format = '';
  private retryTimer = 0;
  private live = true;
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly api: string,
    private readonly token: string,
    private readonly stream: string,
    private readonly iceServers: RTCIceServer[],
  ) {}

  start(): void {
    this.video.muted = true;
    const socket = new WebSocket(`${this.api.replace(/^http/, 'ws')}/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({type: 'join', streamId: this.stream, token: this.token, host: false}));
    socket.onmessage = event => {void this.handleSignalMessage(String(event.data), socket);};
    socket.onclose = () => {if (this.live) this.waiting(t('collaborationDisconnected'));};
    socket.onerror = () => this.waiting(t('collaborationConnecting'));
  }

  private async handleSignalMessage(raw: string, socket: WebSocket): Promise<void> {
    if (!this.live || this.socket !== socket) return;
    try {
      const event = JSON.parse(raw) as {type?: string; hostOnline?: boolean; from?: string; payload?: SignalPayload; message?: string};
      if (event.type === 'joined') {
        if (event.hostOnline) this.connectRelay(); else this.waiting(t('collaborationWaiting'));
      } else if (event.type === 'presence') {
        if (event.hostOnline) this.connectRelay(); else {this.peer?.close(); this.peer = null; this.closeRelay(); this.waiting(t('collaborationWaiting'));}
      } else if (event.type === 'signal' && event.payload) {
        await this.accept(event.from, event.payload);
      } else if (event.type === 'ended') {
        this.waiting(t('collaborationStreamEnded'));
      } else if (event.type === 'error') {
        this.waiting(event.message || t('collaborationUnavailable'));
      }
    } catch (error) {console.warn('Collaboration signaling message rejected', error);}
  }

  private async accept(from: string | undefined, payload: SignalPayload): Promise<void> {
    if (!from) return;
    const peer = this.peer ?? new RTCPeerConnection({iceServers: this.iceServers});
    this.peer = peer;
    peer.onicecandidate = event => {
      if (event.candidate && this.socket?.readyState === WebSocket.OPEN)
        this.socket.send(JSON.stringify({type: 'signal', to: from, payload: {candidate: event.candidate}}));
    };
    peer.ontrack = event => {
      const stream = event.streams[0];
      if (stream) this.video.srcObject = stream;
      else {
        const current = this.video.srcObject instanceof MediaStream ? this.video.srcObject : new MediaStream();
        current.addTrack(event.track); this.video.srcObject = current;
      }
      this.waiting(''); void this.video.play().catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {this.closeRelay(true); this.waiting('');}
      else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.connectRelay();
    };
    if (payload.description) {
      await peer.setRemoteDescription(payload.description);
      for (const candidate of this.pending) await peer.addIceCandidate(candidate);
      this.pending = [];
      if (payload.description.type === 'offer') {
        await peer.setLocalDescription(await peer.createAnswer());
        this.socket?.send(JSON.stringify({type: 'signal', to: from, payload: {description: peer.localDescription}}));
      }
    } else if (payload.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
      else this.pending.push(payload.candidate);
    }
  }

  private connectRelay(): void {
    if (!this.live || this.relaySocket) return;
    const socket = new WebSocket(`${this.api.replace(/^http/, 'ws')}/ws/media`);
    this.relaySocket = socket; socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({type: 'join', streamId: this.stream, token: this.token, host: false, format: ''}));
    socket.onmessage = event => {
      if (this.relaySocket !== socket) return;
      if (event.data instanceof ArrayBuffer) {this.fragments.push(event.data); if (this.fragments.length > 4) this.fragments.shift(); this.appendFragment(); return;}
      try {
        const data = JSON.parse(String(event.data)) as {type?: string; format?: string; message?: string};
        if (data.type === 'relay-format' && data.format) this.prepareRelay(data.format);
        if (data.type === 'error') this.waiting(data.message || t('collaborationUnavailable'));
      } catch { /* Ignore malformed relay messages. */ }
    };
    socket.onclose = () => {if (this.relaySocket === socket) {this.relaySocket = null; if (this.live) this.retryTimer = window.setTimeout(() => this.connectRelay(), 3000);}};
  }

  private prepareRelay(format: string): void {
    if (this.format === format && this.mediaSource?.readyState === 'open') return;
    this.format = format;
    if (!window.MediaSource || !MediaSource.isTypeSupported(format)) {this.waiting(t('collaborationBrowserUnsupported')); return;}
    if (this.video.src) URL.revokeObjectURL(this.video.src);
    this.mediaSource = new MediaSource(); this.sourceBuffer = null;
    this.video.srcObject = null; this.video.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      if (!this.mediaSource || this.mediaSource.readyState !== 'open') return;
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(format); this.sourceBuffer.mode = 'sequence';
        this.sourceBuffer.addEventListener('updateend', () => this.appendFragment()); this.appendFragment();
      } catch {this.waiting(t('collaborationBrowserUnsupported'));}
    }, {once: true});
  }

  private appendFragment(): void {
    if (!this.live || !this.sourceBuffer || this.sourceBuffer.updating || !this.fragments.length) return;
    if (this.mediaSource?.readyState !== 'open') return;
    try {this.sourceBuffer.appendBuffer(this.fragments.shift()!); void this.video.play().catch(() => {}); this.waiting('');}
    catch {this.fragments = [];}
  }

  private closeRelay(preserveVideo = false): void {
    window.clearTimeout(this.retryTimer); this.retryTimer = 0;
    const previous = this.relaySocket; this.relaySocket = null;
    if (previous) {previous.onclose = null; previous.close();}
    this.sourceBuffer = null; this.mediaSource = null; this.fragments = [];
    if (this.video.src) {URL.revokeObjectURL(this.video.src); this.video.removeAttribute('src');}
    if (!preserveVideo) this.video.srcObject = null;
  }

  private waiting(message: string): void {
    const placeholder = this.video.parentElement?.querySelector<HTMLElement>('.collaboration-video-status');
    if (placeholder) {placeholder.textContent = message; placeholder.hidden = !message;}
  }

  stop(): void {
    this.live = false; window.clearTimeout(this.retryTimer);
    const socket = this.socket; this.socket = null; if (socket) {socket.onclose = null; socket.close();}
    this.closeRelay(); this.peer?.close(); this.peer = null; this.pending = [];
    this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src');
  }
}
