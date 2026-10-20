package com.trendlix.people;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // the app's own plugin, kept in this project (not an npm package), registered before the bridge starts: the
        // location with Android's word on a mock one (fake GPS), README Phase 2, 20 October 2026
        registerPlugin(TrendlixLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
