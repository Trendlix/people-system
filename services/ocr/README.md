# OCR service

Reads the text of Egyptian national ID cards (phone photos, front and back), scanned certificates and signed
contracts, and later CVs. The API calls it over People System's private Docker network (`OCR_URL`, `http://ocr:8000`).
It has no port on the server and no sign-in. Pictures are read in memory and never written to disk or to the log.

Python 3.12, FastAPI, and [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 3.7 running on ONNX Runtime, CPU only.

## API

`GET /health` → `200 {"status":"ok"}` once the models are loaded and have read a test picture; `503` before that.

`POST /read?lang=ar|en` (default `ar`), multipart field `file`: JPEG, PNG, WebP or PDF, up to 15 MB (a PDF: every
page, at most 20 pages).

```json
{ "lang": "ar",
  "pages": [ { "lines": [ { "text": "٢٩٠٠١٠١١٢٣٤٥٦٧", "confidence": 0.9643, "box": [1032, 627, 1340, 664] } ] } ],
  "text": "lines joined by \n, pages separated by \f" }
```

- Lines are in reading order: top to bottom; within a row, right to left for `ar`, left to right for `en`.
- `box` is `[x_min, y_min, x_max, y_max]` in pixels of the picture as uploaded, turned the right way up by its EXIF
  orientation. For a PDF, in pixels of the page rendered at 200 dpi.
- The text is returned as read. Arabic-Indic digits (٠-٩) are not converted; the API does that.
- `400 {"detail": "…"}` for an unsupported or unreadable file, a PDF of more than 20 pages, or a `lang` other than
  `ar` or `en`. `413` for a file over 15 MB. `503` while the models are loading. The kind of file is judged by its
  content, never by its name.
- One file is read at a time; others wait their turn. A photo or a page takes about 0.3 to 0.5 s on a laptop and a
  dense A4 page up to 5 s, so give the call a generous timeout (a minute for a long PDF).

## Models

All are official PaddleOCR models, fetched while the image is built (about 20 MB in all). See `app/engine.py`.

| | Model |
|---|---|
| Text detection, both languages | `PP-OCRv5_mobile_det`; the page is shrunk to at most 1280 px for detection only |
| `lang=ar` | `arabic_PP-OCRv5_mobile_rec`: Arabic, Arabic-Indic and Latin digits, and Latin letters, so mixed documents read in one go |
| `lang=en` | `en_PP-OCRv5_mobile_rec` |

Document orientation, unwarping and text-line orientation are off. Pictures larger than 2560 px are scaled down
first.

Measured on a laptop: about 250 MB of memory idle, about 1.1 GB while reading, and 1.4 GB at most on a dense page.
Docker caps the container at 2 GB (`deploy/docker-compose.yml`).

## Run it locally

```bash
cd services/ocr
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest                                    # tests: no models needed, the engine is stubbed
PADDLE_PDX_CACHE_HOME=$PWD/models .venv/bin/python -m app.engine     # download the models once (into models/)
PADDLE_PDX_CACHE_HOME=$PWD/models .venv/bin/uvicorn app.main:app --port 8000
curl -F file=@card.jpg 'http://127.0.0.1:8000/read?lang=ar'
```

## Changing a dependency

`requirements.in` lists what the service needs. `requirements.txt` pins it and everything it pulls in, for Linux
x86-64 and Python 3.12. Edit `requirements.in`, then regenerate the lock with [uv](https://docs.astral.sh/uv/):

```bash
uv pip compile requirements.in -o requirements.txt --python-version 3.12 --python-platform x86_64-manylinux_2_28
```
