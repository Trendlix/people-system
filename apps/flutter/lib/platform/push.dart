import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

// Push notifications on the phone (owner, 8 November 2026: "notifications are not working correctly, and when there is a
// pending request make it to popup in the mobile app and gives a push notification once requested"). People already
// pushes each notification through Firebase Cloud Messaging to the phones registered for it (apps/api notifications,
// push_devices); the Flutter app, since 30 October, never registered one. This is the phone's side: Firebase started
// with this build's settings, the phone's permission asked, its token, and the pushes as they come (while the app is
// open, or tapped).
//
// Firebase's settings come with the build (CI, .github/workflows/flutter-android.yml): on Android from the secret
// GOOGLE_SERVICES_JSON (written as the app's resources, so Android starts Firebase itself, and named to the app with
// PEOPLE_PUSH=on); on an iPhone from the secret GOOGLE_SERVICE_INFO_PLIST, given as FIREBASE_IOS_API_KEY, _APP_ID,
// _SENDER_ID and _PROJECT_ID. A build without them has no push (NoPush): the bell and the popups still work.

/// A push as the app reads it: its inbox row, what it is about, where it opens on the website, and its words.
class PushMessage {
  const PushMessage({required this.id, required this.kind, required this.link, required this.title, required this.body});

  /// From what People sends (apps/api fcm.ts fcmMessage): `data` { id, kind, link }, `notification` { title, body }.
  factory PushMessage.of(Map<String, Object?> data, {String? title, String? body}) => PushMessage(
    id: _text(data['id']),
    kind: _text(data['kind']),
    link: _text(data['link']),
    title: title ?? '',
    body: body ?? '',
  );

  /// The notification's inbox row (marked read once opened).
  final String id;
  final String kind;
  final String link;
  final String title;
  final String body;

  static String _text(Object? v) => v is String ? v : (v == null ? '' : '$v');
}

/// Whether the phone lets the app show notifications.
enum PushPermission { allowed, denied, notAsked }

/// Firebase's settings for an iPhone build; empty when the build has none.
class FirebaseSettings {
  const FirebaseSettings({this.apiKey = '', this.appId = '', this.senderId = '', this.projectId = '', this.android = false});

  factory FirebaseSettings.fromEnvironment() => const FirebaseSettings(
    apiKey: String.fromEnvironment('FIREBASE_IOS_API_KEY'),
    appId: String.fromEnvironment('FIREBASE_IOS_APP_ID'),
    senderId: String.fromEnvironment('FIREBASE_IOS_SENDER_ID'),
    projectId: String.fromEnvironment('FIREBASE_IOS_PROJECT_ID'),
    android: String.fromEnvironment('PEOPLE_PUSH') == 'on',
  );

  final String apiKey;
  final String appId;
  final String senderId;
  final String projectId;

  /// An Android build with Firebase's resources in it (CI: PEOPLE_PUSH=on).
  final bool android;

  bool get _ios => apiKey.isNotEmpty && appId.isNotEmpty && senderId.isNotEmpty && projectId.isNotEmpty;

  /// Whether this build can get pushes on [platform].
  bool readyOn(TargetPlatform platform) => switch (platform) {
    TargetPlatform.android => android,
    TargetPlatform.iOS => _ios,
    _ => false,
  };

  FirebaseOptions get iosOptions => FirebaseOptions(apiKey: apiKey, appId: appId, messagingSenderId: senderId, projectId: projectId, iosBundleId: 'com.trendlix.people');
}

/// The phone's push notifications.
abstract class Push {
  /// Whether this build gets pushes at all (Firebase set up in it).
  bool get available;

  /// 'android' or 'ios', as People keeps it (packages/shared PUSH_PLATFORMS).
  String get platform;

  /// Starts Firebase, once. False: no push in this build, or Firebase didn't start.
  Future<bool> start();

  /// Asks the phone, the first time (later it answers without asking).
  Future<PushPermission> ask();

  /// The phone's token for People to push to; null when there is none (yet).
  Future<String?> token();

  /// A new token, when Firebase gives the phone one.
  Stream<String> get tokenChanges;

  /// A push that came while the app was open (the phone shows nothing then: the app does).
  Stream<PushMessage> get received;

  /// A push tapped while the app was in the background.
  Stream<PushMessage> get opened;

  /// The push tapped to open the app, once.
  Future<PushMessage?> launchedWith();

  /// Signing out: the phone's token dropped, so nothing more comes to it.
  Future<void> forget();
}

/// No push: a build without Firebase, and the tests.
class NoPush implements Push {
  const NoPush();

  @override
  bool get available => false;

  @override
  String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  @override
  Future<bool> start() async => false;

  @override
  Future<PushPermission> ask() async => PushPermission.notAsked;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get tokenChanges => const Stream.empty();

  @override
  Stream<PushMessage> get received => const Stream.empty();

  @override
  Stream<PushMessage> get opened => const Stream.empty();

  @override
  Future<PushMessage?> launchedWith() async => null;

  @override
  Future<void> forget() async {}
}

/// Firebase Cloud Messaging.
class FirebasePush implements Push {
  FirebasePush(this.settings);

  final FirebaseSettings settings;
  Future<bool>? _started;

  FirebaseMessaging get _fcm => FirebaseMessaging.instance;

  static PushMessage _of(RemoteMessage m) => PushMessage.of(m.data, title: m.notification?.title, body: m.notification?.body);

  @override
  bool get available => true;

  @override
  String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  @override
  Future<bool> start() => _started ??= _start();

  Future<bool> _start() async {
    try {
      // Android starts Firebase from the app's resources; an iPhone from the build's settings
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        await Firebase.initializeApp(options: settings.iosOptions);
      } else {
        await Firebase.initializeApp();
      }
      // while the app is open the app shows it (a popup or a message), not the phone
      await _fcm.setForegroundNotificationPresentationOptions(alert: false, badge: true, sound: false);
      return true;
    } catch (e) {
      debugPrint('Push: Firebase did not start: $e');
      return false;
    }
  }

  @override
  Future<PushPermission> ask() async {
    if (!await start()) return PushPermission.notAsked;
    try {
      final s = await _fcm.requestPermission();
      return switch (s.authorizationStatus) {
        AuthorizationStatus.authorized || AuthorizationStatus.provisional => PushPermission.allowed,
        AuthorizationStatus.denied || AuthorizationStatus.deniedPermanently => PushPermission.denied,
        AuthorizationStatus.notDetermined => PushPermission.notAsked,
      };
    } catch (e) {
      debugPrint('Push: permission not asked: $e');
      return PushPermission.notAsked;
    }
  }

  @override
  Future<String?> token() async {
    if (!await start()) return null;
    try {
      // an iPhone has a Firebase token only once Apple gave it its own: a moment after the start
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        for (var i = 0; i < 10 && await _fcm.getAPNSToken() == null; i++) {
          await Future<void>.delayed(const Duration(seconds: 1));
        }
        if (await _fcm.getAPNSToken() == null) return null;
      }
      // the registration token People sends to (apps/api fcm.ts: message.token); firebase_messaging 17's register()
      // gives the installation's id instead, which People doesn't send to
      // ignore: deprecated_member_use
      final t = await _fcm.getToken();
      return t == null || t.isEmpty ? null : t;
    } catch (e) {
      debugPrint('Push: no token: $e');
      return null;
    }
  }

  @override
  // ignore: deprecated_member_use
  Stream<String> get tokenChanges => _fcm.onTokenRefresh;

  @override
  Stream<PushMessage> get received => FirebaseMessaging.onMessage.map(_of);

  @override
  Stream<PushMessage> get opened => FirebaseMessaging.onMessageOpenedApp.map(_of);

  @override
  Future<PushMessage?> launchedWith() async {
    if (!await start()) return null;
    try {
      final m = await _fcm.getInitialMessage();
      return m == null ? null : _of(m);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> forget() async {
    if (!await start()) return;
    try {
      // ignore: deprecated_member_use
      await _fcm.deleteToken();
    } catch (e) {
      debugPrint('Push: token not dropped: $e');
    }
  }
}

/// This build's push: Firebase's when it was built with its settings, else none.
Push pushForThisBuild() {
  final settings = FirebaseSettings.fromEnvironment();
  return settings.readyOn(defaultTargetPlatform) ? FirebasePush(settings) : const NoPush();
}
