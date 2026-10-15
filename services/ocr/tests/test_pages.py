"""Showing the pages of a file (POST /pages): every page of a PDF, or the picture, as JPEGs, for adjusting by hand."""

import base64
import io
import logging
import threading

import numpy as np
import pytest
from PIL import Image

import app.main as main
from app.documents import MAX_PDF_PAGES
from app.upload import MAX_FILE_BYTES

from .conftest import StubEngine, jpeg, pdf, png, wait_ready

WHITE, RED, BLUE = (255, 255, 255), (220, 30, 30), (30, 30, 220)


def send(client, data: bytes, filename="scan.pdf", field="file"):
    return client.post("/pages", files={field: (filename, data, "application/octet-stream")})


def decoded(page: dict) -> Image.Image:
    image = Image.open(io.BytesIO(base64.b64decode(page["image"])))
    assert image.format == "JPEG"
    assert image.size == (page["width"], page["height"])
    return image


def noise_pdf(pages: int, seed: int = 0) -> bytes:
    """A PDF of A4 pages of coloured noise: the hardest thing to make small as a JPEG."""
    rng = np.random.default_rng(seed)
    images = [Image.fromarray(rng.integers(0, 256, (842, 595, 3), dtype=np.uint8)) for _ in range(pages)]
    buf = io.BytesIO()
    images[0].save(buf, "PDF", save_all=True, append_images=images[1:], resolution=72)
    return buf.getvalue()


def test_every_page_of_a_pdf_in_order_at_200_dpi_and_at_most_2000_px(make_client):
    engine = StubEngine()
    data = pdf((612, 792, RED), (842, 595, BLUE), (144, 72, WHITE))  # US Letter, A4 landscape, 2 x 1 inches
    response = send(make_client(engine), data)
    assert response.status_code == 200
    pages = response.json()["pages"]
    # 200 dpi: Letter would be 1700 x 2200 and A4 2339 x 1653: both are made 2000 on their long side
    assert [(p["width"], p["height"]) for p in pages] == [(1546, 2000), (2000, 1414), (400, 200)]
    assert set(response.json()) == {"pages"}
    colours = [decoded(p).convert("RGB").getpixel((p["width"] // 2, p["height"] // 2)) for p in pages]
    assert [max(range(3), key=c.__getitem__) for c in colours[:2]] == [0, 2]  # red, then blue
    assert min(colours[2]) > 240
    assert engine.calls == []  # nothing is read


def test_the_pages_are_progressive_jpegs_at_quality_80_when_they_fit(make_client):
    page = send(make_client(StubEngine()), pdf((595, 842, WHITE))).json()["pages"][0]
    image = decoded(page)
    assert image.info.get("progressive") == 1
    assert (page["width"], page["height"]) == (1414, 2000)
    # the luminance table of quality 80 (libjpeg scales the standard one; its first entry, 16, becomes 6)
    assert image.quantization[0][0] == 6


def test_a_picture_is_one_page_upright_and_at_most_2000_px(make_client):
    client = make_client(StubEngine())
    page = send(client, jpeg(300, 100, exif_orientation=6), filename="phone.jpg").json()["pages"]
    assert [(p["width"], p["height"]) for p in page] == [(100, 300)]
    page = send(client, png(5000, 1000, color=RED), filename="wide.png").json()["pages"]
    assert [(p["width"], p["height"]) for p in page] == [(2000, 400)]
    assert decoded(page[0]).convert("RGB").getpixel((1000, 200))[0] > 200


def test_a_pdf_of_up_to_20_pages_is_shown_and_a_longer_one_refused_saying_how_long_it_is(make_client):
    engine = StubEngine()
    client = make_client(engine)
    response = send(client, pdf(*[(72, 72, WHITE)] * MAX_PDF_PAGES))
    assert response.status_code == 200 and len(response.json()["pages"]) == MAX_PDF_PAGES
    response = send(client, pdf(*[(72, 72, WHITE)] * (MAX_PDF_PAGES + 5)), filename="long.pdf")
    assert response.status_code == 400
    assert response.json() == {"detail": "The PDF has 25 pages; at most 20 pages can be shown.", "pages": 25}
    assert engine.calls == []


def test_all_the_pages_together_stay_within_the_budget(make_client, monkeypatch):
    # a page of this noise is about 0.9 MB at quality 80 and full size: 6 pages are about 5.4 MB
    monkeypatch.setattr(main, "PAGES_BUDGET", 1_200_000)
    pages = send(make_client(StubEngine()), noise_pdf(6)).json()["pages"]
    sizes = [len(base64.b64decode(p["image"])) for p in pages]
    assert len(pages) == 6 and sum(sizes) <= main.PAGES_BUDGET
    assert all(main.PAGES_MIN_SIDE <= max(p["width"], p["height"]) < main.PAGES_SIDE for p in pages)
    assert all(abs(p["width"] / p["height"] - 595 / 842) < 0.01 for p in pages)  # made smaller, never cut


def test_a_page_that_cannot_fit_is_still_sent_at_the_smallest_size(make_client, monkeypatch):
    monkeypatch.setattr(main, "PAGES_BUDGET", 1000)
    response = send(make_client(StubEngine()), noise_pdf(2))
    assert response.status_code == 200
    assert [max(p["width"], p["height"]) for p in response.json()["pages"]] == [main.PAGES_MIN_SIDE] * 2


def test_a_lighter_page_leaves_more_room_for_the_next(make_client, monkeypatch):
    # a white page takes almost nothing of its share: the two noise pages after it share nearly all the budget
    monkeypatch.setattr(main, "PAGES_BUDGET", 1_500_000)
    client = make_client(StubEngine())
    rng = np.random.default_rng(0)
    noise = Image.fromarray(rng.integers(0, 256, (842, 595, 3), dtype=np.uint8))
    white = Image.new("RGB", (595, 842), WHITE)

    def sides(*images):
        buf = io.BytesIO()
        images[0].save(buf, "PDF", save_all=True, append_images=list(images[1:]), resolution=72)
        return [max(p["width"], p["height"]) for p in send(client, buf.getvalue()).json()["pages"]]

    thirds = sides(noise, noise, noise)
    white_first = sides(white, noise, noise)
    assert white_first[0] == 2000
    assert min(white_first[1:]) > max(thirds)


def test_refusals_are_as_for_the_other_calls(make_client):
    client = make_client(StubEngine())
    response = send(client, b"GIF89a" + b"\x00" * 100, filename="x.gif")
    assert response.status_code == 400 and "JPEG, PNG, WebP or PDF" in response.json()["detail"]
    assert send(client, b"%PDF-1.7\n" + b"rubbish" * 50).json()["detail"].startswith("The PDF")
    assert send(client, png()[:60], filename="x.png").status_code == 400
    assert send(client, b"").json() == {"detail": "The file is empty."}
    assert send(client, png(), field="upload").status_code == 400
    response = send(client, b"%PDF-" + b"\x00" * MAX_FILE_BYTES)
    assert response.status_code == 413 and response.json() == {"detail": "The file is larger than 15 MB."}


def test_pages_is_503_while_the_models_load(make_client):
    gate = threading.Event()
    client = make_client(StubEngine(load_gate=gate), ready=False)
    assert send(client, pdf((72, 72, WHITE))).status_code == 503
    gate.set()
    wait_ready(client)
    assert send(client, pdf((72, 72, WHITE))).status_code == 200


def test_a_failure_is_a_500_and_the_service_carries_on(make_client, monkeypatch):
    client = make_client(StubEngine())
    real = main._jpeg_within
    monkeypatch.setattr(main, "_jpeg_within", lambda image, budget: (_ for _ in ()).throw(RuntimeError("encoder")))
    response = send(client, pdf((72, 72, WHITE)))
    assert response.status_code == 500 and response.json() == {
        "detail": "The OCR service failed to show the pages of this file."
    }
    monkeypatch.setattr(main, "_jpeg_within", real)
    assert send(client, pdf((72, 72, WHITE))).status_code == 200


def test_the_log_says_how_many_pages_and_how_large(make_client, caplog):
    with caplog.at_level(logging.INFO, logger="ocr"):
        assert send(make_client(StubEngine()), pdf((72, 72, WHITE), (72, 72, WHITE))).status_code == 200
        assert send(make_client(StubEngine()), pdf(*[(72, 72, WHITE)] * 21)).status_code == 400
    assert "pages: pdf, " in caplog.text and "2 page(s)" in caplog.text and "bytes of JPEG" in caplog.text
    assert "pages refused (400): The PDF has 21 pages" in caplog.text


@pytest.mark.parametrize("budget", [0, 1])
def test_no_budget_left_gives_the_smallest_page_not_an_error(budget):
    image = np.random.default_rng(0).integers(0, 256, (2000, 1414, 3), dtype=np.uint8)
    small, size, encoded = main._jpeg_within(image, budget)
    assert max(small.shape[:2]) == main.PAGES_MIN_SIDE and size > 0 and encoded[:3] == b"\xff\xd8\xff"
