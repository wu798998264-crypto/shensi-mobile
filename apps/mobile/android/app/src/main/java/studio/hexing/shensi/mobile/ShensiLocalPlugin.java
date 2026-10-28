package studio.hexing.shensi.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;

abstract class ShensiLocalPlugin extends Plugin {
    protected boolean trusted(PluginCall call) {
        // Remote server/live-reload configuration must never gain vault access.
        if (getBridge().getServerUrl() != null || !"https://localhost".equals(getBridge().getLocalUrl())) {
            call.reject("原生能力仅允许随包本地页面使用", "UNTRUSTED_ORIGIN");
            return false;
        }
        return true;
    }
    protected String key(PluginCall call, boolean secret) {
        String value = call.getString("key");
        if (value == null || (secret ? value.isEmpty() || value.length() > 512 || value.matches("(?s).*[\\p{Cntrl}].*") : !value.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}"))) {
            call.reject("无效存储身份", "INVALID_STORAGE_KEY");
            return null;
        }
        return value;
    }
}
