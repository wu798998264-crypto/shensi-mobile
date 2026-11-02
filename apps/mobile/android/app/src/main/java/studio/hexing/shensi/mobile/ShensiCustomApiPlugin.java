package studio.hexing.shensi.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.concurrent.TimeUnit;
import okhttp3.*;

// Only the packaged local UI may call a user-configured OpenAI-compatible HTTPS API.
// No cookies, redirects, transparent retries or access to local files.
@CapacitorPlugin(name = "ShensiCustomApi")
public class ShensiCustomApiPlugin extends ShensiLocalPlugin {
    private final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(75, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS).build();
    @PluginMethod public void request(PluginCall call) {
        if (!trusted(call)) return;
        getBridge().execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                String method = call.getString("method", ""), auth = call.getString("authorization", ""), body = call.getString("body", "");
                boolean models = method.equals("GET") && url.getPath().endsWith("/models");
                boolean chat = method.equals("POST") && url.getPath().endsWith("/chat/completions");
                if (!url.getProtocol().equals("https") || url.getUserInfo()!=null || url.getQuery()!=null || url.getRef()!=null || !(models||chat) || body.length()>150000 || auth.length()>16391 || auth.contains("\r") || auth.contains("\n")) throw new IllegalArgumentException();
                Request.Builder request = new Request.Builder().url(url).header("Accept", "application/json");
                if (!auth.isEmpty()) { if (!auth.startsWith("Bearer ")) throw new IllegalArgumentException(); request.header("Authorization", auth); }
                if (chat) request.post(RequestBody.create(body, MediaType.parse("application/json; charset=utf-8")));
                try (Response response = client.newCall(request.build()).execute()) {
                    if (response.code()>=300 && response.code()<400) throw new IllegalArgumentException();
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    if (response.isSuccessful() && response.body()!=null) try (InputStream input=response.body().byteStream()) {
                        byte[] chunk=new byte[8192]; int count;
                        while ((count=input.read(chunk))!=-1) { if(bytes.size()+count>2097152) throw new IllegalArgumentException(); bytes.write(chunk,0,count); }
                    }
                    JSObject result=new JSObject();result.put("status",response.code());result.put("data",bytes.toString("UTF-8"));call.resolve(result);
                }
            } catch(Exception error) { call.reject("API网络连接未确认；未自动重发，请先核对供应商结果", "CUSTOM_API_UNCONFIRMED"); }
        });
    }
}
