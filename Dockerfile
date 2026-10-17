FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# Build web/dist on a laptop first (npm run build); it is copied as static files.
COPY backend/uriwatch backend/uriwatch
COPY backend/models backend/models
COPY data/replay data/replay
COPY web/dist web/dist
COPY bench/results bench/results

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
USER app

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "uriwatch.api:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
