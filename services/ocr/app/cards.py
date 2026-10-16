"""National ID cards on a scanned page or a photo: where each card is, cut out and straightened, which way up it goes
and which side of the card it is. Everything happens in memory.

A flatbed scan often holds both sides of the card on one page, each somewhere on the glass, a little tilted, on a dark
background (the lid left open) or a white one (the lid closed). A phone photo holds one card on a desk. A picture may
also be a card cut out already.

  1. Find: the page is compared with its background colour (the typical colour along its border), and so is any sheet
     of paper filling much of it with its own colour (a photo of a photocopy on a desk). Card-shaped regions are looked
     for three ways (anything unlike the background, an automatic threshold of that, and edges): an outline whose
     smallest enclosing rotated rectangle has about the proportions of an ID-1 card (85.60 x 53.98 mm, 1.586; 1.45 to
     1.80 is accepted), fills it, and has background along most of its outline is a candidate. Of candidates that
     overlap, the larger is kept; one inside a card (its photo) is not a card; one holding two cards is a sheet. At
     most MAX_CARDS are kept.
  2. Refine: each edge is found again on the page itself, where the background ends along 48 short cuts across it, and
     a straight line is fitted through those points: the corners are where the lines meet, to a fraction of a pixel and
     of a degree. Past the edge of the picture counts as background, so a card the picture cuts off ends there.
  3. The whole card, never less: a card has a card's proportions. When the shape found is shorter than that, a strip
     of the card did not show: it runs off the picture, or it is as pale as the lid. The box is made up to the card's
     proportions on the side where the card runs off the picture; failing that, on the side where the strip still
     stands out a little from the background; failing that, on both sides, and the cut keeps as much again to spare.
  4. Cut out: the box, straightened, with a margin of 1.2 mm above and below the card and 1.9 mm at its sides (in the
     card's own millimetres), never past the edge of the picture (what falls outside it at a corner is white). A
     picture that is a card cut out already is not cut again.
  5. Which way up: the card is read both ways up with the Arabic recogniser and kept the way that reads as more
     confident Arabic letters (digits do not count: ١ ٠ ٨ ٧ look like digits upside down too). When the first reading
     already finds the words printed on one side of the card, the second is skipped.
  6. Which side: from the words (the front's "جمهورية مصر العربية" and "بطاقة تحقيق الشخصية"; the back's "البطاقة
     سارية حتى", ذكر/أنثى, religion, marital status), the front's 14-digit number along the bottom, and the back's
     barcode band along the bottom (strong left-right changes, almost no up-down ones).

Coordinates here are pixel indices (a pixel's centre is at whole numbers); the service reports them with 0 at the
picture's top-left corner (see main.py and README.md).
"""

import math
import re
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

import cv2
import numpy as np

CARD_MM = (85.60, 53.98)
CARD_ASPECT = CARD_MM[0] / CARD_MM[1]
MIN_ASPECT, MAX_ASPECT = 1.45, 1.80  # a sheet of A4, at 1.41, is not a card
MIN_AREA_SHARE, MAX_AREA_SHARE = 0.02, 0.95  # of the page
# The longest strip made up for, as a share of the card: lost along a long side (6.5 mm of its height), or along a
# short one (7.7 mm of its width). A shape short of a card by more than that is left as it is: it is not a card that
# lost a strip.
MAX_STRIP = {"h": 0.12, "w": 0.09}
MARGIN_MM = (1.9, 1.2)  # kept around a card that is cut out: at its sides, and above and below it
MAX_CARDS = 4
DETECTION_SIDE = 1000  # the page is searched at most this large; edges are then refined on the page itself
CARD_WIDTH = 1000  # a card is cut out this wide (its margin adds about 44 px)
READ_WIDTH = 800  # and read this wide to tell which way up it goes and which side it is
SIDE_THRESHOLD = 0.6  # below this confidence, the side is not given
WHOLE_ASPECT = (1.48, 1.72)  # a picture this shape may be a card cut out already (an A4 page, at 1.41, is not one)


@dataclass(frozen=True)
class Box:
    """A rotated rectangle: centre, size (w >= h once normalised) and angle (degrees, clockwise on screen)."""

    cx: float
    cy: float
    w: float
    h: float
    angle: float

    @property
    def axes(self) -> tuple[np.ndarray, np.ndarray]:
        """Unit vectors along the card's width (left to right) and height (top to bottom), y pointing down."""
        a = math.radians(self.angle)
        return np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])

    @property
    def centre(self) -> np.ndarray:
        return np.array([self.cx, self.cy])

    def corners(self) -> np.ndarray:
        """Top-left, top-right, bottom-right, bottom-left of the card as it reads; 4 x 2."""
        u, v = self.axes
        hu, hv = u * self.w / 2, v * self.h / 2
        c = self.centre
        return np.array([c - hu - hv, c + hu - hv, c + hu + hv, c - hu + hv])

    def turned(self, degrees: float) -> "Box":
        return replace(self, angle=_wrap(self.angle + degrees, 180))

    @staticmethod
    def from_corners(quad: np.ndarray) -> "Box":
        """The rectangle that best fits four corners in reading order (TL, TR, BR, BL)."""
        tl, tr, br, bl = quad
        u = (tr - tl) + (br - bl)
        v = (bl - tl) + (br - tr)
        # the width direction, averaged with the height direction turned back a quarter
        direction = u / np.linalg.norm(u) + np.array([v[1], -v[0]]) / np.linalg.norm(v)
        angle = math.degrees(math.atan2(direction[1], direction[0]))
        w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        cx, cy = quad.mean(axis=0)
        return Box(float(cx), float(cy), float(w), float(h), _wrap(angle, 180))


@dataclass
class Found:
    """A card on a page: the whole card (landscape, angle in (-90, 90]), and how much more to keep beyond each side
    along its width and its height, where a strip of it may be and it cannot be told on which side."""

    box: Box
    spare: tuple[float, float] = (0.0, 0.0)


@dataclass
class Verdict:
    flip: bool  # the card was upside down in its box
    side: str | None  # "front", "back", or None when unsure
    confidence: float  # how sure the side is: 0 (no idea) to 1
    letters: float = 0.0  # how much confident Arabic was read on it


@dataclass
class Card:
    page: int
    box: Box  # the card itself, upright, in pixel indices of the page
    image: np.ndarray  # BGR: the card with its margin, landscape, upright
    frame: tuple[float, float, float, float]  # where the card is on `image`: left, top, right, bottom, as shares
    side: str | None
    confidence: float
    whole: bool = False  # the picture is the card: it was not cut


def _wrap(angle: float, half_turn: float) -> float:
    """`angle` brought into (-half_turn, half_turn]."""
    angle = math.fmod(angle, 2 * half_turn)
    if angle > half_turn:
        angle -= 2 * half_turn
    elif angle <= -half_turn:
        angle += 2 * half_turn
    return angle


def _landscape(box: Box) -> Box:
    if box.h > box.w:
        box = Box(box.cx, box.cy, box.h, box.w, box.angle + 90)
    return replace(box, angle=_wrap(box.angle, 90))


def shrunk(image: np.ndarray, side: int) -> np.ndarray:
    """`image`, scaled down (smoothly) so that its longer side is at most `side`."""
    return _resized(image, side / max(image.shape[:2]))


def _resized(image: np.ndarray, scale: float) -> np.ndarray:
    if scale >= 1:
        return image
    size = (max(round(image.shape[1] * scale), 1), max(round(image.shape[0] * scale), 1))
    return cv2.resize(image, size, interpolation=cv2.INTER_AREA)


def _sample(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    """`image` at (x, y) `points` (any shape ending in 2), interpolated; 0 (background) past the picture's edge."""
    shape = points.shape[:-1]
    # as rows of at most a few hundred: OpenCV's remap takes no map more than 32767 wide
    columns = shape[-1] if len(shape) > 1 else min(len(points), 256)
    flat = points.reshape(-1, 2)
    pad = (-len(flat)) % columns
    if pad:
        flat = np.concatenate([flat, np.full((pad, 2), -10.0)])
    xs = np.ascontiguousarray(flat[:, 0].reshape(-1, columns), dtype=np.float32)
    ys = np.ascontiguousarray(flat[:, 1].reshape(-1, columns), dtype=np.float32)
    values = cv2.remap(image, xs, ys, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return values.reshape(-1)[: len(flat) - pad].reshape(shape)


# 1. Find


@dataclass
class _Background:
    distance: np.ndarray  # float32: how unlike the background each pixel is (CIELAB distance, on OpenCV's 8-bit scale)
    noise: float  # how unlike it the background itself gets, where it is sure to be background


def _against(lab: np.ndarray, ring: np.ndarray, inside: np.ndarray | None = None) -> _Background:
    """Distances from the typical colour of `ring` (Lab samples, N x 3); 0 outside `inside`, when given."""
    colour = np.median(ring, axis=0)
    distance = np.sqrt(((lab - colour) ** 2).sum(axis=2))
    if inside is not None:
        distance[~inside] = 0
    # the third quartile: a card that runs off the picture may take up a good part of one side of the border
    noise = float(np.percentile(np.sqrt(((ring - colour) ** 2).sum(axis=1)), 75)) * 1.3
    return _Background(distance=distance, noise=noise)


def _backgrounds(page: np.ndarray, scale: float) -> list[_Background]:
    """What the cards lie on: the page's background (along its border), and any sheet of paper or tray that fills
    much of the picture (a photo of a photocopy lying on a desk), against its own colour."""
    lab = cv2.cvtColor(cv2.GaussianBlur(page, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    h, w = lab.shape[:2]
    m = max(2, round(0.02 * min(h, w)))
    border = np.concatenate(
        [lab[:m].reshape(-1, 3), lab[-m:].reshape(-1, 3), lab[:, :m].reshape(-1, 3), lab[:, -m:].reshape(-1, 3)]
    )
    found = [_against(lab, border)]
    small = _resized(found[0].distance, scale)
    mask = (small > max(8.0, 2.5 * found[0].noise)).astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        if cv2.contourArea(contour) < 0.25 * small.size:
            continue
        region = np.zeros(small.shape, np.uint8)
        cv2.drawContours(region, [contour], -1, 1, cv2.FILLED)
        region = cv2.resize(region, (w, h), interpolation=cv2.INTER_NEAREST)
        x, y, rw, rh = cv2.boundingRect(contour)
        k = max(3, round(0.015 * min(rw, rh) / scale)) | 1
        inside = cv2.erode(region, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        ring = inside & ~cv2.erode(inside, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1)))
        if ring.any():
            found.append(_against(lab, lab[ring.astype(bool)], inside.astype(bool)))
    return found


def find_cards(page: np.ndarray) -> list[Found]:
    """The cards on a BGR page, in its pixel indices, best first, at most MAX_CARDS."""
    scale = min(1.0, DETECTION_SIDE / max(page.shape[:2]))
    candidates = []
    for background in _backgrounds(page, scale):
        small = _resized(background.distance, scale)
        candidates += [(box, score, background) for box, score in _candidates(small, background.noise)]
    to_page = np.array([page.shape[1] / small.shape[1], page.shape[0] / small.shape[0]])

    cards = []
    for box, _, background in _pick(candidates):
        quad = (box.corners() + 0.5) * to_page - 0.5
        refined = _landscape(Box.from_corners(_refine(background.distance, quad, background.noise)))
        whole, spare = _whole_card(refined, background, page.shape)
        cards.append(Found(box=whole, spare=spare))
    return cards


def _candidates(distance: np.ndarray, noise: float):
    """(box, score) of card-shaped outlines in several masks of the (small) distance map."""
    page_area = distance.shape[0] * distance.shape[1]
    low = max(8.0, 2.5 * noise)  # anything unlike the background
    d8 = np.clip(distance, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(d8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = max(3, round(min(distance.shape) * 0.006)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    masks = []
    for threshold in sorted({low, max(low, float(otsu))}):
        mask = (distance > threshold).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        masks.append(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2))
    edges = cv2.Canny(d8, max(4.0, low * 0.5), max(8.0, low))
    masks.append(cv2.morphologyEx(cv2.dilate(edges, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, kernel))

    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < MIN_AREA_SHARE * page_area * 0.7:
                continue
            hull = cv2.convexHull(contour)
            box = _landscape(_box_from_points(cv2.boxPoints(cv2.minAreaRect(hull))))
            area = box.w * box.h
            if not (MIN_AREA_SHARE <= area / page_area <= MAX_AREA_SHARE):
                continue
            aspect = box.w / box.h
            if not MIN_ASPECT <= aspect <= MAX_ASPECT:
                continue
            fill = cv2.contourArea(hull) / area
            if fill < 0.9:
                continue
            support = _support(distance, box, low)
            if support < 0.6:
                continue
            fit = math.exp(-(((aspect - CARD_ASPECT) / 0.2) ** 2))
            yield box, support * fill * (0.5 + 0.5 * fit)


def _pick(candidates: list) -> list:
    """One of each card, best first, from (box, score, ...) candidates. The same card found in several ways is kept
    once; a rectangle inside a card (its photo, say) is not a card; a rectangle with two cards in it is a sheet of
    paper or a tray, not a card."""
    distinct: list = []
    for candidate in sorted(candidates, key=lambda c: -c[1]):
        same = [i for i, other in enumerate(distinct) if _iou(candidate[0], other[0]) >= 0.7]
        if not same:
            distinct.append(candidate)
        elif candidate[0].w * candidate[0].h > distinct[same[0]][0].w * distinct[same[0]][0].h:
            distinct[same[0]] = candidate  # the larger of the two: never a shape inside the card
    boxes = [candidate[0] for candidate in distinct]
    area = [box.w * box.h for box in boxes]
    inside = [
        [j for j, other in enumerate(boxes) if area[j] < 0.7 * area[i] and _overlap(other, box) > 0.8]
        for i, box in enumerate(boxes)
    ]
    sheets = {
        i for i, within in enumerate(inside)
        if any(_overlap(boxes[a], boxes[b]) < 0.2 for a in within for b in within if a < b)
    }
    kept = [i for i in range(len(distinct)) if i not in sheets]
    kept = [i for i in kept if not any(i in inside[k] for k in kept)]
    return [distinct[i] for i in kept][:MAX_CARDS]


def _box_from_points(points: np.ndarray) -> Box:
    p0, p1, p2, _ = points
    e0, e1 = p1 - p0, p2 - p1
    if np.linalg.norm(e1) > np.linalg.norm(e0):
        e0, e1 = e1, e0
    angle = math.degrees(math.atan2(e0[1], e0[0]))
    cx, cy = points.mean(axis=0)
    return Box(float(cx), float(cy), float(np.linalg.norm(e0)), float(np.linalg.norm(e1)), angle)


def _support(distance: np.ndarray, box: Box, threshold: float) -> float:
    """The share of the outline with background just outside it (or the picture's edge) and something else inside."""
    u, v = box.axes
    t = np.linspace(-0.42, 0.42, 24)
    points, normals = [], []
    for along, across, half_along, half_across in ((u, v, box.w / 2, box.h / 2), (v, u, box.h / 2, box.w / 2)):
        for sign in (-1, 1):
            base = box.centre + sign * across * half_across
            points.append(base + np.outer(t * 2 * half_along, along))
            normals.append(np.repeat((sign * across)[None], len(t), axis=0))
    points, normals = np.concatenate(points), np.concatenate(normals)
    reach = max(2.0, 0.015 * box.h)
    outside = _sample(distance, points + normals * reach)
    inside = np.maximum(_sample(distance, points - normals * reach), _sample(distance, points - normals * 2 * reach))
    return float(np.mean((outside < threshold) & (inside >= threshold)))


def _intersection(a: Box, b: Box) -> float:
    kind, region = cv2.rotatedRectangleIntersection(
        ((a.cx, a.cy), (a.w, a.h), a.angle), ((b.cx, b.cy), (b.w, b.h), b.angle)
    )
    if kind == cv2.INTERSECT_NONE or region is None:
        return 0.0
    return float(cv2.contourArea(cv2.convexHull(region)))


def _overlap(a: Box, b: Box) -> float:
    """The share of `a` that lies in `b`."""
    return _intersection(a, b) / max(a.w * a.h, 1e-6)


def _iou(a: Box, b: Box) -> float:
    inter = _intersection(a, b)
    return inter / max(a.w * a.h + b.w * b.h - inter, 1e-6)


def _reading_order(quad: np.ndarray, box: Box) -> np.ndarray:
    """The four corners ordered TL, TR, BR, BL for the box's angle (whichever corner is nearest each)."""
    return np.array([quad[int(np.argmin(np.linalg.norm(quad - target, axis=1)))] for target in box.corners()])


# 2. Refine


def _refine(distance: np.ndarray, quad: np.ndarray, noise: float) -> np.ndarray:
    """The four corners, moved to where the card's edges really are: twice, the second time looking closer."""
    box = _landscape(Box.from_corners(quad))
    quad = _reading_order(quad, box)
    for reach in (max(6.0, 0.06 * box.h), max(3.0, 0.02 * box.h)):
        refined = _fit_edges(distance, quad, reach, noise)
        if refined is None:
            break
        new = _landscape(Box.from_corners(refined))
        if not _close(new, box):
            break
        quad, box = _reading_order(refined, new), new
    return quad


def _close(new: Box, old: Box) -> bool:
    turn = abs(_wrap(new.angle - old.angle, 90))
    moved = math.hypot(new.cx - old.cx, new.cy - old.cy)
    return (
        turn <= 3
        and abs(new.w - old.w) <= 0.08 * old.w
        and abs(new.h - old.h) <= 0.08 * old.h
        and moved <= 0.08 * old.h
    )


def _fit_edges(distance: np.ndarray, quad: np.ndarray, reach: float, noise: float) -> np.ndarray | None:
    lines = []
    centre = quad.mean(axis=0)
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        along = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        normal = np.array([along[1], -along[0]])
        if np.dot(normal, (a + b) / 2 - centre) < 0:
            normal = -normal  # pointing out of the card
        line = _fit_edge(distance, a, b, normal, reach, noise)
        if line is None:
            return None
        lines.append(line)
    corners = [_intersect(lines[i - 1], lines[i]) for i in range(4)]
    if any(corner is None for corner in corners):
        return None
    return np.array(corners)


def _fit_edge(distance, a, b, normal, reach, noise, samples=48, step=0.5):
    """A point on, and the direction of, the line where the background ends along the edge from a to b."""
    t = np.linspace(0.1, 0.9, samples)
    offsets = np.arange(reach, -reach - step / 2, -step)  # from outside the card to inside it
    base = a[None] + t[:, None] * (b - a)[None]
    profiles = _sample(distance, base[:, None, :] + offsets[None, :, None] * normal[None, None, :])
    part = max(2, len(offsets) // 5)
    outer, inner = np.median(profiles[:, :part]), np.median(profiles[:, -part:])
    if inner - outer < max(4.0, 1.5 * noise):
        return None
    level = (outer + inner) / 2
    above = profiles >= level
    first = np.argmax(above, axis=1)  # the first offset, from outside, that is no longer background
    ok = above[np.arange(samples), first] & (first > 0)
    if ok.sum() < samples * 0.4:
        return None
    rows = np.nonzero(ok)[0]
    k = first[rows]
    before, after = profiles[rows, k - 1], profiles[rows, k]
    fraction = np.clip((level - before) / np.maximum(after - before, 1e-6), 0, 1)
    points = base[rows] + (offsets[k - 1] - fraction * step)[:, None] * normal[None]
    for _ in range(2):  # a straight line, without the points that stray from it (dust, a corner, the print)
        vx, vy, x0, y0 = cv2.fitLine(points.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        residual = np.abs((points[:, 0] - x0) * vy - (points[:, 1] - y0) * vx)
        keep = residual <= max(1.0, 3 * np.median(residual))
        if keep.all() or keep.sum() < samples * 0.3:
            break
        points = points[keep]
    return np.array([x0, y0], dtype=np.float64), np.array([vx, vy], dtype=np.float64)


def _intersect(l1, l2) -> np.ndarray | None:
    (p, r), (q, s) = l1, l2
    cross = r[0] * s[1] - r[1] * s[0]
    if abs(cross) < 1e-6:
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross
    return p + t * r


# 3. The whole card


def _whole_card(box: Box, background: _Background, shape) -> tuple[Box, tuple[float, float]]:
    """`box` made up to a card's proportions where a strip of the card did not show, and what to keep to spare."""
    short_h = box.w / box.h > CARD_ASPECT  # a strip along a long side is missing: the card is not tall enough
    want = box.w / CARD_ASPECT if short_h else box.h * CARD_ASPECT
    have = box.h if short_h else box.w
    need = want - have
    if need < 0.5 or need > want * MAX_STRIP["h" if short_h else "w"]:
        return box, (0.0, 0.0)
    u, v = box.axes
    outward = v if short_h else u  # towards the bottom of the card, or its right
    across = u if short_h else v
    width_across = box.w if short_h else box.h
    height, width = shape[:2]

    def runs_off(sign: int) -> bool:  # just past the middle of that side, the picture has ended
        x, y = box.centre + sign * outward * (have / 2 + max(2.0, 0.01 * have))
        return not (-0.5 <= x <= width - 0.5 and -0.5 <= y <= height - 0.5)

    def beyond(sign: int) -> float:  # how unlike the background the strip just past that side is, on the whole
        depth = np.arange(have / 2 + 1.5, have / 2 + max(need, 3.0), 1.0)
        spread = np.linspace(-0.4, 0.4, 25) * width_across
        points = box.centre + sign * outward * depth[:, None, None] + across * spread[None, :, None]
        inside = (
            (points[..., 0] >= -0.5) & (points[..., 0] <= width - 0.5)
            & (points[..., 1] >= -0.5) & (points[..., 1] <= height - 0.5)
        )
        values = _sample(background.distance, points)
        return float(values[inside].mean()) if inside.any() else 0.0

    off = runs_off(-1), runs_off(1)
    sign = 0
    if off[0] != off[1]:
        sign = -1 if off[0] else 1
    elif not off[0] and need >= 0.3 * box.w / CARD_MM[0]:  # less than that is a scanner's shadow, not a strip
        before, after = beyond(-1), beyond(1)
        if before > after * 1.4 + 1.5:
            sign = -1
        elif after > before * 1.4 + 1.5:
            sign = 1
    grown = replace(box, h=want) if short_h else replace(box, w=want)
    if sign:
        shift = outward * sign * need / 2
        return replace(grown, cx=box.cx + float(shift[0]), cy=box.cy + float(shift[1])), (0.0, 0.0)
    return grown, ((0.0, need / 2) if short_h else (need / 2, 0.0))


# 4. Cut out


def cut_plan(box: Box, spare: tuple[float, float], width: int, height: int) -> tuple[list[float], list[float]]:
    """How far the cut reaches from the card's centre to the left, top, right and bottom (along the card's own axes),
    and where the card lies on the cut (left, top, right, bottom, as shares of it: below 0 or above 1 where the card
    runs off the picture). The card with its margin and what is to spare, but never past the picture's edge."""
    mm = box.w / CARD_MM[0]
    mx, my = MARGIN_MM[0] * mm + spare[0], MARGIN_MM[1] * mm + spare[1]
    u, v = box.axes
    centre = box.centre + 0.5  # from pixel indices to distances from the picture's top-left corner

    def room(d: np.ndarray) -> float:
        limits = [math.inf]
        for axis, size in ((0, width), (1, height)):
            if d[axis] > 1e-9:
                limits.append((size - centre[axis]) / d[axis])
            elif d[axis] < -1e-9:
                limits.append(-centre[axis] / d[axis])
        return min(limits)

    reach = [
        min(box.w / 2 + mx, room(-u)),
        min(box.h / 2 + my, room(-v)),
        min(box.w / 2 + mx, room(u)),
        min(box.h / 2 + my, room(v)),
    ]
    left, top, right, bottom = reach
    frame = [
        (left - box.w / 2) / (left + right),
        (top - box.h / 2) / (top + bottom),
        (left + box.w / 2) / (left + right),
        (top + box.h / 2) / (top + bottom),
    ]
    return reach, frame


def cut_out(image: np.ndarray, box: Box, reach: list[float], card_width: int = CARD_WIDTH) -> np.ndarray:
    """The part of `image` (BGR) `reach` around the card `box` (both in its pixel indices), straightened, the card
    `card_width` pixels wide."""
    k = card_width / box.w  # pixels of the cut per pixel of the image
    shrink = min(1.0, 1.5 * k)  # a much larger card is first shrunk smoothly, so that its fine print does not alias
    if shrink < 1:
        small = _resized(image, shrink)
        fx, fy = small.shape[1] / image.shape[1], small.shape[0] / image.shape[0]
        box = Box((box.cx + 0.5) * fx - 0.5, (box.cy + 0.5) * fy - 0.5, box.w * fx, box.h * fy, box.angle)
        reach = [reach[0] * fx, reach[1] * fy, reach[2] * fx, reach[3] * fy]
        image, k = small, k / fx
    left, top, right, bottom = reach
    out_w, out_h = max(1, round((left + right) * k)), max(1, round((top + bottom) * k))
    u, v = box.axes
    # the cut's pixel (X, Y) is at (X + 0.5) / k - left along the card and (Y + 0.5) / k - top down it, from its centre
    origin = box.centre + (0.5 / k - left) * u + (0.5 / k - top) * v
    matrix = np.array([[u[0] / k, v[0] / k, origin[0]], [u[1] / k, v[1] / k, origin[1]]], dtype=np.float64)
    return cv2.warpAffine(
        image, matrix, (out_w, out_h), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
    )


# 5 and 6. Which way up, which side

_DIACRITICS = re.compile("[ـً-ٰٟ]")
_LETTER = re.compile("[ء-غف-يٱ-ۓ]")
_DIGIT = re.compile("[0-9٠-٩۰-۹]")
_SAME = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ی": "ي", "ئ": "ي", "ة": "ه", "ک": "ك", "ؤ": "و"}
)

# words printed on one side of the card only, normalised; a group counts once
_FRONT_WORDS = [({"جمهوريه"}, 1.0), ({"تحقيق"}, 1.0), ({"الشخصيه"}, 1.0), ({"العربيه"}, 0.6), ({"مصر"}, 0.3)]
_BACK_WORDS = [
    ({"ساريه"}, 1.2),
    ({"حتي"}, 0.3),
    ({"ذكر", "انثي"}, 0.8),
    ({"مسلم", "مسلمه", "مسيحي", "مسيحيه"}, 0.6),
    ({"اعزب", "عزباء", "متزوج", "متزوجه", "مطلق", "مطلقه", "ارمل", "ارمله"}, 0.6),
]
_DECISIVE = 1.5  # this much of one side's words, read one way up, settles which way up the card goes
# the card's printed serial (two capitals and seven digits, as the API reads it), on the front only
_SERIAL = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2} ?[0-9]{7}(?![A-Za-z0-9])")
_LATIN_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_SERIAL_WEIGHT = 0.4  # a sign of the front, more modest than its words: a short code is easily misread


def _normal_words(text: str) -> list[str]:
    text = _DIACRITICS.sub("", text).translate(_SAME)
    return [word for word in re.split(r"[^ء-ۓ]+", text) if word]


def _matches(word: str, wanted: str) -> bool:
    """A word read is taken for a word of the card when it is that word or, from four letters, very like it and no shorter
    (at most two letters longer): a word a letter short of one of the card's is a name, not that word (ساره is not ساريه,
    nor العرب العربيه). After Prime ERP's reader, 16 October 2026."""
    if word == wanted:
        return True
    if len(wanted) <= 3 or not 0 <= len(word) - len(wanted) <= 2:
        return False
    return SequenceMatcher(None, word, wanted).ratio() >= (0.75 if len(wanted) == 4 else 0.8)


# Card words that a name can look like, letter for letter, and the words printed beside them that a word only like them
# needs on its line: سامية is as like سارية as a misreading of it, so it is taken for "سارية" only in "البطاقة سارية حتى".
_ONLY_BESIDE = {"ساريه": ("حتي", "البطاقه")}


def _has(words: list[str], wanted: str) -> bool:
    """Whether the words of a line show a word of the card (see _matches and _ONLY_BESIDE)."""
    if wanted in words:
        return True
    if not any(_matches(word, wanted) for word in words):
        return False
    beside = _ONLY_BESIDE.get(wanted)
    return beside is None or any(_matches(word, other) for word in words for other in beside)


def _word_score(lines, groups) -> float:
    total = 0.0
    for words, weight in groups:
        best = 0.0
        for line in lines:
            read = _normal_words(line.text)
            if any(_has(read, wanted) for wanted in words):
                best = max(best, weight * line.confidence)
        total += best
    return total


def _letter_score(lines) -> float:
    """How much confident Arabic was read: digits and stray marks do not count."""
    return sum(line.confidence**2 * len(_LETTER.findall(line.text)) for line in lines if line.confidence >= 0.3)


def _serial(lines) -> float:
    """The front's printed serial, as sure as the reader was of it (from Prime ERP's reader, 16 October 2026)."""
    return max((line.confidence for line in lines if _SERIAL.search(line.text.translate(_LATIN_DIGITS))), default=0.0)


def _number_at_bottom(lines, height: int) -> float:
    """The front's 14-digit number runs along the bottom of the card."""
    best = 0.0
    for line in lines:
        if len(_DIGIT.findall(line.text)) >= 12 and (line.box[1] + line.box[3]) / 2 > 0.6 * height:
            best = max(best, line.confidence)
    return best


def _number_at_top(lines, height: int) -> float:
    """The back's 14-digit number runs along the top of the card, beside the issue month (after Prime ERP's reader)."""
    best = 0.0
    for line in lines:
        if len(_DIGIT.findall(line.text)) >= 12 and (line.box[1] + line.box[3]) / 2 < 0.4 * height:
            best = max(best, line.confidence)
    return best


def barcode_bands(gray: np.ndarray) -> tuple[float, float]:
    """How much the bottom and the top of a card look like a barcode band, 0 to 1 each."""
    g = gray.astype(np.float32)
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    h, w = g.shape
    x0, x1 = round(0.05 * w), round(0.95 * w)
    band = max(4, round(0.08 * h))

    def best(y_from: int, y_to: int) -> float:
        score = 0.0
        for y in range(y_from, max(y_from + 1, y_to - band), max(1, band // 3)):
            ax, ay = gx[y : y + band, x0:x1], gy[y : y + band, x0:x1]
            ratio = (ax.mean() + 1) / (ay.mean() + 1)
            columns = ax.mean(axis=0)
            blocks = columns[: len(columns) // 8 * 8].reshape(-1, 8).mean(axis=1)
            coverage = float(np.mean(blocks > 40))
            score = max(score, min(1.0, max(0.0, (ratio - 3) / 3)) * min(1.0, coverage / 0.5))
        return score

    return best(round(0.55 * h), round(0.98 * h)), best(round(0.02 * h), round(0.45 * h))


def judge(engine, card: np.ndarray) -> Verdict:
    """Which way up `card` (BGR, landscape) goes, and which side of an ID card it is."""
    small = _resized(card, READ_WIDTH / card.shape[1])
    bottom, top = barcode_bands(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    flipped = cv2.rotate(small, cv2.ROTATE_180)
    # a barcode band says which way up to read first
    ways = [(True, flipped), (False, small)] if top > bottom else [(False, small), (True, flipped)]

    readings = []
    for flip, image in ways:
        lines = engine.read(image, "ar")
        front, back = _word_score(lines, _FRONT_WORDS), _word_score(lines, _BACK_WORDS)
        readings.append((flip, lines, front, back, _letter_score(lines)))
        if max(front, back) >= _DECISIVE:
            break
    pick = 0
    if len(readings) == 2:
        s0, s1 = readings[0][4], readings[1][4]
        if s0 + s1 >= 5:
            pick = 0 if s0 >= s1 else 1
        elif max(top, bottom) > 0.3:  # hardly any text: the barcode band runs along the bottom
            pick = 0 if readings[0][0] == (top > bottom) else 1
        else:
            pick = 0 if not readings[0][0] else 1
    flip, lines, front, back, letters = readings[pick]

    # signs of a side that are not words: they tell the side once the way up is chosen, never the way up itself
    front += 0.6 * _number_at_bottom(lines, small.shape[0]) + _SERIAL_WEIGHT * _serial(lines)
    back += 0.6 * _number_at_top(lines, small.shape[0]) + 1.5 * (top if flip else bottom)
    margin = front - back
    confidence = abs(2 / (1 + math.exp(-2 * margin)) - 1)
    side = ("front" if margin > 0 else "back") if confidence >= SIDE_THRESHOLD else None
    return Verdict(flip=flip, side=side, confidence=round(confidence, 3) if side else 0.0, letters=letters)


# Putting it together


def _cut_already(found: Found, width: int, height: int) -> bool:
    """The picture is what cutting this card out of it would give: a card cut out already, square to the picture
    (lying or standing), with its margin."""
    if abs(_wrap(found.box.angle, 45)) >= 0.5:
        return False
    reach, _ = cut_plan(found.box, found.spare, width, height)
    along, across = reach[0] + reach[2], reach[1] + reach[3]
    if abs(_wrap(found.box.angle, 90)) > 45:  # the card stands on its end
        along, across = across, along
    return along >= 0.97 * width and across >= 0.97 * height


def find_on_page(engine, page: np.ndarray, full: np.ndarray, page_index: int) -> list[Card]:
    """The cards on `page` (BGR, as returned to the caller), cut out of `full` (the same picture, larger or the same).
    Boxes are in pixel indices of `page`."""
    height, width = page.shape[:2]
    found = find_cards(page)
    largest = max(found, key=lambda f: f.box.w * f.box.h, default=None)
    if largest is not None and _cut_already(largest, width, height):
        return [_whole_picture(engine, full, page_index, width, height, sure=True)]
    aspect = max(width, height) / min(width, height)
    small = largest is None or largest.box.w * largest.box.h < 0.25 * width * height
    if WHOLE_ASPECT[0] <= aspect <= WHOLE_ASPECT[1] and small:
        # shaped like a card, and nothing on it as large as a card on a photo of one: is the picture itself a card?
        # (cut out already, to its edges, as a phone's scanning app crops)
        card = _whole_picture(engine, full, page_index, width, height, sure=False)
        if card is not None:
            return [card]
    cards = []
    to_full = np.array([full.shape[1] / width, full.shape[0] / height])
    for item in found:
        box = _scaled(item.box, to_full)
        spare = (item.spare[0] * to_full[0], item.spare[1] * to_full[1])
        reach, frame = cut_plan(box, spare, full.shape[1], full.shape[0])
        image = cut_out(full, box, reach)
        verdict = judge(engine, image)
        box = item.box
        if verdict.flip:
            image, box, frame = cv2.rotate(image, cv2.ROTATE_180), box.turned(180), _turned_frame(frame)
        cards.append(Card(page_index, box, image, tuple(frame), verdict.side, verdict.confidence))
    return cards


def _whole_picture(engine, full: np.ndarray, page_index: int, width: int, height: int, sure: bool) -> Card | None:
    """The picture as one card, turned upright, not cut. Unless `sure`, None when nothing on it reads like a card."""
    # a picture standing on its end is turned a quarter to the left: the card's left-to-right then runs down the page
    image = full if full.shape[1] >= full.shape[0] else cv2.rotate(full, cv2.ROTATE_90_COUNTERCLOCKWISE)
    image = _resized(image, CARD_WIDTH / image.shape[1])
    verdict = judge(engine, image)
    if not sure and verdict.side is None and verdict.letters < 10:
        return None
    angle = 0.0 if width >= height else 90.0
    box = Box((width - 1) / 2, (height - 1) / 2, max(width, height), min(width, height), angle)
    if verdict.flip:
        image, box = cv2.rotate(image, cv2.ROTATE_180), box.turned(180)
    return Card(page_index, box, image, (0.0, 0.0, 1.0, 1.0), verdict.side, verdict.confidence, whole=True)


def _scaled(box: Box, factor: np.ndarray) -> Box:
    """`box` in pixel indices of a picture `factor` times as large (the same in both directions, or as near as)."""
    fx, fy = float(factor[0]), float(factor[1])
    return Box((box.cx + 0.5) * fx - 0.5, (box.cy + 0.5) * fy - 0.5, box.w * fx, box.h * fy, box.angle)


def _turned_frame(frame) -> list[float]:
    left, top, right, bottom = frame
    return [1 - right, 1 - bottom, 1 - left, 1 - top]


def in_order(cards: list[Card]) -> list[Card]:
    """The front first, when one is known; then page by page, top to bottom, left to right."""

    def extent(card: Card) -> tuple[float, float]:
        ys = card.box.corners()[:, 1]
        return float(ys.min()), float(ys.max())

    ordered: list[Card] = []
    for page in sorted({card.page for card in cards}):
        rows: list[list[Card]] = []
        for card in sorted((c for c in cards if c.page == page), key=lambda c: c.box.cy):
            if rows:
                top, bottom = extent(rows[-1][0])
                ctop, cbottom = extent(card)
                if min(bottom, cbottom) - max(top, ctop) > 0.5 * min(bottom - top, cbottom - ctop):
                    rows[-1].append(card)
                    continue
            rows.append([card])
        for row in rows:
            ordered += sorted(row, key=lambda c: c.box.cx)
    return [c for c in ordered if c.side == "front"] + [c for c in ordered if c.side != "front"]
