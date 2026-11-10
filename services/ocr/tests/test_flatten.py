"""A card photographed at an angle (app/cards.py, "A card photographed at an angle"): the arithmetic of flattening it,
and the finder on made-up cards drawn by tests/synthetic_cards.py and photographed through a lens drawn by
tests/camera.py. After Prime ERP's flatten.test.ts and finder.test.ts (10 November 2026). A card seen straight is cut
out as before: every other test of test_cards.py still holds.
"""

import math
import time

import cv2
import numpy as np
import pytest

from app import cards as C
from app.main import PAGE_SIDE

from .camera import mapped, photo, photographed
from .synthetic_cards import CARD_W, LID, encode, make_card, place, scanned_page
from .test_cards import CardReader, decode, looks_like, send

W, H = 4000, 3000
CARD = (1700.0, 1700.0 / C.CARD_ASPECT)
DESK = (43, 43, 46)


def quad_of(points) -> np.ndarray:
    return np.array(points, dtype=np.float64)


# The shape four corners make


def test_a_card_has_no_corner_pushed_in_and_no_sides_that_cross():
    assert C.convex(quad_of([[0, 0], [10, 0], [10, 6], [0, 6]]))
    assert C.convex(quad_of([[0, 0], [10, 1], [9, 7], [1, 6]]))
    assert not C.convex(quad_of([[0, 0], [10, 0], [3, 3], [0, 6]]))  # a corner pushed in
    assert not C.convex(quad_of([[0, 0], [10, 6], [10, 0], [0, 6]]))  # sides that cross
    assert not C.convex(quad_of([[0, 0], [10, 0], [20, 0], [0, 6]]))  # three on a line


def test_how_slanted_opposite_sides_that_differ_and_corners_off_square():
    sides, corner = C.slant_of(quad_of([[0, 0], [100, 0], [100, 63], [0, 63]]))
    assert sides == 0 and corner == pytest.approx(0, abs=1e-9)
    sides, corner = C.slant_of(quad_of([[10, 0], [90, 0], [100, 63], [0, 63]]))  # the far side 80, the near one 100
    assert sides == pytest.approx(0.2) and corner == pytest.approx(math.degrees(math.atan(10 / 63)))


# The proportions of a card from its corners on a photo


@pytest.mark.parametrize("f", [1800, 3000, 4500])
@pytest.mark.parametrize("tilt, yaw, roll", [(25, 12, 4), (-18, 20, -7), (35, -9, 2), (10, 10, 0)])
def test_with_both_pairs_of_sides_running_together_the_focal_length_and_the_proportions_come_back(f, tilt, yaw, roll):
    q = photo(W, H, f, *CARD, tilt=tilt, yaw=yaw, roll=roll, dx=150, dy=-90) - 0.5
    ratio, sure = C.true_ratio(q, W, H)
    assert sure and ratio == pytest.approx(C.CARD_ASPECT, abs=1e-6)


def test_seen_straight_no_focal_length_is_needed_and_tipped_only_forwards_a_phones_is_taken():
    ratio, sure = C.true_ratio(photo(W, H, 3000, *CARD, roll=7) - 0.5, W, H)
    assert sure and ratio == pytest.approx(C.CARD_ASPECT, abs=1e-9)
    assert C.true_ratio(photo(W, H, 3000, 1250, 880, roll=-3) - 0.5, W, H)[0] == pytest.approx(1250 / 880, abs=1e-9)
    for f in (2700, 3000, 3300):  # a phone's main camera: about 0.6 of the diagonal (5000)
        ratio, sure = C.true_ratio(photo(W, H, f, *CARD, tilt=28) - 0.5, W, H)
        assert not sure and abs(ratio / C.CARD_ASPECT - 1) <= C.SNAP["guessed"]
    # with its own focal length, exact
    assert C.true_ratio(photo(W, H, 3000, *CARD, tilt=28) - 0.5, W, H)[0] == pytest.approx(C.CARD_ASPECT, abs=1e-6)


# Which corners are a card slanted on a photo

STRAIGHT = photo(W, H, 3000, *CARD, roll=5) - 0.5


def test_a_card_photographed_at_an_angle_is_flattened_and_one_seen_straight_is_cut_out_as_before():
    q = photo(W, H, 3000, *CARD, tilt=22, yaw=9, roll=5) - 0.5
    flat = C.flat_of(q, STRAIGHT, CARD[0], W, H)
    assert flat is not None and np.array_equal(flat.quad, q) and flat.sure
    assert flat.ratio == pytest.approx(C.CARD_ASPECT, abs=1e-6)
    assert C.flat_of(STRAIGHT, STRAIGHT, CARD[0], W, H) is None
    nearly = photo(W, H, 3000, *CARD, tilt=2, roll=5) - 0.5  # a hand a little off straight: under 2% between its sides
    assert C.slant_of(nearly)[0] < 0.02 and C.flat_of(nearly, STRAIGHT, CARD[0], W, H) is None


def test_four_corners_that_are_not_a_card_slanted_are_refused():
    q = photo(W, H, 3000, *CARD, tilt=22, yaw=9, roll=5) - 0.5

    def moved(i, dx, dy):
        out = q.copy()
        out[i] += (dx, dy)
        return out

    assert C.flat_of(q[[0, 2, 1, 3]], STRAIGHT, CARD[0], W, H) is None  # sides that cross
    assert C.flat_of(moved(2, -900, -500), STRAIGHT, CARD[0], W, H) is None  # a corner pushed in
    assert C.flat_of(moved(1, 400, 0), STRAIGHT, CARD[0], W, H) is None  # a corner far from the card found
    left = np.array([1400, 0])
    assert C.flat_of(q - left, STRAIGHT - left, CARD[0], W, H) is None  # a card the picture cuts off
    steep = photo(W, H, 3000, *CARD, tilt=75, roll=5) - 0.5
    assert C.flat_of(steep, STRAIGHT, CARD[0], W, H) is None  # further over than a phone held over a card
    square = photo(W, H, 3000, 1300, 1200, tilt=22, yaw=9) - 0.5
    assert C.flat_of(square, photo(W, H, 3000, 1300, 1200) - 0.5, 1300, W, H) is None  # not a card's proportions


# What is cut out for a card flattened

Q = quad_of([[400, 300], [2300, 360], [2380, 1500], [330, 1420]])
ID_FRAME = [1.9 / (85.6 + 3.8), 1.2 / (53.98 + 2.4), 1 - 1.9 / (85.6 + 3.8), 1 - 1.2 / (53.98 + 2.4)]


def card_on(out_w, out_h, frame):
    return (frame[2] - frame[0]) * out_w, (frame[3] - frame[1]) * out_h


def test_an_id_card_goes_to_a_rectangle_of_a_cards_shape_with_the_margin_all_round_as_cut_out_cuts_one():
    out_w, out_h, corners, frame = C.flat_plan(C.Flat(Q, C.CARD_ASPECT, True))
    assert frame == pytest.approx(ID_FRAME, abs=1e-9)
    assert out_w == pytest.approx(C.CARD_WIDTH * (85.6 + 3.8) / 85.6, abs=1)  # 1044, as cut_out gives
    w, h = card_on(out_w, out_h, frame)
    assert w == pytest.approx(C.CARD_WIDTH, abs=1) and w / h == pytest.approx(C.CARD_ASPECT, abs=0.003)
    # the corners go to the corners of the card on the cut (pixel indices)
    want = np.array([[frame[0] * out_w, frame[1] * out_h], [frame[2] * out_w, frame[1] * out_h],
                     [frame[2] * out_w, frame[3] * out_h], [frame[0] * out_w, frame[3] * out_h]]) - 0.5
    assert np.abs(corners - want).max() < 1e-9


def test_proportions_told_a_little_off_an_id_cards_are_laid_on_its_shape_and_the_stretch_kept_beyond():
    r = C.CARD_ASPECT * 1.04
    out_w, out_h, corners, frame = C.flat_plan(C.Flat(Q, r, False))
    w, h = card_on(out_w, out_h, frame)
    assert w / h == pytest.approx(C.CARD_ASPECT, abs=0.003)
    shown = w / r  # what the corners showed, stretched to the card
    extra = h - shown
    margin = frame[1] * out_h
    assert margin == pytest.approx(1.2 * w / 85.6 + extra, abs=1.5)  # beyond the card, as much again as was stretched
    # told surely, 4% off is not an ID card's: a strip made up for instead
    assert C.flat_plan(C.Flat(Q, r, True))[3] != pytest.approx(frame)


def test_a_passport_page_keeps_its_own_proportions_and_a_card_short_by_a_strip_is_made_whole():
    out_w, out_h, _, frame = C.flat_plan(C.Flat(Q, 1.42, True))
    w, h = card_on(out_w, out_h, frame)
    assert w / h == pytest.approx(1.42, abs=0.003)
    out_w, out_h, corners, frame = C.flat_plan(C.Flat(Q, C.CARD_ASPECT * 1.07, True))
    w, h = card_on(out_w, out_h, frame)
    assert w / h == pytest.approx(C.CARD_ASPECT, abs=0.003)  # made whole
    # the card the corners show lies inside the card made whole, half the strip to spare on either side
    assert corners[0][1] > frame[1] * out_h + 1 and corners[3][1] < frame[3] * out_h - 1


def test_the_cut_takes_each_point_from_where_the_transform_sends_it_and_white_past_the_picture():
    # a picture whose every point says where it is: its column in blue, its row in green
    picture = np.zeros((600, 800, 3), np.uint8)
    picture[..., 0] = (np.arange(800)[None, :] // 4).astype(np.uint8)
    picture[..., 1] = (np.arange(600)[:, None] // 3).astype(np.uint8)
    q = quad_of([[180, 120], [620, 140], [650, 430], [150, 420]])
    flat = C.Flat(q, C.CARD_ASPECT, True)
    cut, frame = C.cut_flat(picture, flat)
    out_w, out_h, corners, _ = C.flat_plan(flat)
    assert cut.shape == (out_h, out_w, 3) and frame == pytest.approx(ID_FRAME, abs=1e-9)
    back = cv2.getPerspectiveTransform(corners.astype(np.float32), q.astype(np.float32))
    for x, y in ((300, 200), (700, 500), (100, 600), (900, 150)):
        sx, sy = mapped(back, [[x, y]])[0]
        assert cut[y, x, 0] == pytest.approx(sx / 4, abs=1.5) and cut[y, x, 1] == pytest.approx(sy / 3, abs=1.5)
    # the margin reaches past the picture at a corner: white there
    far = C.Flat(quad_of([[3, 3], [440, 20], [470, 300], [2, 290]]), C.CARD_ASPECT, True)
    assert (C.cut_flat(picture, far)[0][0, 0] == 255).all()


# The finder on cards photographed at an angle


def world(cards, size=(1500, 1100), ground=DESK, card_width=CARD_W):
    """A flat scene (RGB) of cards, each (side, cx, cy, angle), on a desk of one colour or the white of a lid, and where
    each card is. The photo adds the grain."""
    page = np.full((size[1], size[0], 3), ground, dtype=np.uint8)
    boxes = []
    for i, (side, cx, cy, angle) in enumerate(cards):
        p = place(page, make_card(side, seed=i, width=card_width), cx, cy, angle, side)
        boxes.append(C.Box(p.cx, p.cy, p.w, p.h, p.angle))
    return page, boxes


def taken(scene, boxes, width, height, f, ground, seed=0, **pose):
    """The scene photographed (BGR, as the service looks at it) and where each card's corners show on it."""
    picture, matrix = photographed(scene, width, height, f, ground, seed=seed, **pose)
    return np.ascontiguousarray(picture[:, :, ::-1]), [mapped(matrix, box.corners()) for box in boxes]


def cut_of(found: C.Found, picture: np.ndarray):
    """The card cut out flattened from its corners (as find_on_page cuts it), and the transform from the picture to the
    cut."""
    cut, frame = C.cut_flat(picture, found.flat)
    out_w, out_h, corners, _ = C.flat_plan(found.flat)
    to_cut = cv2.getPerspectiveTransform(found.flat.quad.astype(np.float32), corners.astype(np.float32))
    return cut, frame, to_cut


def on_frame(cut, frame, to_cut, truth, by):
    """The card's own corners land on the corners of the card on the cut, within `by` pixels."""
    h, w = cut.shape[:2]
    want = np.array([[frame[0] * w, frame[1] * h], [frame[2] * w, frame[1] * h],
                     [frame[2] * w, frame[3] * h], [frame[0] * w, frame[3] * h]]) - 0.5
    off = np.linalg.norm(mapped(to_cut, truth) - want, axis=1)
    assert off.max() <= by, off


def as_before(found: C.Found, picture: np.ndarray) -> np.ndarray:
    """The card cut out as a rectangle set straight, as cut_out cut it before: to compare with."""
    reach, _ = C.cut_plan(found.box, (0.0, 0.0), picture.shape[1], picture.shape[0])
    return C.cut_out(picture, found.box, reach)


@pytest.mark.parametrize(
    "background, side, f, pose",
    [
        ("dark", "front", 1250, dict(tilt=24, yaw=10, roll=4, size=0.95)),
        ("white", "back", 1350, dict(tilt=-22, yaw=-8, roll=-5, size=0.95)),
    ],
)
def test_on_a_dark_desk_or_a_white_lid_the_corners_are_found_and_the_card_flattened(background, side, f, pose):
    ground = DESK if background == "dark" else (LID, LID, LID)
    scene, [box] = world([(side, 750, 550, 0)], ground=ground)
    picture, [truth] = taken(scene, [box], 1600, 1200, f, ground, seed=4, **pose)
    [found] = C.find_cards(picture)
    assert found.flat is not None
    assert np.linalg.norm(found.flat.quad - truth, axis=1).max() <= 1.5
    assert found.flat.sure and abs(found.flat.ratio / C.CARD_ASPECT - 1) < 0.01
    cut, frame, to_cut = cut_of(found, picture)
    w, h = card_on(cut.shape[1], cut.shape[0], frame)
    assert w / h == pytest.approx(C.CARD_ASPECT, abs=0.003) and w == pytest.approx(C.CARD_WIDTH, abs=1)
    on_frame(cut, frame, to_cut, truth, 2)
    # it looks like the made-up card, upright; cut out as before, the same card slants and looks less like it
    likeness, seen, flipped = looks_like(cut)
    assert (seen, flipped) == (side, False) and likeness > 0.85
    assert looks_like(as_before(found, picture))[0] < likeness - 0.05


@pytest.mark.parametrize("f", [1100, 1200, 1350])  # a phone's own, near 0.6 of the photo's diagonal (2000)
def test_tipped_only_forwards_a_phones_focal_length_is_taken_and_nothing_of_the_card_is_lost(f):
    scene, [box] = world([("front", 750, 550, 0)])
    picture, [truth] = taken(scene, [box], 1600, 1200, f, DESK, tilt=26, size=0.95)
    [found] = C.find_cards(picture)
    assert found.flat is not None and not found.flat.sure
    cut, frame, to_cut = cut_of(found, picture)
    w, h = card_on(cut.shape[1], cut.shape[0], frame)
    assert w / h == pytest.approx(C.CARD_ASPECT, abs=0.003)
    # the whole card on the cut, a rectangle, inside the margin: no more off the frame than a hundredth of the card
    shown = mapped(to_cut, truth)
    (l, t), (r, _), (_, b) = shown[0], shown[1], shown[2]
    assert abs(shown[0][1] - shown[1][1]) <= 1.5 and abs(shown[3][1] - shown[2][1]) <= 1.5
    assert abs(shown[0][0] - shown[3][0]) <= 1.5 and abs(shown[1][0] - shown[2][0]) <= 1.5
    assert 2 < l and 2 < t and r < cut.shape[1] - 2 and b < cut.shape[0] - 2
    on_frame(cut, frame, to_cut, truth, 0.03 * h)


def test_a_photocopy_on_a_desk_both_sides_on_it_photographed_at_an_angle_each_card_is_flattened():
    sheet = np.full((1700, 2600, 3), 35, dtype=np.uint8)
    cv2.rectangle(sheet, (150, 200), (2450, 1500), (250, 250, 250), -1)
    boxes = []
    for side, cx in (("front", 750), ("back", 1850)):
        p = place(sheet, make_card(side), cx, 850, 2, side)
        boxes.append(C.Box(p.cx, p.cy, p.w, p.h, p.angle))
    sheet = np.clip(sheet + np.random.default_rng(0).normal(0, 3, sheet.shape), 0, 255).astype(np.uint8)
    picture, truths = taken(sheet, boxes, 2400, 1800, 1700, (35, 35, 35), tilt=15, yaw=-5, roll=-2, size=0.62)
    small = C.shrunk(picture, PAGE_SIDE)
    k = small.shape[1] / picture.shape[1]
    found = C.find_cards(small)
    assert len(found) == 2
    for truth in truths:
        truth = (truth + 0.5) * k - 0.5
        card = min(found, key=lambda c: np.linalg.norm(c.box.centre - truth.mean(axis=0)))
        assert card.flat is not None
        assert np.linalg.norm(card.flat.quad - truth, axis=1).max() <= 1.5
        cut, frame, to_cut = cut_of(card, small)
        on_frame(cut, frame, to_cut, truth, 2)


def test_both_sides_on_a_dark_desk_photographed_together_at_an_angle_each_is_found_and_flattened():
    scene, boxes = world([("front", 800, 560, 0), ("back", 800, 1640, 0)], size=(1600, 2200))
    picture, truths = taken(scene, boxes, 1800, 2400, 1800, DESK, tilt=20, yaw=-9, roll=3, size=0.85)
    small = C.shrunk(picture, PAGE_SIDE)
    k = small.shape[1] / picture.shape[1]
    found = C.find_cards(small)
    assert len(found) == 2 and all(f.flat is not None for f in found)
    for truth in truths:
        truth = (truth + 0.5) * k - 0.5
        card = min(found, key=lambda c: np.linalg.norm(c.flat.quad.mean(axis=0) - truth.mean(axis=0)))
        assert np.linalg.norm(card.flat.quad - truth, axis=1).max() <= 1.5


def test_photographed_from_straight_above_or_cut_off_by_the_photo_a_card_is_cut_out_as_before():
    scene, [box] = world([("front", 750, 550, 0)])
    level, _ = taken(scene, [box], 1600, 1200, 1250, DESK, roll=6, size=0.95)
    [found] = C.find_cards(level)
    assert found.flat is None
    cut_off, [truth] = taken(scene, [box], 1600, 1200, 1250, DESK, tilt=22, yaw=8, size=0.95, dx=-390)
    assert truth[:, 0].min() < 0  # the photo cuts the card off on its left
    [found] = C.find_cards(cut_off)
    assert found.flat is None  # made whole as before, not flattened from corners it does not have
    for background in ("dark", "white"):  # scanned
        page, _ = scanned_page([("front", 1240, 900, -7), ("back", 1240, 2500, 184)], background=background)
        assert all(f.flat is None for f in C.find_cards(C.shrunk(np.ascontiguousarray(page[:, :, ::-1]), PAGE_SIDE)))


def test_a_12_megapixel_phone_photo_taken_at_an_angle_is_found_and_flattened_in_good_time():
    brown = (128, 98, 72)
    scene, [box] = world([("front", 1350, 950, 0)], size=(2700, 1900), ground=brown, card_width=2000)
    full, [truth] = taken(scene, [box], 4000, 3000, 3000, brown, tilt=25, yaw=8, roll=3, size=1.02)
    page = C.shrunk(full, PAGE_SIDE)
    k = page.shape[1] / full.shape[1]
    started = time.perf_counter()
    [card] = C.find_on_page(CardReader(), page, full, 0)
    took = time.perf_counter() - started
    assert card.quad is not None
    assert np.linalg.norm(card.quad - ((truth + 0.5) * k - 0.5), axis=1).max() <= 1.5
    assert card.image.shape[1] == pytest.approx(C.CARD_WIDTH * (85.6 + 3.8) / 85.6, abs=1)
    likeness, side, flipped = looks_like(card.image)
    assert (side, flipped) == ("front", False) and likeness > 0.85
    print(f"12 MP photo at an angle: found, flattened and told in {took:.2f} s")
    assert took < 10


# Through POST /cards


def test_a_photo_at_an_angle_comes_back_flattened_and_upright_with_its_corners(make_client):
    # the back upside down on a dark desk, photographed at an angle
    scene, [box] = world([("back", 750, 550, 180)])
    picture, [truth] = taken(scene, [box], 1600, 1200, 1250, DESK, tilt=24, yaw=10, roll=4, size=0.95)
    body = send(make_client(CardReader()), encode(np.ascontiguousarray(picture[:, :, ::-1]), "PNG"), "a.png").json()
    [card] = body["cards"]
    assert card["side"] == "back"
    image = decode(card["image"])
    likeness, side, flipped = looks_like(image)
    assert (side, flipped) == ("back", False) and likeness > 0.85
    assert card["frame"] == pytest.approx(ID_FRAME, abs=0.003)
    # the corners of the upright card, from its top left, measured from the page's top-left corner: the card lay upside
    # down, so its top left is where the scene's card has its bottom right
    corners = np.array(card["quad"])
    assert corners.shape == (4, 2)
    assert np.linalg.norm(corners - (truth + 0.5), axis=1).max() <= 1.6
    # the box is the rectangle the corners make on the whole, upright
    assert abs(C._wrap(card["box"]["angle"] - 180, 180)) < 30
    # a card seen straight has no corners in the answer
    page, _ = scanned_page([("front", 1240, 900, -7)], background="dark")
    [straight] = send(make_client(CardReader()), encode(page)).json()["cards"]
    assert "quad" not in straight


def test_the_log_says_a_card_was_flattened(make_client, caplog):
    scene, [box] = world([("front", 750, 550, 0)])
    picture, _ = taken(scene, [box], 1600, 1200, 1250, DESK, tilt=24, yaw=10, roll=4, size=0.95)
    with caplog.at_level("INFO"):
        send(make_client(CardReader()), encode(np.ascontiguousarray(picture[:, :, ::-1]), "PNG"), "a.png")
    assert any("front (flattened)" in record.getMessage() for record in caplog.records)

