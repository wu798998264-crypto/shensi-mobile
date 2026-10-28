package studio.hexing.shensi.mobile;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;

final class ShensiDatabase extends SQLiteOpenHelper {
    private static ShensiDatabase instance;
    static synchronized ShensiDatabase get(Context context) {
        if (instance == null) instance = new ShensiDatabase(context.getApplicationContext());
        return instance;
    }
    private ShensiDatabase(Context context) {
        super(context, new File(context.getNoBackupFilesDir(), "shensi-mobile-v1.sqlite").getAbsolutePath(), null, 1);
        setWriteAheadLoggingEnabled(true);
    }
    @Override public void onConfigure(SQLiteDatabase db) { db.setForeignKeyConstraintsEnabled(true); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE document_states (key TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE secure_entries (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Never drop user data to make a downgrade/upgrade appear successful.
        throw new IllegalStateException("MIGRATION_REQUIRED");
    }
}
