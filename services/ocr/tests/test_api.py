import logging
import threading

from app.documents import MAX_SIDE
from app.upload import MAX_FILE_BYTES

from .conftest import StubEngine, line, pdf, png, wait_ready


def upload(client, data, lang=None, field="file", filename="scan.png"):
    params = {} if lang is None else {"lang": lang}
    return client.post("/read", params=params, files={field: (filename, data, "application/octet-stream")})


# Health


def test_health_is_503_until_the_models_are_loaded(make_client):
    gate = threading.Event()
    client = make_client(StubEngine(load_gate=gate), ready=False)
    assert client.get("/health").status_code == 503
    assert upload(client, png()).status_code == 503
    gate.set()
    wait_ready(client)
    assert client.get("/health").json() == {"status": "ok"}


def test_a_failed_load_is_reported_and_health_stays_503(make_client):
    failed = threading.Event()

    class Broken(StubEngine):
        def load(self):
            raise RuntimeError("no models")

    client = make_client(Broken(), ready=False, on_load_failure=failed.set)
    assert failed.wait(5)
    assert client.get("/health").status_code == 503


# Reading


def id_card_lines(image):
    # what PaddleOCR might return for an ID card, in no particular order
    return [
        line("٢٩٠٠١٠١١٢٣٤٥٦٧", (1029, 626, 1341, 664), 0.95312),
        line("٢٠٢٤/٠٥/١٣", (556, 497, 740, 537), 0.84),
        line("تاريخ الإصدار", (1134, 495, 1344, 546), 0.999),
        line("جمهورية مصر العربية", (966, 60, 1339, 115), 0.991),
    ]


def test_arabic_is_the_default_and_rows_read_right_to_left(make_client):
    engine = StubEngine(id_card_lines)
    client = make_client(engine)
    response = upload(client, png(1400, 880))
    assert response.status_code == 200
    body = response.json()
    assert body["lang"] == "ar"
    assert [item["text"] for item in body["pages"][0]["lines"]] == [
        "جمهورية مصر العربية",
        "تاريخ الإصدار",
        "٢٠٢٤/٠٥/١٣",
        "٢٩٠٠١٠١١٢٣٤٥٦٧",  # Arabic-Indic digits come back as they were read
    ]
    assert body["pages"][0]["lines"][-1] == {
        "text": "٢٩٠٠١٠١١٢٣٤٥٦٧",
        "confidence": 0.9531,
        "box": [1029, 626, 1341, 664],
    }
    assert body["text"] == "جمهورية مصر العربية\nتاريخ الإصدار\n٢٠٢٤/٠٥/١٣\n٢٩٠٠١٠١١٢٣٤٥٦٧"
    assert engine.calls == [((880, 1400, 3), "ar")]


def test_english_rows_read_left_to_right(make_client):
    engine = StubEngine(lambda image: [line("Salary", (800, 400, 1000, 440)), line("Start date", (60, 400, 400, 440))])
    response = upload(make_client(engine), png(), lang="en")
    assert response.status_code == 200
    assert response.json()["text"] == "Start date\nSalary"
    assert engine.calls[0][1] == "en"


def test_every_pdf_page_is_read_and_pages_are_separated_by_form_feeds(make_client):
    engine = StubEngine(lambda image: [line(f"page {len(engine.calls)}", (0, 0, 10, 10))])
    response = upload(
        make_client(engine), pdf((612, 792, (255, 255, 255)), (612, 792, (255, 255, 255))), filename="c.pdf"
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["pages"]) == 2
    assert body["text"] == "page 1\fpage 2"


def test_a_page_with_no_text(make_client):
    response = upload(make_client(StubEngine()), png())
    assert response.json() == {"lang": "ar", "pages": [{"lines": []}], "text": ""}


def test_boxes_are_in_pixels_of_the_picture_as_uploaded(make_client):
    # the picture is scaled down to MAX_SIDE before reading; the box comes back in the original's pixels
    engine = StubEngine(lambda image: [line("wide", (0, 0, image.shape[1], image.shape[0]))])
    response = upload(make_client(engine), png(MAX_SIDE * 2, 200))
    assert engine.calls[0][0] == (100, MAX_SIDE, 3)
    assert response.json()["pages"][0]["lines"][0]["box"] == [0, 0, MAX_SIDE * 2, 200]


def test_lang_is_case_insensitive(make_client):
    assert upload(make_client(StubEngine()), png(), lang="EN").json()["lang"] == "en"


# Refusals


def test_an_unknown_language_is_refused(make_client):
    response = upload(make_client(StubEngine()), png(), lang="fr")
    assert response.status_code == 400
    assert response.json() == {"detail": 'lang must be "ar" or "en".'}


def test_an_unsupported_file_is_refused(make_client):
    response = upload(make_client(StubEngine()), b"GIF89a" + b"\x00" * 100, filename="x.gif")
    assert response.status_code == 400
    assert "JPEG, PNG, WebP or PDF" in response.json()["detail"]


def test_a_file_named_like_a_picture_is_judged_by_its_content(make_client):
    response = upload(make_client(StubEngine()), b"MZ\x90\x00 an executable", filename="photo.jpg")
    assert response.status_code == 400


def test_an_unreadable_picture_is_refused(make_client):
    response = upload(make_client(StubEngine()), png()[:60])
    assert response.status_code == 400
    assert "cannot be read" in response.json()["detail"]


def test_a_pdf_with_too_many_pages_is_refused(make_client):
    engine = StubEngine()
    response = upload(make_client(engine), pdf(*[(50, 50, (255, 255, 255))] * 21), filename="long.pdf")
    assert response.status_code == 400
    assert response.json()["detail"] == "The PDF has 21 pages; at most 20 pages are read."
    assert engine.calls == []


def test_a_file_over_15_mb_is_413(make_client):
    response = upload(make_client(StubEngine()), b"\x89PNG\r\n\x1a\n" + b"\x00" * MAX_FILE_BYTES)
    assert response.status_code == 413
    assert response.json() == {"detail": "The file is larger than 15 MB."}


def test_a_declared_length_over_the_limit_is_413_before_reading(make_client):
    client = make_client(StubEngine())
    response = client.post(
        "/read",
        content=b"x",
        headers={"content-type": "multipart/form-data; boundary=b", "content-length": str(MAX_FILE_BYTES * 2)},
    )
    assert response.status_code == 413


def test_a_file_of_exactly_15_mb_is_accepted(make_client):
    data = png()
    response = upload(make_client(StubEngine()), data + b"\x00" * (MAX_FILE_BYTES - len(data)))
    assert response.status_code == 200


def test_the_file_must_be_in_the_field_file(make_client):
    response = upload(make_client(StubEngine()), png(), field="upload")
    assert response.status_code == 400
    assert response.json() == {"detail": 'There is no file in the field "file".'}


def test_the_body_must_be_multipart(make_client):
    response = make_client(StubEngine()).post("/read", content=png(), headers={"content-type": "image/png"})
    assert response.status_code == 400
    assert "multipart/form-data" in response.json()["detail"]


def test_an_empty_file_is_refused(make_client):
    response = upload(make_client(StubEngine()), b"")
    assert response.status_code == 400
    assert response.json() == {"detail": "The file is empty."}


def test_a_cut_off_upload_is_refused(make_client):
    body = b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\n' + png()
    response = make_client(StubEngine()).post(
        "/read", content=body, headers={"content-type": "multipart/form-data; boundary=b"}
    )
    assert response.status_code == 400
    assert "incomplete" in response.json()["detail"]


# Failures and privacy


def test_an_engine_failure_is_a_500_and_the_service_carries_on(make_client):
    calls = []

    def flaky(image):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("inference failed")
        return [line("ok", (0, 0, 5, 5))]

    client = make_client(StubEngine(flaky))
    assert upload(client, png()).status_code == 500
    assert upload(client, png()).json()["text"] == "ok"


def test_the_log_has_sizes_and_timings_but_never_the_text(make_client, caplog):
    client = make_client(
        StubEngine(lambda image: [line("أحمد محمد علي", (0, 0, 9, 9)), line("29001011234567", (0, 20, 9, 29))])
    )
    with caplog.at_level(logging.INFO, logger="ocr"):
        assert upload(client, png()).status_code == 200
        assert upload(client, b"GIF89a").status_code == 400
    assert "1 page(s), 2 line(s)" in caplog.text
    assert "أحمد" not in caplog.text and "29001011234567" not in caplog.text
