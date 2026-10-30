import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:people/config.dart';

// Where the app finds People (README §2): the address and the private authority given at build time.

const _pem = '-----BEGIN CERTIFICATE-----\nMIIBmade+up+for+the+tests==\n-----END CERTIFICATE-----\n';

void main() {
  test('takes the address without its trailing slash, the live server when none is given', () {
    expect(AppConfig.parse(apiUrl: 'https://people.example.test:8443/', caBase64: '', version: '').apiUrl, 'https://people.example.test:8443');
    expect(AppConfig.parse(apiUrl: '  ', caBase64: '', version: '').apiUrl, 'https://srv2055591.hstgr.cloud:8443');
  });

  test('reads the root as ca-cert.sh prints it (base64 on one line), or its PEM; nothing else', () {
    expect(AppConfig.pemOf(base64.encode(utf8.encode(_pem))), _pem);
    expect(AppConfig.pemOf(_pem), _pem.trim());
    expect(AppConfig.pemOf(''), isNull);
    expect(AppConfig.pemOf('not base64 !!'), isNull);
    expect(AppConfig.pemOf(base64.encode(utf8.encode('just some text'))), isNull);
  });

  test('names a version, 0.0.0 when the build gave none', () {
    expect(AppConfig.parse(apiUrl: '', caBase64: '', version: '0.2.14').version, '0.2.14');
    expect(AppConfig.parse(apiUrl: '', caBase64: '', version: '').version, '0.0.0');
  });
}
