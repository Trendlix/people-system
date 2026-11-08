#!/usr/bin/env python3
"""Firebase's settings for the app's push notifications, in CI (.github/workflows/flutter-android.yml; owner, 8 November
2026: "notifications are not working correctly, and when there is a pending request make it to popup in the mobile app
and gives a push notification once requested"). People's API pushes through the Firebase project the old app used (20
October 2026); the app needs that project's settings for its own platform:

  android  the secret GOOGLE_SERVICES_JSON (Firebase -> Project settings -> the Android app com.trendlix.people ->
           google-services.json, pasted as it is): written as the app's resources,
           android/app/src/main/res/values/firebase.xml (as Google's Gradle plugin would write them; git ignores the
           file), so Android starts Firebase by itself, also for a push that comes while the app is closed. PEOPLE_PUSH=on
           goes to $GITHUB_ENV for the app's --dart-define.
  ios      the secret GOOGLE_SERVICE_INFO_PLIST (Firebase -> Project settings -> the Apple app com.trendlix.people ->
           GoogleService-Info.plist, pasted as it is): FIREBASE_IOS_API_KEY, _APP_ID, _SENDER_ID and _PROJECT_ID go to
           $GITHUB_ENV for the app's --dart-define (lib/platform/push.dart).

Without the secret the build goes on without push (a notice says so) and the app keeps its bell and its popups. A secret
that isn't what Firebase gives stops the build. No value is ever printed: only what is missing or wrong, by name.
"""

from __future__ import annotations

import json
import os
import plistlib
import sys
from pathlib import Path
from xml.sax.saxutils import escape

PACKAGE = 'com.trendlix.people'
APP = Path(__file__).resolve().parent.parent
RESOURCES = APP / 'android/app/src/main/res/values/firebase.xml'


def env_out(lines: dict[str, str]) -> None:
    target = os.environ.get('GITHUB_ENV')
    if not target:
        return
    with open(target, 'a', encoding='utf-8') as f:
        for k, v in lines.items():
            f.write(f'{k}={v}\n')


def summary(line: str) -> None:
    target = os.environ.get('GITHUB_STEP_SUMMARY')
    if target:
        with open(target, 'a', encoding='utf-8') as f:
            f.write(line + '\n')


def fail(message: str) -> None:
    print(f'::error title=Firebase settings::{message}')
    sys.exit(1)


def android_values(config: dict) -> dict[str, str]:
    """The resources Google's Gradle plugin writes from google-services.json, for this app's client."""
    project = config.get('project_info') or {}
    client = next(
        (c for c in config.get('client') or [] if ((c.get('client_info') or {}).get('android_client_info') or {}).get('package_name') == PACKAGE),
        None,
    )
    if client is None:
        fail(f'GOOGLE_SERVICES_JSON has no Android app {PACKAGE}: add it in the Firebase project and paste its google-services.json again.')
    keys = [k.get('current_key') for k in client.get('api_key') or [] if k.get('current_key')]
    values = {
        'google_app_id': (client.get('client_info') or {}).get('mobilesdk_app_id', ''),
        'gcm_defaultSenderId': str(project.get('project_number', '')),
        'google_api_key': keys[0] if keys else '',
        'google_crash_reporting_api_key': keys[0] if keys else '',
        'project_id': project.get('project_id', ''),
    }
    missing = [k for k, v in values.items() if not v]
    if missing:
        fail(f'GOOGLE_SERVICES_JSON lacks {", ".join(missing)}: paste the google-services.json Firebase gives as it is.')
    if project.get('storage_bucket'):
        values['google_storage_bucket'] = project['storage_bucket']
    if project.get('firebase_url'):
        values['firebase_database_url'] = project['firebase_url']
    return values


def android() -> None:
    raw = os.environ.get('GOOGLE_SERVICES_JSON', '').strip()
    if not raw:
        RESOURCES.unlink(missing_ok=True)
        print('::notice title=Push notifications off::The secret GOOGLE_SERVICES_JSON is not set, so this Android build has no push notifications (the bell and the popups still work).')
        summary('- Push notifications: off (the secret GOOGLE_SERVICES_JSON is not set)')
        return
    try:
        config = json.loads(raw)
    except ValueError:
        fail('GOOGLE_SERVICES_JSON is not JSON: paste the google-services.json file from Firebase as it is.')
    values = android_values(config)
    rows = '\n'.join(f'    <string name="{k}" translatable="false">{escape(v)}</string>' for k, v in values.items())
    RESOURCES.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!-- Firebase for push notifications, written by CI from the secret GOOGLE_SERVICES_JSON (tool/firebase_config.py); not in git. -->\n'
        f'<resources>\n{rows}\n</resources>\n',
        encoding='utf-8',
    )
    env_out({'PEOPLE_PUSH': 'on'})
    print('Push notifications: on (Firebase settings written for Android).')
    summary('- Push notifications: on (Android)')


def ios() -> None:
    raw = os.environ.get('GOOGLE_SERVICE_INFO_PLIST', '').strip()
    if not raw:
        print('::notice title=Push notifications off on iPhone::The secret GOOGLE_SERVICE_INFO_PLIST is not set, so this iPhone build has no push notifications (the bell and the popups still work). docs/app-store.md says how to set it.')
        summary('- Push notifications on iPhone: off (the secret GOOGLE_SERVICE_INFO_PLIST is not set)')
        return
    try:
        plist = plistlib.loads(raw.encode('utf-8'))
    except Exception:
        fail('GOOGLE_SERVICE_INFO_PLIST is not a property list: paste the GoogleService-Info.plist file from Firebase as it is.')
    if plist.get('BUNDLE_ID') != PACKAGE:
        fail(f'GOOGLE_SERVICE_INFO_PLIST is not for {PACKAGE}: add the Apple app {PACKAGE} in the Firebase project and paste its GoogleService-Info.plist.')
    values = {
        'FIREBASE_IOS_API_KEY': plist.get('API_KEY', ''),
        'FIREBASE_IOS_APP_ID': plist.get('GOOGLE_APP_ID', ''),
        'FIREBASE_IOS_SENDER_ID': str(plist.get('GCM_SENDER_ID', '')),
        'FIREBASE_IOS_PROJECT_ID': plist.get('PROJECT_ID', ''),
    }
    missing = [k for k, v in values.items() if not v]
    if missing:
        fail(f'GOOGLE_SERVICE_INFO_PLIST lacks {", ".join(missing)}: paste the GoogleService-Info.plist Firebase gives as it is.')
    for v in values.values():
        print(f'::add-mask::{v}')
    env_out(values)
    print('Push notifications on iPhone: on (Firebase settings given to the build).')
    summary('- Push notifications on iPhone: on')


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('android', 'ios'):
        sys.exit('usage: firebase_config.py android|ios')
    android() if sys.argv[1] == 'android' else ios()
