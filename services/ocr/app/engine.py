"""PaddleOCR, loaded once at start-up. Not thread-safe: the service lets one request at a time use it.

PaddleOCR 3 runs here on ONNX Runtime (its engine "onnxruntime"), with the official ONNX exports of the PP-OCRv5 mobile
models, which PaddleOCR downloads itself. In tests (October 2026) this read the same text as the Paddle engine, faster
and in far less memory, and the image does without PaddlePaddle (700 MB). One text detector for both languages; a
recogniser per language:
  ar  arabic_PP-OCRv5_mobile_rec: Arabic letters, Arabic-Indic and Latin digits, and Latin letters too, so an Arabic
      document with English in it (a contract, an address) is read in one go
  en  en_PP-OCRv5_mobile_rec: English only, for CVs and English documents
PaddleOCR's default for English, PP-OCRv6 medium, read the test pages no better, with more than twice the memory and
seven times the time. Document orientation, unwarping and text-line orientation are switched off: phone photos are put
the right way up from their EXIF data (documents.py), and those models cost time on every page.

Run as  python -m app.engine  to download the models and check that they read (the image's build does this).
"""

import logging
import os
import time

import numpy as np

from .layout import Line

# ONNX Runtime 1.30 reports usage to Microsoft and writes a session file (":memory:.ses") into the working folder
# unless this is set before it starts. Nothing about the service may leave the server, so it is always off.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

DETECTION_MODEL = "PP-OCRv5_mobile_det"
RECOGNITION_MODELS = {"ar": "arabic_PP-OCRv5_mobile_rec", "en": "en_PP-OCRv5_mobile_rec"}
# The detector sees the page at most this large (the lines it finds are then read from the full page). Small print on
# an A4 scan is still found; memory and time grow with the square of it.
DETECTION_MAX_SIDE = 1280

log = logging.getLogger("ocr")


class Engine:
    def __init__(self, threads: int):
        self.threads = threads
        self._pipelines = {}

    def load(self) -> None:
        import onnxruntime
        from paddleocr import PaddleOCR  # heavy: imported only when the models are loaded, never by the tests

        onnxruntime.disable_telemetry_events()
        for lang, recognition_model in RECOGNITION_MODELS.items():
            self._pipelines[lang] = PaddleOCR(
                text_detection_model_name=DETECTION_MODEL,
                text_recognition_model_name=recognition_model,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                text_det_limit_type="max",
                text_det_limit_side_len=DETECTION_MAX_SIDE,
                device="cpu",
                engine="onnxruntime",
                engine_config={
                    "intra_op_num_threads": self.threads,
                    "inter_op_num_threads": 1,
                    # memory is given back after each page instead of being kept for the next one
                    "enable_cpu_mem_arena": False,
                    "log_severity_level": 3,  # errors only
                },
            )

    def warm_up(self) -> list[str]:
        """Read a made-up picture in each language: the first run is the slow one, and it proves the models work."""
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGB", (480, 96), "white")
        ImageDraw.Draw(img).text((20, 24), "People System 2026", font=ImageFont.load_default(size=40), fill="black")
        image = np.ascontiguousarray(np.asarray(img)[:, :, ::-1])
        return [" ".join(line.text for line in self.read(image, lang)) for lang in RECOGNITION_MODELS]

    def read(self, image: np.ndarray, lang: str) -> list[Line]:
        """The lines found in a BGR picture, in no particular order; boxes are in pixels of that picture."""
        result = self._pipelines[lang].predict(image)[0]
        boxes = np.asarray(result["rec_boxes"]).tolist()
        lines = []
        for text, score, box in zip(result["rec_texts"], result["rec_scores"], boxes, strict=True):
            text = text.strip()
            if text:
                lines.append(Line(text=text, confidence=float(score), box=tuple(int(v) for v in box)))
        return lines


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    started = time.perf_counter()
    engine = Engine(threads=2)
    engine.load()
    read = engine.warm_up()
    log.info("Models loaded and checked in %.1f s; the test picture read as %s", time.perf_counter() - started, read)
