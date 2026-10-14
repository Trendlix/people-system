"""The uploaded file, read from the request as it arrives, into memory only.

FastAPI's usual UploadFile spools anything over 1 MB to a temporary file on disk; ID photos must never be written to
disk, so the multipart body is parsed here as it streams in, and the size limit is enforced before it is all received.
"""

from python_multipart.exceptions import FormParserError
from python_multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import ClientDisconnect, Request

MAX_FILE_BYTES = 15 * 1024 * 1024
_MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024  # the file, plus room for the multipart headers and any small fields


class UploadError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _too_large() -> UploadError:
    return UploadError(413, f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")


async def read_file(request: Request, field: str = "file") -> bytes:
    """The bytes of the multipart field `field`. Raises UploadError (400 or 413)."""
    content_type, params = parse_options_header(request.headers.get("content-type"))
    if content_type != b"multipart/form-data" or not params.get(b"boundary"):
        raise UploadError(400, f'Send the file as multipart/form-data, in the field "{field}".')
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > _MAX_BODY_BYTES:
        raise _too_large()

    file = bytearray()
    found = False
    complete = False
    capturing = False
    headers: dict[bytes, bytes] = {}
    header_field = bytearray()
    header_value = bytearray()

    def on_part_begin():
        nonlocal capturing
        headers.clear()
        capturing = False

    def on_header_field(data, start, end):
        header_field.extend(data[start:end])

    def on_header_value(data, start, end):
        header_value.extend(data[start:end])

    def on_header_end():
        headers[bytes(header_field).lower()] = bytes(header_value)
        header_field.clear()
        header_value.clear()

    def on_headers_finished():
        nonlocal capturing, found
        _, disposition = parse_options_header(headers.get(b"content-disposition"))
        if disposition.get(b"name") == field.encode() and not found:
            capturing = found = True

    def on_part_data(data, start, end):
        if capturing:
            file.extend(data[start:end])
            if len(file) > MAX_FILE_BYTES:
                raise _too_large()

    def on_end():
        nonlocal complete
        complete = True

    callbacks = {
        "on_part_begin": on_part_begin,
        "on_header_field": on_header_field,
        "on_header_value": on_header_value,
        "on_header_end": on_header_end,
        "on_headers_finished": on_headers_finished,
        "on_part_data": on_part_data,
        "on_end": on_end,
    }
    received = 0
    try:
        parser = MultipartParser(params[b"boundary"], callbacks)
        async for chunk in request.stream():
            received += len(chunk)
            if received > _MAX_BODY_BYTES:
                raise _too_large()
            parser.write(chunk)
        parser.finalize()
    except FormParserError:
        raise UploadError(400, "The upload is not valid multipart/form-data.") from None
    except ClientDisconnect:
        raise UploadError(400, "The upload was interrupted.") from None
    if not complete:
        raise UploadError(400, "The upload is incomplete: it ended before the end of the multipart body.")
    if not found:
        raise UploadError(400, f'There is no file in the field "{field}".')
    if not file:
        raise UploadError(400, "The file is empty.")
    return bytes(file)
