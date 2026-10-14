"""People System's OCR service: reads the text of national ID cards, scanned documents and PDFs.

Internal only: no sign-in, and reachable only on People System's Docker network, where the API calls it.

  GET  /health            200 {"status": "ok"} once the models are loaded and checked; 503 before
  POST /read?lang=ar|en   multipart field "file": JPEG, PNG, WebP or PDF (every page, up to 20), up to 15 MB
       200 {"lang": "ar", "pages": [{"lines": [{"text", "confidence", "box": [x_min, y_min, x_max, y_max]}]}],
            "text": lines joined by \\n, pages separated by \\f}
       400 {"detail": "..."} for an unsupported or unreadable file, 413 for one too large, 503 while loading

Lines are in reading order: top to bottom, and within a row right to left (ar) or left to right (en). Boxes are in
pixels of the picture as uploaded, turned the right way up; for a PDF, of the page rendered at 200 dpi. The text is
returned as read: Arabic-Indic digits stay as they are.

Pictures and their text are never written to disk or to the log; only sizes, page counts and timings are logged.
"""

import logging
import os
import sys
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .documents import Document, UnreadableFile, sniff
from .layout import Line, reading_order
from .upload import UploadError, read_file

RIGHT_TO_LEFT = {"ar": True, "en": False}

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

    @app.post("/read")
    async def read(request: Request, lang: str = "ar"):
        lang = lang.strip().lower()
        if lang not in RIGHT_TO_LEFT:
            return _refuse(400, 'lang must be "ar" or "en".')
        if not ready.is_set():
            return _refuse(503, "The OCR models are still loading. Try again in a minute.")
        try:
            data = await read_file(request)
        except UploadError as e:
            return _refuse(e.status, e.detail)
        kind = sniff(data)
        if kind is None:
            return _refuse(400, "Unsupported file: send a JPEG, PNG, WebP or PDF.", len(data))
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
            sum(len(lines) for lines in pages),
            seconds,
        )
        return {
            "lang": lang,
            "pages": [
                {
                    "lines": [
                        {"text": line.text, "confidence": round(line.confidence, 4), "box": list(line.box)}
                        for line in lines
                    ]
                }
                for lines in pages
            ],
            "text": "\f".join("\n".join(line.text for line in lines) for lines in pages),
        }

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
                pages.append(reading_order(lines, right_to_left=RIGHT_TO_LEFT[lang]))
        return pages, time.perf_counter() - started


def _refuse(status: int, detail: str, size: int | None = None, kind: str | None = None) -> JSONResponse:
    what = ", ".join(part for part in (kind, f"{size} bytes" if size is not None else None) if part)
    log.info("read refused (%d): %s%s", status, detail, f" [{what}]" if what else "")
    return JSONResponse({"detail": detail}, status_code=status)


if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
