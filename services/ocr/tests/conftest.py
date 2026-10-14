"""Test helpers: pictures and PDFs made in memory, and an engine that needs no models."""

import io
import threading
import time
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.layout import Line
from app.main import create_app


def png(width=120, height=40, color=(255, 255, 255), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (width, height), color).save(buf, "PNG")
    return buf.getvalue()


def jpeg(width=120, height=40, color=(255, 255, 255), exif_orientation=None) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color)
    if exif_orientation is None:
        img.save(buf, "JPEG")
    else:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def pdf(*pages: tuple[int, int, tuple[int, int, int]]) -> bytes:
    """A PDF whose pages are plain colours; (width, height) in points (Pillow saves 1 pixel as 1 point at 72 dpi)."""
    images = [Image.new("RGB", (w, h), color) for w, h, color in pages]
    buf = io.BytesIO()
    images[0].save(buf, "PDF", save_all=True, append_images=images[1:], resolution=72)
    return buf.getvalue()


class StubEngine:
    """Stands in for PaddleOCR: returns `lines_for(image)` and remembers what it was asked."""

    def __init__(self, lines_for: Callable = lambda image: [], load_gate: threading.Event | None = None):
        self.lines_for = lines_for
        self.load_gate = load_gate
        self.calls = []

    def load(self):
        if self.load_gate is not None:
            self.load_gate.wait(10)

    def warm_up(self):
        return []

    def read(self, image, lang):
        self.calls.append((image.shape, lang))
        return list(self.lines_for(image))


def wait_ready(client: TestClient, seconds: float = 5) -> None:
    deadline = time.monotonic() + seconds
    while client.get("/health").status_code != 200:
        if time.monotonic() > deadline:
            raise AssertionError("the service did not become ready")
        time.sleep(0.01)


@pytest.fixture
def make_client():
    """make_client(engine) -> a started TestClient whose models are 'loaded'."""
    clients = []

    def make(engine: StubEngine, ready: bool = True, on_load_failure=lambda: None) -> TestClient:
        client = TestClient(create_app(make_engine=lambda: engine, on_load_failure=on_load_failure))
        client.__enter__()
        clients.append(client)
        if ready:
            wait_ready(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


def line(text: str, box: tuple[int, int, int, int], confidence: float = 0.9) -> Line:
    return Line(text=text, confidence=confidence, box=box)
