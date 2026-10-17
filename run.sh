#!/usr/bin/env bash
# One command: set up Python, build the web app if needed (and Node exists),
# then serve everything on one port. Models and storm replays are committed,
# so nothing is trained or downloaded here.
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

if [ ! -f backend/models/honest.json ] || [ ! -f data/replay/uri.json.gz ]; then
  echo "!! models or replays missing. Rebuild them on a laptop:"
  echo "   pip install -r backend/requirements-train.txt"
  echo "   python scripts/fetch_data.py all && python scripts/fetch_data.py age"
  echo "   (cd backend && python -m uriwatch.build && python -m uriwatch.train)"
  exit 1
fi

if [ ! -d web/dist ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "==> Building web app"
    (cd web && npm install --no-fund --no-audit && npm run build)
  else
    echo "!! web/dist missing and npm not found: build on a laptop and copy web/dist here."
  fi
fi

echo "==> Serving on http://$HOST:$PORT"
cd backend
exec ../.venv/bin/uvicorn uriwatch.api:app --host "$HOST" --port "$PORT" --no-server-header
