#!/usr/bin/env bash
# One command: set up Python, train the model if needed, build the PWA if
# needed (and Node exists), then serve everything on one port.
#
#   ./run.sh                 # http://127.0.0.1:8000
#   HOST=0.0.0.0 ./run.sh    # listen on all interfaces (only if you mean to)
set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
PY="${PYTHON:-python3}"

if [ ! -d .venv ]; then
  echo "==> Creating virtualenv"
  "$PY" -m venv .venv
fi
.venv/bin/pip install -q -r backend/requirements-dev.txt

if [ ! -f backend/model.json ]; then
  echo "==> Training model"
  (cd backend && ../.venv/bin/python -m scamstopper.train)
fi

if [ ! -d web/dist ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "==> Building PWA"
    (cd web && npm install --no-fund --no-audit && npm run build)
  else
    echo "!! web/dist missing and npm not found: build on a laptop and copy web/dist here."
  fi
fi

echo "==> Serving on http://$HOST:$PORT"
cd backend
exec ../.venv/bin/uvicorn scamstopper.api:app --host "$HOST" --port "$PORT" --no-server-header
