# Browser capture support

The studio requests camera and microphone in one `getUserMedia` call. A desktop screen broadcast also acquires a display stream and composites the webcam into its lower-right corner. The same composed video track is used by WebRTC, recording, and the WSS relay; camera toggles affect the transmitted overlay, not only the self-preview.

Android and iOS browsers that do not implement screen capture must use camera mode. The screen checkbox is disabled with an explanation before capture starts, including Android versions that expose `getDisplayMedia` but always reject it. Phone-screen capture requires a native Android application using MediaProjection or an iOS application with a ReplayKit broadcast extension. No native application is included in this web release. Re-enabling the checkbox or installing the website as a PWA does not provide these native APIs.

The studio offers an initial front/rear camera preference and an in-session lens switch. Switching releases the previous camera before requesting the next lens, as required on some phones, and preserves the microphone and mute state. Camera-only broadcasts use a stable canvas video track so WebRTC senders, the fragment relay, and active recordings retain their outgoing track when the input device changes. A missing second lens produces a specific error and attempts to restore the original lens; ending a stream during the permission prompt releases the late result.

Capture failures are identified by their `name` property, including DOM exceptions and cross-realm errors that are not instances of the current JavaScript `Error` constructor. Preferred camera constraints are relaxed once on `OverconstrainedError`. Denied permissions do not trigger additional prompts. A desktop with no webcam may continue sharing its screen and microphone.

Live camera capture is no longer blocked solely because MediaRecorder is unavailable; in that case browser recording and the recorded-fragment relay remain unavailable, while direct WebRTC can still work.

Run `npm run test:media` for coverage of mobile capability checks, permission handling, cleanup, microphone/camera controls, and screen/webcam composition. Synthetic media checks verify capture and encoding paths but do not replace a real Android/iOS device test.

Compatibility reference: https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json
