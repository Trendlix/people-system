"""A phone held over a flat card or page, for the tests of a card photographed at an angle: where the corners of a flat
rectangle show on the photo it takes, and a flat scene photographed so. The geometry of a camera, and pictures drawn by
the tests: nothing of a real card or person. After Prime ERP's production/web/src/testing/camera.ts (10 November 2026).
"""

import math

import cv2
import numpy as np


def photo(
    width: int, height: int, f: float, w: float, h: float,
    tilt: float = 0, yaw: float = 0, roll: float = 0, dx: float = 0, dy: float = 0, size: float = 1,
) -> np.ndarray:
    """Where each corner of a rectangle `w` x `h` shows on a photo `width` x `height` taken with a lens of focal length
    `f` pixels looking at the middle of the photo: top left, top right, bottom right, bottom left (4 x 2, measured from
    the photo's top-left corner). The phone is turned by `tilt` degrees about the rectangle's across (one long side
    further from the lens than the other), by `yaw` about its down, by `roll` in the picture; the rectangle's middle is
    moved across the picture by (dx, dy) pixels; `size`: pixels of the photo to a unit of the rectangle, at its
    middle."""
    a, b, c = math.radians(tilt), math.radians(yaw), math.radians(roll)
    z0 = f / size

    def turned(x: float, y: float, z: float) -> tuple[float, float, float]:
        # about the rectangle's across (x), then its down (y), then in the picture (z)
        y1, z1 = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
        x2, z2 = x * math.cos(b) + z1 * math.sin(b), -x * math.sin(b) + z1 * math.cos(b)
        return x2 * math.cos(c) - y1 * math.sin(c), x2 * math.sin(c) + y1 * math.cos(c), z2

    out = []
    for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        px, py, pz = turned(x, y, 0.0)
        z = pz + z0
        out.append((width / 2 + f * (px + dx * z0 / f) / z, height / 2 + f * (py + dy * z0 / f) / z))
    return np.array(out)


def photographed(
    scene: np.ndarray, width: int, height: int, f: float, ground: tuple[int, int, int], seed: int = 0, **pose
) -> tuple[np.ndarray, np.ndarray]:
    """A flat scene (RGB) photographed through a lens of focal length `f` held as `pose` says (see photo), on a photo
    `width` x `height`, with the grain of a phone's camera; past the scene, `ground`. Returns the photo and the
    transform from the scene's pixel indices to the photo's (3 x 3), to say where a point of the scene shows."""
    sh, sw = scene.shape[:2]
    corners = np.array([[0, 0], [sw, 0], [sw, sh], [0, sh]], dtype=np.float64)
    shown = photo(width, height, f, sw, sh, **pose)
    # distances from the top-left corner to pixel indices, on both sides
    matrix = cv2.getPerspectiveTransform((corners - 0.5).astype(np.float32), (shown - 0.5).astype(np.float32))
    picture = cv2.warpPerspective(
        scene, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=ground
    )
    grain = np.random.default_rng(seed + 1).normal(0, 3.0, picture.shape)
    return np.clip(picture + grain, 0, 255).astype(np.uint8), matrix


def mapped(matrix: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Points (N x 2) sent through a perspective transform."""
    return cv2.perspectiveTransform(np.asarray(points, dtype=np.float64).reshape(-1, 1, 2), matrix).reshape(-1, 2)
