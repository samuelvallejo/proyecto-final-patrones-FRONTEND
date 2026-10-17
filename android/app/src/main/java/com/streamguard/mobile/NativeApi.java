package com.streamguard.mobile;

import java.io.*;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.JSONObject;

/** Cookies stay in the app process and are sent only to the fixed first-party API. */
final class NativeApi {
    final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(55, TimeUnit.SECONDS).callTimeout(55, TimeUnit.SECONDS).build();
    private final String cookie;
    NativeApi(String cookie) {this.cookie = cookie;}
    String ticket() throws Exception {return post("/auth/connection-ticket", new JSONObject()).getString("ticket");}
    JSONObject post(String path, JSONObject data) throws Exception {
        return execute(path, RequestBody.create(data.toString(), MediaType.get("application/json")));
    }
    void upload(String path, File file, Map<String, String> values) throws Exception {
        MultipartBody.Builder body = new MultipartBody.Builder().setType(MultipartBody.FORM);
        values.forEach(body::addFormDataPart);
        body.addFormDataPart("file", "screen.mp4", RequestBody.create(file, MediaType.get("video/mp4")));
        execute(path, body.build());
    }
    private JSONObject execute(String path, RequestBody body) throws Exception {
        Request request = new Request.Builder().url(BuildConfig.FRONTEND + "/api" + path).header("Cookie", cookie).post(body).build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) throw new IOException("API operation failed");
            return new JSONObject(response.body().string());
        }
    }
    WebSocket socket(String path, WebSocketListener listener) {
        return client.newWebSocket(new Request.Builder().url(BuildConfig.BACKEND.replace("https://", "wss://") + path)
            .header("Origin", BuildConfig.FRONTEND).build(), listener);
    }
}
