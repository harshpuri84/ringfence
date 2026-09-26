#!/bin/bash
# One command for a live test: capture (unless something already captures), the dashboard, then live mode in front.
# Ctrl+C stops everything this script started. Its flags go to live mode:
#   scripts/up.sh --standin                                           # watch: judge and print, write nothing
#   scripts/up.sh --standin --effects                                 # plus todos on your phone
#   scripts/up.sh --standin --effects --execute --repo ~/code/bee-cli # plus agents on worktrees of that repo
set -u
cd "$(dirname "$0")/.."
set -m # each background job gets its own process group, so one kill stops the whole pipeline
started=()
stop() {
  for pid in "${started[@]}"; do kill -- "-$pid" 2>/dev/null; done
  # The npm `bee` wrapper does not pass signals on; stop a stream it left behind.
  [ -n "${capture:-}" ] && pkill -f "bee stream --types all --json" 2>/dev/null
  echo "stopped: ${#started[@]} background job(s)"
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bee status >/dev/null 2>&1 || { echo "bee is not logged in. Run: bee login"; exit 1; }

if pgrep -f "bee stream --types all --json" >/dev/null; then
  echo "capture: already running"
else
  scripts/capture.sh & capture=$!; started+=("$capture")
  echo "capture: started (${BEE_CAPTURE_DIR:-$HOME/.bee-capture})"
fi

if lsof -nP -iTCP:5188 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "dashboard: already on 5188"
else
  npm run dev -- --port 5188 --strictPort >/dev/null 2>&1 & started+=("$!")
  echo "dashboard: starting"
fi
echo "open http://localhost:5188/?live"
echo

node --env-file-if-exists=.env scripts/live.ts "$@"
