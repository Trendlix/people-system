import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// The HTTP client for People's API (README §2): with People's private authority given, it trusts that root and nothing
/// else (the client is used for People's address only); without one, the phone's own authorities.
http.Client peopleHttpClient(String? caPem) {
  final context = SecurityContext(withTrustedRoots: caPem == null);
  if (caPem != null) context.setTrustedCertificatesBytes(utf8.encode(caPem));
  final client = HttpClient(context: context)..connectionTimeout = const Duration(seconds: 15);
  return IOClient(client);
}
