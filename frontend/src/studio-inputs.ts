import {panel, field, button, select} from './dom';
import {browserCaptureEnvironment, mobileCaptureClient} from './capture';
import {nativeCapture} from './native-capture';
import {t} from './i18n';

/** Desktop input selection and the native Android screen-capture entry point. */
export class StudioInputs {
  readonly element = panel('studio-inputs');
  readonly camera = select([[t('captureDefaultDevice'), '']]);
  readonly microphone = select([[t('captureDefaultDevice'), '']]);
  readonly mode = select([[t('captureBrowserMode'), 'browser']]);
  readonly mobile = mobileCaptureClient(browserCaptureEnvironment());
  constructor() {
    const hint = panel('capture-hint');
    if (nativeCapture.available()) {
      this.mode.add(new Option(t('captureAndroidMode'), 'android'));
      this.mode.value = 'android';
      this.element.append(field(t('captureSource'), this.mode)); hint.textContent = t('captureAndroidHint');
    } else if (this.mobile) {
      hint.textContent = t('captureMobileHint');
      if (/Android/i.test(navigator.userAgent)) {
        const download = document.createElement('a'); download.className = 'button subtle';
        download.textContent = t('captureDownloadAndroid'); download.href = 'https://github.com/samuelvallejo/proyecto-final-patrones-FRONTEND/releases/latest/download/streamguard-android.apk';
        download.target = '_blank'; download.rel = 'noopener'; this.element.append(download);
      }
    } else {
      this.mode.add(new Option(t('captureObsMode'), 'obs'));
      this.mode.value = 'obs';
      this.element.append(field(t('captureSource'), this.mode));
      this.camera.disabled = this.microphone.disabled = true;
      const controls = panel('form-row'); controls.append(field(t('captureVideoInput'), this.camera), field(t('captureAudioInput'), this.microphone));
      this.element.append(button(t('captureFindDevices'), 'button subtle', async () => {
        let permission: MediaStream | undefined;
        try {permission = await navigator.mediaDevices.getUserMedia({video: true, audio: true});}
        finally {permission?.getTracks().forEach(track => track.stop());}
        const inputs = await navigator.mediaDevices.enumerateDevices();
        for (const [kind, control] of [['videoinput', this.camera], ['audioinput', this.microphone]] as const) {
          control.replaceChildren(new Option(t('captureDefaultDevice'), ''));
          for (const device of inputs.filter(item => item.kind === kind)) control.add(new Option(device.label || t('captureUnnamedDevice'), device.deviceId));
          control.disabled = false;
        }
        const obs = inputs.find(item => item.kind === 'videoinput' && /\bobs\b/i.test(item.label));
        if (obs) {this.camera.value = obs.deviceId; this.mode.value = 'obs';}
        hint.textContent = obs ? t('captureObsReady') : t('captureObsMissing');
      }), controls);
      hint.textContent = t('captureDesktopHint');
      this.mode.addEventListener('change', () => {hint.textContent = this.mode.value === 'obs' ? t('captureObsHint') : t('mediaDevicePermissionsHint');});
    }
    this.element.append(hint);
  }
  validate(): void {
    if (this.mode.value === 'obs' && !this.camera.selectedOptions[0]?.textContent?.match(/\bobs\b/i)) throw new Error(t('captureObsMissing'));
  }
}
