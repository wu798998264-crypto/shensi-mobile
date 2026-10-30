package studio.hexing.shensi.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShensiStoragePlugin.class);
        registerPlugin(ShensiSecureVaultPlugin.class);
        registerPlugin(ShensiMetadataPlugin.class);
        registerPlugin(ShensiCloudTransportPlugin.class);
        registerPlugin(ShensiMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
