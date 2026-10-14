"""Made-up national ID cards and scanned pages, drawn in memory for the tests (no real card, no real person).

A card is drawn the size of an ID-1 card at 300 dpi, laid out the way an Egyptian national ID card is: the front with
its heading on the top right, a photo on the left and the 14-digit number along the bottom; the back with lines of text
on the right and a barcode band along the bottom. Pages put cards on a scanner's background, tilted, with noise.
"""

import io
import math
import os
import unicodedata
from dataclasses import dataclass

import cv2
import numpy as np
from bidi import get_display  # python-bidi, which PaddleX installs anyway
from PIL import Image, ImageDraw, ImageFilter, ImageFont

CARD_W = 1012  # 85.6 mm at 300 dpi
CARD_H = round(CARD_W * 53.98 / 85.6)  # 638
MM = CARD_W / 85.6  # pixels per millimetre of a card at 300 dpi
LID = 247  # a scanner's white lid

FRONT_NUMBER = "٢٩١٠٣٠٤٠٢٠٠٤٥٦"
# (text, right edge, top, font size) in pixels of a card CARD_W wide
LAYOUT = {
    "front": [
        ("جمهورية مصر العربية", 972, 30, 46),
        ("بطاقة تحقيق الشخصية", 972, 95, 40),
        ("سامي", 972, 190, 42),
        ("كريم فؤاد عبد الحليم", 972, 256, 42),
        ("١٨ شارع الجمهورية", 972, 322, 42),
        ("قسم العطارين - الإسكندرية", 972, 388, 42),
        ("٢٠٢٣٧٨٤١", 250, 475, 30),
        (FRONT_NUMBER, 952, 520, 62),
    ],
    "back": [
        ("٢٠٢٣/٠٨", 962, 40, 40),
        ("مهندس برمجيات", 962, 110, 40),
        ("ذكر مسلم", 962, 180, 40),
        ("أعزب", 962, 250, 40),
        ("البطاقة سارية حتى ٢٠٣٠/٠٨/١٥", 962, 320, 40),
    ],
}

_FONT_CANDIDATES = [
    os.environ.get("OCR_TEST_ARABIC_FONT", ""),
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def arabic_font_path() -> str | None:
    """A font with Arabic letters, or None: without one, cards carry text-like strokes instead of text."""
    for path in _FONT_CANDIDATES:
        if path and os.path.isfile(path):
            return path
    return None


# Arabic shaping: Pillow without libraqm draws letters in their isolated forms and left to right; a recogniser reads
# joined letters right to left. Each letter is swapped for its joined form, then the line is put in visual order.
def _presentation_forms() -> dict[str, dict[str, str]]:
    forms: dict[str, dict[str, str]] = {}
    for code in range(0xFE70, 0xFEFF):
        decomposition = unicodedata.decomposition(chr(code)).split()
        if len(decomposition) == 2 and decomposition[0].startswith("<"):
            base = chr(int(decomposition[1], 16))
            forms.setdefault(base, {})[decomposition[0].strip("<>")] = chr(code)
    return forms


_FORMS = _presentation_forms()


def shape_arabic(text: str) -> str:
    def joins_forward(ch: str) -> bool:  # joins the letter after it
        return "initial" in _FORMS.get(ch, {})

    out = []
    for i, ch in enumerate(text):
        forms = _FORMS.get(ch)
        if not forms:
            out.append(ch)
            continue
        joined_before = i > 0 and joins_forward(text[i - 1])
        joined_after = joins_forward(ch) and i + 1 < len(text) and text[i + 1] in _FORMS
        if joined_before and joined_after:
            out.append(forms.get("medial", ch))
        elif joined_before:
            out.append(forms.get("final", ch))
        elif joined_after:
            out.append(forms.get("initial", ch))
        else:
            out.append(forms.get("isolated", ch))
    return get_display("".join(out))


@dataclass
class Placed:
    """Where a card was put on a page: centre (pixel indices), size and angle (degrees, clockwise on screen)."""

    side: str
    cx: float
    cy: float
    w: float
    h: float
    angle: float


def make_card(
    side: str, seed: int = 0, width: int = CARD_W, strip: tuple[str, float, tuple] | None = None
) -> Image.Image:
    """An RGBA card (transparent outside its rounded corners). `strip`: (edge, mm, colour), a strip that wide along that
    edge ("top", "bottom", "left" or "right") painted flat in that colour, as a pale part of a card shows on a scan."""
    rng = np.random.default_rng(seed)
    w, h = width, round(width * 53.98 / 85.6)
    s = w / CARD_W
    base = np.array([238, 236, 228] if side == "front" else [232, 236, 240], dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # a light security print: two families of fine wavy lines
    pattern = 0.5 + 0.25 * np.sin(xx / (7 * s) + 3 * np.sin(yy / (40 * s)))
    pattern += 0.25 * np.sin(yy / (9 * s) + xx / (60 * s))
    tint = np.array([-14, -6, 6] if side == "front" else [4, -8, -16], dtype=np.float32)
    img = Image.fromarray(np.clip(base + pattern[..., None] * tint, 0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(img)
    font_path = arabic_font_path()

    if side == "front":  # the photo, 21 x 27 mm, with a face-like oval
        px0, py0, px1, py1 = 40 * s, 140 * s, 290 * s, 460 * s
        draw.rectangle([px0, py0, px1, py1], fill=(150, 150, 160))
        draw.ellipse([px0 + 60 * s, py0 + 50 * s, px1 - 60 * s, py1 - 90 * s], fill=(200, 170, 150))
        draw.rectangle([px0 + 30 * s, py1 - 80 * s, px1 - 30 * s, py1], fill=(60, 60, 80))
    else:  # a barcode band across the bottom
        x = 60 * s
        top, bottom = h - 150 * s, h - 40 * s
        while x < w - 60 * s:
            bar = float(rng.integers(1, 5)) * 2.2 * s
            draw.rectangle([x, top, x + bar, bottom], fill=(20, 20, 20))
            x += bar + float(rng.integers(1, 5)) * 2.2 * s

    for text, right, top, size in LAYOUT[side]:
        right, top, size = right * s, top * s, round(size * s)
        fill = (60, 60, 60) if size < 35 * s else (25, 25, 30)
        if font_path is None:  # strokes the size and spacing of words, so that the layout is the same
            x = right
            for word in reversed(text.split()):
                ww = size * 0.55 * len(word)
                draw.rectangle([x - ww, top + size * 0.25, x, top + size * 0.85], fill=fill)
                x -= ww + size * 0.5
            continue
        font = ImageFont.truetype(font_path, size)
        shaped = shape_arabic(text)
        draw.text((right - draw.textlength(shaped, font=font), top), shaped, font=font, fill=fill)

    if strip is not None:
        edge, mm, colour = strip
        d = mm * w / 85.6
        area = {"top": [0, 0, w, d], "bottom": [0, h - d, w, h], "left": [0, 0, d, h], "right": [w - d, 0, w, h]}[edge]
        if d > 0:
            draw.rectangle([area[0], area[1], area[2] - 1, area[3] - 1], fill=colour)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    # rounded corners: 3.18 mm on an 85.6 mm card
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=round(w * 3.18 / 85.6), fill=255)
    img.putalpha(mask)
    return img


def text_boxes(side: str, width: int, height: int) -> list[tuple[str, tuple[int, int, int, int]]]:
    """The card's lines, and about where a reader finds them on a picture of the card `width` x `height`."""
    sx, sy = width / CARD_W, height / CARD_H
    boxes = []
    for text, right, top, size in LAYOUT[side]:
        left = right - size * 0.5 * len(text)
        boxes.append((text, (round(left * sx), round(top * sy), round(right * sx), round((top + size * 1.2) * sy))))
    return boxes


def place(page: np.ndarray, card: Image.Image, cx: float, cy: float, angle: float, side: str) -> Placed:
    """Draw `card` on `page` (RGB, in place), its centre at (cx, cy), turned `angle` degrees clockwise on screen."""
    rgba = np.asarray(card).astype(np.float32)
    rgba[..., :3] *= rgba[..., 3:4] / 255.0  # premultiplied, so that the edge does not darken as it is resampled
    h, w = rgba.shape[:2]
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    # page = centre + R (card - card centre), with pixel centres at whole numbers; drawn only where the card falls
    reach = math.hypot(w, h) / 2 + 2
    x0, y0 = max(0, math.floor(cx - reach)), max(0, math.floor(cy - reach))
    x1, y1 = min(page.shape[1], math.ceil(cx + reach)), min(page.shape[0], math.ceil(cy + reach))
    ux, uy = (w - 1) / 2, (h - 1) / 2
    matrix = np.array(
        [[c, -s, cx - x0 - c * ux + s * uy], [s, c, cy - y0 - s * ux - c * uy]], dtype=np.float64
    )
    warped = cv2.warpAffine(rgba, matrix, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    region = page[y0:y1, x0:x1].astype(np.float32)
    alpha = warped[..., 3:4] / 255.0
    page[y0:y1, x0:x1] = np.clip(region * (1 - alpha) + warped[..., :3], 0, 255).astype(np.uint8)
    return Placed(side=side, cx=cx, cy=cy, w=float(w), h=float(h), angle=angle)


def scanned_page(
    cards: list[tuple[str, float, float, float]],
    size: tuple[int, int] = (2480, 3508),
    background: str = "dark",
    seed: int = 0,
    card_width: int = CARD_W,
    shadow: bool = True,
    strip: tuple[str, float, tuple] | None = None,
) -> tuple[np.ndarray, list[Placed]]:
    """An RGB page with cards on it: each (side, cx, cy, angle). `background` is "dark" (a flatbed scanner with its
    lid open) or "white" (lid closed, with a thin shadow along two edges of each card unless `shadow` is False).
    `strip`: see make_card. Returns the page and where each card went."""
    rng = np.random.default_rng(seed)
    width, height = size
    if background == "dark":
        level = 28 + 22 * np.linspace(0, 1, height, dtype=np.float32)  # uneven, as the room's light falls
        page = np.repeat(np.repeat(level[:, None, None], width, axis=1), 3, axis=2).astype(np.uint8)
    else:
        page = np.full((height, width, 3), LID, dtype=np.uint8)
    placed = []
    for i, (side, cx, cy, angle) in enumerate(cards):
        card = make_card(side, seed=seed + i, width=card_width, strip=strip)
        if background == "white" and shadow:
            # a scanner's lamp leaves a thin shadow along two edges of a card lying on the glass
            dark = Image.new("RGBA", card.size, (110, 110, 110, 0))
            dark.putalpha(card.getchannel("A").point(lambda v: v * 0.45))
            place(page, dark.filter(ImageFilter.GaussianBlur(1)), cx + 2.5, cy + 2.5, angle, side)
        placed.append(place(page, card, cx, cy, angle, side))
    noisy = page.astype(np.int16) + rng.normal(0, 3.0, page.shape).astype(np.int16)
    return np.clip(noisy, 0, 255).astype(np.uint8), placed


def encode(page: np.ndarray, fmt: str = "JPEG", quality: int = 90) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(page).save(buf, fmt, quality=quality)
    return buf.getvalue()


def pdf_of(pages: list[np.ndarray], dpi: int = 300) -> bytes:
    """A PDF with one scanned page per picture, as a scanner makes it (each picture fills its page)."""
    images = [Image.fromarray(page) for page in pages]
    buf = io.BytesIO()
    images[0].save(buf, "PDF", save_all=True, append_images=images[1:], resolution=dpi, quality=90)
    return buf.getvalue()


def card_picture(side: str, angle_quarter: int = 0, margin_mm: float = 1.2, background: int = LID) -> np.ndarray:
    """A picture that is a card cut out already (RGB): the card with `margin_mm` around it, level, turned by quarter
    turns clockwise."""
    pad = round(margin_mm * MM)
    page = np.full((CARD_H + 2 * pad, CARD_W + 2 * pad, 3), background, dtype=np.uint8)
    place(page, make_card(side), pad + (CARD_W - 1) / 2, pad + (CARD_H - 1) / 2, 0.0, side)
    return np.ascontiguousarray(np.rot90(page, -angle_quarter)) if angle_quarter else page
