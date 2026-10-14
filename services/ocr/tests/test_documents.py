import struct
import zlib

import pytest

from app.documents import MAX_PDF_PAGES, MAX_SIDE, PDF_DPI, Document, UnreadableFile, sniff

from .conftest import jpeg, pdf, png


def pages(data, kind):
    with Document(data, kind) as document:
        return document.page_count, list(document.pages())


# What the file is


@pytest.mark.parametrize(
    "data, kind",
    [
        (jpeg(), "jpeg"),
        (png(), "png"),
        (b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20, "webp"),
        (pdf((100, 100, (255, 255, 255))), "pdf"),
        (b"MZ\x90\x00 an executable", None),
        (b"GIF89a", None),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", None),
        (b"", None),
    ],
)
def test_the_kind_comes_from_the_first_bytes(data, kind):
    assert sniff(data) == kind


# Pictures


def test_a_picture_is_one_page_in_bgr():
    count, [page] = pages(png(30, 20, color=(255, 0, 0)), "png")
    assert count == 1
    assert page.image.shape == (20, 30, 3)
    assert tuple(page.image[0, 0]) == (0, 0, 255)  # red, in BGR
    assert page.scale == (1.0, 1.0)


def test_a_transparent_background_becomes_white():
    _, [page] = pages(png(10, 10, color=(0, 0, 0, 0), mode="RGBA"), "png")
    assert tuple(page.image[5, 5]) == (255, 255, 255)


def test_a_phone_photo_is_turned_the_right_way_up():
    # stored 300 wide and 100 high, with EXIF saying "turn 90 degrees": upright it is 100 wide and 300 high
    _, [page] = pages(jpeg(300, 100, exif_orientation=6), "jpeg")
    assert page.image.shape[:2] == (300, 100)
    assert page.scale == (1.0, 1.0)


def test_a_large_picture_is_scaled_down_and_boxes_scale_back():
    _, [page] = pages(png(MAX_SIDE * 2, 100), "png")
    assert page.image.shape[:2] == (50, MAX_SIDE)
    assert page.scale == (2.0, 2.0)


def test_a_large_jpeg_is_decoded_small():
    _, [page] = pages(jpeg(6000, 4000), "jpeg")
    height, width = page.image.shape[:2]
    assert width == MAX_SIDE and abs(height - 1707) <= 1
    assert page.scale[0] == pytest.approx(6000 / width) and page.scale[1] == pytest.approx(4000 / height)


def _png_header_only(width, height):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IEND", b"")
    )


def test_too_many_pixels_is_refused_before_decoding():
    with pytest.raises(UnreadableFile, match="too large"):
        Document(_png_header_only(10_000, 8_000), "png")


@pytest.mark.parametrize(
    "data, kind",
    [
        (png()[:60], "png"),  # cut short
        (b"\x89PNG\r\n\x1a\n" + b"rubbish" * 20, "png"),
        (b"\xff\xd8\xff" + b"rubbish" * 20, "jpeg"),
        (b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20, "webp"),
    ],
)
def test_a_damaged_picture_is_unreadable(data, kind):
    with pytest.raises(UnreadableFile, match="cannot be read"):
        Document(data, kind)


def test_a_picture_is_only_decoded_as_what_it_claims_to_be():
    # PNG bytes are not read as a JPEG even if the caller got the kind wrong
    with pytest.raises(UnreadableFile):
        Document(png(), "jpeg")


# PDFs


def test_every_page_of_a_pdf_is_rendered_in_order():
    letter_portrait, a4_landscape = (612, 792, (255, 0, 0)), (842, 595, (0, 0, 255))
    count, rendered = pages(pdf(letter_portrait, a4_landscape), "pdf")
    assert count == 2
    zoom = PDF_DPI / 72
    assert rendered[0].image.shape == (round(792 * zoom), round(612 * zoom), 3)
    assert rendered[1].image.shape == (round(595 * zoom), round(842 * zoom), 3)
    # Pillow stores the pages as JPEG, so the colours are a shade off
    assert _close(rendered[0].image[10, 10], (0, 0, 255))  # red page, in BGR
    assert _close(rendered[1].image[10, 10], (255, 0, 0))  # blue page, in BGR
    assert all(page.scale == (1.0, 1.0) for page in rendered)


def _close(pixel, expected):
    return all(abs(int(a) - b) <= 3 for a, b in zip(pixel, expected, strict=True))


def test_a_very_large_pdf_page_is_rendered_no_larger_than_the_limit():
    _, [page] = pages(pdf((3000, 1500, (255, 255, 255))), "pdf")
    assert page.image.shape[:2] == (MAX_SIDE // 2, MAX_SIDE)


def test_pdf_pages_are_rendered_one_at_a_time():
    with Document(pdf(*[(100, 100, (255, 255, 255))] * 3), "pdf") as document:
        iterator = document.pages()
        first = next(iterator)
        assert first.image.shape[:2] == (round(100 * PDF_DPI / 72),) * 2
        assert len(list(iterator)) == 2


def test_a_pdf_with_too_many_pages_is_refused():
    with pytest.raises(UnreadableFile, match=f"{MAX_PDF_PAGES + 1} pages; at most {MAX_PDF_PAGES}"):
        Document(pdf(*[(50, 50, (255, 255, 255))] * (MAX_PDF_PAGES + 1)), "pdf")


def test_a_pdf_with_the_most_pages_allowed_is_read():
    count, _ = pages(pdf(*[(50, 50, (255, 255, 255))] * MAX_PDF_PAGES), "pdf")
    assert count == MAX_PDF_PAGES


def test_a_damaged_pdf_is_unreadable():
    with pytest.raises(UnreadableFile, match="cannot be opened"):
        Document(b"%PDF-1.7\n" + b"rubbish" * 50, "pdf")
