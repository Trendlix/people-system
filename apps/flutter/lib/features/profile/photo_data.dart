import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../api/people_client.dart';
import '../../providers.dart';
import 'profile_parts.dart';

// One's own picture and the new one sent to HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"): read from People with the session as any call is (the app's own client, which knows
// People's certificate), and shown round, with the square HR chose to show the face bigger, as the website does.

/// The personal photo in one's employee file (GET /api/paperwork/:id/photo: one's own only).
String ownPhotoPath(String photoId) => '/api/paperwork/${Uri.encodeComponent(photoId)}/photo';

/// A photo one sent HR (GET /api/photo-requests/:id/photo).
String sentPhotoPath(String requestId) => '/api/photo-requests/${Uri.encodeComponent(requestId)}/photo';

/// GET of a picture, which People's client doesn't have (it reads JSON): sent the same way (the app's user agent, the
/// session as a bearer), its refusals in People's words, a refused session signing the app out.
extension PeopleBytes on PeopleClient {
  Future<Uint8List> getBytes(String path) async {
    final t = token == null ? null : await token!();
    final sentSession = t != null && t.isNotEmpty;
    final request = http.Request('GET', Uri.parse('$baseUrl$path'))
      ..headers.addAll({'accept': 'image/*', 'user-agent': userAgent, if (sentSession) 'authorization': 'Bearer $t'});
    http.Response res;
    try {
      res = await http.Response.fromStream(await httpClient.send(request).timeout(timeout));
    } on TimeoutException {
      throw ApiException(0, const [PeopleClient.unreachableText]);
    } on Exception {
      throw ApiException(0, const [PeopleClient.unreachableText]);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode == 401 && sentSession) onSessionEnded?.call();
      throw ApiException(res.statusCode, PeopleClient.messagesOf(res.statusCode, res.body));
    }
    return res.bodyBytes;
  }
}

/// A picture from People, by its path; kept while something shows it.
final pictureProvider = FutureProvider.autoDispose.family<Uint8List, String>((ref, path) => ref.read(peopleClientProvider).getBytes(path));

/// The square of a photo shown in the circle, as fractions of it (packages/shared photo-crop.ts PhotoCrop).
typedef PhotoSquare = ({double x, double y, double w, double h});

/// A round picture from People ([path]), the initials under it while it loads or when it can't be; with [crop], exactly
/// that square of it, else the whole photo, centred.
class RoundPicture extends ConsumerWidget {
  const RoundPicture({super.key, required this.path, required this.name, required this.size, required this.fill, required this.ink, required this.fontSize, this.crop, this.label});

  final String? path;
  final String name;
  final double size;
  final Color fill;
  final Color ink;
  final double fontSize;
  final PhotoSquare? crop;

  /// What a screen reader says of it; the name by default.
  final String? label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initials = InitialsCircle(name: name, size: size, fill: fill, ink: ink, fontSize: fontSize);
    final where = path;
    if (where == null) return initials;
    final bytes = ref.watch(pictureProvider(where)).value;
    if (bytes == null) return initials;
    final c = crop;
    final Widget picture = c == null
        ? Image.memory(bytes, width: size, height: size, fit: BoxFit.cover, gaplessPlayback: true, errorBuilder: (_, _, _) => initials)
        : Stack(
            children: [
              // the square chosen fills the circle: the photo drawn 1/w of the circle wide and 1/h high, moved by x and y
              Positioned(
                left: -c.x * size / c.w,
                top: -c.y * size / c.h,
                width: size / c.w,
                height: size / c.h,
                child: Image.memory(bytes, fit: BoxFit.fill, gaplessPlayback: true, errorBuilder: (_, _, _) => initials),
              ),
            ],
          );
    return Semantics(
      image: true,
      label: label ?? name,
      excludeSemantics: true,
      child: ClipOval(child: SizedBox(width: size, height: size, child: picture)),
    );
  }
}
