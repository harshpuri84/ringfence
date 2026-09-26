#!/bin/bash
# Stop capture, live mode and the dashboard, wherever they were started from.
pkill -f "scripts/capture.sh"
pkill -f "bee stream --types all --json"
pkill -f "scripts/live.ts"
lsof -nP -tiTCP:5188 -sTCP:LISTEN | xargs kill 2>/dev/null
pgrep -fl "capture.sh|bee stream --types all|scripts/live.ts" || echo "all stopped"
