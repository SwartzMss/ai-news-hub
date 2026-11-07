#!/usr/bin/env bash
set -euo pipefail
umask 0077

startup_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
startup_log_dir="$startup_repo/logs"
startup_env_args=(--env-file-if-exists=.env)
while (($#)); do
  case "$1" in
    --log-dir)
      if (($# < 2)) || [[ -z "$2" ]]; then
        echo '--log-dir requires a directory' >&2
        exit 2
      fi
      startup_log_dir="$2"
      shift 2
      ;;
    --no-env-file) startup_env_args=(); shift ;;
    --help)
      echo 'Usage: bash scripts/start.sh [--log-dir DIRECTORY] [--no-env-file]'
      exit 0
      ;;
    *) echo "Unknown startup argument: $1" >&2; exit 2 ;;
  esac
done
# Relative overrides are resolved against the project, independent of the caller.
cd -- "$startup_repo"
if [[ ! -f dist/apps/server/src/main.js ]]; then
  echo 'Backend build missing. Run npm run build first.' >&2
  exit 1
fi
mkdir -p -- "$startup_log_dir"
startup_log_file="$startup_log_dir/backend.log"
echo "Backend logs: $startup_log_file" >&2
# exec keeps systemd/terminal signals and the backend exit status intact.
exec node "${startup_env_args[@]}" dist/apps/server/src/main.js >> "$startup_log_file" 2>&1
