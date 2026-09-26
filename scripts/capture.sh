#!/bin/bash
# Stopgap capture: raw `bee stream` events, one JSON object per line, one file per day, reconnecting with backoff.
# Live mode tails the newest file. The files hold your real speech, so they stay in $BEE_CAPTURE_DIR, outside every repo.
# scripts/up.sh starts and stops this for you. By hand: scripts/capture.sh & and stop it with scripts/down.sh
dir="${BEE_CAPTURE_DIR:-$HOME/.bee-capture}"
mkdir -p "$dir"
wait=1
while true; do
  start=$(date +%s)
  bee stream --types all --json 2>>"$dir/capture.err" | grep --line-buffered '^{' >> "$dir/stream-$(date +%F).jsonl"
  [ $(( $(date +%s) - start )) -gt 60 ] && wait=1
  echo "$(date '+%F %T') stream ended, reconnecting in ${wait}s" >> "$dir/capture.err"
  sleep $wait
  wait=$(( wait * 2 > 30 ? 30 : wait * 2 ))
done
