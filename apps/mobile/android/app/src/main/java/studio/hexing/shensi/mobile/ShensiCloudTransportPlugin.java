package studio.hexing.shensi.mobile;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.MediaType;

// Exact-origin binary bridge. No arbitrary URLs, redirects, cookies or disk paths.
@CapacitorPlugin(name = "ShensiCloudTransport")
public class ShensiCloudTransportPlugin extends ShensiLocalPlugin {
    private final OkHttpClient davClient = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS).build();

    @PluginMethod public void nutstore(PluginCall call) {
        if (!trusted(call)) return;
        getBridge().execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                String method = call.getString("method", "GET"), auth = call.getString("authorization", "");
                boolean delta = (url.getPath().equals("/nsdav/delta") || url.getPath().equals("/nsdav/latestDeltaCursor")) && method.equals("POST") && url.getQuery() == null;
                boolean dav = url.getPath().startsWith("/dav/") && method.matches("OPTIONS|PROPFIND|MKCOL|GET|HEAD|PUT|DELETE");
                if (!url.getProtocol().equals("https") || !url.getHost().equals("dav.jianguoyun.com") || url.getPort() != -1 || url.getUserInfo() != null || url.getQuery() != null && !method.equals("PROPFIND") || url.getRef() != null || !(dav || delta) || !auth.matches("Basic [A-Za-z0-9+/=]{1,4096}")) throw new IllegalArgumentException();
                String encoded = call.getString("data", "");
                if (encoded.length() > 11184812) throw new IllegalArgumentException();
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                if (bytes.length > 8 * 1024 * 1024) throw new IllegalArgumentException();
                JSObject headers = call.getObject("headers", new JSObject());
                Request.Builder request = new Request.Builder().url(url).header("Authorization", auth);
                for (String name : new String[]{"Content-Type", "Depth", "If-Match", "If-None-Match", "Range"}) {
                    String value = headers.getString(name, "");
                    if (value.length() > 512 || value.contains("\r") || value.contains("\n")) throw new IllegalArgumentException();
                    if (!value.isEmpty()) request.header(name, value);
                }
                RequestBody body = (method.equals("PUT") || method.equals("PROPFIND") || bytes.length > 0) ? RequestBody.create(bytes, MediaType.parse(headers.getString("Content-Type", "application/octet-stream"))) : null;
                if ((method.equals("GET") || method.equals("HEAD")) && body != null) throw new IllegalArgumentException();
                request.method(method, body);
                try (Response response = davClient.newCall(request.build()).execute()) {
                    if (response.code() >= 300 && response.code() < 400) throw new IllegalArgumentException();
                    if (!method.equals("HEAD") && response.body() != null && response.body().contentLength() > 8 * 1024 * 1024) throw new IllegalArgumentException();
                    ByteArrayOutputStream result = new ByteArrayOutputStream();
                    if (response.body() != null) try (InputStream input = response.body().byteStream()) {
                        byte[] chunk = new byte[8192]; int count;
                        while ((count = input.read(chunk)) != -1) { if (result.size() + count > 8 * 1024 * 1024) throw new IllegalArgumentException(); result.write(chunk, 0, count); }
                    }
                    JSObject safeHeaders = new JSObject();
                    for (String name : new String[]{"Content-Type", "Content-Length", "ETag", "Retry-After", "Content-Range", "Accept-Ranges", "Link"}) if (response.header(name) != null) safeHeaders.put(name, response.header(name));
                    JSObject output = new JSObject();output.put("status", response.code());output.put("headers", safeHeaders);output.put("base64", Base64.encodeToString(result.toByteArray(), Base64.NO_WRAP));call.resolve(output);
                }
            } catch (Exception error) { call.reject("坚果云传输未确认，请检查网络或应用密码；不会自动重复写入", "NUTSTORE_TRANSPORT_FAILED"); }
        });
    }
    @PluginMethod public void request(PluginCall call) {
        if (!trusted(call)) return;
        getBridge().execute(() -> transfer(call));
    }
    @PluginMethod public void artifact(PluginCall call) {
        if (!trusted(call)) return;
        getBridge().execute(() -> {
            HttpsURLConnection connection = null;
            try {
                URL url = new URL(call.getString("url", "")); String host = url.getHost();
                if (!url.getProtocol().equals("https") || !(host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com")) || url.getPort() != -1 || url.getUserInfo() != null || url.getRef() != null) throw new IllegalArgumentException();
                connection = (HttpsURLConnection)url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
                connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setRequestMethod("GET"); connection.setRequestProperty("Accept", "application/octet-stream");
                int status = connection.getResponseCode(); JSObject response = new JSObject(); response.put("status", status);
                if (status >= 300 && status < 400) { response.put("location", connection.getHeaderField("Location")); response.put("base64", ""); call.resolve(response); return; }
                if (connection.getContentLengthLong() > 2 * 1024 * 1024) throw new IllegalArgumentException();
                ByteArrayOutputStream result = new ByteArrayOutputStream();
                try (InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                    if (in != null) { byte[] chunk = new byte[8192]; int count; while ((count = in.read(chunk)) != -1) { if (result.size() + count > 2 * 1024 * 1024) throw new IllegalArgumentException(); result.write(chunk, 0, count); } }
                }
                response.put("base64", Base64.encodeToString(result.toByteArray(), Base64.NO_WRAP)); call.resolve(response);
            } catch (Exception e) { call.reject("公开插件制品下载失败，未安装", "ARTIFACT_DOWNLOAD_FAILED"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    private void transfer(PluginCall call) {
        HttpsURLConnection connection = null;
        try {
            URL url = new URL(call.getString("url", "")); String method = call.getString("method", "GET"), token = call.getString("token", "");
            boolean upload = method.equals("PUT") && url.getPath().matches("/skill/v1/cloud-sync/uploads/[a-zA-Z0-9_-]{1,128}/chunks/[0-9]{1,5}");
            boolean download = method.equals("GET") && url.getPath().matches("/skill/v1/cloud-sync/files/[a-zA-Z0-9_-]{1,128}/chunks/[0-9]{1,5}");
            if (!url.getProtocol().equals("https") || !url.getHost().equals("api.hexing.studio") || url.getPort() != -1 || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null || (!upload && !download) || !token.matches("[A-Za-z0-9._~+/=-]{1,16384}")) throw new IllegalArgumentException();
            byte[] body = null;
            if (upload) {
                String data = call.getString("data", ""), digest = call.getString("sha256", "");
                if (data.length() > 5592408 || !digest.matches("[a-f0-9]{64}")) throw new IllegalArgumentException();
                body = Base64.decode(data, Base64.NO_WRAP); if (body.length > 4 * 1024 * 1024) throw new IllegalArgumentException();
            }
            connection = (HttpsURLConnection)url.openConnection(); connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000); connection.setReadTimeout(60000); connection.setUseCaches(false); connection.setRequestMethod(method);
            connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Accept", download ? "application/octet-stream" : "application/json");
            if (upload) {
                connection.setRequestProperty("Content-Type", "application/octet-stream"); connection.setRequestProperty("X-Content-SHA256", call.getString("sha256"));
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(body); }
            }
            int status = connection.getResponseCode(); if (status >= 300 && status < 400) throw new IllegalArgumentException();
            int limit = download && status >= 200 && status < 300 ? 4 * 1024 * 1024 : 512 * 1024;
            if (connection.getContentLengthLong() > limit) throw new IllegalArgumentException();
            ByteArrayOutputStream result = new ByteArrayOutputStream();
            try (InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (in != null) { byte[] chunk = new byte[8192]; int count; while ((count = in.read(chunk)) != -1) { if (result.size() + count > limit) throw new IllegalArgumentException(); result.write(chunk, 0, count); } }
            }
            JSObject response = new JSObject(); response.put("status", status); response.put("base64", Base64.encodeToString(result.toByteArray(), Base64.NO_WRAP)); call.resolve(response);
        } catch (Exception e) { call.reject("云端传输未确认；原续传记录保留", "CLOUD_TRANSPORT_FAILED"); }
        finally { if (connection != null) connection.disconnect(); }
    }
}
