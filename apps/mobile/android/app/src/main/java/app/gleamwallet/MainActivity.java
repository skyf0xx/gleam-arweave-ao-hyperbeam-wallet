package app.gleamwallet;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, which no package brings in; it has to be registered before the bridge starts.
        registerPlugin(OverlayGuardPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
