package com.trendlix.people;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Whether this build of the app can receive push notifications: it was built with the Firebase project's
 * google-services.json, which the Mobile (Android) workflow writes from the repository secret GOOGLE_SERVICES_JSON.
 *
 * <p>Owner, 20 October 2026 (apps/mobile/README.md, section 1): "Push notifications: yes"; README Phase 4. The Push
 * Notifications plugin needs Firebase, and Firebase starts only when Gradle applied the google-services plugin with that
 * file (app/build.gradle: only when the file is there), which also adds the {@code google_app_id} string to the app's
 * resources. A build without it (the secret not set) has no Firebase: the plugin's {@code register()} and
 * {@code unregister()} would then stop the app ({@code FirebaseMessaging.getInstance()} throws on Capacitor's plugin
 * thread). So the website's pages (apps/web/src/lib/native.ts) ask here first, and call the Push Notifications plugin
 * only when this says {@code configured: true}.
 *
 * <ul>
 *   <li>{@code isConfigured()} → {@code { configured }}: Firebase's {@code google_app_id} is in the app's resources.</li>
 * </ul>
 *
 * <p>No text for people here (the pages word everything); nothing is logged.
 */
@CapacitorPlugin(name = "TrendlixPush")
public class TrendlixPushPlugin extends Plugin {

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("configured", firebaseConfigured());
        call.resolve(answer);
    }

    /** The google-services plugin writes google_app_id into the app's values when it was applied with the file. */
    private boolean firebaseConfigured() {
        Context context = getContext();
        int id = context.getResources().getIdentifier("google_app_id", "string", context.getPackageName());
        if (id == 0) return false;
        String value = context.getString(id);
        return value != null && !value.trim().isEmpty();
    }
}
