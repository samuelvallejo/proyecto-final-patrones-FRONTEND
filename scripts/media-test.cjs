const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {stripTypeScriptTypes} = require('node:module');
const root = path.resolve(__dirname, '..');
const spanish = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/locales/es.json')));
function load(name, globals = {}, imports = {}) {
  const source = fs.readFileSync(path.join(root, 'frontend/src', name + '.ts'), 'utf8');
  let code = stripTypeScriptTypes(source, {mode: 'transform'});
  const names = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(match => match[1]);
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, fields, key) => `const {${fields}} = require('${key}');`)
    .replace(/export\s+(?=(?:async\s+)?(?:function|const|class))/g, '');
  code += `\nObject.assign(exports, {${names.join(',')}});`;
  const exports = {}, context = vm.createContext({exports, console, ...globals, require: key => {
    if (!(key in imports)) throw new Error('Unexpected import: ' + key);
    return imports[key];
  }});
  vm.runInContext(code, context, {filename: name + '.js'}); return exports;
}
const capture = load('capture');
function track(kind) {return {kind, enabled: true, readyState: 'live', stopped: false,
  stop() {this.stopped = true; this.readyState = 'ended';}, addEventListener() {}};}
class Stream {
  constructor(tracks) {this.tracks = tracks;}
  getTracks() {return this.tracks;}
  getVideoTracks() {return this.tracks.filter(track => track.kind === 'video');}
  getAudioTracks() {return this.tracks.filter(track => track.kind === 'audio');}
}
function environment(userAgent = 'Desktop Chrome') {
  const camera = track('video'), microphone = track('audio'), screen = track('video');
  const constraints = [], displayCalls = [];
  return {camera, microphone, screen, constraints, displayCalls,
    environment: {userAgent, platform: 'Linux', maxTouchPoints: 0, devices: {
      async getUserMedia(value) {constraints.push(value); return new Stream([camera, microphone]);},
      async getDisplayMedia(value) {displayCalls.push(value); return new Stream([screen]);},
    }}};
}
test('Android with an exposed but unsupported screen API requests camera and microphone together', async () => {
  const fixture = environment('Mozilla/5.0 (Linux; Android 14) Chrome/130');
  const sources = await capture.acquireSources(true, fixture.environment);
  assert.equal(fixture.displayCalls.length, 0);
  assert.equal(sources.cameraFallback, true);
  assert.equal(sources.display, null);
  assert.equal(fixture.constraints.length, 1);
  assert.equal(fixture.constraints[0].video.facingMode, 'user');
  assert.equal(Boolean(fixture.constraints[0].audio), true);
});
test('iPad desktop mode does not offer unsupported screen capture', () => {
  const fixture = environment('Mozilla/5.0 (Macintosh) Safari');
  fixture.environment.platform = 'MacIntel'; fixture.environment.maxTouchPoints = 5;
  assert.equal(capture.screenCaptureSupported(fixture.environment), false);
});
test('A named DOM failure is recognized without relying on Error inheritance', () => {
  assert.equal(capture.mediaErrorName({name: 'NotAllowedError'}), 'NotAllowedError');
  assert.equal(capture.mediaErrorName(null), '');
});
test('Device constraints are relaxed once when a phone camera rejects the preferred settings', async () => {
  const fixture = environment('Android');
  let calls = 0;
  fixture.environment.devices.getUserMedia = async constraints => {
    calls++; if (calls === 1) throw {name: 'OverconstrainedError'};
    assert.equal(constraints.video, true); assert.equal(constraints.audio, true);
    return new Stream([fixture.camera, fixture.microphone]);
  };
  await capture.acquireSources(false, fixture.environment); assert.equal(calls, 2);
});
test('Permission denial does not become a fallback and cleans up an already shared screen', async () => {
  const fixture = environment();
  fixture.environment.devices.getUserMedia = async () => {throw {name: 'NotAllowedError'};};
  await assert.rejects(capture.acquireSources(true, fixture.environment), error => error.name === 'NotAllowedError');
  assert.equal(fixture.screen.stopped, true);
});
test('Canceling the desktop screen chooser does not open camera and microphone', async () => {
  const fixture = environment();
  fixture.environment.devices.getDisplayMedia = async () => {throw {name: 'NotAllowedError'};};
  await assert.rejects(capture.acquireSources(true, fixture.environment));
  assert.equal(fixture.constraints.length, 0);
});
test('A computer without webcam can still share its screen and microphone', async () => {
  const fixture = environment();
  let calls = 0;
  fixture.environment.devices.getUserMedia = async constraints => {
    calls++; if (calls === 1) throw {name: 'NotFoundError'};
    assert.equal(constraints.audio, true); assert.equal(constraints.video, undefined);
    return new Stream([fixture.microphone]);
  };
  const sources = await capture.acquireSources(true, fixture.environment);
  assert.equal(sources.display.getVideoTracks()[0], fixture.screen);
  assert.equal(sources.devices.getAudioTracks()[0], fixture.microphone);
  assert.equal(calls, 2);
});
function mediaHarness(fixture) {
  const videos = [], draws = [], output = track('video');
  const document = {getElementById: () => null, createElement: tag => {
    if (tag === 'canvas') return {width: 1280, height: 720,
      getContext: () => ({fillRect() {}, drawImage(video) {draws.push(video);}}),
      captureStream: () => new Stream([output])};
    const video = {muted: false, playsInline: false, autoplay: false, videoWidth: 1280, videoHeight: 720, readyState: 2,
      play: async () => {}, pause() {}, requestVideoFrameCallback(callback) {this.frame = callback; return 1;}, cancelVideoFrameCallback() {this.frame = null;}};
    videos.push(video); return video;
  }};
  const browser = {addEventListener() {}, clearTimeout() {}, clearInterval() {}, setInterval() {return 1;}};
  const globals = {window: browser, document, MediaStream: Stream, HTMLVideoElement: class {}, navigator: {
    userAgent: fixture.environment.userAgent, platform: fixture.environment.platform,
    maxTouchPoints: fixture.environment.maxTouchPoints, mediaDevices: fixture.environment.devices,
  }};
  const compositor = load('compositor', globals);
  const media = load('media', globals, {'./capture': load('capture', globals), './compositor': compositor,
    './i18n': {t: key => spanish[key]}, './relay': {relay: {stop() {}, viewerActive: () => false}}, './contracts': {}}).media;
  return {media, videos, draws, output};
}
test('Mobile camera can start without MediaRecorder and both device toggles work', async () => {
  const fixture = environment('Android'), harness = mediaHarness(fixture);
  await harness.media.prepare(true);
  assert.equal(harness.media.usedCameraFallback(), true);
  assert.equal(harness.media.cameraAvailable(), true);
  assert.equal(harness.media.toggleCamera(), false); assert.equal(fixture.camera.enabled, false);
  assert.equal(harness.media.toggleMicrophone(), false); assert.equal(fixture.microphone.enabled, false);
  assert.equal(harness.media.toggleCamera(), true);
  harness.media.stop(); assert.equal(fixture.camera.stopped, true); assert.equal(fixture.microphone.stopped, true);
});
test('Screen sharing includes webcam, hides its overlay when disabled, and releases every track', async () => {
  const fixture = environment(), harness = mediaHarness(fixture);
  await harness.media.prepare(true);
  assert.equal(harness.media.cameraAvailable(), true);
  assert.equal(fixture.constraints.length, 1);
  assert.equal(harness.draws.filter(video => video === harness.videos[1]).length, 1);
  harness.media.toggleCamera(); harness.videos[0].frame();
  assert.equal(harness.draws.filter(video => video === harness.videos[1]).length, 1);
  harness.media.toggleCamera(); harness.videos[0].frame();
  assert.equal(harness.draws.filter(video => video === harness.videos[1]).length, 2);
  harness.media.stop();
  for (const current of [fixture.camera, fixture.microphone, fixture.screen, harness.output]) assert.equal(current.stopped, true);
});
test('Permission failures return useful Spanish feedback rather than the generic video error', () => {
  const harness = mediaHarness(environment('Android'));
  assert.equal(harness.media.messageForError({name: 'NotAllowedError'}), spanish.mediaPermissionDenied);
  assert.equal(harness.media.messageForError({name: 'NotFoundError'}), spanish.mediaDeviceMissing);
});
