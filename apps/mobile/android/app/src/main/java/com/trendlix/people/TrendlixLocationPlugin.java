package com.trendlix.people;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

/**
 * Where the phone is, read once for a check-in, and whether Android says the location is a mock one (fake GPS).
 *
 * <p>Owner, 20 October 2026 (apps/mobile/README.md, Phase 2): "Android mock location → mock: true on the punch →
 * flagged ("Fake GPS suspected") on Daily Attendance". The Capacitor Geolocation plugin doesn't say whether a location
 * is a mock one, so this small plugin reads it itself: Google Play services' fused location (as the Geolocation
 * plugin does), fresh and as precise as it may, within the timeout asked for, and Android's own word on it
 * ({@code Location.isMock()} from Android 12, {@code isFromMockProvider()} before). The website's pages call it
 * through apps/web/src/lib/native.ts ({@code window.Capacitor.Plugins.TrendlixLocation.getPosition}); nothing is kept
 * on the phone, and the location is only read while the app is open (no background location).
 *
 * <p>{@code getPosition({ enableHighAccuracy, timeout, maximumAge })} answers {@code { latitude, longitude, accuracy,
 * timestamp, mock }}, or refuses with a code the page turns into its own words (no text for people here): DENIED (the
 * location permission refused), LOCATION_OFF (the phone's location is off), TIMEOUT (no location in time), NO_PLAY_SERVICES
 * (Google Play services can't give one: the page asks the Geolocation plugin instead), UNAVAILABLE (anything else).
 */
@CapacitorPlugin(
    name = "TrendlixLocation",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }, alias = TrendlixLocationPlugin.LOCATION),
        @Permission(strings = { Manifest.permission.ACCESS_COARSE_LOCATION }, alias = TrendlixLocationPlugin.COARSE_LOCATION)
    }
)
public class TrendlixLocationPlugin extends Plugin {

    static final String LOCATION = "location";
    static final String COARSE_LOCATION = "coarseLocation";

    /** The page asks for 10 seconds; never less than 1 nor more than 60. */
    private static final int DEFAULT_TIMEOUT_MS = 10_000;

    @PluginMethod
    public void getPosition(PluginCall call) {
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            read(call);
        } else {
            // the system's own prompt, "while using the app" (or approximate only, which still reads)
            requestPermissionForAlias(LOCATION, call, "afterPermission");
        }
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState(COARSE_LOCATION) == PermissionState.GRANTED) {
            read(call);
        } else {
            call.reject("Location permission denied.", "DENIED");
        }
    }

    @SuppressLint("MissingPermission") // asked for in getPosition
    private void read(PluginCall call) {
        Context context = getContext();
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null || !LocationManagerCompat.isLocationEnabled(manager)) {
            call.reject("The phone's location is off.", "LOCATION_OFF");
            return;
        }
        int timeout = Math.max(1_000, Math.min(60_000, call.getInt("timeout", DEFAULT_TIMEOUT_MS)));
        int maximumAge = Math.max(0, call.getInt("maximumAge", 0));
        boolean precise = Boolean.TRUE.equals(call.getBoolean("enableHighAccuracy", true));
        CurrentLocationRequest request = new CurrentLocationRequest.Builder()
            .setPriority(precise ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY)
            .setDurationMillis(timeout)
            .setMaxUpdateAgeMillis(maximumAge)
            .build();
        CancellationTokenSource cancel = new CancellationTokenSource();
        try {
            LocationServices.getFusedLocationProviderClient(context)
                .getCurrentLocation(request, cancel.getToken())
                .addOnSuccessListener(location -> {
                    if (location == null) {
                        call.reject("No location within the time allowed.", "TIMEOUT");
                    } else {
                        call.resolve(asResult(location));
                    }
                })
                .addOnFailureListener(e -> {
                    if (e instanceof ApiException) {
                        call.reject("Google Play services can't give the location on this phone.", "NO_PLAY_SERVICES", e);
                    } else {
                        call.reject("The location could not be read.", "UNAVAILABLE", e);
                    }
                });
        } catch (RuntimeException e) {
            call.reject("The location could not be read.", "UNAVAILABLE", e);
        }
    }

    private static JSObject asResult(Location location) {
        JSObject result = new JSObject();
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        if (location.hasAccuracy()) {
            result.put("accuracy", (double) location.getAccuracy());
        }
        result.put("timestamp", location.getTime());
        result.put("mock", isMock(location));
        return result;
    }

    /** Android's own word: the location came from a mock provider (an app set as the phone's "mock location app"). */
    @SuppressWarnings("deprecation")
    private static boolean isMock(Location location) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? location.isMock() : location.isFromMockProvider();
    }
}
