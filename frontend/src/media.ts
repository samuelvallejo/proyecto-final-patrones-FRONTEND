import {t, type TranslationKey} from './i18n';
import {liveEvent, object, text, type Json, type LiveEvent, type MediaConfig} from './contracts';
import {relay} from './relay';
import {acquireSources, browserCaptureEnvironment, mediaErrorName, screenCaptureSupported} from './capture';
import {compositeVideo, type CompositeVideo} from './compositor';

interface Segment {blob: Blob; start: number; end: number}
interface SpeechResult {isFinal: boolean; [index: number]: {transcript: string}}
interface SpeechEvent {resultIndex: number; results: ArrayLike<SpeechResult>}
interface SpeechRecognizer {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onend: (() => void) | null; onerror: ((event: {error: string}) => void) | null;
  start(): void; stop(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognizer;
    webkitSpeechRecognition?: new () => SpeechRecognizer;
    webkitAudioContext?: typeof AudioContext;
    StreamMedia: typeof media;
  }
}
interface MediaState {
  api: string; token: string; config: MediaConfig;
  local: MediaStream | null; remote: MediaStream | null; ws: WebSocket | null;
  microphone: MediaStreamTrack | null;
  camera: MediaStreamTrack | null; cameraFallback: boolean; composite: CompositeVideo | null;
  captures: MediaStream[]; mixer: AudioContext | null;
  peers: Map<string, RTCPeerConnection>; pending: Map<string, RTCIceCandidateInit[]>;
  host: boolean; stream: string; started: number; recorderStarted: number;
  segments: Segment[]; recorder: MediaRecorder | null; interval?: number;
  callback: (event: LiveEvent) => void; stopping: boolean; capture: string | null;
  audio: AudioContext | null; audioTimer?: number; speech: SpeechRecognizer | null;
  urls: string[]; lastPeak: number;
  reconnectTimer?: number; keepAliveTimer?: number; reconnectAttempts: number;
  fallbackTimer?: number;
}
const state: MediaState = {
  api: '', token: '', config: {}, local: null, remote: null, ws: null,
  microphone: null, camera: null, cameraFallback: false, composite: null,
  captures: [], mixer: null,
  peers: new Map(), pending: new Map(), host: false, stream: '', started: 0,
  recorderStarted: 0, segments: [], recorder: null, callback: () => {},
  stopping: false, capture: null, audio: null, speech: null, urls: [], lastPeak: 0,
  reconnectAttempts: 0,
};
export function messageForError(error: unknown): string {
  const keys: Record<string, TranslationKey> = {
    NotAllowedError: 'mediaPermissionDenied', SecurityError: 'mediaPermissionDenied',
    NotFoundError: 'mediaDeviceMissing', NotReadableError: 'mediaDeviceBusy',
    OverconstrainedError: 'mediaConstraintsFailed', AbortError: 'mediaCaptureAborted',
    InvalidStateError: 'mediaCaptureNeedsFocus', NotSupportedError: 'mediaCaptureUnsupported', TypeError: 'mediaCaptureUnsupported',
  };
  const name = mediaErrorName(error);
  const key = keys[name]; if (key) return t(key);
  if (error instanceof Error) {
    if (error.name === 'Error' && error.message) return error.message;
  }
  console.error('Browser media operation failed', error); return t('mediaConnectionFailed');
}
async function request(path: string, body: Json | FormData): Promise<Json> {
  const headers: Record<string, string> = {Authorization: `Bearer ${state.token}`};
  if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${state.api}/api${path}`, {method: 'POST', headers,
    body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(55000)});
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(text(object(value), 'error') || t('mediaText01'));
  return value as Json;
}
function emit(event: LiveEvent): void { state.callback(event); }
function attach(): void {
  if (!state.host && relay.viewerActive()) return;
  const element = document.getElementById('live-video'); const source = state.host ? state.local : state.remote;
  if (element instanceof HTMLVideoElement && source) {
    if (element.srcObject !== source) element.srcObject = source;
    element.dataset.transport = 'webrtc'; if (state.host) element.muted = true;
    void element.play().catch(() => {});
    const placeholder = document.getElementById('video-placeholder'); if (placeholder) placeholder.style.display = 'none';
  }
}
function send(data: unknown): void { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(data)); }
function closePeers(): void { for (const peer of state.peers.values()) peer.close(); state.peers.clear(); state.pending.clear(); }
function recorderType(): string | undefined {
  return ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => window.MediaRecorder?.isTypeSupported(type));
}
function useRelay(): void {
  window.clearTimeout(state.fallbackTimer); state.fallbackTimer = undefined;
  if (state.stopping || state.host || !state.config.mediaRelayConfigured || relay.viewerActive()) return;
  relay.start(state.api, state.token, state.stream, null, '', message => emit({type: 'notice', body: message}));
  emit({type: 'notice', body: t('mediaRelayConnecting')});
}
function awaitVideo(): void {
  if (state.host || !state.config.mediaRelayConfigured || state.fallbackTimer || relay.viewerActive()) return;
  state.fallbackTimer = window.setTimeout(() => {
    state.fallbackTimer = undefined;
    const connected = [...state.peers.values()].some(peer => peer.connectionState === 'connected');
    if (!connected) useRelay();
  }, 8000);
}
async function prepare(screen: boolean): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('mediaText02'));
  stop(); state.stopping = false;
  try {
    const captured = await acquireSources(screen, browserCaptureEnvironment());
    state.captures.push(captured.devices);
    if (captured.display) state.captures.push(captured.display);
    state.microphone = captured.devices.getAudioTracks()[0] ?? null;
    state.camera = captured.devices.getVideoTracks()[0] ?? null;
    state.cameraFallback = captured.cameraFallback;
    if (!state.microphone || (!captured.display && !state.camera)) throw new Error(t('mediaDeviceMissing'));
    let audioTracks = [state.microphone];
    if (captured.display) {
      if (captured.display.getAudioTracks().length) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (Audio) {
          const mixer = new Audio(); state.mixer = mixer;
          const destination = mixer.createMediaStreamDestination();
          mixer.createMediaStreamSource(captured.display).connect(destination);
          mixer.createMediaStreamSource(new MediaStream([state.microphone])).connect(destination);
          void mixer.resume().catch(() => {}); audioTracks = destination.stream.getAudioTracks();
        }
      }
      if (state.camera) {
        try {state.composite = compositeVideo(captured.display, captured.devices);}
        catch {throw new Error(t('mediaCompositorUnsupported'));}
      }
      state.local = new MediaStream([...(state.composite ? [state.composite.track] : captured.display.getVideoTracks()), ...audioTracks]);
      captured.display.getVideoTracks()[0]?.addEventListener('ended', () => {if (state.host) stop();});
    } else state.local = captured.devices;
    state.local.getVideoTracks()[0]?.addEventListener('ended', () => {if (state.host) stop();});
  } catch (error) {stop(); throw new Error(messageForError(error));}
  state.host = true; attach();
}
function createPeer(id: string): RTCPeerConnection {
  const peer = new RTCPeerConnection({iceServers: state.config.iceServers ?? [{urls: 'stun:stun.l.google.com:19302'}]});
  state.peers.set(id, peer);
  peer.onicecandidate = event => {if (event.candidate) send({type: 'signal', to: id, payload: {candidate: event.candidate}});};
  peer.ontrack = event => {
    if (event.streams[0]) state.remote = event.streams[0];
    else {state.remote ??= new MediaStream(); state.remote.addTrack(event.track);}
    attach();
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected' && !state.host) {
      window.clearTimeout(state.fallbackTimer); state.fallbackTimer = undefined;
      relay.stop(); attach();
    }
    if (peer.connectionState === 'failed') {
      if (!state.host && state.config.mediaRelayConfigured) useRelay();
      else if (!state.config.mediaRelayConfigured) emit({type: 'error', message: t('mediaText04')});
    }
    if (peer.connectionState === 'disconnected' && !state.host) awaitVideo();
  };
  if (state.host && state.local) for (const track of state.local.getTracks()) peer.addTrack(track, state.local);
  return peer;
}
async function signal(event: LiveEvent): Promise<void> {
  if (!event.from || !event.payload) throw new Error('Invalid peer signal');
  const peer = state.peers.get(event.from) ?? createPeer(event.from); const payload = event.payload;
  if (payload.description) {
    await peer.setRemoteDescription(payload.description);
    for (const candidate of state.pending.get(event.from) ?? []) await peer.addIceCandidate(candidate);
    state.pending.delete(event.from);
    if (payload.description.type === 'offer') {
      await peer.setLocalDescription(await peer.createAnswer());
      send({type: 'signal', to: event.from, payload: {description: peer.localDescription}});
    }
  } else if (payload.candidate) {
    if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
    else {const queue = state.pending.get(event.from) ?? []; queue.push(payload.candidate); state.pending.set(event.from, queue);}
  }
}
function connect(stream: string, host: boolean, callback: (event: LiveEvent) => void): void {
  window.clearTimeout(state.fallbackTimer); state.fallbackTimer = undefined;
  window.clearTimeout(state.reconnectTimer); window.clearInterval(state.keepAliveTimer);
  if (state.ws) {state.ws.onclose = null; state.ws.close();} closePeers();
  state.stream = stream; state.host = host; state.callback = callback; state.stopping = false;
  if (host && !state.local) {emit({type: 'error', message: t('mediaText05')}); return;}
  let joined = false; const ws = new WebSocket(`${state.api.replace(/^http/, 'ws')}/ws`); state.ws = ws;
  ws.onopen = () => send({type: 'join', streamId: stream, token: state.token, host});
  ws.onmessage = async raw => {
    try {
      const event = liveEvent(JSON.parse(String(raw.data)) as unknown);
      if (state.ws !== ws || state.stopping) return;
      if (event.type === 'joined') {
        joined = true; state.reconnectAttempts = 0;
        state.keepAliveTimer = window.setInterval(() => send({type: 'ping'}), 20000);
        if (host && !state.recorder) {state.started = Date.now(); startRecording(); startAudio();}
        if (host && state.config.mediaRelayConfigured && recorderType()) relay.start(state.api, state.token, stream, state.local, recorderType() ?? '', message => emit({type: 'notice', body: message}));
        if (!host && event.hostOnline) awaitVideo();
        attach();
      }
      if (event.type === 'error' && !joined) {
        if (event.retryable && host && state.reconnectAttempts > 0) {ws.close(); return;}
        ws.onclose = null; stop();
      }
      if (event.type === 'presence' && !host) {
        if (event.hostOnline === false) closePeers(); else awaitVideo();
      }
      if (event.type === 'viewer-joined' && host && event.peerId) {
        const peer = createPeer(event.peerId); await peer.setLocalDescription(await peer.createOffer());
        send({type: 'signal', to: event.peerId, payload: {description: peer.localDescription}});
      }
      if (event.type === 'viewer-left' && event.peerId) {state.peers.get(event.peerId)?.close(); state.peers.delete(event.peerId);}
      if (event.type === 'signal') await signal(event);
      if (event.type === 'capture' && host && event.highlightId) capture(event.highlightId);
      if (event.type === 'subtitle' && event.text) {
        const element = document.getElementById('live-caption');
        if (element) {element.textContent = event.text; window.setTimeout(() => {if (element.textContent === event.text) element.textContent = '';}, 7000);}
      }
      if (event.type === 'ended') stop(); emit(event);
    } catch (error) {console.error('Media event failed', error); emit({type: 'error', message: t('mediaEventFailed')});}
  };
  ws.onerror = () => emit({type: 'error', message: t('mediaText06')});
  ws.onclose = () => {
    if (state.stopping || state.ws !== ws) return;
    window.clearInterval(state.keepAliveTimer); closePeers();
    const attempt = ++state.reconnectAttempts;
    if (attempt > 8) {const wasHost = state.host; stop(); emit({type: 'ended', message: wasHost ? t('mediaText07') : t('mediaText08')}); return;}
    if (attempt === 1) emit({type: 'notice', body: t('mediaReconnecting')});
    state.reconnectTimer = window.setTimeout(() => connect(stream, host, callback), Math.min(500 * 2 ** (attempt - 1), 5000));
  };
}
function startRecording(): void {
  if (!state.local || state.stopping) return;
  if (!recorderType()) {emit({type: 'notice', body: t('mediaRecordingUnavailable')}); return;}
  const chunks: Blob[] = []; const start = Math.floor((Date.now() - state.started) / 1000);
  const recorder = new MediaRecorder(state.local, {mimeType: recorderType(), videoBitsPerSecond: 1200000, audioBitsPerSecond: 64000});
  state.recorder = recorder; state.recorderStarted = Date.now();
  recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
  recorder.onstop = () => {
    // An old recorder must not populate a new stream's buffer after teardown.
    if (state.stopping || state.recorder !== recorder) return;
    const end = Math.max(start + 1, Math.ceil((Date.now() - state.started) / 1000)); const blob = new Blob(chunks, {type: recorder.mimeType});
    if (blob.size) {state.segments.push({blob, start, end}); if (state.segments.length > 4) state.segments.shift();}
    if (state.capture) {const highlight = state.capture; state.capture = null; void upload(highlight, state.segments.at(-1));}
    if (!state.stopping && state.host) startRecording();
  };
  recorder.start(); window.clearTimeout(state.interval);
  state.interval = window.setTimeout(() => {if (recorder.state === 'recording') recorder.stop();}, 15000);
}
function capture(highlight: string): void {
  if (!recorderType()) {emit({type: 'capture-status', message: t('mediaRecordingUnavailable'), error: true}); return;}
  if (state.capture) {emit({type: 'capture-status', message: t('mediaText09'), error: true}); return;}
  const currentSeconds = state.recorder ? (Date.now() - state.recorderStarted) / 1000 : 0;
  if (state.recorder?.state === 'recording' && currentSeconds >= 2) {state.capture = highlight; window.clearTimeout(state.interval); state.recorder.stop();}
  else if (state.segments.length) void upload(highlight, state.segments.at(-1));
  else {state.capture = highlight; emit({type: 'capture-status', message: t('mediaText10'), error: false});}
}
async function upload(highlight: string, segment?: Segment): Promise<void> {
  if (!segment) return; emit({type: 'capture-status', message: t('mediaText11'), error: false});
  const data = new FormData(); data.append('highlightId', highlight); data.append('start', String(segment.start)); data.append('end', String(segment.end));
  data.append('file', segment.blob, segment.blob.type.includes('mp4') ? 'clip.mp4' : 'clip.webm');
  try {await request(`/streams/${state.stream}/segments`, data); emit({type: 'capture-status', message: t('mediaText12'), error: false});}
  catch (error) {emit({type: 'capture-status', message: messageForError(error), error: true});}
}
function startAudio(): void {
  if (!state.local?.getAudioTracks().length) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return; state.audio = new Audio();
    const source = state.audio.createMediaStreamSource(state.local); const analyser = state.audio.createAnalyser();
    analyser.fftSize = 1024; source.connect(analyser); const samples = new Float32Array(analyser.fftSize); let hits = 0;
    state.audioTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      hits = rms > .28 ? hits + 1 : 0;
      if (hits >= 2 && Date.now() - state.lastPeak > 90000) {
        state.lastPeak = Date.now(); void request(`/streams/${state.stream}/highlights`, {source: 'AUDIO_PEAK', reason: t('mediaText13')}).catch(() => {});
      }
    }, 500);
  } catch { /* Audio peaks are optional; manual markers and chat remain available. */ }
}
async function captions(): Promise<void> {
  if (!state.host) throw new Error(t('mediaText14'));
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) throw new Error(t('mediaText15')); if (state.speech) return;
  const speech = new Recognition(); state.speech = speech; speech.lang = 'es-CO'; speech.continuous = true; speech.interimResults = false;
  speech.onresult = event => {
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]; const transcript = result?.[0]?.transcript;
      if (result?.isFinal && transcript) {
        const end = Math.max(1, (Date.now() - state.started) / 1000);
        void request(`/streams/${state.stream}/subtitles`, {start: Math.max(0, end - 5), end, text: transcript}).catch(error => emit({type: 'error', message: messageForError(error)}));
      }
    }
  };
  speech.onend = () => {if (state.host && !state.stopping && state.speech === speech) {try {speech.start();} catch {}}};
  speech.onerror = event => {if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {state.speech = null; emit({type: 'error', message: t('mediaText16')});}};
  speech.start();
}
async function playback(asset: string, id: string, download: boolean): Promise<void> {
  const response = await fetch(`${state.api}/api/media/${encodeURIComponent(asset)}`, {headers: state.token ? {Authorization: `Bearer ${state.token}`} : {}});
  if (!response.ok) throw new Error(t('mediaText17'));
  const blob = await response.blob(); const url = URL.createObjectURL(blob); state.urls.push(url);
  if (download) {
    const link = document.createElement('a'); link.href = url; link.download = `streamguard-${asset}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  } else {const video = document.getElementById(id); if (video instanceof HTMLVideoElement) {video.src = url; await video.play().catch(() => {});}}
}
async function share(asset: string, title: string): Promise<boolean> {
  const url = `${location.origin}/#clip=${encodeURIComponent(asset)}`;
  try {
    if (navigator.share) await navigator.share({title, url});
    else if (navigator.clipboard) await navigator.clipboard.writeText(url);
    else throw new Error('Sharing is unavailable');
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw new Error(t('shareFailed'));
  }
}
function stop(): void {
  window.clearTimeout(state.fallbackTimer); state.fallbackTimer = undefined; relay.stop();
  window.clearTimeout(state.reconnectTimer); window.clearInterval(state.keepAliveTimer); state.reconnectAttempts = 0;
  state.stopping = true; state.capture = null; window.clearTimeout(state.interval); window.clearInterval(state.audioTimer);
  if (state.recorder?.state === 'recording') state.recorder.stop(); state.recorder = null;
  const ws = state.ws; state.ws = null; if (ws) {ws.onclose = null; ws.close();} closePeers();
  if (state.speech) {const speech = state.speech; state.speech = null; speech.onend = null; speech.stop();}
  if (state.audio) {void state.audio.close().catch(() => {}); state.audio = null;}
  if (state.mixer) {void state.mixer.close().catch(() => {}); state.mixer = null;}
  state.composite?.stop(); state.composite = null;
  for (const capture of state.captures) capture.getTracks().forEach(track => track.stop()); state.captures = [];
  if (state.local) {for (const track of state.local.getTracks()) track.stop(); state.local = null;}
  state.microphone = null;
  state.camera = null; state.cameraFallback = false;
  state.remote = null; state.host = false; state.segments = []; state.lastPeak = 0;
  for (const url of state.urls) URL.revokeObjectURL(url); state.urls = [];
}
export const media = {
  configure(api: string, token: string, config: MediaConfig): void {state.api = api.replace(/\/$/, ''); state.token = token; state.config = config;},
  prepare, connect, attach, stop, captions, playback, share, messageForError,
  toggleMicrophone(): boolean {
    if (!state.microphone) return false;
    state.microphone.enabled = !state.microphone.enabled;
    return state.microphone.enabled;
  },
  microphoneEnabled(): boolean {return state.microphone?.enabled ?? false;},
  cameraAvailable(): boolean {return state.camera !== null && state.camera.readyState === 'live';},
  cameraEnabled(): boolean {return state.camera?.enabled ?? false;},
  toggleCamera(): boolean {
    if (!state.camera || state.camera.readyState !== 'live') return false;
    state.camera.enabled = !state.camera.enabled;
    return state.camera.enabled;
  },
  usedCameraFallback(): boolean {return state.cameraFallback;},
  screenSharingSupported(): boolean {return Boolean(navigator.mediaDevices) && screenCaptureSupported(browserCaptureEnvironment());},
};
window.StreamMedia = media;
window.addEventListener('beforeunload', stop);
