# People System's OCR service as an image: PaddleOCR 3 on ONNX Runtime, CPU only (see app/engine.py and README.md).
# Built from this folder; deploy/docker-compose.yml does that:  docker build services/ocr
FROM python:3.12-slim-bookworm

# OpenCV, which PaddleOCR uses, will not load without libGL and GLib, though nothing is ever shown on a screen
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_ROOT_USER_ACTION=ignore
# Where PaddleOCR keeps its models. They are fetched below, while the image is built: the container never needs the
# internet, and PaddleOCR does not go looking for the model sites when it starts.
ENV PADDLE_PDX_CACHE_HOME=/opt/models PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
# ONNX Runtime reports usage to Microsoft and writes a session file unless this is set (app/engine.py sets it too)
ENV ORT_DISABLE_TELEMETRY=1
# Fewer memory pools in the C library: less memory left behind, unused, between one file and the next
ENV MALLOC_ARENA_MAX=2
# CPU threads used to read a page; deploy/docker-compose.yml sets it
ENV OCR_THREADS=2

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

# The service's own user, which can read the code and the models but change neither
RUN useradd --system --create-home --home-dir /home/ocr --shell /usr/sbin/nologin ocr

COPY app app

# Fetch the models (owned by root, readable by all) and read a test picture with them; then read it again as the
# service's user, the way the service will. If either fails, so does the build, and the running version stays as it is.
RUN python -m app.engine && chmod -R a+rX /opt/models
USER ocr
RUN python -m app.engine

EXPOSE 8000
# Healthy once the models are loaded and have read a test picture (a few seconds after the start)
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

# One process: the models are loaded once, and files are read one at a time (app/main.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
