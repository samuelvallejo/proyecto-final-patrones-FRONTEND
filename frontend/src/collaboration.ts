import {t} from './i18n';
import {connectionTicket} from './api';

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
  private signalRetry = 0;
  private heartbeat = 0;
  private fallbackTimer = 0;
  private mediaUrl = '';
  private fragmentMode = false;
  private live = true;
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly api: string,
    _token: string,
    private readonly stream: string,
    private readonly iceServers: RTCIceServer[],
  ) {}

  start(): void {
    if (!this.live) return;
    this.video.muted = true;
    const socket = new WebSocket(`${this.api.replace(/^http/, 'ws')}/ws`);
    this.socket = socket;
    socket.onopen = () => {void connectionTicket().then(ticket => {
      if (this.socket!==socket || !this.live) return;
      socket.send(JSON.stringify({type: 'join', streamId: this.stream, token: ticket, host: false}));
      this.heartbeat = window.setInterval(() => {if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: 'ping'}));}, 20000);
    }).catch(() => socket.close());};
    socket.onmessage = event => {void this.handleSignalMessage(String(event.data), socket);};
    socket.onclose = () => {
      window.clearInterval(this.heartbeat);
      if (this.live) {
        this.peer?.close(); this.peer = null; this.pending = []; this.closeRelay();
        this.waiting(t('collaborationDisconnected')); this.signalRetry = window.setTimeout(() => this.start(), 3000);
      }
    };
    socket.onerror = () => this.waiting(t('collaborationConnecting'));
  }

  private async handleSignalMessage(raw: string, socket: WebSocket): Promise<void> {
    if (!this.live || this.socket !== socket) return;
    try {
      const event = JSON.parse(raw) as {type?: string; hostOnline?: boolean; from?: string; payload?: SignalPayload; message?: string};
      if (event.type === 'joined') {
        if (event.hostOnline) this.awaitRelay(); else this.waiting(t('collaborationWaiting'));
      } else if (event.type === 'presence') {
        if (event.hostOnline) this.awaitRelay(); else {this.peer?.close(); this.peer = null; this.pending = []; this.closeRelay(); this.waiting(t('collaborationWaiting'));}
      } else if (event.type === 'signal' && event.payload) {
        await this.accept(event.from, event.payload);
      } else if (event.type === 'ended') {
        this.stop(); this.waiting(t('collaborationStreamEnded'));
      } else if (event.type === 'error') {
        this.waiting(event.message || t('collaborationUnavailable'));
      }
    } catch {this.waiting(t('operationFailed'));}
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
      this.video.onplaying = () => this.waiting(''); void this.video.play().catch(() => {});
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

  private awaitRelay(): void {
    if (this.fallbackTimer || this.peer?.connectionState === 'connected' || this.relaySocket) return;
    this.fallbackTimer = window.setTimeout(() => {this.fallbackTimer = 0; this.connectRelay();}, 8000);
  }

  private connectRelay(): void {
    if (!this.live || this.relaySocket) return;
    const socket = new WebSocket(`${this.api.replace(/^http/, 'ws')}/ws/media`);
    this.relaySocket = socket; socket.binaryType = 'arraybuffer';
    socket.onopen = () => {void connectionTicket().then(ticket => {if (this.relaySocket===socket && this.live) socket.send(JSON.stringify({type: 'join', streamId: this.stream, token: ticket, host: false, format: ''}));}).catch(() => socket.close());};
    socket.onmessage = event => {
      if (this.relaySocket !== socket) return;
      if (event.data instanceof ArrayBuffer) {
        this.fragments.push(event.data); if (this.fragments.length > 3) this.fragments.shift();
        if (this.fragmentMode) {if (this.video.ended || !this.video.getAttribute('src')) this.nextFragment();}
        else this.appendFragment();
        return;
      }
      try {
        const data = JSON.parse(String(event.data)) as {type?: string; format?: string; message?: string};
        if (data.type === 'relay-format' && data.format) this.prepareRelay(data.format);
        if (data.type === 'error') this.waiting(data.message || t('collaborationUnavailable'));
      } catch { /* Ignore malformed relay messages. */ }
    };
    socket.onclose = () => {if (this.relaySocket === socket) {this.relaySocket = null; if (this.live) this.retryTimer = window.setTimeout(() => this.connectRelay(), 3000);}};
  }

  private prepareRelay(format: string): void {
    if (this.format === format && (this.mediaSource || this.fragmentMode)) return;
    this.format = format;
    this.video.onplaying = () => this.waiting('');
    if (!window.MediaSource || !MediaSource.isTypeSupported(format)) {
      this.fragmentMode = true; this.video.srcObject = null;
      this.video.removeAttribute('src'); this.video.onended = () => this.nextFragment(); this.nextFragment(); return;
    }
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaSource = new MediaSource(); this.sourceBuffer = null;
    this.video.srcObject = null; this.mediaUrl = URL.createObjectURL(this.mediaSource); this.video.src = this.mediaUrl;
    this.mediaSource.addEventListener('sourceopen', () => {
      if (!this.mediaSource || this.mediaSource.readyState !== 'open') return;
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(format); this.sourceBuffer.mode = 'sequence';
        this.sourceBuffer.addEventListener('updateend', () => {
          const buffer = this.sourceBuffer;
          if (buffer?.buffered.length) {
            const end = buffer.buffered.end(buffer.buffered.length - 1);
            if (end - this.video.currentTime > 7) this.video.currentTime = Math.max(0, end - 3);
            void this.video.play().catch(() => {});
          }
          this.appendFragment();
        }); this.appendFragment();
      } catch {this.waiting(t('collaborationBrowserUnsupported'));}
    }, {once: true});
  }

  private appendFragment(): void {
    if (!this.live || !this.sourceBuffer || this.sourceBuffer.updating || !this.fragments.length) return;
    if (this.mediaSource?.readyState !== 'open') return;
    if (this.video.currentTime > 25 && this.sourceBuffer.buffered.length && this.sourceBuffer.buffered.start(0) < this.video.currentTime - 20) {
      this.sourceBuffer.remove(0, this.video.currentTime - 20); return;
    }
    try {this.sourceBuffer.appendBuffer(this.fragments.shift()!); void this.video.play().catch(() => {});}
    catch {this.fragments = [];}
  }

  private nextFragment(): void {
    if (!this.live || !this.fragments.length) return;
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = URL.createObjectURL(new Blob([this.fragments.shift()!], {type: this.format}));
    this.video.src = this.mediaUrl; void this.video.play().catch(() => {});
  }

  private closeRelay(preserveVideo = false): void {
    window.clearTimeout(this.fallbackTimer); this.fallbackTimer = 0;
    window.clearTimeout(this.retryTimer); this.retryTimer = 0;
    const previous = this.relaySocket; this.relaySocket = null;
    if (previous) {previous.onclose = null; previous.close();}
    this.sourceBuffer = null; this.mediaSource = null; this.fragments = [];
    this.format = ''; this.fragmentMode = false; this.video.onended = null;
    if (this.mediaUrl) {URL.revokeObjectURL(this.mediaUrl); this.mediaUrl = ''; this.video.removeAttribute('src');}
    if (!preserveVideo) this.video.srcObject = null;
  }

  private waiting(message: string): void {
    const placeholder = this.video.parentElement?.querySelector<HTMLElement>('.collaboration-video-status');
    if (placeholder) {placeholder.textContent = message; placeholder.hidden = !message;}
  }

  stop(): void {
    this.live = false; window.clearTimeout(this.retryTimer); window.clearTimeout(this.signalRetry); window.clearInterval(this.heartbeat);
    const socket = this.socket; this.socket = null; if (socket) {socket.onclose = null; socket.close();}
    this.closeRelay(); this.peer?.close(); this.peer = null; this.pending = [];
    this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src');
  }
}
