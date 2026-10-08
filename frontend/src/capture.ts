/** Browser capture capabilities and device acquisition, independent of the studio UI. */
export interface CaptureEnvironment {
  devices: Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'getDisplayMedia'>>;
  userAgent: string; platform: string; maxTouchPoints: number;
}
export interface CapturedSources {
  devices: MediaStream; display: MediaStream | null; cameraFallback: boolean;
}
export function mediaErrorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : '';
}
export function screenCaptureSupported(environment: CaptureEnvironment): boolean {
  const mobile = /Android|iPhone|iPad|iPod/i.test(environment.userAgent)
    || (/Mac/i.test(environment.platform) && environment.maxTouchPoints > 1);
  return !mobile && typeof environment.devices.getDisplayMedia === 'function';
}
export function browserCaptureEnvironment(): CaptureEnvironment {
  return {devices: navigator.mediaDevices, userAgent: navigator.userAgent,
    platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints};
}
export async function acquireSources(screen: boolean, environment: CaptureEnvironment): Promise<CapturedSources> {
  let display: MediaStream | null = null;
  let devices: MediaStream | null = null;
  let cameraFallback = screen && !screenCaptureSupported(environment);
  try {
    if (screen && !cameraFallback) {
      try {
        // The chooser must open before awaiting camera/microphone permission.
        display = await environment.devices.getDisplayMedia!({video: true, audio: true});
      } catch (error) {
        if (!['NotSupportedError', 'TypeError', 'NotFoundError'].includes(mediaErrorName(error))) throw error;
        cameraFallback = true;
      }
    }
    try {
      devices = await environment.devices.getUserMedia({
        video: {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 24}, facingMode: 'user'},
        audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      });
    } catch (error) {
      const name = mediaErrorName(error);
      if (name === 'OverconstrainedError') devices = await environment.devices.getUserMedia({video: true, audio: true});
      else if (name === 'NotFoundError' && display) devices = await environment.devices.getUserMedia({audio: true});
      else throw error;
    }
    if ((!display && !devices.getVideoTracks().length) || !devices.getAudioTracks().length || (display && !display.getVideoTracks().length)) {
      const error = new Error('A requested camera, microphone, or display track is missing');
      error.name = 'NotFoundError'; throw error;
    }
    return {devices, display, cameraFallback};
  } catch (error) {
    display?.getTracks().forEach(track => track.stop());
    devices?.getTracks().forEach(track => track.stop());
    throw error;
  }
}
