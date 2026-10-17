import {t} from './i18n';
import {object, liveEvent, type LiveEvent} from './contracts';

interface NativeBridge {postMessage(value: string): void; onmessage: ((event: MessageEvent<string>) => void) | null}
declare global {interface Window {StreamGuardAndroid?: NativeBridge}}
const pending = new Map<string, {resolve: () => void; reject: (error: Error) => void; timer: number}>();
let listener: (event: LiveEvent) => void = () => {};
let active = false;
let microphone = true;
let initialized = false;
let generation = 0;
function initialize(): NativeBridge | undefined {
  const bridge = window.StreamGuardAndroid;
  if (bridge && !initialized) {
    initialized = true;
    bridge.onmessage = event => {
      try {
        const message = object(JSON.parse(event.data));
        if (message.event) {listener(liveEvent(message.event)); return;}
        const id = typeof message.id === 'string' ? message.id : '';
        const request = pending.get(id); if (!request) return;
        pending.delete(id); window.clearTimeout(request.timer);
        if (message.ok === true) request.resolve(); else request.reject(new Error(t('nativeCaptureFailed')));
      } catch {listener({type: 'error', message: t('nativeCaptureFailed')});}
    };
  }
  return bridge;
}
function command(action: string, payload: Record<string, string | boolean> = {}): Promise<void> {
  const bridge = initialize(); if (!bridge) return Promise.reject(new Error(t('nativeAppRequired')));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {pending.delete(id); reject(new Error(t('nativeCaptureFailed')));}, action === 'prepare' ? 120000 : 55000);
    pending.set(id, {resolve, reject, timer}); bridge.postMessage(JSON.stringify({id, action, ...payload}));
  });
}
export const nativeCapture = {
  available: () => Boolean(window.StreamGuardAndroid),
  active: () => active,
  microphoneEnabled: () => microphone,
  async prepare(): Promise<void> {const current = ++generation; await command('prepare'); if (generation !== current) {void command('stop').catch(() => {}); throw new Error(t('nativeCaptureFailed'));} active = true; microphone = true;},
  async start(stream: string, callback: (event: LiveEvent) => void): Promise<void> {
    listener = callback; await command('start', {stream});
  },
  async flush(): Promise<void> {if (active) await command('flush');},
  toggleMicrophone(): boolean {
    microphone = !microphone; void command('microphone', {enabled: microphone}).catch(() => listener({type: 'error', message: t('nativeCaptureFailed')})); return microphone;
  },
  stop(): void {generation++; if (active || pending.size) {active = false; void command('stop').catch(() => {});} listener = () => {};},
};
