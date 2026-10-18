#!/usr/bin/env bash
# Regenerate frontend_data/live.json every 15 minutes from live weather.
# Run on the VM:  nohup bash scripts/run_live_loop.sh > live_loop.log 2>&1 &
set -u
cd "$(dirname "$0")/.."
source ~/jupyter-env/bin/activate
export TRANSFORMERS_VERBOSITY=error
while true; do
  python live_forecast.py
  sleep 900
done
