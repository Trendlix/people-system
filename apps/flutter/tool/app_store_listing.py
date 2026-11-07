#!/usr/bin/env python3
"""Fills Trendlix People's App Store page through the App Store Connect API (owner, 7 November 2026: "can you take
control and fill the field in apple store connect?"; docs/app-store.md has the same answers): the app's subtitle,
categories, privacy policy, content rights and age rating; the version's description, keywords, promotional text,
support address, copyright and manual release; the review notes and the reviewers' account name; the iPhone 6.9"
screenshots (tool/frame_screenshots.py); a free price; Egypt. With --version it also names the version as the build
(0.6.<run>) and chooses that build.

Left to a person, as the API can't do them or they are theirs to give: App Privacy, the review contact and the
reviewers' account password, and Apple's unlisted distribution form.

Run again at will: it sets the same values and uploads only the screenshots not there yet. Only Python's standard
library and the Mac's openssl. It never prints a secret.

  python3 apps/flutter/tool/app_store_listing.py [--version 0.6.43] [--signing ~/TrendLIX-Apple-Signing]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apple_signing import API, BUNDLE_ID, token  # noqa: E402

SUBTITLE = "Trendlix's employee app"
PRIVACY_URL = 'https://people.trendlix.com/privacy'
SUPPORT_URL = 'https://people.trendlix.com/privacy'
COPYRIGHT = '2026 Trendlix'
PROMOTIONAL = 'Check in, ask for leave and follow your requests, log hours and see your KPIs.'
KEYWORDS = 'HR,attendance,check in,leave,timesheet,KPI,employee,Trendlix'
DESCRIPTION = """Trendlix People is the employee app of Trendlix. Employees sign in with their work account to:

• check in and out for work, with the place confirmed by location
• ask for leave, work from home, official duty, permissions and compensatory days, and follow each request
• log hours on a timesheet
• see their attendance and KPIs
• approve their team's requests (for managers)

The app is for Trendlix employees only and needs an account from the company's HR."""
REVIEW_ACCOUNT = 'testing@trendlix.com'
REVIEW_NOTES = (
    "Trendlix People is the HR app for Trendlix's own employees: attendance, leave and other requests, timesheets and "
    "KPIs. Accounts are created by the company's HR; there is no sign-up. Please sign in with the account above: a test "
    "employee with no real data. Check-in asks for the location while the app is in use, to confirm the employee is at a "
    "place they may check in from. We are requesting Unlisted App Distribution for this app, as it is for our employees "
    "only."
)
SCREENSHOT_TYPE = 'APP_IPHONE_67'  # the 6.7" and 6.9" iPhones' set (1320 x 2868 is a 6.9" picture)
TERRITORIES = ['EGY']


class Apple:
    def __init__(self, signing: Path):
        env = dict(line.split('=', 1) for line in (signing / 'signing.env').read_text().splitlines() if '=' in line)
        key = next(signing.glob(f"AuthKey_{env['KEY_ID']}.p8"))
        self.jwt = token(env['KEY_ID'], env['ISSUER_ID'], key)

    def call(self, method: str, path: str, body: dict | None = None, ok_conflict: bool = False) -> dict:
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
            if ok_conflict and e.code == 409:
                return {'conflict': detail}
            raise SystemExit(f'Apple refused {method} {path.split("?")[0]} ({e.code}): {detail}')


def step(name: str, fn) -> None:
    try:
        result = fn()
        print(f'  ✓ {name}{": " + result if isinstance(result, str) and result else ""}')
    except SystemExit as e:
        print(f'  ✗ {name}: {e}')


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--signing', default='~/TrendLIX-Apple-Signing', type=Path)
    p.add_argument('--screenshots', default='~/TrendLIX-Store-Screenshots/app-store', type=Path)
    p.add_argument('--version', help="the build's version (0.6.<run>): the version takes its name and that build")
    a = p.parse_args()
    apple = Apple(a.signing.expanduser())

    app = apple.call('GET', f'/v1/apps?filter[bundleId]={BUNDLE_ID}')['data']
    if not app:
        sys.exit(f'No app for {BUNDLE_ID} in App Store Connect: create it first (docs/app-store.md step 3).')
    app_id = app[0]['id']
    versions = apple.call('GET', f'/v1/apps/{app_id}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    editable = [v for v in versions if v['attributes'].get('appStoreState') in ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED')]
    if not editable:
        sys.exit('No version waiting to be sent for review (all are with Apple or out).')
    version = editable[0]
    vid = version['id']
    infos = apple.call('GET', f'/v1/apps/{app_id}/appInfos')['data']
    info = next((i for i in infos if i['attributes'].get('appStoreState') != 'READY_FOR_SALE'), infos[0])
    print(f"Trendlix People (app {app_id}), version {version['attributes']['versionString']}:")

    # the app
    step('Content rights: no third-party content', lambda: apple.call('PATCH', f'/v1/apps/{app_id}', {
        'data': {'type': 'apps', 'id': app_id, 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}}) and '')
    step('Category: Business, then Productivity', lambda: apple.call('PATCH', f"/v1/appInfos/{info['id']}", {
        'data': {'type': 'appInfos', 'id': info['id'], 'relationships': {
            'primaryCategory': {'data': {'type': 'appCategories', 'id': 'BUSINESS'}},
            'secondaryCategory': {'data': {'type': 'appCategories', 'id': 'PRODUCTIVITY'}},
        }}}) and '')

    def info_text():
        locs = apple.call('GET', f"/v1/appInfos/{info['id']}/appInfoLocalizations")['data']
        loc = next(l for l in locs if l['attributes']['locale'] == 'en-US')
        apple.call('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", {
            'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': {'subtitle': SUBTITLE, 'privacyPolicyUrl': PRIVACY_URL}}})
        return ''
    step(f'Subtitle and privacy policy ({PRIVACY_URL})', info_text)

    def age_rating():
        decl = apple.call('GET', f"/v1/appInfos/{info['id']}/ageRatingDeclaration")['data']
        attrs = {}
        for k, v in decl['attributes'].items():
            if k in ('kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'developerAgeRatingInfoUrl',
                     'gracRatingClassificationNumber'):
                continue
            if isinstance(v, bool) or k in BOOLEANS:
                attrs[k] = False
            else:
                attrs[k] = 'NONE'
        apple.call('PATCH', f"/v1/ageRatingDeclarations/{decl['id']}", {'data': {'type': 'ageRatingDeclarations', 'id': decl['id'], 'attributes': attrs}})
        return f'{len(attrs)} questions answered None / No'
    step('Age rating', age_rating)

    # the version
    def version_text():
        attrs = {'copyright': COPYRIGHT, 'releaseType': 'MANUAL'}
        if a.version:
            attrs['versionString'] = a.version
        apple.call('PATCH', f'/v1/appStoreVersions/{vid}', {'data': {'type': 'appStoreVersions', 'id': vid, 'attributes': attrs}})
        locs = apple.call('GET', f'/v1/appStoreVersions/{vid}/appStoreVersionLocalizations')['data']
        loc = next(l for l in locs if l['attributes']['locale'] == 'en-US')
        apple.call('PATCH', f"/v1/appStoreVersionLocalizations/{loc['id']}", {
            'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': {
                'description': DESCRIPTION, 'keywords': KEYWORDS, 'promotionalText': PROMOTIONAL, 'supportUrl': SUPPORT_URL}}})
        return 'manual release' + (f', version {a.version}' if a.version else '')
    step('Description, keywords, promotional text, support URL, copyright', version_text)

    if a.version:
        def choose_build():
            builds = apple.call('GET', f'/v1/builds?filter[app]={app_id}&filter[preReleaseVersion.version]={a.version}&sort=-uploadedDate&limit=5')['data']
            usable = [b for b in builds if b['attributes'].get('processingState') == 'VALID']
            if not usable:
                states = ', '.join(b['attributes'].get('processingState', '?') for b in builds) or 'none uploaded'
                raise SystemExit(f'no processed build {a.version} yet ({states}); run again once Apple has processed it')
            b = usable[0]
            apple.call('PATCH', f'/v1/appStoreVersions/{vid}/relationships/build', {'data': {'type': 'builds', 'id': b['id']}})
            return f"build {b['attributes']['version']}"
        step(f'Build {a.version}', choose_build)

    def review():
        notes = {'demoAccountRequired': True, 'demoAccountName': REVIEW_ACCOUNT, 'notes': REVIEW_NOTES}
        existing = apple.call('GET', f'/v1/appStoreVersions/{vid}/appStoreReviewDetail').get('data')
        if existing:
            apple.call('PATCH', f"/v1/appStoreReviewDetails/{existing['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': existing['id'], 'attributes': notes}})
        else:
            apple.call('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': notes,
                'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}})
        return f'sign-in {REVIEW_ACCOUNT} (its password and the contact are set in App Store Connect)'
    step('App Review notes', review)

    def screenshots():
        folder = a.screenshots.expanduser()
        files = sorted(folder.glob('*.png'))
        if not files:
            raise SystemExit(f'none in {folder} (tool/frame_screenshots.py makes them)')
        locs = apple.call('GET', f'/v1/appStoreVersions/{vid}/appStoreVersionLocalizations')['data']
        loc = next(l for l in locs if l['attributes']['locale'] == 'en-US')
        sets = apple.call('GET', f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")['data']
        shot_set = next((s for s in sets if s['attributes']['screenshotDisplayType'] == SCREENSHOT_TYPE), None)
        if shot_set is None:
            shot_set = apple.call('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': SCREENSHOT_TYPE},
                'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id']}}}}})['data']
        there = {s['attributes']['fileName'] for s in apple.call('GET', f"/v1/appScreenshotSets/{shot_set['id']}/appScreenshots")['data']}
        added = 0
        for f in files:
            if f.name in there:
                continue
            data = f.read_bytes()
            shot = apple.call('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': f.name, 'fileSize': len(data)},
                'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': shot_set['id']}}}}})['data']
            for op in shot['attributes']['uploadOperations']:
                part = data[op['offset']:op['offset'] + op['length']]
                req = urllib.request.Request(op['url'], method=op['method'], data=part, headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
                urllib.request.urlopen(req, timeout=120).read()
            apple.call('PATCH', f"/v1/appScreenshots/{shot['id']}", {'data': {'type': 'appScreenshots', 'id': shot['id'],
                'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
            added += 1
        return f'{added} uploaded, {len(there)} already there'
    step('iPhone 6.9" screenshots', screenshots)

    def price():
        points = apple.call('GET', f'/v1/apps/{app_id}/appPricePoints?filter[territory]=USA&limit=200')['data']
        free = next(pt for pt in points if float(pt['attributes']['customerPrice']) == 0)
        apple.call('POST', '/v1/appPriceSchedules', {
            'data': {'type': 'appPriceSchedules', 'relationships': {
                'app': {'data': {'type': 'apps', 'id': app_id}},
                'baseTerritory': {'data': {'type': 'territories', 'id': 'USA'}},
                'manualPrices': {'data': [{'type': 'appPrices', 'id': '${free}'}]},
            }},
            'included': [{'type': 'appPrices', 'id': '${free}', 'attributes': {'startDate': None},
                          'relationships': {'appPricePoint': {'data': {'type': 'appPricePoints', 'id': free['id']}}}}],
        })
        return ''
    step('Price: free', price)

    def availability():
        # Apple takes every territory, each on or off
        every = [t['id'] for t in apple.call('GET', '/v1/territories?limit=200')['data']]
        result = apple.call('POST', '/v2/appAvailabilities', {
            'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': False}, 'relationships': {
                'app': {'data': {'type': 'apps', 'id': app_id}},
                'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}'} for t in every]},
            }},
            'included': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}', 'attributes': {'available': t in TERRITORIES},
                          'relationships': {'territory': {'data': {'type': 'territories', 'id': t}}}} for t in every],
        }, ok_conflict=True)
        if 'conflict' in result:
            if 'already exists' in result['conflict']:
                return 'already set (change it under Pricing and Availability)'
            raise SystemExit(result['conflict'][:300])
        return f"{', '.join(TERRITORIES)} only, of {len(every)}"
    step('Availability', availability)

    print('\nStill yours in App Store Connect: App Privacy, the App Review contact and the testing account password'
          ' (once each), then Add for Review and the unlisted request form (docs/app-store.md step 8).')


# the age rating's yes/no questions (the rest are None / Infrequent / Frequent)
BOOLEANS = {'gambling', 'unrestrictedWebAccess', 'lootBox', 'advertising', 'ageAssurance', 'healthOrWellnessTopics',
            'messagingAndChat', 'parentalControls', 'userGeneratedContent', 'seventeenPlus', 'socialMedia',
            'socialMediaAgeRestricted'}

if __name__ == '__main__':
    main()
