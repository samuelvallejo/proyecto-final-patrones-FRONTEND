package com.streamguard.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.widget.Toast;
import androidx.webkit.*;
import java.util.*;
import org.json.JSONObject;

/** The native bridge is available only to the trusted main frame, never to arbitrary websites. */
public final class MainActivity extends Activity {
    private WebView browser;
    private JavaScriptReplyProxy reply;
    private String prepareId;
    private Intent projectionGrant;
    private PermissionRequest webPermission;
    private static final int SCREEN = 41, MICROPHONE = 42, WEB_MEDIA = 43;
    private final BroadcastReceiver updates = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String payload = intent.getStringExtra("payload");
            if (reply != null && payload != null) reply.postMessage(payload);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updates, new IntentFilter(ScreenBroadcastService.EVENT), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(updates, new IntentFilter(ScreenBroadcastService.EVENT));
        browser = new WebView(this); setContentView(browser);
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(false);
        browser.getSettings().setAllowContentAccess(false);
        browser.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme())) startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                return true;
            }
        });
        browser.setDownloadListener((url, userAgent, disposition, mime, size) -> {
            Uri target = Uri.parse(url); if ("https".equals(target.getScheme())) startActivity(new Intent(Intent.ACTION_VIEW, target));
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!trusted(request.getOrigin()) || webPermission != null) {request.deny(); return;}
                    webPermission = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, WEB_MEDIA);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {if (webPermission == request) webPermission = null;}
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(browser, "StreamGuardAndroid", Set.of(BuildConfig.FRONTEND), (view, message, origin, mainFrame, proxy) -> {
                if (!mainFrame || !trusted(origin) || message.getData() == null) return;
                reply = proxy;
                try {dispatch(new JSONObject(message.getData()));} catch (Exception error) {respond("", false);}
            });
        } else Toast.makeText(this, R.string.webview_required, Toast.LENGTH_LONG).show();
        browser.loadUrl(BuildConfig.FRONTEND);
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && Uri.parse(BuildConfig.FRONTEND).getHost().equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private void dispatch(JSONObject message) throws Exception {
        String id = message.getString("id"), action = message.getString("action");
        if (id.length() > 60) return;
        switch (action) {
            case "prepare" -> {
                if (prepareId != null || ScreenBroadcastService.active()) {respond(id, false); return;}
                prepareId = id; projectionGrant = null;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
                else requestScreen();
            }
            case "start" -> {
                String stream = UUID.fromString(message.getString("stream")).toString();
                String cookie = CookieManager.getInstance().getCookie(BuildConfig.FRONTEND + "/api");
                if (projectionGrant == null || cookie == null || ScreenBroadcastService.active()) {respond(id, false); return;}
                Intent start = new Intent(this, ScreenBroadcastService.class).setAction("start").putExtra("stream", stream).putExtra("cookie", cookie).putExtra("id", id).putExtra("grant", projectionGrant);
                projectionGrant = null; startForegroundService(start);
            }
            case "stop", "flush", "microphone" -> {
                if (!ScreenBroadcastService.active()) {projectionGrant = null; respond(id, true); return;}
                startService(new Intent(this, ScreenBroadcastService.class).setAction(action).putExtra("id", id).putExtra("enabled", message.optBoolean("enabled", true)));
            }
            default -> respond(id, false);
        }
    }
    private void requestScreen() {
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        startActivityForResult(manager.createScreenCaptureIntent(), SCREEN);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == SCREEN) {
            projectionGrant = result == RESULT_OK ? data : null;
            respond(prepareId, projectionGrant != null); prepareId = null;
        }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == MICROPHONE) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) requestScreen();
            else {respond(prepareId, false); prepareId = null;}
        } else if (request == WEB_MEDIA && webPermission != null) {
            List<String> allowed = new ArrayList<>();
            for (String resource : webPermission.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) allowed.add(resource);
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) allowed.add(resource);
            }
            if (allowed.isEmpty()) webPermission.deny(); else webPermission.grant(allowed.toArray(new String[0]));
            webPermission = null;
        }
    }
    private void respond(String id, boolean ok) {
        try {if (reply != null && id != null) reply.postMessage(new JSONObject().put("id", id).put("ok", ok).toString());} catch (Exception ignored) {}
    }
    @Override public void onBackPressed() {if (browser.canGoBack()) browser.goBack(); else super.onBackPressed();}
    @Override protected void onPause() {CookieManager.getInstance().flush(); super.onPause();}
    @Override protected void onDestroy() {unregisterReceiver(updates); browser.destroy(); super.onDestroy();}
}
