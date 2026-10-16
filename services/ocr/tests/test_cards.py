"""Finding national ID cards (POST /cards and app/cards.py), on made-up cards drawn by tests/synthetic_cards.py.

No models: CardReader stands in for the OCR engine and "reads" a picture only when it looks like one of the made-up
cards (the right way up: its lines; upside down: a few unsure scraps). tests/test_cards_models.py runs the real models.
"""

import base64
import io
import logging
import math
import threading

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw

from app import cards as C
from app.main import PAGE_SIDE
from app.upload import MAX_FILE_BYTES

from .conftest import StubEngine, line, pdf, wait_ready
from .synthetic_cards import (
    CARD_H,
    CARD_W,
    LID,
    MM,
    card_picture,
    encode,
    make_card,
    pdf_of,
    place,
    scanned_page,
    text_boxes,
)

# The fake reader


def _thumb(image: np.ndarray) -> np.ndarray:
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (160, 101), interpolation=cv2.INTER_AREA).astype(np.float32)
    return (small - small.mean()) / (small.std() + 1e-6)


def _reference(side: str) -> np.ndarray:
    card = make_card(side)
    white = Image.new("RGBA", card.size, (255, 255, 255, 255))
    return _thumb(np.asarray(Image.alpha_composite(white, card).convert("L")))


REFERENCES = {side: _reference(side) for side in ("front", "back")}


def looks_like(image: np.ndarray) -> tuple[float, str, bool]:
    """(likeness, side, upside down) of the made-up card a picture of a card (with its margin) is most like."""
    h, w = image.shape[:2]
    inner = image[round(0.02 * h) : round(0.98 * h), round(0.02 * w) : round(0.98 * w)]
    thumb = _thumb(inner)
    return max(
        (float((thumb * reference).mean()), side, flipped)
        for side, upright in REFERENCES.items()
        for flipped, reference in ((False, upright), (True, upright[::-1, ::-1]))
    )


class CardReader(StubEngine):
    def __init__(self, **kwargs):
        super().__init__(self.lines, **kwargs)

    @staticmethod
    def lines(image):
        h, w = image.shape[:2]
        if w < h:
            return []
        likeness, side, flipped = looks_like(image)
        if likeness < 0.5:
            return []
        if flipped:
            return [line("يي ل م", (40, 30, 300, 70), 0.41), line("لية", (500, 300, 640, 340), 0.38)]
        return [line(text, box, 0.95) for text, box in text_boxes(side, w, h)]


# Helpers


def shown(page_rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """The page as the service looks at it (BGR, at most PAGE_SIDE), and how much smaller than given."""
    bgr = np.ascontiguousarray(page_rgb[:, :, ::-1])
    small = C.shrunk(bgr, PAGE_SIDE)
    return small, small.shape[1] / bgr.shape[1]


def scaled(placed, f: float) -> C.Box:
    """Where a card was put, in pixel indices of the page `f` times as large."""
    return C.Box((placed.cx + 0.5) * f - 0.5, (placed.cy + 0.5) * f - 0.5, placed.w * f, placed.h * f, placed.angle)


def nearest(found: list, truth: C.Box):
    return min(found, key=lambda f: math.hypot(f.box.cx - truth.cx, f.box.cy - truth.cy))


def beyond(box: C.Box, truth: C.Box, reach=None) -> dict[str, float]:
    """How far past each edge of the card `truth` the box (or the cut reaching `reach` from its centre) goes, in
    pixels, along the card's own axes: below 0, inside the card."""
    u, v = box.axes
    du, dv = float(np.dot(truth.centre - box.centre, u)), float(np.dot(truth.centre - box.centre, v))
    left, top, right, bottom = reach or (box.w / 2, box.h / 2, box.w / 2, box.h / 2)
    return {
        "left": left + du - truth.w / 2,
        "top": top + dv - truth.h / 2,
        "right": right - du - truth.w / 2,
        "bottom": bottom - dv - truth.h / 2,
    }


def turn(a: float, b: float, half_turn: float = 90) -> float:
    return abs(C._wrap(a - b, half_turn))


def decode(b64: str) -> np.ndarray:
    data = base64.b64decode(b64)
    assert data[:3] == b"\xff\xd8\xff"  # a JPEG
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def send(client, data: bytes, filename="scan.jpg", field="file"):
    return client.post("/cards", files={field: (filename, data, "application/octet-stream")})


# Finding the cards on a page (no reading)


@pytest.mark.parametrize("background", ["dark", "white"])
def test_both_sides_on_one_scanned_page_are_found_where_they_are(background):
    page, placed = scanned_page([("front", 1240, 900, -7), ("back", 1240, 2500, 184)], background=background)
    small, f = shown(page)
    found = C.find_cards(small)
    assert len(found) == 2
    for card in placed:
        truth = scaled(card, f)
        box = nearest(found, truth).box
        assert box.w > box.h
        assert turn(box.angle, truth.angle) <= 0.2
        edges = beyond(box, truth)
        if background == "dark":
            assert all(abs(e) <= 1.0 for e in edges.values()), edges
        else:  # a scanner's shadow along two edges counts as the card: up to about half a millimetre more
            assert all(-1.0 <= e <= 0.6 * MM * f for e in edges.values()), edges


def test_cards_tilted_either_way_and_one_standing_on_its_end():
    page, placed = scanned_page(
        [("front", 700, 800, 4), ("back", 1800, 800, -3), ("front", 1240, 2400, 91)], background="white"
    )
    small, f = shown(page)
    found = C.find_cards(small)
    assert len(found) == 3
    for card in placed:
        truth = scaled(card, f)
        box = nearest(found, truth).box
        assert turn(box.angle, truth.angle) <= 0.3  # the same line, either way along it: which way up comes later
        assert -90 < box.angle <= 90 and box.w > box.h
        assert math.hypot(box.cx - truth.cx, box.cy - truth.cy) <= 2.5


@pytest.mark.parametrize("background", ["dark", "white"])
def test_a_page_with_no_card(background):
    page, _ = scanned_page([], background=background)
    assert C.find_cards(shown(page)[0]) == []


def test_a_typed_page_is_not_a_card():
    img = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(img)
    for row in range(40):
        for word in range(9):
            draw.rectangle([100 + word * 115, 120 + row * 38, 190 + word * 115, 140 + row * 38], fill=(30, 30, 30))
    assert C.find_cards(np.asarray(img)[:, :, ::-1].copy()) == []


def test_a_sheet_holding_two_cards_is_not_itself_a_card():
    # a photo of a sheet of paper on a dark desk, the sheet shaped like a card, with both sides of a card on it
    page = np.full((2480, 3508, 3), 35, dtype=np.uint8)
    cv2.rectangle(page, (250, 300), (3250, 2175), (250, 250, 250), -1)  # 3000 x 1875
    placed = [place(page, make_card(side), cx, 1240, 2, side) for side, cx in (("front", 1100), ("back", 2400))]
    page = np.clip(page + np.random.default_rng(0).normal(0, 3, page.shape), 0, 255).astype(np.uint8)
    small, f = shown(page)
    found = C.find_cards(small)
    assert len(found) == 2
    for card in placed:
        assert abs(nearest(found, scaled(card, f)).box.w - CARD_W * f) < 2


# The whole card, never less


def cut_scene(edge: str, lost: float, background: str):
    """A picture of a level card that the picture's `edge` cuts `lost` mm into, and where the card is on it."""
    page, [card] = scanned_page([("front", 700, 600, 0)], size=(1400, 1200), background=background, shadow=False)
    left, right = card.cx - (card.w - 1) / 2 - 0.5, card.cx + (card.w - 1) / 2 + 0.5
    top, bottom = card.cy - (card.h - 1) / 2 - 0.5, card.cy + (card.h - 1) / 2 + 0.5
    x0, y0, x1, y1 = 0, 0, 1400, 1200
    if edge == "top":
        y0 = round(top + lost * MM)
    elif edge == "bottom":
        y1 = round(bottom - lost * MM)
    elif edge == "left":
        x0 = round(left + lost * MM)
    else:
        x1 = round(right - lost * MM)
    picture = np.ascontiguousarray(page[y0:y1, x0:x1, ::-1])
    truth = C.Box(card.cx - x0, card.cy - y0, card.w, card.h, 0.0)
    return picture, truth, (x1 - x0, y1 - y0)


@pytest.mark.parametrize("background", ["dark", "white"])
@pytest.mark.parametrize("edge", ["top", "bottom", "left", "right"])
@pytest.mark.parametrize("lost", [0, 1, 2, 3, 5])
def test_a_card_the_picture_cuts_off_is_made_whole_on_that_side(background, edge, lost):
    picture, truth, (width, height) = cut_scene(edge, lost, background)
    [found] = C.find_cards(picture)
    box = found.box
    assert box.w / box.h == pytest.approx(C.CARD_ASPECT, abs=0.004)  # a card's proportions, not a shorter shape
    edges = beyond(box, truth)
    assert all(e >= -1.0 for e in edges.values()), edges  # the box holds the whole card: never inside it
    assert all(e <= 0.25 * MM for e in edges.values()), edges  # and is the card, not more
    reach, frame = C.cut_plan(box, found.spare, width, height)
    margins = {k: v / MM for k, v in beyond(box, truth, reach).items()}
    for side, margin in margins.items():
        wanted = 1.9 if side in ("left", "right") else 1.2
        if side == edge and lost > 0:
            # the cut goes up to the edge of the picture, and says the card runs on past it
            assert margin == pytest.approx(-lost, abs=0.15)
        elif not (side == edge and lost == 0):
            assert wanted - 0.15 <= margin <= wanted + 0.15, margins
    index = ["left", "top", "right", "bottom"].index(edge)
    if lost > 0:
        assert frame[index] < 0 if index < 2 else frame[index] > 1


@pytest.mark.parametrize("shadow", [False, True])
@pytest.mark.parametrize("how", ["as pale as the lid", "a little darker than the lid"])
@pytest.mark.parametrize("edge", ["top", "bottom", "left", "right"])
@pytest.mark.parametrize("lost", [1, 3, 5])
def test_a_pale_strip_of_a_card_is_never_cut_off(shadow, how, edge, lost):
    colour = (LID,) * 3 if how == "as pale as the lid" else (LID - 6,) * 3
    page, [card] = scanned_page(
        [("front", 700, 600, 2)], size=(1400, 1200), background="white", shadow=shadow, strip=(edge, lost, colour)
    )
    picture = np.ascontiguousarray(page[:, :, ::-1])
    [found] = C.find_cards(picture)
    truth = C.Box(card.cx, card.cy, card.w, card.h, card.angle)
    reach, _ = C.cut_plan(found.box, found.spare, 1400, 1200)
    margins = beyond(found.box, truth, reach)
    # every part of the card is in the cut, with most of the margin, and not much more than the strip besides
    assert all(0.9 * MM <= m <= (lost + 3) * MM for m in margins.values()), {k: v / MM for k, v in margins.items()}


def test_the_cut_out_card_keeps_its_margin_and_the_box_is_the_card():
    page, [card] = scanned_page([("back", 700, 600, -5)], size=(1400, 1200))
    picture = np.ascontiguousarray(page[:, :, ::-1])
    [found] = C.find_cards(picture)
    reach, frame = C.cut_plan(found.box, found.spare, 1400, 1200)
    image = C.cut_out(picture, found.box, reach)
    margin_x, margin_y = 1.9 / (85.6 + 3.8), 1.2 / (53.98 + 2.4)
    assert frame == pytest.approx([margin_x, margin_y, 1 - margin_x, 1 - margin_y], abs=0.002)
    assert image.shape[1] == pytest.approx(C.CARD_WIDTH * (85.6 + 3.8) / 85.6, abs=2)
    assert image.shape[0] == pytest.approx(C.CARD_WIDTH * (53.98 + 2.4) / 85.6, abs=2)
    # the margin is the dark background, the card is light
    assert image[:5].mean() < 80 and image[image.shape[0] // 2, image.shape[1] // 2].mean() > 150


# Which way up, which side


@pytest.mark.parametrize("side", ["front", "back"])
@pytest.mark.parametrize("upside_down", [False, True])
def test_a_card_is_turned_upright_and_its_side_told(side, upside_down):
    card = np.asarray(Image.alpha_composite(Image.new("RGBA", (CARD_W, CARD_H), "white"), make_card(side)))
    bgr = np.ascontiguousarray(card[:, :, 2::-1])
    if upside_down:
        bgr = cv2.rotate(bgr, cv2.ROTATE_180)
    verdict = C.judge(CardReader(), bgr)
    assert verdict.flip == upside_down
    assert verdict.side == side and verdict.confidence >= 0.9


def test_the_back_is_told_by_its_barcode_when_nothing_reads():
    card = np.asarray(Image.alpha_composite(Image.new("RGBA", (CARD_W, CARD_H), "white"), make_card("back")))
    bgr = np.ascontiguousarray(card[:, :, 2::-1])
    bottom, top = C.barcode_bands(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    assert bottom > 0.8 and top < 0.1
    verdict = C.judge(StubEngine(), cv2.rotate(bgr, cv2.ROTATE_180))
    assert verdict.flip and verdict.side == "back"
    front = np.asarray(Image.alpha_composite(Image.new("RGBA", (CARD_W, CARD_H), "white"), make_card("front")))
    assert max(C.barcode_bands(cv2.cvtColor(front[:, :, :3], cv2.COLOR_RGB2GRAY))) < 0.1


def test_side_words_are_matched_loosely_and_digits_upside_down_do_not_count():
    lines = [line("جمهوریة مصر العربیة", (0, 0, 9, 9), 0.9), line("بطاقة تحقيق الشخصيه", (0, 9, 9, 18), 0.9)]
    assert C._word_score(lines, C._FRONT_WORDS) > 2.5 and C._word_score(lines, C._BACK_WORDS) == 0
    back = [line("البطاقه ساريه حتى٢٠٣٠١٥", (0, 0, 9, 9), 0.8), line("انثى مسيحية", (0, 9, 9, 18), 0.9)]
    assert C._word_score(back, C._BACK_WORDS) > 2 and C._word_score(back, C._FRONT_WORDS) == 0
    assert C._letter_score([line("٢٩١٠٣٠٤٠٢٠٠٤٥٦", (0, 0, 9, 9), 0.99)]) == 0


def test_the_printed_serial_is_read_as_the_api_reads_it():
    for text in ["KM4729105", "KM 4729105", "KM ٤٧٢٩١٠٥", "| KM4729105 ."]:
        assert C._serial([line(text, (0, 0, 9, 9), 0.9)]) == 0.9, text
    for text in ["KM47291", "km4729105", "XKM4729105", "KM47291050", "٤٧٢٩١٠٥"]:
        assert C._serial([line(text, (0, 0, 9, 9), 0.9)]) == 0, text


def test_the_printed_serial_is_a_modest_sign_of_the_front_and_never_turns_the_card():
    plain = np.full((CARD_H, CARD_W, 3), 236, np.uint8)  # no barcode, no print: only what the reader gives counts
    heading = line("العربية", (420, 60, 760, 110), 0.9)  # one word of the front's heading: not enough on its own
    serial = line("KM 4729105", (60, 520, 330, 560), 0.95)
    alone = C.judge(StubEngine(lambda image: [heading]), plain)
    assert alone.side is None
    both = C.judge(StubEngine(lambda image: [heading, serial]), plain)
    assert both.side == "front" and not both.flip
    assert C.judge(StubEngine(lambda image: [serial]), plain).side is None  # a serial alone does not make a front

    # seen only on the card turned upside down, it does not make the reader turn the card
    marked = plain.copy()
    marked[:40, :40] = 30  # tells the stub which way up it is shown the card
    upside_down = C.judge(StubEngine(lambda image: [serial] if image[-10:, -10:].mean() < 100 else []), marked)
    assert not upside_down.flip and upside_down.side is None


def test_a_name_is_not_taken_for_a_word_of_the_card():
    # a word read shorter than the card's word is never it; one as long or a letter longer still is, as misread
    assert not C._matches("ساره", "ساريه") and not C._matches("العرب", "العربيه")
    assert C._matches("ساريه", "ساريه") and C._matches("سارييه", "ساريه") and C._matches("العربيىه", "العربيه")
    # سامية is as like سارية as a misreading of it: it is taken for it only beside the words printed with it on the back
    name = [line("سامية", (600, 150, 760, 190), 0.95)]
    assert C._word_score(name, C._BACK_WORDS) == 0
    misread = [line("البطاقة سامية حتى ٢٠٣١/٠٥/٠٢", (300, 330, 760, 370), 0.9)]
    assert C._word_score(misread, C._BACK_WORDS) >= 1.5 * 0.9 - 1e-9  # سارية and حتى
    assert C._word_score([line("سامية البطاقه", (0, 0, 9, 9), 0.9)], C._BACK_WORDS) > 1
    # the Persian forms of ي and ك, which the reader sometimes gives, are the Arabic ones
    assert C._normal_words("مسیحیة کفر") == ["مسيحيه", "كفر"]


def test_a_front_whose_holder_is_named_like_a_word_of_the_back_is_still_the_front():
    plain = np.full((CARD_H, CARD_W, 3), 236, np.uint8)
    front = [
        line("مصر العربية", (430, 30, 760, 70), 0.9),  # the heading, half read
        line("سامية", (640, 150, 760, 190), 0.95),  # a made-up holder: Samia Adel Fathy
        line("عادل فتحي", (560, 200, 760, 240), 0.95),
        line("٢٨٨٠٧١٥٠٢١٢٣٤٥", (420, 430, 760, 470), 0.95),  # the number along the bottom
    ]
    verdict = C.judge(StubEngine(lambda image: front), plain)
    assert verdict.side == "front" and verdict.confidence >= 0.8


def test_the_number_along_the_head_of_the_card_is_a_sign_of_the_back():
    plain = np.full((CARD_H, CARD_W, 3), 236, np.uint8)
    marital = line("متزوجة", (620, 230, 760, 270), 0.9)  # one word of the back: not enough on its own
    number = line("٢٨٨٠٧١٥٠٢١٢٣٤٥  ٢٠٢١/٠٣", (330, 25, 760, 65), 0.95)
    assert C.judge(StubEngine(lambda image: [marital]), plain).side is None
    assert C.judge(StubEngine(lambda image: [marital, number]), plain).side == "back"
    # the same number along the foot is the front's
    foot = line(number.text, (330, 430, 760, 470), 0.95)
    assert C._number_at_top([foot], 504) == 0 and C._number_at_top([number], 504) == 0.95


# POST /cards


def test_a_scan_of_both_sides_gives_the_front_first_cut_out_straight_and_upright(make_client):
    # the back at the top of the page, upside down; the front below it
    page, placed = scanned_page([("back", 1240, 900, 184), ("front", 1240, 2500, 4)])
    response = send(make_client(CardReader()), encode(page))
    assert response.status_code == 200
    body = response.json()
    assert [(p["width"], p["height"]) for p in body["pages"]] == [(1414, 2000)]
    assert decode(body["pages"][0]["image"]).shape == (2000, 1414, 3)
    assert [c["side"] for c in body["cards"]] == ["front", "back"]
    f = 1414 / 2480
    for card, truth in zip(body["cards"], [placed[1], placed[0]], strict=True):
        box = card["box"]
        # the box is measured from the page's top-left corner: a pixel's centre is half a pixel in
        assert box["cx"] == pytest.approx((truth.cx + 0.5) * f, abs=1.0)
        assert box["cy"] == pytest.approx((truth.cy + 0.5) * f, abs=1.0)
        assert box["w"] == pytest.approx(truth.w * f, abs=1.5) and box["h"] == pytest.approx(truth.h * f, abs=1.5)
        assert turn(box["angle"], truth.angle, 180) <= 0.2  # 184 degrees comes back as -176
        assert -180 < box["angle"] <= 180
        assert card["page"] == 0 and card["confidence"] >= 0.9
        image = decode(card["image"])
        assert image.shape[1] > image.shape[0]  # landscape
        assert abs(image.shape[1] - 1044) <= 2
        likeness, side, flipped = looks_like(image)
        assert (side, flipped) == (card["side"], False) and likeness > 0.8  # upright
        assert card["frame"] == pytest.approx([0.0213, 0.0213, 0.9787, 0.9787], abs=0.003)


def test_the_box_cuts_the_same_card_as_the_manual_tool_would(make_client):
    # rotate the page by -angle around the centre and cut w x h there: the card, upright, as the service cut it
    page, _ = scanned_page([("front", 1300, 1500, -6), ("back", 1100, 2700, 177)], background="white")
    body = send(make_client(CardReader()), encode(page)).json()
    shown_page = decode(body["pages"][0]["image"])
    for card in body["cards"]:
        box = card["box"]
        matrix = cv2.getRotationMatrix2D((box["cx"], box["cy"]), box["angle"], 1.0)  # OpenCV: positive turns left
        matrix[:, 2] += [box["w"] / 2 - box["cx"], box["h"] / 2 - box["cy"]]
        manual = cv2.warpAffine(shown_page, matrix, (round(box["w"]), round(box["h"])), flags=cv2.INTER_LINEAR)
        likeness, side, flipped = looks_like(np.pad(manual, ((14, 14), (14, 14), (0, 0)), mode="edge"))
        assert (side, flipped) == (card["side"], False) and likeness > 0.7


def test_sides_unknown_are_in_reading_order(make_client):
    page, _ = scanned_page(
        [("front", 1240, 2600, 0), ("back", 1800, 900, 2), ("front", 640, 950, -2)], background="dark"
    )
    body = send(make_client(StubEngine()), encode(page)).json()  # nothing reads
    f = 1414 / 2480
    assert [c["box"]["cx"] / f for c in body["cards"]] == pytest.approx([640, 1800, 1240], abs=3)  # row by row
    assert [c["side"] for c in body["cards"]] == [None, "back", None]  # the barcode still tells the back
    assert [c["confidence"] for c in body["cards"]][::2] == [0, 0]


def test_a_pdf_with_one_side_per_page(make_client):
    back, _ = scanned_page([("back", 1240, 1500, -2)], background="white", seed=1)
    front, _ = scanned_page([("front", 1300, 1000, 3)], background="white", seed=2)
    response = send(make_client(CardReader()), pdf_of([back, front]), filename="id.pdf")
    assert response.status_code == 200
    body = response.json()
    assert [(p["width"], p["height"]) for p in body["pages"]] == [(1414, 2000), (1414, 2000)]
    assert [(c["side"], c["page"]) for c in body["cards"]] == [("front", 1), ("back", 0)]
    assert body["cards"][0]["box"]["cx"] == pytest.approx(1300.5 * 1414 / 2480, abs=1.5)


def test_only_the_first_two_pages_of_a_pdf_are_looked_at_and_a_long_one_is_not_refused(make_client):
    engine = CardReader()
    response = send(make_client(engine), pdf(*[(595, 842, (255, 255, 255))] * 25), filename="long.pdf")
    assert response.status_code == 200
    assert len(response.json()["pages"]) == 2 and response.json()["cards"] == []


def test_no_card_is_an_empty_list_not_an_error(make_client):
    page, _ = scanned_page([], background="white")
    response = send(make_client(CardReader()), encode(page))
    assert response.status_code == 200
    assert response.json()["cards"] == [] and len(response.json()["pages"]) == 1


@pytest.mark.parametrize("quarter, angle", [(0, 0), (1, 90), (3, -90), (2, 180)])
@pytest.mark.parametrize("margin", [0, 1.2])
def test_a_picture_that_is_a_card_is_not_cut_again(make_client, quarter, angle, margin):
    picture = card_picture("front", quarter, margin_mm=margin)
    height, width = picture.shape[:2]
    body = send(make_client(CardReader()), encode(picture, "PNG"), filename="card.png").json()
    [card] = body["cards"]
    assert card["box"] == {"cx": width / 2, "cy": height / 2, "w": max(width, height), "h": min(width, height),
                           "angle": angle}
    assert card["frame"] == [0.0, 0.0, 1.0, 1.0] and card["side"] == "front"
    image = decode(card["image"])
    assert image.shape[1] == C.CARD_WIDTH and image.shape[1] > image.shape[0]
    assert looks_like(image)[1:] == ("front", False)


def test_a_card_cut_off_by_the_top_of_the_picture_is_made_whole(make_client):
    page, [card] = scanned_page([("back", 900, 700, 0)], size=(1800, 1400), background="white", shadow=False)
    top = round(card.cy - card.h / 2 + 3 * MM)  # 3 mm of the card above the picture
    body = send(make_client(CardReader()), encode(np.ascontiguousarray(page[top:]), "PNG"), filename="s.png").json()
    [found] = body["cards"]
    box = found["box"]
    assert box["w"] / box["h"] == pytest.approx(C.CARD_ASPECT, abs=0.004)
    assert box["cy"] - box["h"] / 2 == pytest.approx(-3 * MM, abs=1.5)  # its top is 3 mm above the picture
    assert found["frame"][1] < 0 and found["side"] == "back"


# Refusals, like /read


def test_unsupported_unreadable_and_empty_files_are_400(make_client):
    client = make_client(CardReader())
    response = send(client, b"GIF89a" + b"\x00" * 100, filename="x.gif")
    assert response.status_code == 400 and "JPEG, PNG, WebP or PDF" in response.json()["detail"]
    assert send(client, b"\x89PNG\r\n\x1a\n" + b"rubbish" * 9).status_code == 400
    assert send(client, b"%PDF-1.7\n" + b"rubbish" * 50, filename="x.pdf").json()["detail"].startswith("The PDF")
    assert send(client, b"").json() == {"detail": "The file is empty."}
    assert send(client, encode(np.zeros((9, 9, 3), np.uint8)), field="upload").status_code == 400


def test_a_file_over_15_mb_is_413(make_client):
    response = send(make_client(CardReader()), b"\xff\xd8\xff" + b"\x00" * MAX_FILE_BYTES)
    assert response.status_code == 413 and response.json() == {"detail": "The file is larger than 15 MB."}


def test_cards_is_503_while_the_models_load(make_client):
    gate = threading.Event()
    client = make_client(CardReader(load_gate=gate), ready=False)
    assert send(client, encode(np.zeros((9, 9, 3), np.uint8))).status_code == 503
    gate.set()
    wait_ready(client)


def test_the_log_says_what_was_found_but_never_what_was_read(make_client, caplog):
    page, _ = scanned_page([("front", 1240, 900, -7), ("back", 1240, 2500, 3)])
    with caplog.at_level(logging.INFO, logger="ocr"):
        assert send(make_client(CardReader()), encode(page)).status_code == 200
    assert "cards: jpeg" in caplog.text and "2 card(s), front, back" in caplog.text
    assert "سارية" not in caplog.text and "٢٩١" not in caplog.text


def test_an_engine_failure_is_a_500(make_client):
    def broken(image):
        raise RuntimeError("inference failed")

    page, _ = scanned_page([("front", 1240, 900, -7)])
    response = send(make_client(StubEngine(broken)), encode(page))
    assert response.status_code == 500 and "cards" in response.json()["detail"]
