import {t, type TranslationKey} from './i18n';
import {liveEvent, object, text, type Json, type LiveEvent, type MediaConfig} from './contracts';
import {relay} from './relay';
import {CaptureService} from './capture';
import {compositeVideo, type CompositeVideo} from './compositor';
import {connectionTicket} from './api';
import {beginActivity} from './activity';
import {nativeCapture} from './native-capture';

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
    StreamMedia: MediaController;
  }
}
interface MediaState {
  api: string; token: string; config: MediaConfig;
  local: MediaStream | null; remote: MediaStream | null; ws: WebSocket | null;
  microphone: MediaStreamTrack | null;
  camera: MediaStreamTrack | null; cameraFallback: boolean; composite: CompositeVideo | null;
  facing: 'user' | 'environment'; switchingCamera: boolean; generation: number;
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
/** Camera, screen and microphone capture, WebRTC peers, recording and clips for one page. */
export class MediaController {
  private readonly state: MediaState = {
    api: '', token: '', config: {}, local: null, remote: null, ws: null,
    microphone: null, camera: null, cameraFallback: false, composite: null,
    facing: 'user', switchingCamera: false, generation: 0,
    captures: [], mixer: null,
    peers: new Map(), pending: new Map(), host: false, stream: '', started: 0,
    recorderStarted: 0, segments: [], recorder: null, callback: () => {},
    stopping: false, capture: null, audio: null, speech: null, urls: [], lastPeak: 0,
    reconnectAttempts: 0,
  };
  private finalizing = false;
  private archiveBlocked = false;
  private archiveTail: Promise<void> = Promise.resolve();
  private queuedArchiveParts = 0;

  configure(api: string, token: string, config: MediaConfig): void {this.state.api = api.replace(/\/$/, ''); this.state.token = token; this.state.config = config;}
  /** Turns a browser media error into a useful Spanish message. */
  messageForError(error: unknown): string {
    const keys: Record<string, TranslationKey> = {
      NotAllowedError: 'mediaPermissionDenied', SecurityError: 'mediaPermissionDenied',
      NotFoundError: 'mediaDeviceMissing', NotReadableError: 'mediaDeviceBusy',
      OverconstrainedError: 'mediaConstraintsFailed', AbortError: 'mediaCaptureAborted',
      InvalidStateError: 'mediaCaptureNeedsFocus', NotSupportedError: 'mediaCaptureUnsupported', TypeError: 'mediaCaptureUnsupported',
    };
    const name = CaptureService.errorName(error);
    if (name === 'NotAllowedError' && /Android/i.test(navigator.userAgent)) return t('mediaAndroidPermissionDenied');
    const key = keys[name]; if (key) return t(key);
    if (error instanceof Error) {
      if (error.name === 'Error' && error.message) return error.message;
    }
    return t('mediaConnectionFailed');
  }
  private async request(path: string, body: Json | FormData, silent=false): Promise<Json> {
    const done=silent ? ()=>{} : beginActivity();
    try {
    const headers: Record<string, string> = {};
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(`/api${path}`, {method: 'POST', headers, credentials: 'include',
      body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(55000)});
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(text(object(value), 'error') || t('mediaText01'));
    return value as Json;
    } finally {done();}
  }
  private emit(event: LiveEvent): void { this.state.callback(event); }
  attach(): void {
    if (nativeCapture.active()) {
      const placeholder = document.getElementById('video-placeholder');
      if (placeholder) {placeholder.textContent = t('nativeScreenPreview'); placeholder.style.display = '';}
      return;
    }
    if (!this.state.host && relay.viewerActive()) return;
    const element = document.getElementById('live-video'); const source = this.state.host ? this.state.local : this.state.remote;
    if (element instanceof HTMLVideoElement && source) {
      if (element.srcObject !== source) element.srcObject = source;
      element.dataset.transport = 'webrtc'; if (this.state.host) element.muted = true;
      void element.play().catch(() => {});
      const placeholder = document.getElementById('video-placeholder'); if (placeholder) placeholder.style.display = 'none';
    }
  }
  private send(data: unknown): void { if (this.state.ws?.readyState === WebSocket.OPEN) this.state.ws.send(JSON.stringify(data)); }
  private closePeers(): void { for (const peer of this.state.peers.values()) peer.close(); this.state.peers.clear(); this.state.pending.clear(); }
  private recorderType(): string | undefined {
    return ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => window.MediaRecorder?.isTypeSupported(type));
  }
  private useRelay(): void {
    window.clearTimeout(this.state.fallbackTimer); this.state.fallbackTimer = undefined;
    if (this.state.stopping || this.state.host || !this.state.config.mediaRelayConfigured || relay.viewerActive()) return;
    relay.start(this.state.api, this.state.token, this.state.stream, null, '', message => this.emit({type: 'notice', body: message}));
    this.emit({type: 'notice', body: t('mediaRelayConnecting')});
  }
  private awaitVideo(): void {
    if (this.state.host || !this.state.config.mediaRelayConfigured || this.state.fallbackTimer || relay.viewerActive()) return;
    this.state.fallbackTimer = window.setTimeout(() => {
      this.state.fallbackTimer = undefined;
      const connected = [...this.state.peers.values()].some(peer => peer.connectionState === 'connected');
      if (!connected) this.useRelay();
    }, 8000);
  }
  async prepare(screen: boolean, facing: 'user' | 'environment' = 'user', cameraDeviceId = '', microphoneDeviceId = '', nativeScreen = false, screenOnly = false): Promise<void> {
    // A new broadcast starts with a clean recording archive.
    this.finalizing = false; this.archiveBlocked = false;
    if (nativeScreen) {this.stop(); this.state.stopping = false; await nativeCapture.prepare(); this.state.host = true; return;}
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('mediaText02'));
    this.stop(); this.state.stopping = false;
    try {
      const captured = await CaptureService.browser().acquire({screen, facing, cameraDeviceId, microphoneDeviceId, screenOnly});
      this.state.captures.push(captured.devices);
      if (captured.display) this.state.captures.push(captured.display);
      this.state.microphone = captured.devices.getAudioTracks()[0] ?? null;
      this.state.camera = captured.devices.getVideoTracks()[0] ?? null;
      this.state.facing = facing;
      this.state.cameraFallback = captured.cameraFallback;
      if (!this.state.microphone || (!captured.display && !this.state.camera)) throw new Error(t('mediaDeviceMissing'));
      let audioTracks = [this.state.microphone];
      if (captured.display) {
        if (captured.display.getAudioTracks().length) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (Audio) {
            const mixer = new Audio(); this.state.mixer = mixer;
            const destination = mixer.createMediaStreamDestination();
            mixer.createMediaStreamSource(captured.display).connect(destination);
            mixer.createMediaStreamSource(new MediaStream([this.state.microphone])).connect(destination);
            void mixer.resume().catch(() => {}); audioTracks = destination.stream.getAudioTracks();
          }
        }
        if (this.state.camera) {
          try {this.state.composite = compositeVideo(captured.display, captured.devices);}
          catch {this.state.camera = null; this.emit({type: 'notice', body: t('mediaCompositorUnsupported')});}
        }
        this.state.local = new MediaStream([...(this.state.composite ? [this.state.composite.track] : captured.display.getVideoTracks()), ...audioTracks]);
        captured.display.getVideoTracks()[0]?.addEventListener('ended', () => {if (this.state.host) this.stop();});
      } else {
        try {
          this.state.composite = compositeVideo(null, captured.devices);
          this.state.local = new MediaStream([this.state.composite.track, ...audioTracks]);
        } catch {
          // A few Android browsers cannot capture a canvas. Sending the camera
          // track directly still allows a normal camera-and-microphone stream.
          this.state.composite = null;
          this.state.local = captured.devices;
        }
      }
      this.state.local.getVideoTracks()[0]?.addEventListener('ended', () => {if (this.state.host) this.stop();});
    } catch (error) {this.stop(); throw new Error(this.messageForError(error));}
    this.state.host = true; this.attach();
  }
  /** Keep the outgoing canvas/audio tracks stable while releasing the phone's old camera. */
  async switchCamera(): Promise<void> {
    if (!this.state.host || !this.state.camera || this.state.switchingCamera) return;
    const previous = this.state.camera, enabled = previous.enabled, generation = this.state.generation;
    const oldFacing = this.state.facing, nextFacing = oldFacing === 'user' ? 'environment' : 'user';
    this.state.switchingCamera = true;
    const install = async (stream: MediaStream, facing: 'user' | 'environment'): Promise<void> => {
      if (generation !== this.state.generation || !this.state.host) {stream.getTracks().forEach(track => track.stop()); return;}
      const camera = stream.getVideoTracks()[0];
      if (!camera) {stream.getTracks().forEach(track => track.stop()); throw new Error(t('mediaCameraMissing'));}
      camera.enabled = enabled; this.state.camera = camera; this.state.facing = facing;
      this.state.captures.push(stream);
      if (this.state.composite) this.state.composite.replaceCamera(stream);
      else if (this.state.local) {
        const recorder = this.state.recorder;
        if (recorder?.state === 'recording') {this.state.recorder = null; recorder.stop();}
        this.state.local.removeTrack(previous); this.state.local.addTrack(camera);
        await Promise.all([...this.state.peers.values()].flatMap(peer => peer.getSenders()
          .filter(sender => sender.track?.id === previous.id).map(sender => sender.replaceTrack(camera).catch(error => {
            console.warn('Camera track could not be replaced for one viewer', error);
          }))));
        if (generation === this.state.generation && this.state.host) this.startRecording();
      }
    };
    // iOS devices often cannot open the rear lens until the front lens has stopped.
    previous.stop();
    try {
      await install(await navigator.mediaDevices.getUserMedia({audio: false, video: {
        facingMode: {exact: nextFacing}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 24},
      }}), nextFacing);
    } catch (error) {
      if (generation !== this.state.generation) return;
      try {await install(await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: oldFacing}}}), oldFacing);}
      catch {this.state.camera = null;}
      throw new Error(['NotFoundError', 'OverconstrainedError'].includes(CaptureService.errorName(error)) ? t('mediaOtherCameraMissing') : this.messageForError(error));
    } finally {if (generation === this.state.generation) this.state.switchingCamera = false;}
  }
  private createPeer(id: string): RTCPeerConnection {
    const peer = new RTCPeerConnection({iceServers: this.state.config.iceServers ?? [{urls: 'stun:stun.l.google.com:19302'}]});
    this.state.peers.set(id, peer);
    peer.onicecandidate = event => {if (event.candidate) this.send({type: 'signal', to: id, payload: {candidate: event.candidate}});};
    peer.ontrack = event => {
      if (event.streams[0]) this.state.remote = event.streams[0];
      else {this.state.remote ??= new MediaStream(); this.state.remote.addTrack(event.track);}
      this.attach();
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected' && !this.state.host) {
        window.clearTimeout(this.state.fallbackTimer); this.state.fallbackTimer = undefined;
        relay.stop(); this.attach();
      }
      if (peer.connectionState === 'failed') {
        if (!this.state.host && this.state.config.mediaRelayConfigured) this.useRelay();
        else if (!this.state.config.mediaRelayConfigured) this.emit({type: 'error', message: t('mediaText04')});
      }
      if (peer.connectionState === 'disconnected' && !this.state.host) this.awaitVideo();
    };
    if (this.state.host && this.state.local) for (const track of this.state.local.getTracks()) peer.addTrack(track, this.state.local);
    return peer;
  }
  private async signal(event: LiveEvent): Promise<void> {
    if (!event.from || !event.payload) throw new Error('Invalid peer signal');
    const peer = this.state.peers.get(event.from) ?? this.createPeer(event.from); const payload = event.payload;
    if (payload.description) {
      await peer.setRemoteDescription(payload.description);
      for (const candidate of this.state.pending.get(event.from) ?? []) await peer.addIceCandidate(candidate);
      this.state.pending.delete(event.from);
      if (payload.description.type === 'offer') {
        await peer.setLocalDescription(await peer.createAnswer());
        this.send({type: 'signal', to: event.from, payload: {description: peer.localDescription}});
      }
    } else if (payload.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
      else {const queue = this.state.pending.get(event.from) ?? []; queue.push(payload.candidate); this.state.pending.set(event.from, queue);}
    }
  }
  connect(stream: string, host: boolean, callback: (event: LiveEvent) => void): void {
    if (host && nativeCapture.active()) {
      this.state.stream = stream; this.state.host = true; this.state.callback = callback; this.state.stopping = false;
      void nativeCapture.start(stream, callback).then(() => this.attach()).catch(() => {this.stop(); callback({type: 'ended', message: t('nativeCaptureFailed')});}); return;
    }
    window.clearTimeout(this.state.fallbackTimer); this.state.fallbackTimer = undefined;
    window.clearTimeout(this.state.reconnectTimer); window.clearInterval(this.state.keepAliveTimer);
    if (this.state.ws) {this.state.ws.onclose = null; this.state.ws.close();} this.closePeers();
    this.state.stream = stream; this.state.host = host; this.state.callback = callback; this.state.stopping = false;
    if (host && !this.state.local) {this.emit({type: 'error', message: t('mediaText05')}); return;}
    let joined = false; const ws = new WebSocket(`${this.state.api.replace(/^http/, 'ws')}/ws`); this.state.ws = ws;
    ws.onopen = () => {void connectionTicket().then(ticket => {if (this.state.ws === ws && !this.state.stopping) this.send({type: 'join', streamId: stream, token: ticket, host});}).catch(() => {this.emit({type: 'error', message: t('operationFailed')}); ws.close();});};
    ws.onmessage = async raw => {
      try {
        const event = liveEvent(JSON.parse(String(raw.data)) as unknown);
        if (this.state.ws !== ws || this.state.stopping) return;
        if (event.type === 'joined') {
          joined = true; this.state.reconnectAttempts = 0;
          this.state.keepAliveTimer = window.setInterval(() => this.send({type: 'ping'}), 20000);
          if (host && !this.state.recorder) {this.state.started = Date.now(); this.startRecording(); this.startAudio();}
          if (host && this.state.config.mediaRelayConfigured && this.recorderType()) relay.start(this.state.api, this.state.token, stream, this.state.local, this.recorderType() ?? '', message => this.emit({type: 'notice', body: message}));
          if (!host && event.hostOnline) {if (event.mediaTransport === 'relay') this.useRelay(); else this.awaitVideo();}
          this.attach();
        }
        if (event.type === 'error' && !joined) {
          if (event.retryable && host && this.state.reconnectAttempts > 0) {ws.close(); return;}
          ws.onclose = null; this.stop();
        }
        if (event.type === 'presence' && !host) {
          if (event.hostOnline === false) this.closePeers(); else if (event.mediaTransport === 'relay') this.useRelay(); else this.awaitVideo();
        }
        if (event.type === 'viewer-joined' && host && event.peerId) {
          const peer = this.createPeer(event.peerId); await peer.setLocalDescription(await peer.createOffer());
          this.send({type: 'signal', to: event.peerId, payload: {description: peer.localDescription}});
        }
        if (event.type === 'viewer-left' && event.peerId) {this.state.peers.get(event.peerId)?.close(); this.state.peers.delete(event.peerId);}
        if (event.type === 'signal') await this.signal(event);
        if (event.type === 'capture' && host && event.highlightId) this.capture(event.highlightId);
        if (event.type === 'subtitle' && event.text) {
          const element = document.getElementById('live-caption');
          if (element) {element.textContent = event.text; window.setTimeout(() => {if (element.textContent === event.text) element.textContent = '';}, 7000);}
        }
        if (event.type === 'ended') this.stop(); this.emit(event);
      } catch (error) {console.error('Media event failed', error); this.emit({type: 'error', message: t('mediaEventFailed')});}
    };
    ws.onerror = () => this.emit({type: 'error', message: t('mediaText06')});
    ws.onclose = () => {
      if (this.state.stopping || this.state.ws !== ws) return;
      window.clearInterval(this.state.keepAliveTimer); this.closePeers();
      const attempt = ++this.state.reconnectAttempts;
      if (attempt > 8) {const wasHost = this.state.host; this.stop(); this.emit({type: 'ended', message: wasHost ? t('mediaText07') : t('mediaText08')}); return;}
      if (attempt === 1) this.emit({type: 'notice', body: t('mediaReconnecting')});
      this.state.reconnectTimer = window.setTimeout(() => this.connect(stream, host, callback), Math.min(500 * 2 ** (attempt - 1), 5000));
    };
  }
  private startRecording(): void {
    if (!this.state.local || this.state.stopping) return;
    if (!this.recorderType()) {this.emit({type: 'notice', body: t('mediaRecordingUnavailable')}); return;}
    const chunks: Blob[] = []; const start = Math.floor((Date.now() - this.state.started) / 1000);
    const recorder = new MediaRecorder(this.state.local, {mimeType: this.recorderType(), videoBitsPerSecond: 1200000, audioBitsPerSecond: 64000});
    this.state.recorder = recorder; this.state.recorderStarted = Date.now();
    recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
    recorder.onstop = () => {
      // An old recorder must not populate a new stream's buffer after teardown.
      if (this.state.stopping || this.state.recorder !== recorder) return;
      const end = Math.max(start + 1, Math.ceil((Date.now() - this.state.started) / 1000)); const blob = new Blob(chunks, {type: recorder.mimeType});
      if (blob.size) {this.state.segments.push({blob, start, end}); if (this.state.segments.length > 4) this.state.segments.shift(); this.archiveSegment({blob, start, end});}
      if (this.state.capture) {const highlight = this.state.capture; this.state.capture = null; void this.upload(highlight, this.state.segments.at(-1));}
      if (!this.state.stopping && this.state.host && !this.finalizing) this.startRecording();
    };
    recorder.start(); window.clearTimeout(this.state.interval);
    this.state.interval = window.setTimeout(() => {if (recorder.state === 'recording') recorder.stop();}, 15000);
  }
  private archiveSegment(segment: Segment): void {
    if (this.archiveBlocked) return;
    if (this.queuedArchiveParts >= 4) {this.archiveBlocked = true; this.emit({type: 'notice', body: t('archiveUploadSlow')}); return;}
    const stream = this.state.stream; this.queuedArchiveParts++;
    this.archiveTail = this.archiveTail.then(async () => {
      if (this.archiveBlocked) return;
      const data = new FormData(); data.append('start', String(segment.start)); data.append('end', String(segment.end));
      data.append('file', segment.blob, segment.blob.type.includes('mp4') ? 'recording.mp4' : 'recording.webm');
      for (let attempt=0; attempt<2; attempt++) {
        try {await this.request(`/streams/${stream}/recording`, data, true); return;}
        catch (error) {if (attempt === 1) {this.archiveBlocked = true; this.emit({type:'notice', body:error instanceof Error ? error.message : t('archiveUploadFailed')});}}
      }
    }).finally(() => {this.queuedArchiveParts--;});
  }
  async finalizeRecording(): Promise<void> {
    if (nativeCapture.active()) {await nativeCapture.flush(); return;}
    const done = beginActivity(); this.finalizing = true; window.clearTimeout(this.state.interval);
    try {
      const recorder = this.state.recorder;
      if (recorder?.state === 'recording') {
        await new Promise<void>(resolve => {recorder.addEventListener('stop', () => resolve(), {once: true}); recorder.stop();});
      }
      await this.archiveTail;
    } finally {done();}
  }
  private capture(highlight: string): void {
    if (!this.recorderType()) {this.emit({type: 'capture-status', message: t('mediaRecordingUnavailable'), error: true}); return;}
    if (this.state.capture) {this.emit({type: 'capture-status', message: t('mediaText09'), error: true}); return;}
    const currentSeconds = this.state.recorder ? (Date.now() - this.state.recorderStarted) / 1000 : 0;
    if (this.state.recorder?.state === 'recording' && currentSeconds >= 2) {this.state.capture = highlight; window.clearTimeout(this.state.interval); this.state.recorder.stop();}
    else if (this.state.segments.length) void this.upload(highlight, this.state.segments.at(-1));
    else {this.state.capture = highlight; this.emit({type: 'capture-status', message: t('mediaText10'), error: false});}
  }
  private async upload(highlight: string, segment?: Segment): Promise<void> {
    if (!segment) return; this.emit({type: 'capture-status', message: t('mediaText11'), error: false});
    const data = new FormData(); data.append('highlightId', highlight); data.append('start', String(segment.start)); data.append('end', String(segment.end));
    data.append('file', segment.blob, segment.blob.type.includes('mp4') ? 'clip.mp4' : 'clip.webm');
    try {await this.request(`/streams/${this.state.stream}/segments`, data); this.emit({type: 'capture-status', message: t('mediaText12'), error: false});}
    catch (error) {this.emit({type: 'capture-status', message: this.messageForError(error), error: true});}
  }
  private startAudio(): void {
    if (!this.state.local?.getAudioTracks().length) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return; this.state.audio = new Audio();
      const source = this.state.audio.createMediaStreamSource(this.state.local); const analyser = this.state.audio.createAnalyser();
      analyser.fftSize = 1024; source.connect(analyser); const samples = new Float32Array(analyser.fftSize); let hits = 0;
      this.state.audioTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        hits = rms > .28 ? hits + 1 : 0;
        if (hits >= 2 && Date.now() - this.state.lastPeak > 90000) {
          this.state.lastPeak = Date.now(); void this.request(`/streams/${this.state.stream}/highlights`, {source: 'AUDIO_PEAK', reason: t('mediaText13')}).catch(() => {});
        }
      }, 500);
    } catch { /* Audio peaks are optional; manual markers and chat remain available. */ }
  }
  async captions(): Promise<void> {
    if (!this.state.host) throw new Error(t('mediaText14'));
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) throw new Error(t('mediaText15')); if (this.state.speech) return;
    const speech = new Recognition(); this.state.speech = speech; speech.lang = 'es-CO'; speech.continuous = true; speech.interimResults = false;
    speech.onresult = event => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]; const transcript = result?.[0]?.transcript;
        if (result?.isFinal && transcript) {
          const end = Math.max(1, (Date.now() - this.state.started) / 1000);
          void this.request(`/streams/${this.state.stream}/subtitles`, {start: Math.max(0, end - 5), end, text: transcript}).catch(error => this.emit({type: 'error', message: this.messageForError(error)}));
        }
      }
    };
    speech.onend = () => {if (this.state.host && !this.state.stopping && this.state.speech === speech) {try {speech.start();} catch {}}};
    speech.onerror = event => {if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {this.state.speech = null; this.emit({type: 'error', message: t('mediaText16')});}};
    speech.start();
  }
  async playback(asset: string, id: string, download: boolean): Promise<void> {
    const response = await fetch(`/api/media/${encodeURIComponent(asset)}`, {credentials: 'include'});
    if (!response.ok) throw new Error(t('mediaText17'));
    const blob = await response.blob(); const url = URL.createObjectURL(blob); this.state.urls.push(url);
    if (download) {
      const link = document.createElement('a'); link.href = url; link.download = `streamguard-${asset}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else {const video = document.getElementById(id); if (video instanceof HTMLVideoElement) {video.src = url; await video.play().catch(() => {});}}
  }
  async share(asset: string, title: string): Promise<boolean> {
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
  stop(): void {
    nativeCapture.stop();
    this.state.generation++; this.state.switchingCamera = false;
    window.clearTimeout(this.state.fallbackTimer); this.state.fallbackTimer = undefined; relay.stop();
    window.clearTimeout(this.state.reconnectTimer); window.clearInterval(this.state.keepAliveTimer); this.state.reconnectAttempts = 0;
    this.state.stopping = true; this.state.capture = null; window.clearTimeout(this.state.interval); window.clearInterval(this.state.audioTimer);
    if (this.state.recorder?.state === 'recording') this.state.recorder.stop(); this.state.recorder = null;
    const ws = this.state.ws; this.state.ws = null; if (ws) {ws.onclose = null; ws.close();} this.closePeers();
    if (this.state.speech) {const speech = this.state.speech; this.state.speech = null; speech.onend = null; speech.stop();}
    if (this.state.audio) {void this.state.audio.close().catch(() => {}); this.state.audio = null;}
    if (this.state.mixer) {void this.state.mixer.close().catch(() => {}); this.state.mixer = null;}
    this.state.composite?.stop(); this.state.composite = null;
    for (const capture of this.state.captures) capture.getTracks().forEach(track => track.stop()); this.state.captures = [];
    if (this.state.local) {for (const track of this.state.local.getTracks()) track.stop(); this.state.local = null;}
    this.state.microphone = null;
    this.state.camera = null; this.state.cameraFallback = false;
    this.state.remote = null; this.state.host = false; this.state.segments = []; this.state.lastPeak = 0;
    for (const url of this.state.urls) URL.revokeObjectURL(url); this.state.urls = [];
  }
  nativeScreenActive(): boolean {return nativeCapture.active();}
  cameraFacing(): 'user' | 'environment' {return this.state.facing;}
  toggleMicrophone(): boolean {
    if (nativeCapture.active()) return nativeCapture.toggleMicrophone();
    if (!this.state.microphone) return false;
    this.state.microphone.enabled = !this.state.microphone.enabled;
    return this.state.microphone.enabled;
  }
  microphoneEnabled(): boolean {return nativeCapture.active() ? nativeCapture.microphoneEnabled() : this.state.microphone?.enabled ?? false;}
  cameraAvailable(): boolean {return this.state.camera !== null && this.state.camera.readyState === 'live';}
  cameraEnabled(): boolean {return this.state.camera?.enabled ?? false;}
  toggleCamera(): boolean {
    if (!this.state.camera || this.state.camera.readyState !== 'live') return false;
    this.state.camera.enabled = !this.state.camera.enabled;
    return this.state.camera.enabled;
  }
  usedCameraFallback(): boolean {return this.state.cameraFallback;}
  screenSharingSupported(): boolean {return Boolean(navigator.mediaDevices) && CaptureService.browser().screenSupported();}
}

/** The page captures and plays one broadcast at a time, so the app shares one controller. */
export const media = new MediaController();
window.StreamMedia = media;
window.addEventListener('beforeunload', () => media.stop());
