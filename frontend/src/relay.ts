import {object, text} from './contracts';
import {t} from './i18n';
import {connectionTicket} from './api';

interface RelaySession {
  api: string; token: string; stream: string; local: MediaStream | null; format: string; notice: (message: string) => void;
}

/** Transient, bounded video fragments over WSS for networks that block WebRTC. */
export class MediaRelay {
  private socket: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private recordTimer: number | undefined;
  private retryTimer: number | undefined;
  private heartbeat: number | undefined;
  private source: MediaSource | null = null;
  private buffer: SourceBuffer | null = null;
  private video: HTMLVideoElement | null = null;
  private sourceUrl = '';
  private fragmentUrl = '';
  private queue: ArrayBuffer[] = [];
  private mime = '';
  private independentFiles = false;
  private viewers = 0;
  private session: RelaySession | null = null;

  start(api: string, token: string, stream: string, local: MediaStream | null, format: string, notice: (message: string) => void): void {
    if (this.session?.stream === stream) return;
    this.stop(); this.session = {api, token, stream, local, format, notice}; this.open();
  }

  viewerActive(): boolean {return Boolean(this.session && !this.session.local);}

  stop(): void {
    this.session = null; window.clearTimeout(this.retryTimer); window.clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.stopRecording(); const previous = this.socket; this.socket = null; if (previous) {previous.onclose = null; previous.close();}
    this.resetPlayer(); this.queue = []; this.mime = ''; this.viewers = 0;
  }

  private publish(): void {
    const current = this.session, ws = this.socket;
    if (!current?.local || !this.viewers || this.recorder || ws?.readyState !== WebSocket.OPEN) return;
    const chunks: Blob[] = [];
    const recording = new MediaRecorder(current.local, {mimeType: current.format, videoBitsPerSecond: 650000, audioBitsPerSecond: 48000});
    this.recorder = recording;
    recording.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
    recording.onstop = () => {
      if (this.recorder !== recording || this.session !== current || this.socket !== ws) return;
      this.recorder = null;
      const fragment = new Blob(chunks, {type: recording.mimeType});
      if (fragment.size && fragment.size <= 1024 * 1024 && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(fragment);
      this.publish();
    };
    recording.start(); this.recordTimer = window.setTimeout(() => {if (recording.state === 'recording') recording.stop();}, 2200);
  }

  private stopRecording(): void {
    window.clearTimeout(this.recordTimer);
    const previous = this.recorder; this.recorder = null;
    if (previous?.state === 'recording') previous.stop();
  }

  private playing(): void {
    const placeholder = document.getElementById('video-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  }

  private play(): void {
    const video = this.video;
    if (video) void video.play().catch(() => {video.muted = true; void video.play().catch(() => {});});
  }

  private append(): void {
    const video = this.video, buffer = this.buffer;
    if (!video || !buffer || buffer.updating || !this.queue.length || this.source?.readyState !== 'open') return;
    if (video.currentTime > 25 && buffer.buffered.length && buffer.buffered.start(0) < video.currentTime - 20) {
      buffer.remove(0, video.currentTime - 20); return;
    }
    const fragment = this.queue.shift();
    if (fragment) {
      try {buffer.appendBuffer(fragment);}
      catch (error) {console.warn('Relay fragment rejected', error); this.resetPlayer();}
    }
  }

  private nextFragment(): void {
    if (!this.video || !this.queue.length) return;
    if (this.fragmentUrl) URL.revokeObjectURL(this.fragmentUrl);
    this.fragmentUrl = URL.createObjectURL(new Blob([this.queue.shift()!], {type: this.mime}));
    this.video.src = this.fragmentUrl; this.play();
  }

  private resetPlayer(): void {
    this.buffer = null; this.source = null;
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl); this.sourceUrl = '';
    if (this.fragmentUrl) URL.revokeObjectURL(this.fragmentUrl); this.fragmentUrl = '';
    if (this.video) {this.video.onended = null; this.video.onplaying = null;}
    this.video = null;
  }

  private player(format: string, files = this.independentFiles): void {
    const element = document.getElementById('live-video');
    if (!(element instanceof HTMLVideoElement)) return;
    if (this.video === element && this.mime === format && this.independentFiles === files) return;
    this.resetPlayer(); this.mime = format; this.independentFiles = files; this.video = element; element.srcObject = null;
    element.dataset.transport = 'relay'; element.onplaying = () => this.playing();
    if (!files && window.MediaSource && MediaSource.isTypeSupported(format)) {
      const media = new MediaSource(); this.source = media; this.sourceUrl = URL.createObjectURL(media); element.src = this.sourceUrl;
      media.addEventListener('sourceopen', () => {
        if (this.source !== media) return;
        const buffer = media.addSourceBuffer(format); buffer.mode = 'sequence'; this.buffer = buffer;
        buffer.addEventListener('updateend', () => {
          if (this.video && this.buffer?.buffered.length) {
            const end = this.buffer.buffered.end(this.buffer.buffered.length - 1);
            if (end - this.video.currentTime > 7) this.video.currentTime = Math.max(0, end - 3);
            this.play();
          }
          this.append();
        });
        this.append();
      }, {once: true});
    } else {
      element.onended = () => this.nextFragment();
      this.nextFragment();
    }
  }

  private open(): void {
    const current = this.session; if (!current) return;
    const ws = new WebSocket(`${current.api.replace(/^http/, 'ws')}/ws/media`); this.socket = ws; ws.binaryType = 'arraybuffer';
    ws.onopen = () => {void connectionTicket().then(ticket => {if (this.socket === ws && this.session === current) ws.send(JSON.stringify({type: 'join', streamId: current.stream, token: ticket, host: Boolean(current.local), format: current.format}));}).catch(() => ws.close());};
    ws.onmessage = event => {
      if (this.socket !== ws || this.session !== current) return;
      if (event.data instanceof ArrayBuffer) {
        this.queue.push(event.data); if (this.queue.length > 3) this.queue.shift();
        this.player(this.mime);
        if (this.buffer) this.append(); else if (this.video && !this.source && (this.video.ended || !this.video.getAttribute('src'))) this.nextFragment();
        return;
      }
      try {
        const data = object(JSON.parse(String(event.data)) as unknown);
        if (text(data, 'type') === 'relay-ready' || text(data, 'type') === 'relay-demand') {
          this.viewers = Number(data.viewers) || 0;
          if (this.viewers) this.publish(); else this.stopRecording();
        }
        if (text(data, 'type') === 'relay-format') this.player(text(data, 'format'), data.fragmentMode === 'file');
        if (text(data, 'type') === 'error') current.notice(text(data, 'message'));
        if (!this.heartbeat) this.heartbeat = window.setInterval(() => {if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: 'ping'}));}, 20000);
      } catch (error) {console.warn('Relay event rejected', error);}
    };
    ws.onclose = event => {
      if (this.session !== current || this.socket !== ws) return;
      window.clearInterval(this.heartbeat); this.heartbeat = undefined; this.stopRecording(); this.viewers = 0;
      if (event.code === 1008) {current.notice(t('mediaRelayUnavailable')); this.session = null; return;}
      this.retryTimer = window.setTimeout(() => this.open(), 2000);
    };
  }
}

/** One relay connection per page. */
export const relay = new MediaRelay();
