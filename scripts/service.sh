#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  start|stop|restart|status)
    exec systemctl "$1" ai-news-hub.service
    ;;
  health)
    probe_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
    cd -- "$probe_repo"
    exec node --env-file-if-exists=.env dist/scripts/health.js
    ;;
  *)
    echo 'Usage: bash scripts/service.sh {start|stop|restart|status|health}' >&2
    exit 2
    ;;
esac
