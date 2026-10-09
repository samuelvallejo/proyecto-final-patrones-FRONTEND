import {object, text} from './contracts';
import {t} from './i18n';

/** Transient, bounded video fragments over WSS for networks that block WebRTC. */
let socket: WebSocket | null = null;
let recorder: MediaRecorder | null = null;
let recordTimer: number | undefined;
let retryTimer: number | undefined;
let heartbeat: number | undefined;
let source: MediaSource | null = null;
let buffer: SourceBuffer | null = null;
let video: HTMLVideoElement | null = null;
let sourceUrl = '';
let fragmentUrl = '';
let queue: ArrayBuffer[] = [];
let mime = '';
let viewers = 0;
let session: {api: string; token: string; stream: string; local: MediaStream | null; format: string; notice: (message: string) => void} | null = null;

function publish(): void {
  const current = session, ws = socket;
  if (!current?.local || !viewers || recorder || ws?.readyState !== WebSocket.OPEN) return;
  const chunks: Blob[] = [];
  const recording = new MediaRecorder(current.local, {mimeType: current.format, videoBitsPerSecond: 650000, audioBitsPerSecond: 48000});
  recorder = recording;
  recording.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
  recording.onstop = () => {
    if (recorder !== recording || session !== current || socket !== ws) return;
    recorder = null;
    const fragment = new Blob(chunks, {type: recording.mimeType});
    if (fragment.size && fragment.size <= 1024 * 1024 && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(fragment);
    publish();
  };
  recording.start(); recordTimer = window.setTimeout(() => {if (recording.state === 'recording') recording.stop();}, 2200);
}

function stopRecording(): void {
  window.clearTimeout(recordTimer);
  const previous = recorder; recorder = null;
  if (previous?.state === 'recording') previous.stop();
}

function playing(): void {
  const placeholder = document.getElementById('video-placeholder');
  if (placeholder) placeholder.style.display = 'none';
}

function play(): void {
  if (video) void video.play().catch(() => {if (video) {video.muted = true; void video.play().catch(() => {});}});
}

function append(): void {
  if (!video || !buffer || buffer.updating || !queue.length || source?.readyState !== 'open') return;
  if (video.currentTime > 25 && buffer.buffered.length && buffer.buffered.start(0) < video.currentTime - 20) {
    buffer.remove(0, video.currentTime - 20); return;
  }
  const fragment = queue.shift();
  if (fragment) {
    try {buffer.appendBuffer(fragment);}
    catch (error) {console.warn('Relay fragment rejected', error); resetPlayer();}
  }
}

function nextFragment(): void {
  if (!video || !queue.length) return;
  if (fragmentUrl) URL.revokeObjectURL(fragmentUrl);
  fragmentUrl = URL.createObjectURL(new Blob([queue.shift()!], {type: mime}));
  video.src = fragmentUrl; play();
}

function resetPlayer(): void {
  buffer = null; source = null;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = '';
  if (fragmentUrl) URL.revokeObjectURL(fragmentUrl); fragmentUrl = '';
  if (video) {video.onended = null; video.onplaying = null;}
  video = null;
}

function player(format: string): void {
  const element = document.getElementById('live-video');
  if (!(element instanceof HTMLVideoElement)) return;
  if (video === element && mime === format) return;
  resetPlayer(); mime = format; video = element; video.srcObject = null;
  video.dataset.transport = 'relay'; video.onplaying = playing;
  if (window.MediaSource && MediaSource.isTypeSupported(format)) {
    const media = new MediaSource(); source = media; sourceUrl = URL.createObjectURL(media); video.src = sourceUrl;
    media.addEventListener('sourceopen', () => {
      if (source !== media) return;
      buffer = media.addSourceBuffer(format); buffer.mode = 'sequence';
      buffer.addEventListener('updateend', () => {
        if (video && buffer?.buffered.length) {
          const end = buffer.buffered.end(buffer.buffered.length - 1);
          if (end - video.currentTime > 7) video.currentTime = Math.max(0, end - 3);
          play();
        }
        append();
      });
      append();
    }, {once: true});
  } else {
    video.onended = nextFragment;
    nextFragment();
  }
}

function open(): void {
  const current = session; if (!current) return;
  const ws = new WebSocket(`${current.api.replace(/^http/, 'ws')}/ws/media`); socket = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => {void connectionTicket().then(ticket => {if (socket===ws && session===current) ws.send(JSON.stringify({type: 'join', streamId: current.stream, token: ticket, host: Boolean(current.local), format: current.format}));}).catch(() => ws.close());};
  ws.onmessage = event => {
    if (socket !== ws || session !== current) return;
    if (event.data instanceof ArrayBuffer) {
      queue.push(event.data); if (queue.length > 3) queue.shift();
      player(mime); if (buffer) append(); else if (video && !source && (video.ended || !video.getAttribute('src'))) nextFragment();
      return;
    }
    try {
      const data = object(JSON.parse(String(event.data)) as unknown);
      if (text(data, 'type') === 'relay-ready' || text(data, 'type') === 'relay-demand') {
        viewers = Number(data.viewers) || 0;
        if (viewers) publish(); else stopRecording();
      }
      if (text(data, 'type') === 'relay-format') player(text(data, 'format'));
      if (text(data, 'type') === 'error') current.notice(text(data, 'message'));
      if (!heartbeat) heartbeat = window.setInterval(() => {if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: 'ping'}));}, 20000);
    } catch (error) {console.warn('Relay event rejected', error);}
  };
  ws.onclose = event => {
    if (session !== current || socket !== ws) return;
    window.clearInterval(heartbeat); heartbeat = undefined; stopRecording(); viewers = 0;
    if (event.code === 1008) {current.notice(t('mediaRelayUnavailable')); session = null; return;}
    retryTimer = window.setTimeout(open, 2000);
  };
}

export const relay = {
  start(api: string, token: string, stream: string, local: MediaStream | null, format: string, notice: (message: string) => void): void {
    if (session?.stream === stream) return;
    this.stop(); session = {api, token, stream, local, format, notice}; open();
  },
  viewerActive(): boolean {return Boolean(session && !session.local);},
  stop(): void {
    session = null; window.clearTimeout(retryTimer); window.clearInterval(heartbeat); heartbeat = undefined;
    stopRecording(); const previous = socket; socket = null; if (previous) {previous.onclose = null; previous.close();}
    resetPlayer(); queue = []; mime = ''; viewers = 0;
  },
};
import {connectionTicket} from './api';
