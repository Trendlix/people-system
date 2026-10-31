import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Why there is no spot to check in with. Inside the app People needs one (apps/api check-in.service.ts: "App only").
enum LocationProblem { serviceOff, denied, deniedForever, timeout, unavailable }

/// Where the phone is, read at the press and never tracked (README Phase 1): the point, its accuracy in metres, and
/// whether Android said it is a mock one (fake GPS: kept and flagged by People, never refused here).
typedef Spot = ({double latitude, double longitude, double accuracy, bool mock});

/// A spot, or why there is none.
typedef LocationRead = ({Spot? spot, LocationProblem? problem});

abstract interface class Locator {
  Future<LocationRead> read();

  /// Whether the app can read the location now, without asking anything: null when it can, else why not (the phone's
  /// switch off, not allowed, refused for good). For the app's gate (owner, 31 October 2026: "app has to be location
  /// enabled to work").
  Future<LocationProblem?> readiness();

  /// Asks the phone to allow the app's location (the permission prompt), then says what is still missing; null: ready.
  Future<LocationProblem?> ask();

  /// The app's own settings page (to allow location after "Don't ask again").
  Future<void> openAppSettings();

  /// The phone's location switch.
  Future<void> openLocationSettings();
}

class DeviceLocator implements Locator {
  const DeviceLocator();

  static const _limit = Duration(seconds: 20);

  @override
  Future<LocationRead> read() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return (spot: null, problem: LocationProblem.serviceOff);
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.deniedForever) return (spot: null, problem: LocationProblem.deniedForever);
      if (permission == LocationPermission.denied || permission == LocationPermission.unableToDetermine) {
        return (spot: null, problem: LocationProblem.denied);
      }
      final settings = defaultTargetPlatform == TargetPlatform.android
          ? AndroidSettings(accuracy: LocationAccuracy.high, timeLimit: _limit)
          : const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: _limit);
      final p = await Geolocator.getCurrentPosition(locationSettings: settings);
      return (spot: (latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, mock: p.isMocked), problem: null);
    } on TimeoutException {
      return (spot: null, problem: LocationProblem.timeout);
    } on LocationServiceDisabledException {
      return (spot: null, problem: LocationProblem.serviceOff);
    } on PermissionDeniedException {
      return (spot: null, problem: LocationProblem.denied);
    } on Exception {
      return (spot: null, problem: LocationProblem.unavailable);
    }
  }

  @override
  Future<LocationProblem?> readiness() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationProblem.serviceOff;
      return _problemOf(await Geolocator.checkPermission());
    } on Exception {
      return LocationProblem.unavailable;
    }
  }

  @override
  Future<LocationProblem?> ask() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationProblem.serviceOff;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      return _problemOf(permission);
    } on Exception {
      return LocationProblem.unavailable;
    }
  }

  static LocationProblem? _problemOf(LocationPermission permission) => switch (permission) {
    LocationPermission.deniedForever => LocationProblem.deniedForever,
    LocationPermission.denied || LocationPermission.unableToDetermine => LocationProblem.denied,
    _ => null,
  };

  @override
  Future<void> openAppSettings() => Geolocator.openAppSettings();

  @override
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}
