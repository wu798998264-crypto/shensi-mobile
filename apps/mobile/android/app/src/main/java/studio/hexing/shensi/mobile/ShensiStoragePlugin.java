package studio.hexing.shensi.mobile;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "ShensiStorage")
public class ShensiStoragePlugin extends ShensiLocalPlugin {
    private SQLiteDatabase database() { return ShensiDatabase.get(getContext()).getWritableDatabase(); }
    @PluginMethod public void list(PluginCall call) {
        if (!trusted(call)) return;
        try (Cursor rows = database().rawQuery("SELECT key FROM document_states ORDER BY key", null)) {
            JSArray keys = new JSArray(); while (rows.moveToNext()) keys.put(rows.getString(0));
            JSObject result = new JSObject(); result.put("keys", keys); call.resolve(result);
        } catch (Exception e) { call.reject("读取笔记本目录失败", "STORAGE_FAILED"); }
    }
    @PluginMethod public void read(PluginCall call) {
        if (!trusted(call)) return; String key = key(call, false); if (key == null) return;
        try (Cursor rows = database().rawQuery("SELECT revision,value FROM document_states WHERE key=?", new String[]{key})) {
            JSObject result = new JSObject(); boolean found = rows.moveToFirst();
            result.put("revision", found ? rows.getLong(0) : 0);
            result.put("value", found ? rows.getString(1) : JSONObject.NULL); call.resolve(result);
        } catch (Exception e) { call.reject("读取笔记本失败，未覆盖原资料", "STORAGE_FAILED"); }
    }
    @PluginMethod public void compareAndSwap(PluginCall call) {
        if (!trusted(call)) return; String key = key(call, false); if (key == null) return;
        // JSONObject uses Integer for early revisions; Capacitor getLong only
        // accepts Long. Reject decimal/string inputs without rejecting 0/1/2.
        Object revision = call.getData().opt("expectedRevision");
        Long expected = revision instanceof Integer || revision instanceof Long ? ((Number) revision).longValue() : null;
        String value = call.getString("value");
        if (expected == null || expected < 0 || expected >= 9007199254740991L || value == null || value.getBytes(StandardCharsets.UTF_8).length > 64 * 1024 * 1024) {
            call.reject("事务版本或大小无效", "INVALID_TRANSACTION"); return;
        }
        try { new JSONObject(value); } catch (Exception e) { call.reject("笔记本必须为有效JSON", "INVALID_TRANSACTION"); return; }
        SQLiteDatabase db;
        try { db = database(); db.beginTransaction(); } catch (Exception e) { call.reject("无法开启资料事务", "STORAGE_FAILED"); return; }
        boolean conflict = false, committed = false;
        try {
            long actual = 0;
            try (Cursor rows = db.rawQuery("SELECT revision FROM document_states WHERE key=?", new String[]{key})) { if (rows.moveToFirst()) actual = rows.getLong(0); }
            if (actual != expected) conflict = true;
            else {
                ContentValues row = new ContentValues(); row.put("key", key); row.put("revision", actual + 1); row.put("value", value);
                if (db.insertWithOnConflict("document_states", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0) throw new IllegalStateException();
                try (Cursor saved = db.rawQuery("SELECT revision,value FROM document_states WHERE key=?", new String[]{key})) {
                    if (!saved.moveToFirst() || saved.getLong(0) != actual + 1 || !value.equals(saved.getString(1))) throw new IllegalStateException();
                }
                db.setTransactionSuccessful(); committed = true;
            }
        } catch (Exception e) { committed = false; }
        finally { try { db.endTransaction(); } catch (Exception e) { committed = false; } }
        if (conflict) call.reject("资料已变化，请保留输入并重新核对", "WORKSPACE_STATE_CONFLICT");
        else if (!committed) call.reject("保存事务未确认，请回读原操作，勿重复覆盖", "STORAGE_FAILED");
        else { JSObject result = new JSObject(); result.put("revision", expected + 1); result.put("value", value); call.resolve(result); }
    }
}
