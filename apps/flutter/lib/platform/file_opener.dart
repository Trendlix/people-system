import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// A file People gives the app, opened in the phone's own viewer to read and print (owner, 31 October 2026: "on the
// resignation, the letter is auto generated, viewed by the employee but uploaded by the HR"): the app reads it from
// People with its session, which never goes in a link (the phone's browser doesn't trust People's private authority
// either), and hands the bytes to the Android side (MainActivity.kt), which keeps the last one only in the app's cache
// and lets a viewer read it through a content link. No package: url_launcher can't open the app's own files.

/// Opens a file's bytes in the phone's viewer for its type, under [name]: false when no app on the phone opens it (or
/// not on Android).
typedef FileOpener = Future<bool> Function(Uint8List bytes, String name, String mimeType);

const _files = MethodChannel('people/files');

/// The phone's viewer, through MainActivity.kt.
Future<bool> openOnPhone(Uint8List bytes, String name, String mimeType) async {
  try {
    return await _files.invokeMethod<bool>('open', {'bytes': bytes, 'name': name, 'mimeType': mimeType}) ?? false;
  } on PlatformException {
    return false;
  } on MissingPluginException {
    return false;
  }
}

/// Replaced in the tests.
final fileOpenerProvider = Provider<FileOpener>((ref) => openOnPhone);
