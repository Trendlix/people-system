# OCR service

Reads the text of Egyptian national ID cards (phone photos, front and back), scanned certificates and signed
contracts, and later CVs; finds the ID cards on a scan or a photo, cut out, straightened and the right way up; and
shows the pages of a PDF or a photo as pictures, for adjusting by hand. The API calls it over People System's private
Docker network (`OCR_URL`, `http://ocr:8000`).
It has no port on the server and no sign-in. Pictures are read in memory and never written to disk or to the log.

Python 3.12, FastAPI, and [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 3.7 running on ONNX Runtime, CPU only.

## API

`GET /health` → `200 {"status":"ok"}` once the models are loaded and have read a test picture; `503` before that.

`POST /read?lang=ar|en` (default `ar`), multipart field `file`: JPEG, PNG, WebP or PDF, up to 15 MB (a PDF: every
page, at most 20 pages).

```json
{ "lang": "ar",
  "pages": [ { "width": 1400, "height": 880,
               "lines": [ { "text": "٢٩٠٠١٠١١٢٣٤٥٦٧", "confidence": 0.9643, "box": [1032, 627, 1340, 664] } ] } ],
  "text": "lines joined by \n, pages separated by \f" }
```

- Lines are in reading order: top to bottom; within a row, right to left for `ar`, left to right for `en`.
- `box` is `[x_min, y_min, x_max, y_max]` in pixels of the picture as uploaded, turned the right way up by its EXIF
  orientation. For a PDF, in pixels of the page rendered at 200 dpi. `width` and `height` are the size of that picture
  or page, so that a line the picture's edge runs through can be told from a whole one.
- The text is returned as read. Arabic-Indic digits (٠-٩) are not converted; the API does that.
- `400 {"detail": "…"}` for an unsupported or unreadable file, a PDF of more than 20 pages, or a `lang` other than
  `ar` or `en`. `413` for a file over 15 MB. `503` while the models are loading. The kind of file is judged by its
  content, never by its name.
- One file is read at a time; others wait their turn. A photo or a page takes about 0.3 to 0.5 s on a laptop and a
  dense A4 page up to 5 s, so give the call a generous timeout (a minute for a long PDF).

### Finding ID cards

`POST /cards`, multipart field `file`: JPEG, PNG, WebP or PDF, up to 15 MB. A PDF's first 2 pages are looked at; later
pages are ignored, and a longer PDF is not refused. A flatbed scan with both sides of the card on one page (each
anywhere, tilted, on the dark of an open lid or the white of a closed one), one side per file, a phone photo of a card on
a desk, or a photo of a photocopy: the service finds each card, cuts it out along its edges, straightens it, turns it
the right way up and says which side it is. See `app/cards.py` for how.

```json
{ "pages": [ { "width": 1414, "height": 2000, "image": "<base64 JPEG>" } ],
  "cards": [ { "page": 0,
               "box": { "cx": 707.28, "cy": 1425.59, "w": 577.19, "h": 363.93, "angle": -176.0 },
               "frame": [0.0213, 0.0213, 0.9787, 0.9787],
               "image": "<base64 JPEG>",
               "side": "front",
               "confidence": 0.998 } ] }
```

- `pages[].image` is the page as it was looked at: turned the right way up by its EXIF orientation (a PDF page
  rendered at 300 dpi), scaled down to at most 2000 px on its long side, JPEG quality 85. `width` and `height` are its
  size. Everything about a card refers to this picture.
- `box` is the card itself, without any margin, in pixels of `pages[page].image`, measured from its top-left corner
  (x to the right, y down; the centre of the top-left pixel is at 0.5, 0.5):
  - `cx`, `cy`: the card's centre; `w`, `h`: its width and height, `w` > `h`, always in the card's own proportions,
    85.60 : 53.98. A strip of the card that the picture's edge cut off, or that is as pale as the scanner's lid, is
    made up for: the box is never a shape cut inside the card, and may reach past the edge of the page.
  - `angle`: degrees, in (-180, 180], positive clockwise as seen on screen. The upright card's left-to-right direction
    points along (cos `angle`, sin `angle`) on the page (y down), and its top-to-bottom along (-sin `angle`,
    cos `angle`). 0: level and upright; -7: tilted 7° anticlockwise; 90: lying on its side with its top towards the
    right of the page; ±180: upside down.
  - To cut the card the same way (the web's manual tool): rotate the page by -`angle` around (`cx`, `cy`), then cut the
    axis-aligned `w` x `h` rectangle centred on (`cx`, `cy`). The point (x', y') of the upright card, measured from its
    top-left corner, is on the page at
    (`cx` + (x' - `w`/2) cos `angle` - (y' - `h`/2) sin `angle`, `cy` + (x' - `w`/2) sin `angle` + (y' - `h`/2) cos `angle`).
    On a canvas `w` x `h`: `ctx.translate(w / 2, h / 2); ctx.rotate(-angle * Math.PI / 180); ctx.drawImage(page, -cx, -cy)`.
- `image` is the card cut out that way **with a margin outside it**: 1.2 mm above and below the card and 1.9 mm at its
  sides, in the card's own millimetres (`h` x 1.2 / 53.98 and `w` x 1.9 / 85.60 pixels of the page), but never past the
  edge of the page: on a side where the card runs off the page, the cut stops at the page's edge. Where a tilted card's
  cut reaches past the page at a corner, that corner is white. Where a pale strip was missing and it could not be told
  on which side, the cut keeps half the strip more on both sides. Landscape, upright, the card 1000 px wide (the
  margin makes the picture about 1044 x 659), JPEG quality 90, cut from the page at its full size (up to 4096 px; a PDF
  page at 300 dpi), not from `pages[].image`. To match it by hand, add the same margin to the `w` x `h` cut.
- `frame` is where the card lies on `image`: [left, top, right, bottom] as shares of its width and height, usually
  about [0.021, 0.021, 0.979, 0.979]; below 0 or above 1 on a side where the card runs off the page.
- `side` is `"front"`, `"back"`, or `null` when unsure; `confidence` is how sure the side is, from 0 to 1 (`side` is
  given from 0.6; 0 when it is `null`). The front is told by "جمهورية مصر العربية" and "بطاقة تحقيق الشخصية" and its
  14-digit number along the bottom; the back by "البطاقة سارية حتى", gender, religion and marital status, and its
  barcode band along the bottom. Which way up is decided by reading the card both ways.
- `cards` holds the front first, when one is known; then the others page by page, top to bottom, left to right. At
  most 4. No card: `"cards": []`, still 200.
- A picture that is a card cut out already (a picture shaped like a card, 1.48 to 1.72, with the card filling it, level)
  is not cut again: one card whose `box` is the whole picture (`cx` = `width` / 2, `cy` = `height` / 2, `w` x `h` the
  picture, `angle` 0, 90, 180 or -90 to stand it upright), `frame` [0, 0, 1, 1], and `image` the picture turned
  upright, 1000 px wide.
- Refusals are as for `/read`: `400 {"detail": "…"}` for an unsupported or unreadable file, `413` over 15 MB, `503`
  while the models load.
- About 0.55 s on a laptop (2 threads) for an A4 scan with both sides on it or a two-page PDF, 0.4 s for a 12-megapixel
  phone photo, 0.2 s for a card cut out already and 0.1 s for a page with no card. The response is about 0.5 MB.

### Pages to adjust

`POST /pages`, multipart field `file`: JPEG, PNG, WebP or PDF, up to 15 MB. Every page of a PDF (at most 20), or the
picture, as a JPEG, for cropping, straightening and turning by hand in the web app (through the API's
`POST /paperwork/prepare`). Nothing is read and no card is looked for, so the models are not used.

```json
{ "pages": [ { "width": 1414, "height": 2000, "image": "<base64 JPEG>" } ] }
```

- The pages are in order. A PDF page is rendered at 200 dpi, as `/read` reads it, the right way up (its own rotation
  applied), on white; a picture is turned the right way up by its EXIF orientation. Either is at most 2000 px on its
  long side (an A4 page: 1414 x 2000). `width` and `height` are the size of `image`.
- `image` is a progressive JPEG, quality 80 when it fits. All the pages reach the browser in one answer of at most
  4.5 MB (a Vercel server action), so together they are kept within 3 MB of JPEG (4 MB in base64): each page may take an
  equal share of what is left by the pages before it, and a page over its share is made at a lower quality, down to 60,
  then smaller, down to 1000 px on its long side, never cut. A page still over its share then is sent as it is.
- Measured on a laptop (made-up A4 documents; a page full of text or scanned is 0.3 to 0.6 MB at quality 80 and full
  size):

  | PDF | Pages as sent | In base64, all together | Time |
  |---|---|---|---|
  | 10 pages of a typed contract (11 pt, margins of 2.5 cm) | 2000 px, quality 70 to 75 | 3.3 MB | 0.4 s |
  | 5 pages crammed with typed text | 2000 px, quality 70 to 75 | 3.5 MB | 0.3 s |
  | 10 pages crammed with typed text | 1400 to 1750 px, quality 60 | 3.6 MB | 0.6 s |
  | 10 scanned pages (colour or grey, scanned at 200 or 300 dpi) | 1650 to 1800 px, quality 60 | 3.6 MB | 0.8 to 1 s |
  | 20 scanned pages | 1000 to 1300 px, quality 60 | 3.7 MB | 1.2 s |
  | 20 pages crammed with typed text | 1000 px, quality 60 | 4.1 MB | 0.9 s |

  At quality 80 and full size, the 10-page contract would be 3.8 MB in base64 and the 10 scanned pages 6 to 7 MB. One
  page is in memory at a time: the call takes about 30 MB at most, whatever the number of pages.
- A PDF of more than 20 pages: `400 {"detail": "The PDF has 25 pages; at most 20 pages can be shown.", "pages": 25}`.
  Other refusals are as for `/read`: `400 {"detail": "…"}` for an unsupported or unreadable file (a PDF protected by a
  password, say), `413` over 15 MB, `503` while the models load.
- An OCR service built before `/pages` answers it `404`; the API then shows the pages that `/cards` gives (a PDF's
  first 2 pages), and refuses a longer PDF until the image is rebuilt.

## Models

All are official PaddleOCR models, fetched while the image is built (about 20 MB in all). See `app/engine.py`.

| | Model |
|---|---|
| Text detection, both languages | `PP-OCRv5_mobile_det`; the page is shrunk to at most 1280 px for detection only |
| `lang=ar` | `arabic_PP-OCRv5_mobile_rec`: Arabic, Arabic-Indic and Latin digits, and Latin letters, so mixed documents read in one go |
| `lang=en` | `en_PP-OCRv5_mobile_rec` |

Document orientation, unwarping and text-line orientation are off. Pictures larger than 2560 px are scaled down
first.

Measured on a laptop: about 250 MB of memory idle, about 1.1 GB while reading, and 1.4 GB at most on a dense page;
finding cards stays around 1 GB at most. Docker caps the container at 2 GB (`deploy/docker-compose.yml`).

## Run it locally

```bash
cd services/ocr
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest                                    # tests: no models needed, the engine is stubbed
PADDLE_PDX_CACHE_HOME=$PWD/models .venv/bin/python -m app.engine     # download the models once (into models/)
PADDLE_PDX_CACHE_HOME=$PWD/models .venv/bin/pytest  # also runs tests/test_cards_models.py with the real models
PADDLE_PDX_CACHE_HOME=$PWD/models .venv/bin/uvicorn app.main:app --port 8000
curl -F file=@card.jpg 'http://127.0.0.1:8000/read?lang=ar'
curl -F file=@scan.pdf http://127.0.0.1:8000/cards
curl -F file=@contract.pdf http://127.0.0.1:8000/pages
```

The tests draw made-up cards (`tests/synthetic_cards.py`), never real ones; the card tests with the real models also
need a font with Arabic letters (found on macOS and with DejaVu or Noto on Linux; or set `OCR_TEST_ARABIC_FONT`).

## Changing a dependency

`requirements.in` lists what the service needs. `requirements.txt` pins it and everything it pulls in, for Linux
x86-64 and Python 3.12. Edit `requirements.in`, then regenerate the lock with [uv](https://docs.astral.sh/uv/):

```bash
uv pip compile requirements.in -o requirements.txt --python-version 3.12 --python-platform x86_64-manylinux_2_28
```
