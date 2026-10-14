"""POST /cards with the real models, on made-up cards. Skipped unless the models have been downloaded (README.md:
PADDLE_PDX_CACHE_HOME=$PWD/models) and a font with Arabic letters is found (tests/synthetic_cards.py)."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import wait_ready
from .synthetic_cards import arabic_font_path, card_picture, encode, pdf_of, scanned_page
from .test_cards import decode, looks_like, send, turn

_models = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", "/nonexistent")) / "official_models"
pytestmark = pytest.mark.skipif(
    not (_models / "arabic_PP-OCRv5_mobile_rec_onnx").is_dir() or arabic_font_path() is None,
    reason="needs the downloaded models (PADDLE_PDX_CACHE_HOME) and an Arabic font",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as client:
        wait_ready(client, seconds=180)
        yield client


def check(card: dict, side: str, angle: float):
    assert card["side"] == side and card["confidence"] >= 0.9
    assert turn(card["box"]["angle"], angle, 180) <= 0.3
    likeness, looks, flipped = looks_like(decode(card["image"]))
    assert (looks, flipped) == (side, False) and likeness > 0.7  # cut out upright


@pytest.mark.parametrize("background", ["dark", "white"])
def test_both_sides_on_one_page_one_upside_down(client, background):
    page, _ = scanned_page([("back", 1240, 900, -7), ("front", 1240, 2500, 184)], background=background)
    body = send(client, encode(page)).json()
    assert len(body["cards"]) == 2
    check(body["cards"][0], "front", 184)
    check(body["cards"][1], "back", -7)


def test_a_pdf_with_one_side_per_page(client):
    front, _ = scanned_page([("front", 1240, 1000, 4)], background="white", seed=3)
    back, _ = scanned_page([("back", 1300, 1600, 176)], background="dark", seed=4)
    body = send(client, pdf_of([front, back]), filename="id.pdf").json()
    assert [(c["side"], c["page"]) for c in body["cards"]] == [("front", 0), ("back", 1)]
    check(body["cards"][1], "back", 176)


@pytest.mark.parametrize("quarter, angle", [(1, 90), (3, -90)])
def test_a_picture_that_is_a_card_standing_on_its_end(client, quarter, angle):
    body = send(client, encode(card_picture("back", quarter), "PNG"), filename="card.png").json()
    [card] = body["cards"]
    assert card["frame"] == [0.0, 0.0, 1.0, 1.0]
    check(card, "back", angle)
