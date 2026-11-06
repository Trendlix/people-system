plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.trendlix.people"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // the old app's identity (apps/mobile), so this one installs over it
        applicationId = "com.trendlix.people"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // The keys a release is signed with. For Google Play (owner, 6 November 2026: "now i have google play console"): the
    // upload key at PLAY_UPLOAD_KEYSTORE, its password PLAY_UPLOAD_PASSWORD (flutter-android.yml, from the secrets
    // PLAY_UPLOAD_KEYSTORE_BASE64 and PLAY_UPLOAD_PASSWORD; a PKCS12 keystore, alias "upload"): Play checks the bundle
    // with it and signs the app with its own key. Else the website APK's one key (owner, 2 November 2026: "if it is not
    // applicable skip it"): in CI the keystore at PEOPLE_KEYSTORE, so each APK installs over the last; a build on a Mac
    // signs with its own debug key.
    signingConfigs {
        val upload = System.getenv("PLAY_UPLOAD_KEYSTORE")?.takeIf { it.isNotBlank() }
        val uploadPassword = System.getenv("PLAY_UPLOAD_PASSWORD")?.takeIf { it.isNotBlank() }
        if (upload != null && uploadPassword != null) {
            create("play") {
                storeFile = file(upload)
                storeType = "PKCS12"
                storePassword = uploadPassword
                keyAlias = "upload"
                keyPassword = uploadPassword
            }
        }
        System.getenv("PEOPLE_KEYSTORE")?.takeIf { it.isNotBlank() }?.let { path ->
            create("people") {
                storeFile = file(path)
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("play") ?: signingConfigs.findByName("people") ?: signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // the AppCompat theme the fingerprint prompt needs (values/styles.xml)
    implementation("androidx.appcompat:appcompat:1.7.1")
}
