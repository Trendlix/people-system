#!/usr/bin/env python3
"""The App Store signing for Trendlix People's iPhone app (docs/app-store.md; owner, 7 November 2026: "my apple developer
account is ready", asked, "Unlisted App Store page").

With an App Store Connect API key (Admin), it:
  1. registers the app's identifier, com.trendlix.people, when Apple doesn't have it yet;
  2. makes an Apple Distribution certificate (its private key is made here and never leaves this Mac but in the files below);
  3. makes the App Store provisioning profile "Trendlix People App Store" for them (a profile of that name is replaced);
  4. packs the certificate, the profile and the API key into one line for the GitHub secret APPLE_SIGNING_BASE64, which the
     iPhone build (.github/workflows/flutter-android.yml, job "iphone") signs and uploads with.

Run it again when the certificate ends (a year later; README.txt in the folder says when), then replace the secret.
Only Python's standard library and the Mac's openssl. It never prints a secret.

  python3 apps/flutter/tool/apple_signing.py --key-id ABCD123456 --issuer-id 00000000-0000-0000-0000-000000000000 \\
      --key ~/TrendLIX-Apple-Signing/AuthKey_ABCD123456.p8 --out ~/TrendLIX-Apple-Signing
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import secrets
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BUNDLE_ID = 'com.trendlix.people'
APP_NAME = 'Trendlix People'
PROFILE_NAME = 'Trendlix People App Store'
API = 'https://api.appstoreconnect.apple.com'


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def der_to_raw(der: bytes) -> bytes:
    """An ECDSA signature as openssl writes it (DER: SEQUENCE of the INTEGERs r and s) as JWT's ES256 wants it (r ‖ s,
    32 bytes each)."""

    def length(at: int) -> tuple[int, int]:
        first = der[at]
        if first < 0x80:
            return first, at + 1
        n = first & 0x7F
        return int.from_bytes(der[at + 1 : at + 1 + n], 'big'), at + 1 + n

    if der[0] != 0x30:
        raise ValueError('not a DER sequence')
    _, at = length(1)
    out = b''
    for _ in range(2):
        if der[at] != 0x02:
            raise ValueError('not a DER integer')
        n, at = length(at + 1)
        value = der[at : at + n].lstrip(b'\x00')
        if len(value) > 32:
            raise ValueError('integer too long for P-256')
        out += value.rjust(32, b'\x00')
        at += n
    return out


def token(key_id: str, issuer_id: str, key: Path) -> str:
    """A 20-minute App Store Connect token, signed with the API key (ES256)."""
    now = int(time.time())
    header = b64url(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    payload = b64url(json.dumps({'iss': issuer_id, 'iat': now, 'exp': now + 1200, 'aud': 'appstoreconnect-v1'}).encode())
    signing_input = f'{header}.{payload}'.encode()
    der = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)], input=signing_input, capture_output=True, check=True).stdout
    return f'{header}.{payload}.{b64url(der_to_raw(der))}'


class Apple:
    def __init__(self, key_id: str, issuer_id: str, key: Path):
        self.jwt = token(key_id, issuer_id, key)

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            API + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': f'Bearer {self.jwt}', 'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')
            try:
                errors = json.loads(detail).get('errors', [])
                detail = '; '.join(f"{x.get('title', '')}: {x.get('detail', '')}" for x in errors) or detail
            except ValueError:
                pass
            sys.exit(f'Apple refused {method} {path.split("?")[0]} ({e.code}): {detail}')


def run(*args: str, stdin: bytes | None = None) -> bytes:
    return subprocess.run(list(args), input=stdin, capture_output=True, check=True).stdout


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--key-id', required=True, help="the API key's Key ID (App Store Connect -> Users and Access -> Integrations)")
    p.add_argument('--issuer-id', required=True, help='the Issuer ID shown above the keys')
    p.add_argument('--key', required=True, type=Path, help='the AuthKey_<Key ID>.p8 file')
    p.add_argument('--out', required=True, type=Path, help='the private folder the files go to')
    a = p.parse_args()
    key = a.key.expanduser()
    out = a.out.expanduser()
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    apple = Apple(a.key_id, a.issuer_id, key)

    # 1. the app's identifier
    found = apple.call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE_ID}&limit=200')['data']
    bundle = next((b for b in found if b['attributes']['identifier'] == BUNDLE_ID), None)
    if bundle is None:
        bundle = apple.call('POST', '/v1/bundleIds', {'data': {'type': 'bundleIds', 'attributes': {'identifier': BUNDLE_ID, 'name': APP_NAME, 'platform': 'IOS'}}})['data']
        print(f'Registered the identifier {BUNDLE_ID}.')
    else:
        print(f'The identifier {BUNDLE_ID} was already registered.')

    # 2. an Apple Distribution certificate, its private key made here
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        run('openssl', 'genrsa', '-out', str(t / 'key.pem'), '2048')
        csr = run('openssl', 'req', '-new', '-key', str(t / 'key.pem'), '-subj', '/CN=Trendlix People CI/O=Trendlix/C=EG').decode()
        cert = apple.call('POST', '/v1/certificates', {'data': {'type': 'certificates', 'attributes': {'certificateType': 'DISTRIBUTION', 'csrContent': csr}}})['data']
        (t / 'cert.der').write_bytes(base64.b64decode(cert['attributes']['certificateContent']))
        run('openssl', 'x509', '-inform', 'DER', '-in', str(t / 'cert.der'), '-out', str(t / 'cert.pem'))
        subject = run('openssl', 'x509', '-in', str(t / 'cert.pem'), '-noout', '-subject').decode()
        team = next((part.split('=', 1)[1].strip() for part in subject.replace('/', ',').split(',') if part.strip().startswith('OU')), '')
        if not team:
            sys.exit("The certificate doesn't name the team (OU); nothing was written.")
        expires = cert['attributes'].get('expirationDate', '')[:10]
        password = secrets.token_urlsafe(24)
        legacy = ['-legacy'] if run('openssl', 'version').startswith(b'OpenSSL 3') else []
        run('openssl', 'pkcs12', '-export', *legacy, '-inkey', str(t / 'key.pem'), '-in', str(t / 'cert.pem'), '-name', 'Apple Distribution', '-out', str(t / 'cert.p12'), '-passout', f'pass:{password}')
        p12 = (t / 'cert.p12').read_bytes()
    print(f'Made an Apple Distribution certificate for team {team}, until {expires}.')

    # 3. the App Store profile (one of the same name is replaced: it would name the old certificate)
    for old in apple.call('GET', f'/v1/profiles?filter[name]={urllib.parse.quote(PROFILE_NAME)}&limit=200')['data']:
        if old['attributes']['name'] == PROFILE_NAME:
            apple.call('DELETE', f"/v1/profiles/{old['id']}")
    profile = apple.call('POST', '/v1/profiles', {
        'data': {
            'type': 'profiles',
            'attributes': {'name': PROFILE_NAME, 'profileType': 'IOS_APP_STORE'},
            'relationships': {
                'bundleId': {'data': {'type': 'bundleIds', 'id': bundle['id']}},
                'certificates': {'data': [{'type': 'certificates', 'id': cert['id']}]},
            },
        },
    })['data']
    print(f'Made the profile "{PROFILE_NAME}".')

    # 4. the files, and the GitHub secret: one .tar.gz, base64 on one line
    env = '\n'.join([
        f'TEAM_ID={team}',
        f'KEY_ID={a.key_id}',
        f'ISSUER_ID={a.issuer_id}',
        f'BUNDLE_ID={BUNDLE_ID}',
        f'PROFILE_NAME={PROFILE_NAME}',
        f'P12_PASSWORD={password}',
        f'CERT_EXPIRES={expires}',
        '',
    ])
    files = {
        'cert.p12': p12,
        'profile.mobileprovision': base64.b64decode(profile['attributes']['profileContent']),
        'AuthKey.p8': key.read_bytes(),
        'signing.env': env.encode(),
    }
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode='w:gz') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(data))
    for name, data in files.items():
        if name != 'AuthKey.p8':
            (out / name).write_bytes(data)
            os.chmod(out / name, 0o600)
    secret = base64.b64encode(packed.getvalue()).decode()
    (out / 'github-secret-APPLE_SIGNING_BASE64.txt').write_text(secret + '\n')
    os.chmod(out / 'github-secret-APPLE_SIGNING_BASE64.txt', 0o600)
    (out / 'README.txt').write_text(f"""TRENDLIX PEOPLE - APP STORE SIGNING  (made {time.strftime('%d %B %Y')})
==================================================================

Keep this folder private. With these files anyone can upload iPhone app versions as Trendlix.

FILES
  AuthKey_{a.key_id}.p8                  The App Store Connect API key (Key ID {a.key_id}). Apple lets you download it only once.
  cert.p12                               The Apple Distribution certificate with its private key (team {team}).
  signing.env                            The IDs, and the certificate's password (P12_PASSWORD).
  profile.mobileprovision                The App Store profile "{PROFILE_NAME}" for {BUNDLE_ID}.
  github-secret-APPLE_SIGNING_BASE64.txt All of the above in one line, for GitHub.

STEP 1 - ADD ONE SECRET TO GITHUB
  GitHub -> Trendlix/people-system -> Settings -> Secrets and variables -> Actions -> New repository secret
    Name: APPLE_SIGNING_BASE64   Value: everything in github-secret-APPLE_SIGNING_BASE64.txt
  From then on every app build also makes the iPhone app and uploads it to App Store Connect (TestFlight).

STEP 2 - BACK IT UP
  Copy this whole folder to the company's password manager or another safe place.

RENEWING
  The certificate ends on {expires}. Before then, run apps/flutter/tool/apple_signing.py again (docs/app-store.md)
  and replace the GitHub secret.
""")
    print(f'Wrote the files and the GitHub secret to {out} (README.txt says what to do).')


if __name__ == '__main__':
    main()
