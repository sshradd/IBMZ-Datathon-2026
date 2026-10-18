#!/usr/bin/env bash
# Regenerate frontend_data/live.json every 15 min from live weather, and publish it
# to the repo's `live-data` branch so the frontend can poll a live raw-GitHub URL:
#   https://raw.githubusercontent.com/sshradd/IBMZ-Datathon-2026/live-data/live.json
# Run on the VM:  nohup bash scripts/run_live_loop.sh > live_loop.log 2>&1 &
# (Publishing needs ~/outage_project/live_publish set up as a git repo on branch
#  live-data, with a credential helper at ~/.config/uriwatch/git-credentials.)
set -u
cd "$(dirname "$0")/.."
source ~/jupyter-env/bin/activate
export TRANSFORMERS_VERBOSITY=error
while true; do
  python live_forecast.py
  if [ -f frontend_data/live.json ] && [ -d live_publish/.git ]; then
    cp frontend_data/live.json live_publish/live.json
    ( cd live_publish \
      && git add live.json \
      && git commit -q --amend -m "live $(date -u +%FT%TZ)" \
      && git push -q -f origin live-data ) || echo "publish failed $(date -u +%FT%TZ)"
  fi
  sleep 900
done
