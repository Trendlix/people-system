#!/usr/bin/env python3
"""The App Store profile with Push Notifications (owner, 8 November 2026: "when there is a pending request make it to
popup in the mobile app and gives a push notification once requested"; docs/app-store.md).

  push   once, on the owner's Mac, with the App Store Connect API key: turns on Push Notifications for
         com.trendlix.people and makes the profile "Trendlix People App Store" again for the same certificate (a profile
         carries what its identifier could do when it was made: the one before had no push). Writes it to the private
         folder (profile.mobileprovision) and packs the folder's GitHub secret file again with it.
  fetch  in CI (job "iphone"): the profile of that name as Apple has it now, so a profile made again reaches the build
         without replacing the GitHub secret. Apple unreachable: it says so and the build keeps the one in the secret.

Only Python's standard library and openssl (apple_signing.py's Apple). It never prints a secret.

  python3 apps/flutter/tool/apple_profile.py push --folder ~/TrendLIX-Apple-Signing
  python3 apps/flutter/tool/apple_profile.py fetch --key-id K --issuer-id I --key AuthKey.p8 --out profile.mobileprovision
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import sys
import tarfile
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apple_signing import BUNDLE_ID, PROFILE_NAME, Apple, enable_push  # noqa: E402


def bundle_of(apple: Apple) -> dict:
    found = apple.call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE_ID}&limit=200')['data']
    bundle = next((b for b in found if b['attributes']['identifier'] == BUNDLE_ID), None)
    if bundle is None:
        sys.exit(f'Apple has no identifier {BUNDLE_ID}: run apple_signing.py first.')
    return bundle


def profiles_named(apple: Apple) -> list[dict]:
    rows = apple.call('GET', f'/v1/profiles?filter[name]={urllib.parse.quote(PROFILE_NAME)}&limit=200')['data']
    return [p for p in rows if p['attributes']['name'] == PROFILE_NAME]


def remake(apple: Apple) -> bytes:
    """The profile made again, for the certificates the one before named. Its content."""
    bundle = bundle_of(apple)
    enable_push(apple, bundle['id'])
    old = profiles_named(apple)
    if not old:
        sys.exit(f'Apple has no profile "{PROFILE_NAME}": run apple_signing.py first.')
    certificates = [c['id'] for c in apple.call('GET', f"/v1/profiles/{old[0]['id']}/certificates?limit=50")['data']]
    if not certificates:
        sys.exit(f'The profile "{PROFILE_NAME}" names no certificate: run apple_signing.py again.')
    for p in old:
        apple.call('DELETE', f"/v1/profiles/{p['id']}")
    profile = apple.call('POST', '/v1/profiles', {
        'data': {
            'type': 'profiles',
            'attributes': {'name': PROFILE_NAME, 'profileType': 'IOS_APP_STORE'},
            'relationships': {
                'bundleId': {'data': {'type': 'bundleIds', 'id': bundle['id']}},
                'certificates': {'data': [{'type': 'certificates', 'id': c} for c in certificates]},
            },
        },
    })['data']
    print(f'Made the profile "{PROFILE_NAME}" again, with Push Notifications.')
    return base64.b64decode(profile['attributes']['profileContent'])


def fetch(apple: Apple) -> bytes:
    """The active profile of that name, as Apple has it now."""
    active = [p for p in profiles_named(apple) if p['attributes'].get('profileState') == 'ACTIVE']
    if not active:
        sys.exit(f'Apple has no active profile "{PROFILE_NAME}".')
    newest = max(active, key=lambda p: p['attributes'].get('expirationDate', ''))
    return base64.b64decode(newest['attributes']['profileContent'])


def env_of(folder: Path) -> dict[str, str]:
    out = {}
    for line in (folder / 'signing.env').read_text().splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            out[k] = v
    return out


def push(folder: Path) -> None:
    env = env_of(folder)
    key = folder / f"AuthKey_{env['KEY_ID']}.p8"
    content = remake(Apple(env['KEY_ID'], env['ISSUER_ID'], key))
    (folder / 'profile.mobileprovision').write_bytes(content)
    os.chmod(folder / 'profile.mobileprovision', 0o600)
    # the GitHub secret's file again, with the new profile (CI fetches the profile itself, so replacing the secret can wait)
    files = {
        'cert.p12': (folder / 'cert.p12').read_bytes(),
        'profile.mobileprovision': content,
        'AuthKey.p8': key.read_bytes(),
        'signing.env': (folder / 'signing.env').read_bytes(),
    }
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode='w:gz') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(data))
    secret = folder / 'github-secret-APPLE_SIGNING_BASE64.txt'
    secret.write_text(base64.b64encode(packed.getvalue()).decode() + '\n')
    os.chmod(secret, 0o600)
    print(f'Wrote profile.mobileprovision and the GitHub secret file again in {folder}.')


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='command', required=True)
    s = sub.add_parser('push', help='turn on Push Notifications and make the profile again (once)')
    s.add_argument('--folder', required=True, type=Path, help='the private folder apple_signing.py wrote')
    f = sub.add_parser('fetch', help='the profile as Apple has it now (CI)')
    f.add_argument('--key-id', required=True)
    f.add_argument('--issuer-id', required=True)
    f.add_argument('--key', required=True, type=Path)
    f.add_argument('--out', required=True, type=Path)
    a = p.parse_args()
    if a.command == 'push':
        push(a.folder.expanduser())
        return
    content = fetch(Apple(a.key_id, a.issuer_id, a.key.expanduser()))
    a.out.write_bytes(content)
    print(f'The profile "{PROFILE_NAME}" as Apple has it now.')


if __name__ == '__main__':
    main()
