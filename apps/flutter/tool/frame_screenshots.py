#!/usr/bin/env python3
"""The stores' pictures from screenshots/out (screenshots/store_screenshots_test.dart; owner, 7 November 2026: "prepare
screenshots"): each screen with a phone's (or the iPad's) status bar drawn in its empty top (9:41, signal, Wi-Fi, battery), and for
Google Play the app icon (512 x 512) and the feature graphic (1024 x 500), from the owner's icon
(apps/mobile/assets/source/trendlix-icon.jpg). Needs Pillow.

  flutter test screenshots/
  python3 tool/frame_screenshots.py ~/TrendLIX-Store-Screenshots
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent
FONTS = APP / 'assets' / 'fonts'
ICON = APP.parent / 'mobile' / 'assets' / 'source' / 'trendlix-icon.jpg'
INK = (20, 20, 20)
WHITE = (255, 255, 255)

# each store's phone: points per pixel, the status bar's height and where its parts sit (points)
PHONES = {
    'app-store': {'ratio': 3.0, 'bar': 62, 'time_x': 52, 'mid_y': 32, 'time_size': 17, 'right': 34},
    # the 12.9" iPad's (owner, 7 November 2026: "can the app be optimized for ipad screen?"): a thinner bar, smaller type
    'app-store-ipad': {'ratio': 2.0, 'bar': 24, 'time_x': 24, 'mid_y': 13, 'time_size': 13, 'right': 22},
    'google-play': {'ratio': 2.625, 'bar': 24, 'time_x': 16, 'mid_y': 12, 'time_size': 13, 'right': 14},
}


def font(weight: str, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / f'InstrumentSans-{weight}.ttf'), round(size))


def status_bar(img: Image.Image, phone: dict) -> Image.Image:
    """The phone's status bar, drawn over the screen's empty top in the screen's own background."""
    r = phone['ratio']
    out = img.convert('RGB')
    d = ImageDraw.Draw(out)
    mid = phone['mid_y'] * r
    # the time
    f = font('SemiBold', phone['time_size'] * r)
    d.text((phone['time_x'] * r, mid), '9:41', font=f, fill=INK, anchor='lm')
    # the battery: an outline, its charge and its cap
    s = phone['time_size'] / 17 * r  # one point of the icons, at this phone's size
    right = out.width - phone['right'] * r
    bw, bh = 25 * s, 12 * s
    bx, by = right - bw - 2 * s, mid - bh / 2
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=3.5 * s, outline=(150, 150, 150), width=max(1, round(s)))
    d.rounded_rectangle([bx + 2 * s, by + 2 * s, bx + bw - 2 * s, by + bh - 2 * s], radius=2 * s, fill=INK)
    d.rounded_rectangle([bx + bw + 0.8 * s, mid - 2 * s, bx + bw + 2.3 * s, mid + 2 * s], radius=0.8 * s, fill=(150, 150, 150))
    # the Wi-Fi: three arcs and a dot, fanning up
    cx, base = bx - 6 * s - 8 * s, mid + 5.5 * s
    for radius in (11 * s, 7.3 * s):
        d.arc([cx - radius, base - radius, cx + radius, base + radius], 225, 315, fill=INK, width=round(2.2 * s))
    d.pieslice([cx - 3.6 * s, base - 3.6 * s, cx + 3.6 * s, base + 3.6 * s], 225, 315, fill=INK)
    # the signal: four bars, rising
    sx = cx - 8 * s - 6 * s - 17 * s
    for i, h in enumerate((4, 6.3, 8.6, 11)):
        x = sx + i * 4.6 * s
        d.rounded_rectangle([x, mid + 5.5 * s - h * s, x + 3 * s, mid + 5.5 * s], radius=0.9 * s, fill=INK)
    return out


def mark() -> Image.Image:
    """The owner's icon without its grey edge."""
    return Image.open(ICON).convert('RGB').crop((4, 4, 1177, 1177))


def play_icon(size: int = 512) -> Image.Image:
    src = mark()
    s = round(src.width * (0.64 * size) / 855)
    out = Image.new('RGB', (size, size), (0, 0, 0))
    out.paste(src.resize((s, s), Image.LANCZOS), ((size - s) // 2, (size - s) // 2))
    return out


def feature_graphic() -> Image.Image:
    """1024 x 500: the T and dot on black, the app's name beside it."""
    out = Image.new('RGB', (1024, 500), (0, 0, 0))
    src = mark()
    box = src.convert('L').point(lambda v: 255 if v > 40 else 0).getbbox()
    t = src.crop(box)
    h = 230
    t = t.resize((round(t.width * h / t.height), h), Image.LANCZOS)
    x = 150
    out.paste(t, (x, (500 - h) // 2))
    d = ImageDraw.Draw(out)
    tx = x + t.width + 70
    d.text((tx, 212), 'Trendlix People', font=font('SemiBold', 74), fill=WHITE, anchor='ls')
    d.text((tx, 284), 'The employee app of Trendlix', font=font('Regular', 36), fill=(170, 170, 170), anchor='ls')
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    dest = Path(sys.argv[1]).expanduser()
    shots = APP / 'screenshots' / 'out'
    for store, phone in PHONES.items():
        pictures = sorted((shots / store).glob('*.png'))
        if not pictures:
            sys.exit(f'No screenshots in {shots / store}: run flutter test screenshots/ first.')
        (dest / store).mkdir(parents=True, exist_ok=True)
        for p in pictures:
            status_bar(Image.open(p), phone).save(dest / store / p.name, optimize=True)
        print(f'{store}: {len(pictures)} screenshots, {Image.open(pictures[0]).size[0]} x {Image.open(pictures[0]).size[1]}')
    play_icon().save(dest / 'google-play' / 'app-icon-512.png', optimize=True)
    feature_graphic().save(dest / 'google-play' / 'feature-graphic-1024x500.png', optimize=True)
    print(f'google-play: app-icon-512.png, feature-graphic-1024x500.png\nAll in {dest}')


if __name__ == '__main__':
    main()
