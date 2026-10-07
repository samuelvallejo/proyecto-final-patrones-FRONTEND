/** API payloads are untrusted JSON, narrowed before use by UI and signaling code. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = { [key: string]: Json };
export function object(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
export function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(object) : []; }
export function text(value: Row | null, key: string): string {
  const field = value?.[key];
  return typeof field === 'string' || typeof field === 'number' ? String(field) : '';
}
export function flag(value: Row, key: string): boolean { return value[key] === true; }
export interface MediaConfig { iceServers?: RTCIceServer[]; mediaRelayConfigured?: boolean }
export interface LiveEvent {
  type: string; message?: Json; body?: string; viewers?: number; error?: boolean; hostOnline?: boolean; retryable?: boolean;
  peerId?: string; from?: string; highlightId?: string; text?: string;
  payload?: {description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit};
}
export function liveEvent(value: unknown): LiveEvent {
  const event = object(value);
  if (typeof event.type !== 'string') throw new Error('Invalid signaling event');
  return event as unknown as LiveEvent;
}
export function mediaConfig(value: Row): MediaConfig {
  const iceServers = value.iceServers;
  return {iceServers: Array.isArray(iceServers) ? iceServers as unknown as RTCIceServer[] : undefined, mediaRelayConfigured: value.mediaRelayConfigured === true};
}
