package studio.hexing.shensi.mobile;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

@CapacitorPlugin(name = "ShensiSecureVault")
public class ShensiSecureVaultPlugin extends ShensiLocalPlugin {
    private static final String ALIAS = "shensi.mobile.vault.v1";
    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("KEY_UNAVAILABLE");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private SQLiteDatabase database() { return ShensiDatabase.get(getContext()).getWritableDatabase(); }
    @PluginMethod public synchronized void set(PluginCall call) {
        if (!trusted(call)) return; String name = key(call, true); if (name == null) return;
        String value = call.getString("value");
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 65536) { call.reject("凭据长度无效", "INVALID_SECRET"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(("shensi-vault-v1:" + name).getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            JSONObject envelope = new JSONObject(); envelope.put("v", 1); envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)); envelope.put("cipher", Base64.encodeToString(encrypted, Base64.NO_WRAP));
            ContentValues row = new ContentValues(); row.put("key", name); row.put("value", envelope.toString());
            if (database().insertWithOnConflict("secure_entries", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0) throw new IllegalStateException();
            call.resolve();
        } catch (Exception e) { call.reject("系统安全凭据保存失败；未降级为明文", "SECURE_VAULT_FAILED"); }
    }
    @PluginMethod public synchronized void get(PluginCall call) {
        if (!trusted(call)) return; String name = key(call, true); if (name == null) return;
        try (Cursor rows = database().rawQuery("SELECT value FROM secure_entries WHERE key=?", new String[]{name})) {
            JSObject result = new JSObject();
            if (!rows.moveToFirst()) { result.put("value", JSONObject.NULL); call.resolve(result); return; }
            JSONObject envelope = new JSONObject(rows.getString(0)); if (envelope.getInt("v") != 1) throw new IllegalStateException();
            byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP); if (iv.length != 12) throw new IllegalStateException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
            cipher.updateAAD(("shensi-vault-v1:" + name).getBytes(StandardCharsets.UTF_8));
            result.put("value", new String(cipher.doFinal(Base64.decode(envelope.getString("cipher"), Base64.NO_WRAP)), StandardCharsets.UTF_8)); call.resolve(result);
        } catch (Exception e) { call.reject("凭据无法解密，请重新授权；原记录未删除", "SECURE_VAULT_UNAVAILABLE"); }
    }
    @PluginMethod public synchronized void remove(PluginCall call) {
        if (!trusted(call)) return; String name = key(call, true); if (name == null) return;
        try { database().delete("secure_entries", "key=?", new String[]{name}); call.resolve(); }
        catch (Exception e) { call.reject("安全凭据清理失败，请重试", "SECURE_VAULT_FAILED"); }
    }
}
