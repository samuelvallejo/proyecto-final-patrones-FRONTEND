package com.streamguard.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.Surface;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;
import okio.ByteString;
import org.json.JSONObject;

/** Native screen permission + hardware encoding + the existing authenticated WSS media relay. */
public final class ScreenBroadcastService extends Service {
    static final String EVENT = "com.streamguard.mobile.CAPTURE_EVENT";
    private static volatile boolean running;
    static boolean active() {return running;}
    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread worker; private Handler capture;
    private final ExecutorService sockets = Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor uploads = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(4));
    private final List<SegmentMuxer.Part> parts = new ArrayList<>();
    private NativeApi api; private MediaProjection projection; private VirtualDisplay display; private Surface surface;
    private MediaRecorder recorder; private File recording; private WebSocket hub, relay;
    private String stream, startId; private long began, partStarted;
    private int width, height, dpi, generation, reconnects, demand;
    private boolean stopping, microphone = true, hubReady, relayReady;
    private volatile boolean archiveBlocked;
    private File latestClip; private int clipStart, clipEnd; private String pendingHighlight;
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override public void onStop() {if (capture != null) capture.post(() -> finish(true));}
    };
    private final Runnable rotate = () -> rotate(true);
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (stopping) return;
            if (hub != null) hub.send("{\"type\":\"ping\"}");
            if (relay != null) relay.send("{\"type\":\"ping\"}");
            capture.postDelayed(this, 20000);
        }
    };
    @Override public void onCreate() {
        super.onCreate(); worker = new HandlerThread("StreamGuardCapture"); worker.start(); capture = new Handler(worker.getLooper());
    }
    @Override public int onStartCommand(Intent intent, int flags, int start) {
        if (intent == null) {stopSelf(); return START_NOT_STICKY;}
        String action = intent.getAction();
        if ("start".equals(action) && !running) {
            running = true; showNotification();
            capture.post(() -> begin(intent));
        } else capture.post(() -> {
            String id = intent.getStringExtra("id");
            switch (action == null ? "" : action) {
                case "stop" -> {respond(id, true); finish(true);}
                case "flush" -> {
                    rotate(true); archive();
                    try {uploads.execute(() -> respond(id, true));} catch (RejectedExecutionException error) {respond(id, false);}
                }
                case "microphone" -> {microphone = intent.getBooleanExtra("enabled", true); rotate(true); respond(id, true);}
                default -> respond(id, false);
            }
        });
        return START_NOT_STICKY;
    }
    private void showNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("live", getString(R.string.capture_channel), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ScreenBroadcastService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, "live").setSmallIcon(R.drawable.shield)
            .setContentTitle(getString(R.string.capture_title)).setContentText(getString(R.string.capture_description)).setOngoing(true).setContentIntent(open)
            .addAction(new Notification.Action.Builder(null, getString(R.string.stop_capture), stop).build()).build();
        if (Build.VERSION.SDK_INT >= 30) startForeground(12, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else if (Build.VERSION.SDK_INT >= 29) startForeground(12, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(12, notification);
    }
    private void begin(Intent intent) {
        try {
            stream = UUID.fromString(intent.getStringExtra("stream")).toString(); startId = intent.getStringExtra("id");
            api = new NativeApi(intent.getStringExtra("cookie"));
            Intent grant = intent.getParcelableExtra("grant");
            projection = getSystemService(MediaProjectionManager.class).getMediaProjection(Activity.RESULT_OK, grant);
            projection.registerCallback(projectionCallback, capture);
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            double scale = Math.min(1, 720.0 / Math.min(metrics.widthPixels, metrics.heightPixels));
            width = ((int)(metrics.widthPixels * scale) / 2) * 2; height = ((int)(metrics.heightPixels * scale) / 2) * 2; dpi = metrics.densityDpi;
            surface = MediaCodec.createPersistentInputSurface(); began = SystemClock.elapsedRealtime();
            startPart();
            display = projection.createVirtualDisplay("StreamGuard", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, capture);
            openSockets(); capture.post(heartbeat);
        } catch (Exception error) {fail();}
    }
    private void startPart() throws Exception {
        recording = File.createTempFile("live-", ".mp4", getCacheDir());
        recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
        if (microphone) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE); recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264); recorder.setVideoSize(width, height); recorder.setVideoFrameRate(20); recorder.setVideoEncodingBitRate(600000);
        if (microphone) {recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); recorder.setAudioChannels(1); recorder.setAudioSamplingRate(24000); recorder.setAudioEncodingBitRate(48000);}
        recorder.setInputSurface(surface); recorder.setOutputFile(recording.getPath()); recorder.prepare(); recorder.start(); partStarted = SystemClock.elapsedRealtime();
        capture.postDelayed(rotate, 2500);
    }
    private void rotate(boolean resume) {
        capture.removeCallbacks(rotate);
        if (recorder != null) {
            File file = recording; boolean valid = true;
            try {recorder.stop();} catch (RuntimeException error) {valid = false;} finally {recorder.release(); recorder = null;}
            long end = SystemClock.elapsedRealtime();
            if (valid && file.length() > 0) {
                if (relayReady && demand > 0 && file.length() <= 1024 * 1024 && relay != null && relay.queueSize() < 1024 * 1024) {
                    try {relay.send(ByteString.of(Files.readAllBytes(file.toPath())));} catch (IOException ignored) {}
                }
                parts.add(new SegmentMuxer.Part(file, partStarted - began, end - began));
                if (parts.size() >= 6) archive();
            } else file.delete();
        }
        if (resume && !stopping && projection != null) {try {startPart();} catch (Exception error) {fail();}}
    }
    private void archive() {
        if (parts.isEmpty()) return;
        List<SegmentMuxer.Part> batch = new ArrayList<>(parts); parts.clear();
        if (archiveBlocked) {batch.forEach(part -> part.file().delete()); return;}
        try {uploads.execute(() -> {
            File output = null;
            try {
                output = File.createTempFile("archive-", ".mp4", getCacheDir()); SegmentMuxer.join(batch, output);
                int start = (int)(batch.get(0).start() / 1000), end = Math.max(start + 1, (int)Math.ceil(batch.get(batch.size()-1).end() / 1000.0));
                api.upload("/streams/" + stream + "/recording", output, Map.of("start", String.valueOf(start), "end", String.valueOf(end)));
                if (latestClip != null) latestClip.delete(); latestClip = output; output = null; clipStart = start; clipEnd = end;
                if (pendingHighlight != null) {String highlight = pendingHighlight; pendingHighlight = null; uploadClip(highlight);}
            } catch (Exception error) {archiveBlocked = true; event(json("type", "notice", "body", getString(R.string.archive_failed)));}
            finally {if (output != null) output.delete(); batch.forEach(part -> part.file().delete());}
        });} catch (RejectedExecutionException error) {
            archiveBlocked = true; batch.forEach(part -> part.file().delete()); event(json("type", "notice", "body", getString(R.string.archive_failed)));
        }
    }
    private void openSockets() {
        if (stopping) return;
        final int attempt = ++generation; hubReady = relayReady = false;
        if (hub != null) hub.cancel(); if (relay != null) relay.cancel();
        sockets.execute(() -> {
            try {
                String hubTicket = api.ticket(), relayTicket = api.ticket();
                capture.post(() -> {
                    if (stopping || generation != attempt) return;
                    hub = api.socket("/ws", listener(false, hubTicket, attempt));
                    relay = api.socket("/ws/media", listener(true, relayTicket, attempt));
                });
            } catch (Exception error) {capture.post(() -> reconnect(attempt));}
        });
    }
    private WebSocketListener listener(boolean media, String ticket, int attempt) {
        return new WebSocketListener() {
            @Override public void onOpen(WebSocket socket, Response response) {
                socket.send(json("type", "join", "streamId", stream, "token", ticket, "host", true, "format", "video/mp4", "fragmentMode", "file", "mediaTransport", "relay").toString());
            }
            @Override public void onMessage(WebSocket socket, String value) {
                capture.post(() -> {
                    if (stopping || generation != attempt) return;
                    try {
                        JSONObject data = new JSONObject(value); String type = data.optString("type");
                        if ("error".equals(type)) {fail(); return;}
                        if (media) {
                            if ("relay-ready".equals(type)) relayReady = true;
                            if ("relay-ready".equals(type) || "relay-demand".equals(type)) demand = data.optInt("viewers");
                        } else {
                            if ("joined".equals(type)) hubReady = true;
                            if ("capture".equals(type)) {
                                String highlight = UUID.fromString(data.getString("highlightId")).toString();
                                try {uploads.execute(() -> {if (latestClip == null) pendingHighlight = highlight; else uploadClip(highlight);});}
                                catch (RejectedExecutionException error) {event(json("type", "capture-status", "error", true, "message", getString(R.string.archive_failed)));}
                            }
                            if ("ended".equals(type)) {event(data); finish(false); return;}
                            if ("presence".equals(type) || "joined".equals(type)) event(data);
                        }
                        if (hubReady && relayReady) {reconnects = 0; if (startId != null) {respond(startId, true); startId = null;}}
                    } catch (Exception error) {fail();}
                });
            }
            @Override public void onClosed(WebSocket socket, int code, String reason) {capture.post(() -> reconnect(attempt));}
            @Override public void onFailure(WebSocket socket, Throwable error, Response response) {capture.post(() -> reconnect(attempt));}
        };
    }
    private void reconnect(int attempt) {
        if (stopping || generation != attempt) return;
        generation++; hubReady = relayReady = false;
        if (++reconnects > 6) {fail(); return;}
        capture.postDelayed(this::openSockets, Math.min(5000, 500L << reconnects));
    }
    private void fail() {respond(startId, false); startId = null; event(json("type", "error", "message", getString(R.string.capture_failed))); finish(true);}
    private void uploadClip(String highlight) {
        try {
            api.upload("/streams/" + stream + "/segments", latestClip, Map.of("highlightId", highlight, "start", String.valueOf(clipStart), "end", String.valueOf(clipEnd)));
            event(json("type", "clips-updated"));
        } catch (Exception error) {event(json("type", "capture-status", "error", true, "message", getString(R.string.archive_failed)));}
    }
    private void finish(boolean endRemote) {
        if (stopping) return; stopping = true; running = false; generation++;
        capture.removeCallbacksAndMessages(null); rotate(false); archive();
        if (hub != null) hub.close(1000, "Finished"); if (relay != null) relay.close(1000, "Finished");
        if (display != null) {display.release(); display = null;}
        if (projection != null) {projection.unregisterCallback(projectionCallback); projection.stop(); projection = null;}
        if (surface != null) {surface.release(); surface = null;}
        if (endRemote && api != null && stream != null) sockets.execute(() -> {try {api.post("/streams/" + stream + "/end", new JSONObject());} catch (Exception ignored) {}});
        event(json("type", "ended")); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    private static JSONObject json(Object... values) {
        JSONObject result = new JSONObject(); try {for (int index=0; index<values.length; index+=2) result.put(values[index].toString(), values[index+1]);} catch (Exception ignored) {} return result;
    }
    private void event(JSONObject data) {broadcast(json("event", data));}
    private void respond(String id, boolean ok) {if (id != null) broadcast(json("id", id, "ok", ok));}
    private void broadcast(JSONObject data) {main.post(() -> sendBroadcast(new Intent(EVENT).setPackage(getPackageName()).putExtra("payload", data.toString())));}
    @Override public IBinder onBind(Intent intent) {return null;}
    @Override public void onDestroy() {
        capture.post(() -> {
            if (!stopping) finish(true);
            sockets.shutdown();
            try {uploads.execute(() -> {if (latestClip != null) latestClip.delete();});} catch (RejectedExecutionException ignored) {}
            uploads.shutdown(); worker.quitSafely();
        });
        running = false; super.onDestroy();
    }
}
