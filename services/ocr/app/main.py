"""People System's OCR service: reads the text of national ID cards, scanned documents and PDFs.

Internal only: no sign-in, and reachable only on People System's Docker network, where the API calls it.

  GET  /health            200 {"status": "ok"} once the models are loaded and checked; 503 before
  POST /read?lang=ar|en   multipart field "file": JPEG, PNG, WebP or PDF (every page, up to 20), up to 15 MB
       200 {"lang": "ar", "pages": [{"width", "height", "lines": [{"text", "confidence",
            "box": [x_min, y_min, x_max, y_max]}]}], "text": lines joined by \\n, pages separated by \\f}
  POST /cards             multipart field "file": JPEG, PNG, WebP or PDF (its first 2 pages), up to 15 MB
       200 {"pages": [{"width", "height", "image"}], "cards": [{"page", "box": {"cx", "cy", "w", "h", "angle"},
            "frame": [left, top, right, bottom], "image", "side", "confidence"}]}  (see app/cards.py, README.md)
  POST /pages             multipart field "file": JPEG, PNG, WebP or PDF (every page, up to 20), up to 15 MB
       200 {"pages": [{"width", "height", "image"}]}: the pages as pictures, for cropping and adjusting by hand; nothing
            is read and no card is looked for. A PDF of more than 20 pages: 400 {"detail": "...", "pages": its pages}
  all: 400 {"detail": "..."} for an unsupported or unreadable file, 413 for one too large, 503 while loading

/read: lines are in reading order: top to bottom, and within a row right to left (ar) or left to right (en). Boxes,
width and height are in pixels of the picture as uploaded, turned the right way up; for a PDF, of the page rendered
at 200 dpi. The text is returned as read: Arabic-Indic digits stay as they are.

Pictures and their text are never written to disk or to the log; only sizes, page counts, card sides and timings are
logged.
"""

import base64
import logging
import math
import os
import sys
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import cards as id_cards
from .documents import MAX_PDF_PAGES, Document, TooManyPages, UnreadableFile, sniff
from .layout import Line, reading_order
from .upload import UploadError, read_file

RIGHT_TO_LEFT = {"ar": True, "en": False}

# /cards: a picture is looked at up to this large (an A4 page scanned at 300 dpi is 3508 px), and a PDF's first pages
# are rendered at 300 dpi; each page is returned, and its cards are located, at most PAGE_SIDE large.
CARDS_MAX_SIDE = 4096
CARDS_PDF_DPI = 300
CARDS_PDF_PAGES = 2
PAGE_SIDE = 2000
PAGE_QUALITY = 85
CARD_QUALITY = 90

# /pages: every page of a PDF, or the picture, to be cropped and adjusted by hand in the web app, which then stores the
# result in place of the file. A PDF page is rendered at 200 dpi, as /read reads it, and a page or a picture is at most
# PAGES_SIDE large (an A4 page: 1414 x 2000). All the pages reach the browser in one answer of at most 4.5 MB (a Vercel
# server action), so together they are kept within PAGES_BUDGET bytes of JPEG, 4 MB once in base64: each page may take
# an equal share of what is left, and one over its share is made at a lower quality, down to PAGES_MIN_QUALITY, then
# smaller, down to PAGES_MIN_SIDE. An A4 page full of text, or scanned, is 0.3 to 0.6 MB at 80 and full size: a typed
# 10-page contract keeps its full size at 70 to 75; 10 scanned pages come out at about 0.27 MB and 1650 to 1800 px a
# page, 20 at about 0.14 MB and 1000 to 1300 px (README.md). Only 20 pages crammed with text can go a little over, at
# the floors (4.1 MB in base64).
PAGES_PDF_DPI = 200
PAGES_SIDE = 2000
PAGES_QUALITY = 80
PAGES_MIN_QUALITY = 60
PAGES_MIN_SIDE = 1000
PAGES_BUDGET = 3_000_000

log = logging.getLogger("ocr")


def _default_engine():
    from .engine import Engine

    return Engine(threads=int(os.environ.get("OCR_THREADS", "2")))


def _exit_on_failure() -> None:
    # the container stops, Docker starts it again, and `docker compose ps` shows it is not healthy
    os._exit(1)


def create_app(make_engine: Callable = _default_engine, on_load_failure: Callable[[], None] = _exit_on_failure):
    ready = threading.Event()
    # One document at a time: the engine and PDFium are not thread-safe, and only one picture is in memory at once.
    work = threading.Lock()
    engines = []

    def load() -> None:
        started = time.perf_counter()
        try:
            engine = make_engine()
            engine.load()
            engine.warm_up()
        except Exception:
            log.exception("The OCR models could not be loaded")
            on_load_failure()
            return
        engines.append(engine)
        ready.set()
        log.info("Ready: models loaded and checked in %.1f s", time.perf_counter() - started)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # loaded beside the server, so that /health can answer 503 meanwhile
        threading.Thread(target=load, name="load-models", daemon=True).start()
        yield

    app = FastAPI(title="People System OCR", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/health")
    def health():
        if ready.is_set():
            return {"status": "ok"}
        return JSONResponse({"status": "loading"}, status_code=503)

    async def upload(request: Request, what: str):
        """(data, kind), or the refusal to send back."""
        if not ready.is_set():
            return None, _refuse(503, "The OCR models are still loading. Try again in a minute.", what=what)
        try:
            data = await read_file(request)
        except UploadError as e:
            return None, _refuse(e.status, e.detail, what=what)
        kind = sniff(data)
        if kind is None:
            return None, _refuse(400, "Unsupported file: send a JPEG, PNG, WebP or PDF.", len(data), what=what)
        return (data, kind), None

    @app.post("/read")
    async def read(request: Request, lang: str = "ar"):
        lang = lang.strip().lower()
        if lang not in RIGHT_TO_LEFT:
            return _refuse(400, 'lang must be "ar" or "en".')
        got, refusal = await upload(request, "read")
        if refusal is not None:
            return refusal
        data, kind = got
        try:
            pages, seconds = await run_in_threadpool(_read_document, engines[0], work, data, kind, lang)
        except UnreadableFile as e:
            return _refuse(400, str(e), len(data), kind)
        except Exception:
            log.exception("read failed: %s, %d bytes", kind, len(data))
            return JSONResponse({"detail": "The OCR service failed to read this file."}, status_code=500)
        log.info(
            "read: %s, %d bytes, lang %s, %d page(s), %d line(s), %.2f s",
            kind,
            len(data),
            lang,
            len(pages),
            sum(len(lines) for _, lines in pages),
            seconds,
        )
        return {
            "lang": lang,
            "pages": [
                {
                    "width": size[0],
                    "height": size[1],
                    "lines": [
                        {"text": line.text, "confidence": round(line.confidence, 4), "box": list(line.box)}
                        for line in lines
                    ],
                }
                for size, lines in pages
            ],
            "text": "\f".join("\n".join(line.text for line in lines) for _, lines in pages),
        }

    @app.post("/cards")
    async def cards(request: Request):
        got, refusal = await upload(request, "cards")
        if refusal is not None:
            return refusal
        data, kind = got
        try:
            result, found, seconds = await run_in_threadpool(_find_cards, engines[0], work, data, kind)
        except UnreadableFile as e:
            return _refuse(400, str(e), len(data), kind, what="cards")
        except Exception:
            log.exception("cards failed: %s, %d bytes", kind, len(data))
            return JSONResponse({"detail": "The OCR service failed to look for cards in this file."}, status_code=500)
        log.info(
            "cards: %s, %d bytes, %d page(s), %d card(s)%s, %.2f s",
            kind,
            len(data),
            len(result["pages"]),
            len(found),
            "".join(f", {card.side or 'side unknown'}{' (whole picture)' if card.whole else ''}" for card in found),
            seconds,
        )
        return result

    @app.post("/pages")
    async def pages(request: Request):
        got, refusal = await upload(request, "pages")
        if refusal is not None:
            return refusal
        data, kind = got
        try:
            shown, seconds = await run_in_threadpool(_show_pages, work, data, kind)
        except TooManyPages as e:
            detail = f"The PDF has {e.pages} pages; at most {MAX_PDF_PAGES} pages can be shown."
            return _refuse(400, detail, len(data), kind, what="pages", more={"pages": e.pages})
        except UnreadableFile as e:
            return _refuse(400, str(e), len(data), kind, what="pages")
        except Exception:
            log.exception("pages failed: %s, %d bytes", kind, len(data))
            return JSONResponse({"detail": "The OCR service failed to show the pages of this file."}, status_code=500)
        log.info(
            "pages: %s, %d bytes, %d page(s), %d bytes of JPEG, %.2f s",
            kind,
            len(data),
            len(shown),
            sum(len(page["image"]) for page in shown) * 3 // 4,
            seconds,
        )
        return {"pages": shown}

    return app


def _read_document(engine, work: threading.Lock, data: bytes, kind: str, lang: str):
    with work:
        started = time.perf_counter()
        pages = []
        with Document(data, kind) as document:
            for page in document.pages():
                sx, sy = page.scale
                lines = [
                    Line(
                        text=line.text,
                        confidence=line.confidence,
                        box=(
                            round(line.box[0] * sx),
                            round(line.box[1] * sy),
                            round(line.box[2] * sx),
                            round(line.box[3] * sy),
                        ),
                    )
                    for line in engine.read(page.image, lang)
                ]
                pages.append((page.size, reading_order(lines, right_to_left=RIGHT_TO_LEFT[lang])))
        return pages, time.perf_counter() - started


def _find_cards(engine, work: threading.Lock, data: bytes, kind: str):
    """The response of /cards, the cards found, and the time it took."""
    with work:
        started = time.perf_counter()
        pages, found = [], []
        with Document(
            data, kind, max_side=CARDS_MAX_SIDE, pdf_dpi=CARDS_PDF_DPI, first_pages=CARDS_PDF_PAGES
        ) as document:
            for index, page in enumerate(document.pages()):
                full = page.image
                shown = id_cards.shrunk(full, PAGE_SIDE)
                found += id_cards.find_on_page(engine, shown, full, index)
                pages.append(
                    {"width": shown.shape[1], "height": shown.shape[0], "image": _jpeg(shown, PAGE_QUALITY)}
                )
        found = id_cards.in_order(found)[: id_cards.MAX_CARDS]
        result = {"pages": pages, "cards": [_card_json(card) for card in found]}
        return result, found, time.perf_counter() - started


def _show_pages(work: threading.Lock, data: bytes, kind: str):
    """The pages of /pages, and the time it took. One page is in memory at a time, besides the JPEGs made so far."""
    with work:
        started = time.perf_counter()
        shown = []
        with Document(data, kind, max_side=PAGES_SIDE, pdf_dpi=PAGES_PDF_DPI) as document:
            left = PAGES_BUDGET
            for index, page in enumerate(document.pages()):
                image, size, encoded = _jpeg_within(page.image, max(left, 0) // (document.page_count - index))
                del page  # before the next page is rendered
                left -= size
                shown.append(
                    {
                        "width": image.shape[1],
                        "height": image.shape[0],
                        "image": base64.b64encode(encoded).decode("ascii"),
                    }
                )
                del image, encoded
        return shown, time.perf_counter() - started


def _jpeg_within(image, budget: int):
    """(the picture, its size, its JPEG): a JPEG of at most `budget` bytes, at PAGES_QUALITY, else at a lower quality,
    else smaller, as far as the floors allow (a page that still does not fit is sent as it is then). Sizes are those of
    baseline JPEGs, which are quick to make (5 ms for an A4 page); the JPEG sent is progressive, which takes 30 ms, is
    about an eighth smaller at the same settings, and is shown the same by every browser."""
    quality = PAGES_QUALITY
    size = len(_encoded(image, quality))
    while size > budget and quality > PAGES_MIN_QUALITY:
        quality = max(quality - 5, PAGES_MIN_QUALITY)
        size = len(_encoded(image, quality))
    while size > budget and max(image.shape[:2]) > PAGES_MIN_SIDE:
        # a JPEG's size goes about with its number of pixels
        ratio = math.sqrt(budget / size) * 0.98 if budget > 0 else 0
        image = id_cards.shrunk(image, max(round(max(image.shape[:2]) * ratio), PAGES_MIN_SIDE))
        size = len(_encoded(image, quality))
    return image, size, _encoded(image, quality, progressive=True)


def _card_json(card: "id_cards.Card") -> dict:
    box = card.box
    return {
        "page": card.page,
        # pixel indices to distances from the page's top-left corner: a pixel's centre is half a pixel in
        "box": {
            "cx": round(float(box.cx) + 0.5, 2),
            "cy": round(float(box.cy) + 0.5, 2),
            "w": round(float(box.w), 2),
            "h": round(float(box.h), 2),
            "angle": round(float(box.angle), 2),
        },
        "frame": [round(float(v), 4) for v in card.frame],
        "image": _jpeg(card.image, CARD_QUALITY),
        "side": card.side,
        "confidence": round(card.confidence, 3),
    }


def _jpeg(image, quality: int) -> str:
    return base64.b64encode(_encoded(image, quality)).decode("ascii")


def _encoded(image, quality: int, progressive: bool = False) -> bytes:
    params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    if progressive:
        params += [cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1]
    ok, encoded = cv2.imencode(".jpg", image, params)
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return encoded.tobytes()


def _refuse(
    status: int,
    detail: str,
    size: int | None = None,
    kind: str | None = None,
    what: str = "read",
    more: dict | None = None,
) -> JSONResponse:
    about = ", ".join(part for part in (kind, f"{size} bytes" if size is not None else None) if part)
    log.info("%s refused (%d): %s%s", what, status, detail, f" [{about}]" if about else "")
    return JSONResponse({"detail": detail, **(more or {})}, status_code=status)


if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
