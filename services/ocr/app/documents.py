"""What was uploaded, and its pages as pictures the engine can read. Everything stays in memory.

Not thread-safe (PDFium is not): the service opens one document at a time.
"""

import io
import math
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageOps

MAX_PDF_PAGES = 20
PDF_DPI = 200  # small print on a scanned A4 page stays readable; the page is 1654 x 2339 pixels
MAX_SIDE = 2560  # larger pictures are scaled down first: memory stays bounded, and the text is still large enough
MAX_PIXELS = 50_000_000  # a picture bigger than this (as stored, before scaling down) is refused

_PILLOW_FORMATS = {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}


class UnreadableFile(Exception):
    """The file is not one we read, or it is damaged. The message is shown to the caller."""


class TooManyPages(UnreadableFile):
    """A PDF longer than MAX_PDF_PAGES: `pages` is how many it has."""

    def __init__(self, pages: int):
        super().__init__(f"The PDF has {pages} pages; at most {MAX_PDF_PAGES} pages are read.")
        self.pages = pages


def sniff(data: bytes) -> str | None:
    """The kind of file, from its first bytes (never from its name or the type the client claims)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:1024].lstrip().startswith(b"%PDF-"):
        return "pdf"
    return None


@dataclass
class Page:
    image: np.ndarray  # what the engine reads: height x width x 3, uint8, BGR
    scale: tuple[float, float]  # multiply the engine's x and y by these to get pixels of the page as uploaded
    size: tuple[int, int]  # width and height of the page as uploaded (turned upright), or as rendered from the PDF


class Document:
    """A picture (one page) or a PDF (up to MAX_PDF_PAGES pages, rendered one at a time as they are read).

    `max_side`: a larger picture or page is scaled down to this. `pdf_dpi`: how finely PDF pages are rendered.
    `first_pages`: only the first so many pages of a PDF are looked at, and a longer PDF is not refused for its length.
    """

    def __init__(
        self,
        data: bytes,
        kind: str,
        *,
        max_side: int = MAX_SIDE,
        pdf_dpi: int = PDF_DPI,
        first_pages: int | None = None,
    ):
        self.kind = kind
        self._data = data
        self._pdf = None
        self._max_side = max_side
        self._pdf_dpi = pdf_dpi
        if kind == "pdf":
            try:
                self._pdf = pdfium.PdfDocument(data)
            except pdfium.PdfiumError:
                raise UnreadableFile("The PDF cannot be opened: it is damaged or protected by a password.") from None
            count = len(self._pdf)
            if count == 0:
                self.close()
                raise UnreadableFile("The PDF has no pages.")
            if first_pages is not None:
                count = min(count, first_pages)
            elif count > MAX_PDF_PAGES:
                self.close()
                raise TooManyPages(count)
            self.page_count = count
        elif kind in _PILLOW_FORMATS:
            self._picture = _decode_picture(data, _PILLOW_FORMATS[kind], max_side)
            self.page_count = 1
        else:
            raise UnreadableFile("Unsupported file: send a JPEG, PNG, WebP or PDF.")

    def pages(self) -> Iterator[Page]:
        if self._pdf is None:
            yield self._picture
            return
        for index in range(self.page_count):
            yield _render_pdf_page(self._pdf, index, self._pdf_dpi, self._max_side)

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()
            self._pdf = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _decode_picture(data: bytes, pillow_format: str, max_side: int = MAX_SIDE) -> Page:
    try:
        img = Image.open(io.BytesIO(data), formats=[pillow_format])
        width, height = img.size  # read from the header: nothing is decoded yet
        if width < 1 or height < 1 or width * height > MAX_PIXELS:
            raise UnreadableFile(f"The picture is too large: at most {MAX_PIXELS // 1_000_000} megapixels.")
        # a phone stores its photos sideways and says which way up they go; the page is read the right way up
        if img.getexif().get(0x0112, 1) in (5, 6, 7, 8):
            width, height = height, width
        if pillow_format == "JPEG" and max(width, height) > max_side:
            # JPEG can be decoded straight at a half, a quarter or an eighth of its size, which saves memory
            ratio = max_side / max(width, height)
            img.draft("RGB", (math.ceil(img.width * ratio), math.ceil(img.height * ratio)))
        img = ImageOps.exif_transpose(img)
        img = _on_white(img)
        if max(img.size) > max_side:
            ratio = max_side / max(img.size)
            img = img.resize((max(round(img.width * ratio), 1), max(round(img.height * ratio), 1)), Image.LANCZOS)
        rgb = np.asarray(img)
    except UnreadableFile:
        raise
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise UnreadableFile("The picture cannot be read: it is damaged or not really a JPEG, PNG or WebP.") from None
    return Page(
        image=np.ascontiguousarray(rgb[:, :, ::-1]),
        scale=(width / rgb.shape[1], height / rgb.shape[0]),
        size=(width, height),
    )


def _on_white(img: Image.Image) -> Image.Image:
    """RGB; a transparent background becomes white, as on paper, instead of black."""
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        return Image.alpha_composite(Image.new("RGBA", img.size, (255, 255, 255, 255)), img).convert("RGB")
    return img.convert("RGB")


def _render_pdf_page(pdf: "pdfium.PdfDocument", index: int, dpi: int = PDF_DPI, max_side: int = MAX_SIDE) -> Page:
    page = pdf[index]
    try:
        width_pt, height_pt = page.get_size()  # in points, 72 to the inch
        if width_pt <= 0 or height_pt <= 0:
            raise UnreadableFile(f"Page {index + 1} of the PDF has no size.")
        scale = min(dpi / 72, max_side / max(width_pt, height_pt))
        # the right way up (the page's own rotation is applied), on white, three channels in PDFium's order: BGR
        bitmap = page.render(scale=scale)
        try:
            image = np.array(bitmap.to_numpy(), copy=True)
        finally:
            bitmap.close()
    except pdfium.PdfiumError:
        raise UnreadableFile(f"Page {index + 1} of the PDF cannot be read.") from None
    finally:
        page.close()
    if image.ndim != 3 or image.shape[2] != 3:
        raise UnreadableFile(f"Page {index + 1} of the PDF cannot be read.")
    return Page(image=image, scale=(1.0, 1.0), size=(image.shape[1], image.shape[0]))
