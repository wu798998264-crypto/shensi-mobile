package studio.hexing.shensi.mobile;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

@CapacitorPlugin(name = "ShensiMetadata")
public class ShensiMetadataPlugin extends ShensiLocalPlugin {
    @PluginMethod public void read(PluginCall call) {
        if (!trusted(call)) return; String key = key(call, false); if (key == null) return;
        try (Cursor row = ShensiDatabase.get(getContext()).getReadableDatabase().rawQuery("SELECT revision,value FROM mobile_metadata WHERE key=?", new String[]{key})) {
            boolean found = row.moveToFirst(); JSObject result = new JSObject();
            result.put("revision", found ? row.getLong(0) : 0); result.put("value", found ? row.getString(1) : JSONObject.NULL); call.resolve(result);
        } catch (Exception e) { call.reject("读取同步或插件记录失败", "METADATA_FAILED"); }
    }
    @PluginMethod public void compareAndSwap(PluginCall call) {
        if (!trusted(call)) return; String key = key(call, false); if (key == null) return;
        Object raw = call.getData().opt("expectedRevision"); String value = call.getString("value");
        if (!(raw instanceof Integer || raw instanceof Long) || ((Number)raw).longValue() < 0 || ((Number)raw).longValue() >= 9007199254740991L || value == null || value.getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) {
            call.reject("元数据事务无效", "INVALID_TRANSACTION"); return;
        }
        long expected = ((Number)raw).longValue(); SQLiteDatabase db;
        try { new JSONObject(value); db = ShensiDatabase.get(getContext()).getWritableDatabase(); db.beginTransaction(); }
        catch (Exception e) { call.reject("元数据事务无法开启", "METADATA_FAILED"); return; }
        boolean conflict = false, committed = false;
        try {
            long actual = 0;
            try (Cursor row = db.rawQuery("SELECT revision FROM mobile_metadata WHERE key=?", new String[]{key})) { if (row.moveToFirst()) actual = row.getLong(0); }
            if (actual != expected) conflict = true;
            else {
                ContentValues row = new ContentValues(); row.put("key", key); row.put("revision", actual + 1); row.put("value", value);
                if (db.insertWithOnConflict("mobile_metadata", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0) throw new IllegalStateException();
                db.setTransactionSuccessful(); committed = true;
            }
        } catch (Exception e) { committed = false; }
        finally { try { db.endTransaction(); } catch (Exception e) { committed = false; } }
        if (conflict) call.reject("记录已变化，请重试", "METADATA_CONFLICT");
        else if (!committed) call.reject("记录保存未确认，请回读", "METADATA_FAILED");
        else { JSObject result = new JSObject(); result.put("revision", expected + 1); result.put("value", value); call.resolve(result); }
    }
}
