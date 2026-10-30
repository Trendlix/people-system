import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

/// The phone as People lists it under Your Sessions (e.g. "Samsung SM-S918B"), and its platform as People names it.
abstract interface class DeviceIdentity {
  Future<String> name();

  /// 'android' or 'ios' (packages/shared device-credentials.ts `DEVICE_PLATFORMS`).
  String get platform;
}

class PhoneIdentity implements DeviceIdentity {
  PhoneIdentity([DeviceInfoPlugin? info]) : _info = info ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _info;

  @override
  String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  @override
  Future<String> name() async {
    try {
      if (platform == 'ios') return (await _info.iosInfo).name;
      final a = await _info.androidInfo;
      return phoneName(a.manufacturer, a.model);
    } on Exception {
      // People names it by the platform when the name is empty
      return '';
    }
  }
}

/// "samsung", "SM-S918B" → "Samsung SM-S918B"; the maker once when the model already starts with it.
String phoneName(String manufacturer, String model) {
  final maker = manufacturer.trim();
  final m = model.trim();
  if (maker.isEmpty) return m;
  final shown = maker[0].toUpperCase() + maker.substring(1);
  if (m.toLowerCase().startsWith(maker.toLowerCase())) return m;
  return m.isEmpty ? shown : '$shown $m';
}
