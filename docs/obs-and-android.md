# OBS and native Android capture

## Desktop workflow

The studio detects mobile user agents (including touch-enabled iPads using a desktop user agent). On computers, OBS mode is selected initially. Install OBS Studio, compose the screen/camera scene, and start its virtual camera. In StreamGuard, grant camera/microphone access, detect devices, and choose OBS Virtual Camera. The exact device ID is used; missing selected inputs never silently fall back to another camera or microphone.

OBS provides scenes, display capture, filters, transitions, and camera composition in its own interface. StreamGuard consumes that composed video through the virtual camera and distributes it through its existing WebRTC/WSS transports. This integration does not expose OBS WebSocket or remote-control every OBS setting from the website. Browser mode remains available for computers without OBS.

The virtual camera carries video only. Select the microphone in StreamGuard, or route OBS monitoring to a virtual audio input installed on the computer and select that input. No RTMP ingest server or additional paid cloud service is required for this integration.

## Android application

The `android/` project is a Java Android app (Android 8/API 26 or later) containing a restricted WebView of the existing platform. Users log in to the same first-party interface. The bridge uses AndroidX WebKit origin restrictions and verifies the main frame. It accepts only the configured frontend origin. Session cookies are read natively and sent only to the fixed first-party HTTPS API; they are never passed to JavaScript or stored in source code. No credentials appear in links.

The native screen mode requests RECORD_AUDIO and a fresh MediaProjection consent. A non-exported foreground service shows a persistent notification with a stop action. The app uses hardware H.264/AAC encoding, a persistent input surface, and one virtual display per consent. Completed MP4 files of about 2.5 seconds are sent over the existing authenticated WSS relay with `fragmentMode=file`. Viewers play independent files sequentially; this mode has a few seconds of latency and brief segment boundaries, rather than WebRTC latency. Native publishers advertise `mediaTransport=relay` to avoid waiting for a peer connection that they do not offer.

Six segments are combined locally with MediaMuxer before uploading to the existing recording API. Upload queues and live fragment sizes are bounded; the server retains its existing authorization, per-room viewer limits, and storage quota. Marked clips use the latest completed recording batch. Microphone mute applies at the next recorder boundary. Only screen and microphone are captured; internal/game audio and a camera overlay are not included in native screen mode. Camera mode, including front/rear selection, remains available through the WebView.

Stopping from the system sharing control, the notification, or the studio ends the session. A lost connection uses bounded reconnect attempts; the backend's existing host expiry ends a lost publisher. Rotation can be letterboxed to preserve a stable encoder size. DRM/protected windows can remain black as required by Android.

Building requires JDK 17, Gradle 8.13 and Android SDK 36. Run `gradle :app:assembleRelease :app:lintRelease` from `android/`. The GitHub Android workflow builds an unsigned release APK. Sign it with the project's private local keystore before distribution; never commit the keystore or its password. A fresh signed APK is published as a GitHub Release asset. This avoids Google Play enrollment fees; Android asks the user to allow installation from the download source.

This release must still be checked on physical Android devices for manufacturer-specific encoding and permission behavior. Compilation and browser relay tests do not prove a phone-to-viewer live session.

References: [OBS virtual camera](https://obsproject.com/kb/virtual-camera-guide), [Android MediaProjection](https://developer.android.com/media/grow/media-projection), [MediaRecorder persistent surface](https://developer.android.com/reference/android/media/MediaRecorder#setInputSurface(android.view.Surface)), [restricted WebView bridge](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set%3Cjava.lang.String%3E,androidx.webkit.WebViewCompat.WebMessageListener)).
