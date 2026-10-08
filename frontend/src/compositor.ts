/** Combines shared screen and optional webcam into one video track for every transport. */
export interface CompositeVideo {track: MediaStreamTrack; stop(): void}
export function compositeVideo(display: MediaStream, camera: MediaStream): CompositeVideo {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d', {alpha: false});
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('Screen and camera composition is unavailable');
  const output = canvas.captureStream(24), track = output.getVideoTracks()[0];
  if (!track) throw new Error('Screen and camera composition did not create a video track');
  const screenVideo = document.createElement('video'), cameraVideo = document.createElement('video');
  for (const video of [screenVideo, cameraVideo]) {video.muted = true; video.playsInline = true; video.autoplay = true;}
  screenVideo.srcObject = display;
  // Keep microphone audio out of the compositor's webcam element.
  cameraVideo.srcObject = new MediaStream(camera.getVideoTracks());
  void screenVideo.play().catch(() => {}); void cameraVideo.play().catch(() => {});
  let stopped = false, frame: number | undefined, timer: number | undefined;
  const draw = (): void => {
    if (stopped) return;
    if (screenVideo.videoWidth > 0) {
      const scale = Math.min(1, 1280 / screenVideo.videoWidth, 720 / screenVideo.videoHeight);
      const width = Math.max(2, Math.round(screenVideo.videoWidth * scale / 2) * 2);
      const height = Math.max(2, Math.round(screenVideo.videoHeight * scale / 2) * 2);
      if (canvas.width !== width || canvas.height !== height) {canvas.width = width; canvas.height = height;}
    }
    context.fillStyle = '#101415'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (screenVideo.readyState >= 2) context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    if (camera.getVideoTracks()[0]?.enabled && cameraVideo.readyState >= 2 && cameraVideo.videoWidth > 0 && cameraVideo.videoHeight > 0) {
      const scale = Math.min(canvas.width * .25 / cameraVideo.videoWidth, canvas.height * .35 / cameraVideo.videoHeight);
      const width = Math.max(2, Math.round(cameraVideo.videoWidth * scale)), height = Math.max(2, Math.round(cameraVideo.videoHeight * scale));
      const margin = Math.max(8, Math.round(canvas.width * .015));
      const x = canvas.width - width - margin, y = canvas.height - height - margin;
      context.fillStyle = '#b2f771'; context.fillRect(x - 2, y - 2, width + 4, height + 4);
      context.drawImage(cameraVideo, x, y, width, height);
    }
    if (typeof screenVideo.requestVideoFrameCallback === 'function') frame = screenVideo.requestVideoFrameCallback(draw);
  };
  draw();
  if (typeof screenVideo.requestVideoFrameCallback !== 'function') timer = window.setInterval(draw, 1000 / 24);
  return {track, stop: () => {
    stopped = true; window.clearInterval(timer);
    if (frame !== undefined) screenVideo.cancelVideoFrameCallback(frame);
    for (const video of [screenVideo, cameraVideo]) {video.pause(); video.srcObject = null;}
    output.getTracks().forEach(current => current.stop());
  }};
}
