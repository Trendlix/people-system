package com.trendlix.people;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // the app's own plugins, kept in this project (not npm packages), registered before the bridge starts: the
        // location with Android's word on a mock one (fake GPS), README Phase 2, 20 October 2026; and fingerprint
        // sign-in (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password sign-in"), README
        // Phase 3
        registerPlugin(TrendlixLocationPlugin.class);
        registerPlugin(TrendlixBiometricPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
