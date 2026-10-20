package com.trendlix.people;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.InvalidAlgorithmParameterException;
import java.security.Key;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint sign-in: the phone keeps the device credential's secret behind the fingerprint, so the next open of the
 * app signs in without the password.
 *
 * <p>Owner, 20 October 2026 (apps/mobile/README.md, section 1): "Sign-in: Face ID / fingerprint after the first password
 * sign-in"; README Phase 3, "Phase 3 contract — what was built". After a password sign-in the website asks the API for a
 * device credential ({@code { id, secret }}) and hands it to {@link #enroll}; the secret is encrypted with an AES-256-GCM
 * key in the Android Keystore that needs a strong biometric for every use ({@code setUserAuthenticationRequired(true)},
 * {@code setInvalidatedByBiometricEnrollment(true)}; from Android 11 {@code AUTH_BIOMETRIC_STRONG} with no time
 * allowance), and only the ciphertext, its IV and the credential's id (not secret) are kept, in the app's private
 * preferences. {@link #unlock} decrypts it behind the prompt and gives it back to the page, which trades it for a session
 * on the website. The secret is never kept in plain and never logged (no exception or message here carries it).
 *
 * <p>On Android it is the fingerprint: only a strong (Class 3) biometric can unlock a Keystore key through a
 * {@code CryptoObject}, and on many Android phones the face unlock is weak (Class 2), so on those phones the prompt takes
 * the fingerprint only (a phone whose face unlock is Class 3, e.g. a Pixel 8 or later, may offer the face too).
 *
 * <p>The website's pages call it through apps/web/src/lib/native.ts ({@code window.Capacitor.Plugins.TrendlixBiometric}):
 * <ul>
 *   <li>{@code isAvailable()} → {@code { available, reason?, deviceName }}; reason when not available: NONE_ENROLLED (no
 *       fingerprint set up), NO_HARDWARE, WEAK_ONLY (only a weak biometric, e.g. a Class 2 face unlock), UNAVAILABLE
 *       (anything else: the sensor busy, a security update needed); deviceName e.g. "Google Pixel 8".</li>
 *   <li>{@code isEnrolled()} → {@code { enrolled, id? }}: a secret is kept and its key is still there.</li>
 *   <li>{@code enroll({ id, secret, title?, negativeButtonText? })} → the prompt (ENCRYPT) → {@code { enrolled: true }}.</li>
 *   <li>{@code unlock({ title?, negativeButtonText? })} → the prompt (DECRYPT) → {@code { id, secret }}.</li>
 *   <li>{@code clear()} → the key and what is kept are deleted → {@code {}}; never fails.</li>
 * </ul>
 * Refusals are codes the page turns into its own words (no text for people here): CANCELLED (the prompt closed, or "Use
 * password"), LOCKOUT (too many tries), KEY_INVALIDATED (a fingerprint was added or removed since: everything is cleared
 * and the password is asked for), NOT_AVAILABLE (no strong biometric enrolled now, or nothing kept), FAILED (anything
 * else). The prompt's texts come from the page, with the owner-approved English defaults "Sign in to TrendLIX People" and
 * "Use password".
 */
@CapacitorPlugin(name = "TrendlixBiometric")
public class TrendlixBiometricPlugin extends Plugin {

    static final String CANCELLED = "CANCELLED";
    static final String LOCKOUT = "LOCKOUT";
    static final String KEY_INVALIDATED = "KEY_INVALIDATED";
    static final String NOT_AVAILABLE = "NOT_AVAILABLE";
    static final String FAILED = "FAILED";

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "trendlix_people_fingerprint";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int KEY_SIZE = 256;
    private static final int GCM_TAG_BITS = 128;

    private static final String PREFS = "trendlix_people_fingerprint";
    private static final String PREF_ID = "id";
    private static final String PREF_CIPHERTEXT = "ciphertext";
    private static final String PREF_IV = "iv";

    /** The page's words come first; these are the owner-approved English ones (README Phase 3, 20 October 2026). */
    private static final String DEFAULT_TITLE = "Sign in to TrendLIX People";
    private static final String DEFAULT_NEGATIVE = "Use password";

    /** packages/shared device-credentials.ts DEVICE_NAME_MAX ("Samsung SM-S918B"). */
    private static final int DEVICE_NAME_MAX = 100;

    /**
     * A prompt that hasn't answered in this long is given up (CANCELLED), so one the library never showed can't block
     * the next for good.
     */
    private static final long PROMPT_STALE_MS = 120_000;

    /** What the fingerprint unlocked is used for: sealing the secret (enroll) or opening it (unlock). */
    private interface Unlocked {
        void with(Cipher cipher) throws GeneralSecurityException;
    }

    /** The enroll or unlock in progress: the prompt keeps one callback per screen, so one at a time. */
    private Answer current;
    private long currentSince;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        String reason = unavailableReason();
        JSObject result = new JSObject();
        result.put("available", reason == null);
        if (reason != null) {
            result.put("reason", reason);
        }
        result.put("deviceName", deviceName());
        call.resolve(result);
    }

    @PluginMethod
    public void isEnrolled(PluginCall call) {
        JSObject result = new JSObject();
        Kept kept = readKept();
        Boolean hasKey = null;
        if (kept != null) {
            hasKey = keyExists();
        }
        if (kept != null && Boolean.FALSE.equals(hasKey)) {
            // the key is gone (e.g. the screen lock was removed, or the preferences came back from a backup without
            // it): what is kept can never be opened
            clearAll();
        }
        if (kept != null && Boolean.TRUE.equals(hasKey)) {
            result.put("enrolled", true);
            result.put("id", kept.id);
        } else {
            result.put("enrolled", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        final String id = call.getString("id");
        final String secret = call.getString("secret");
        if (isBlank(id) || isBlank(secret)) {
            call.reject("An id and a secret are needed.", FAILED);
            return;
        }
        if (unavailableReason() != null) {
            call.reject("No strong biometric can be used on this phone now.", NOT_AVAILABLE);
            return;
        }
        final Answer answer = begin(call);
        if (answer == null) {
            return;
        }
        // one credential per phone: a new one replaces the old
        clearAll();
        SecretKey key;
        try {
            key = createKey();
        } catch (InvalidAlgorithmParameterException | IllegalStateException e) {
            // e.g. "At least one biometric must be enrolled", or no secure lock screen
            clearAll();
            answer.reject("No strong biometric can be used on this phone now.", NOT_AVAILABLE);
            return;
        } catch (GeneralSecurityException | RuntimeException e) {
            clearAll();
            answer.reject("The fingerprint key could not be made.", FAILED);
            return;
        }
        Cipher cipher;
        try {
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (GeneralSecurityException | RuntimeException e) {
            clearAll();
            answer.reject("The fingerprint key could not be used.", FAILED);
            return;
        }
        authenticate(answer, call, cipher, true, authorized -> {
            byte[] plain = secret.getBytes(StandardCharsets.UTF_8);
            byte[] sealed;
            try {
                sealed = authorized.doFinal(plain);
            } finally {
                Arrays.fill(plain, (byte) 0);
            }
            byte[] iv = authorized.getIV();
            if (iv == null || iv.length == 0) {
                throw new GeneralSecurityException("The cipher gave no IV.");
            }
            boolean saved = prefs()
                .edit()
                .putString(PREF_ID, id)
                .putString(PREF_CIPHERTEXT, Base64.encodeToString(sealed, Base64.NO_WRAP))
                .putString(PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .commit();
            if (!saved) {
                throw new IllegalStateException("The preferences could not be written.");
            }
            JSObject result = new JSObject();
            result.put("enrolled", true);
            answer.resolve(result);
        });
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        final Kept kept = readKept();
        if (kept == null) {
            call.reject("No fingerprint sign-in is kept on this phone.", NOT_AVAILABLE);
            return;
        }
        if (unavailableReason() != null) {
            call.reject("No strong biometric can be used on this phone now.", NOT_AVAILABLE);
            return;
        }
        final Answer answer = begin(call);
        if (answer == null) {
            return;
        }
        SecretKey key;
        try {
            key = loadKey();
        } catch (UnrecoverableKeyException e) {
            key = null;
        } catch (GeneralSecurityException | IOException | RuntimeException e) {
            answer.reject("The Keystore could not be read.", FAILED);
            return;
        }
        if (key == null) {
            clearAll();
            answer.reject("The fingerprint key is gone.", KEY_INVALIDATED);
            return;
        }
        Cipher cipher;
        try {
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, kept.iv));
        } catch (KeyPermanentlyInvalidatedException e) {
            // a fingerprint was added or removed since it was turned on (setInvalidatedByBiometricEnrollment)
            clearAll();
            answer.reject("The fingerprints changed since fingerprint sign-in was turned on.", KEY_INVALIDATED);
            return;
        } catch (GeneralSecurityException | RuntimeException e) {
            // e.g. a damaged IV: what is kept would fail every time
            clearAll();
            answer.reject("The fingerprint key could not be used.", FAILED);
            return;
        }
        authenticate(answer, call, cipher, false, authorized -> {
            byte[] plain = authorized.doFinal(kept.ciphertext);
            String secret = new String(plain, StandardCharsets.UTF_8);
            Arrays.fill(plain, (byte) 0);
            if (secret.isEmpty()) {
                throw new GeneralSecurityException("Nothing was kept.");
            }
            JSObject result = new JSObject();
            result.put("id", kept.id);
            result.put("secret", secret);
            answer.resolve(result);
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        clearAll();
        call.resolve(new JSObject());
    }

    /**
     * Shows the prompt (on the screen's thread) with the cipher as its CryptoObject; the fingerprint unlocks the cipher
     * and {@code unlocked} uses it. Enrolling, any refusal drops the new key (nothing half-made is kept); unlocking, a
     * closed prompt or a lockout keeps what is kept, and only a cipher that fails after the fingerprint clears it.
     */
    private void authenticate(
        final Answer answer,
        final PluginCall call,
        final Cipher cipher,
        final boolean enrolling,
        final Unlocked unlocked
    ) {
        final AppCompatActivity activity = getActivity();
        if (activity == null) {
            if (enrolling) {
                clearAll();
            }
            answer.reject("There is no screen to show the fingerprint prompt on.", FAILED);
            return;
        }
        final String title = text(call, "title", DEFAULT_TITLE);
        final String negative = text(call, "negativeButtonText", DEFAULT_NEGATIVE);
        activity.runOnUiThread(() -> {
            try {
                // the library drops a prompt it can't show (the app going to the background) without answering
                if (activity.isFinishing() || activity.getSupportFragmentManager().isStateSaved()) {
                    if (enrolling) {
                        clearAll();
                    }
                    answer.reject("The app is not on the screen.", FAILED);
                    return;
                }
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setNegativeButtonText(negative)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(false)
                    .build();
                BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            if (enrolling) {
                                clearAll();
                            }
                            String code = codeOf(errorCode);
                            answer.reject(messageOf(code), code);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // a finger not recognised: the prompt stays open and says so itself; nothing to answer yet
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                            Cipher authorized = crypto != null ? crypto.getCipher() : null;
                            if (authorized == null) {
                                if (enrolling) {
                                    clearAll();
                                }
                                answer.reject("The prompt gave no cipher back.", FAILED);
                                return;
                            }
                            try {
                                unlocked.with(authorized);
                            } catch (GeneralSecurityException | RuntimeException e) {
                                // the secret could not be sealed or opened (e.g. a damaged copy): nothing kept is any
                                // use now
                                if (!answer.answered()) {
                                    clearAll();
                                    answer.reject("The fingerprint key could not be used.", FAILED);
                                }
                            }
                        }
                    }
                );
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
            } catch (RuntimeException e) {
                if (enrolling) {
                    clearAll();
                }
                answer.reject("The fingerprint prompt could not be shown.", FAILED);
            }
        });
    }

    /** The prompt's refusal as one of the plugin's codes. */
    private static String codeOf(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_CANCELED:
                return CANCELLED;
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return LOCKOUT;
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return NOT_AVAILABLE;
            default:
                return FAILED;
        }
    }

    /** Plain English for the log and the developer; the page words the code itself. */
    private static String messageOf(String code) {
        switch (code) {
            case CANCELLED:
                return "The fingerprint prompt was closed.";
            case LOCKOUT:
                return "Too many tries: the fingerprint is locked for now.";
            case NOT_AVAILABLE:
                return "No strong biometric can be used on this phone now.";
            default:
                return "The fingerprint could not be checked.";
        }
    }

    /** Why a strong biometric can't be used now, or null when it can. */
    private String unavailableReason() {
        BiometricManager manager = BiometricManager.from(getContext());
        int strong = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (strong == BiometricManager.BIOMETRIC_SUCCESS) {
            return null;
        }
        // a weak one only (e.g. a Class 2 face unlock): it can't unlock a Keystore key
        if (manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS) {
            return "WEAK_ONLY";
        }
        switch (strong) {
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "NONE_ENROLLED";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "NO_HARDWARE";
            default:
                // HW_UNAVAILABLE, SECURITY_UPDATE_REQUIRED, UNSUPPORTED, STATUS_UNKNOWN
                return "UNAVAILABLE";
        }
    }

    /**
     * The phone's name for the person's list of phones: the maker, capitalised, and the model, the maker once (e.g.
     * "Google Pixel 8", "Samsung SM-S918B", "OnePlus 9"); trimmed, at most 100 characters.
     */
    static String deviceName() {
        String manufacturer = clean(Build.MANUFACTURER);
        String model = clean(Build.MODEL);
        if (!manufacturer.isEmpty()) {
            manufacturer = Character.toUpperCase(manufacturer.charAt(0)) + manufacturer.substring(1);
        }
        String name;
        if (model.isEmpty()) {
            name = manufacturer;
        } else if (manufacturer.isEmpty()) {
            name = model;
        } else if (model.regionMatches(true, 0, manufacturer, 0, manufacturer.length())) {
            name = manufacturer + model.substring(manufacturer.length());
        } else {
            name = manufacturer + " " + model;
        }
        if (name.length() > DEVICE_NAME_MAX) {
            name = name.substring(0, DEVICE_NAME_MAX).trim();
        }
        return name.isEmpty() ? "Android" : name;
    }

    /** Control characters dropped, spaces collapsed, trimmed (as packages/shared deviceNameOf does). */
    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
    }

    /** A text the page passed, or the default. */
    private static String text(PluginCall call, String key, String fallback) {
        String value = call.getString(key);
        return isBlank(value) ? fallback : value.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /**
     * A fresh AES-256-GCM key in the Keystore that needs a strong biometric for every use and is lost when a
     * fingerprint is added or removed. Before Android 11 the default (no time allowance: every use needs a
     * CryptoObject, which only a strong biometric unlocks).
     */
    private static SecretKey createKey() throws GeneralSecurityException {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_SIZE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        return generator.generateKey();
    }

    /** The key, or null when it isn't there. */
    private static SecretKey loadKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        Key key = keyStore.getKey(KEY_ALIAS, null);
        return key instanceof SecretKey ? (SecretKey) key : null;
    }

    /** Whether the key is in the Keystore; null when the Keystore can't be read (nothing is cleared then). */
    private static Boolean keyExists() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            return keyStore.containsAlias(KEY_ALIAS);
        } catch (GeneralSecurityException | IOException | RuntimeException e) {
            return null;
        }
    }

    /** The key and what is kept, deleted. Never fails. */
    private void clearAll() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        } catch (GeneralSecurityException | IOException | RuntimeException e) {
            // nothing there, or the Keystore can't be read: what is kept goes all the same
        }
        try {
            prefs().edit().clear().commit();
        } catch (RuntimeException e) {
            // nothing more to do
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** What is kept, or null when nothing whole is (a part, or a damaged copy, is cleared). */
    private Kept readKept() {
        SharedPreferences prefs = prefs();
        String id = prefs.getString(PREF_ID, null);
        String ciphertext = prefs.getString(PREF_CIPHERTEXT, null);
        String iv = prefs.getString(PREF_IV, null);
        if (isBlank(id) && isBlank(ciphertext) && isBlank(iv)) {
            return null;
        }
        if (!isBlank(id) && !isBlank(ciphertext) && !isBlank(iv)) {
            try {
                byte[] sealed = Base64.decode(ciphertext, Base64.NO_WRAP);
                byte[] nonce = Base64.decode(iv, Base64.NO_WRAP);
                if (sealed.length > 0 && nonce.length > 0) {
                    return new Kept(id, sealed, nonce);
                }
            } catch (IllegalArgumentException e) {
                // not Base64: damaged
            }
        }
        clearAll();
        return null;
    }

    /** Takes the call as the one in progress, or refuses it (FAILED) while another prompt is open. */
    private synchronized Answer begin(PluginCall call) {
        long now = SystemClock.elapsedRealtime();
        if (current != null) {
            if (now - currentSince < PROMPT_STALE_MS) {
                call.reject("A fingerprint prompt is already open.", FAILED);
                return null;
            }
            Answer stale = current;
            current = null;
            stale.reject("The fingerprint prompt never answered.", CANCELLED);
        }
        current = new Answer(call);
        currentSince = now;
        return current;
    }

    private synchronized void end(Answer answer) {
        if (current == answer) {
            current = null;
        }
    }

    /** The ciphertext, its IV and the credential's id (not secret), as kept in the preferences. */
    private static final class Kept {

        final String id;
        final byte[] ciphertext;
        final byte[] iv;

        Kept(String id, byte[] ciphertext, byte[] iv) {
            this.id = id;
            this.ciphertext = ciphertext;
            this.iv = iv;
        }
    }

    /** A call answered once only, whichever of the prompt's callbacks comes first. */
    private final class Answer {

        private final PluginCall call;
        private final AtomicBoolean done = new AtomicBoolean(false);

        Answer(PluginCall call) {
            this.call = call;
        }

        boolean answered() {
            return done.get();
        }

        void resolve(JSObject result) {
            if (finish()) {
                call.resolve(result);
            }
        }

        void reject(String message, String code) {
            if (finish()) {
                call.reject(message, code);
            }
        }

        private boolean finish() {
            if (!done.compareAndSet(false, true)) {
                return false;
            }
            end(this);
            return true;
        }
    }
}
