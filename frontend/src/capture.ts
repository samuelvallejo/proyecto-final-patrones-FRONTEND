/** Browser capture capabilities and device acquisition, independent of the studio UI. */
export interface CaptureEnvironment {
  devices: Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'getDisplayMedia'>>;
  userAgent: string; platform: string; maxTouchPoints: number;
}
export interface CaptureDeviceChoice { deviceId: string; label: string; kind: 'audioinput' | 'videoinput' }
export interface CapturedSources {
  devices: MediaStream; display: MediaStream | null; cameraFallback: boolean;
}
export interface CaptureRequest {
  /** Share the screen (with camera unless `screenOnly`). */
  screen: boolean;
  facing?: 'user' | 'environment';
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  /** Screen with the microphone only: the webcam is never opened. */
  screenOnly?: boolean;
}

/** Knows what one browser (or a test fixture) can capture, and opens the camera, microphone and screen. */
export class CaptureService {
  constructor(private readonly environment: CaptureEnvironment) {}

  /** The current browser. */
  static browser(): CaptureService {
    return new CaptureService({devices: navigator.mediaDevices, userAgent: navigator.userAgent,
      platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints});
  }

  static errorName(error: unknown): string {
    return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : '';
  }

  /** Phones and tablets: no desktop screen picker, and the camera can be switched front/back. */
  isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(this.environment.userAgent)
      || (/Mac/i.test(this.environment.platform) && this.environment.maxTouchPoints > 1);
  }

  screenSupported(): boolean {
    return !this.isMobile() && typeof this.environment.devices.getDisplayMedia === 'function';
  }

  async acquire(request: CaptureRequest): Promise<CapturedSources> {
    const {screen, facing = 'user', cameraDeviceId = '', microphoneDeviceId = '', screenOnly = false} = request;
    const devices = this.environment.devices;
    let display: MediaStream | null = null;
    let media: MediaStream | null = null;
    let cameraFallback = screen && !this.screenSupported();
    try {
      if (screen && !cameraFallback) {
        try {
          // The chooser must open before awaiting camera/microphone permission.
          display = await devices.getDisplayMedia!({video: true, audio: true});
        } catch (error) {
          if (!['NotSupportedError', 'TypeError', 'NotFoundError'].includes(CaptureService.errorName(error))) throw error;
          cameraFallback = true;
        }
      }
      try {
        const android = /Android/i.test(this.environment.userAgent);
        if (screenOnly && display) media = await devices.getUserMedia({
          audio: microphoneDeviceId ? {deviceId: {exact: microphoneDeviceId}} : {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
        });
        else media = await devices.getUserMedia(android ? {
          // Android camera drivers vary widely; let the browser choose a supported
          // capture size instead of asking for desktop-sized video up front.
          video: cameraDeviceId ? {deviceId: {exact: cameraDeviceId}} : {facingMode: {ideal: facing}},
          audio: microphoneDeviceId ? {deviceId: {exact: microphoneDeviceId}} : true,
        } : {
          video: cameraDeviceId ? {deviceId: {exact: cameraDeviceId}} : {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 24}, facingMode: {ideal: facing}},
          audio: microphoneDeviceId ? {deviceId: {exact: microphoneDeviceId}} : {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
        });
      } catch (error) {
        const name = CaptureService.errorName(error);
        if (cameraDeviceId || microphoneDeviceId) throw error;
        if (name === 'OverconstrainedError' || (name === 'NotFoundError' && !display))
          media = await devices.getUserMedia({video: {facingMode: {ideal: facing}}, audio: true});
        else if (name === 'NotFoundError' && display) media = await devices.getUserMedia({audio: true});
        else throw error;
      }
      if ((!display && !media.getVideoTracks().length) || !media.getAudioTracks().length || (display && !display.getVideoTracks().length)) {
        const error = new Error('A requested camera, microphone, or display track is missing');
        error.name = 'NotFoundError'; throw error;
      }
      return {devices: media, display, cameraFallback};
    } catch (error) {
      display?.getTracks().forEach(track => track.stop());
      media?.getTracks().forEach(track => track.stop());
      throw error;
    }
  }
}
