#!/usr/bin/env bash
set -euo pipefail

service_name=ai-news-hub.service
unit_path=/etc/systemd/system/ai-news-hub.service
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

as_root() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo "$@"
  fi
}

load_state() {
  systemctl show "$service_name" --property=LoadState --value
}

ensure_installed() {
  local state node_path codex_path service_user
  state=$(load_state)
  if [[ "$state" == not-found ]]; then
    node_path=$(command -v node)
    codex_path=$(command -v codex)
    service_user=${SUDO_USER:-$(id -un)}
    echo 'Service not installed; installing and enabling boot startup.'
    as_root "$node_path" "$repo_dir/scripts/install-service.mjs" \
      --user "$service_user" --codex "$codex_path"
  elif [[ -z "$state" ]]; then
    echo 'Cannot determine service installation state.' >&2
    return 1
  fi
}

if (( $# != 1 )); then
  echo 'Usage: bash scripts/service.sh {start|stop|restart|status|health|uninstall}' >&2
  exit 2
fi

case "$1" in
  start|restart)
    ensure_installed
    as_root systemctl "$1" "$service_name"
    ;;
  stop)
    as_root systemctl stop "$service_name"
    ;;
  status)
    exec systemctl status "$service_name"
    ;;
  uninstall)
    state=$(load_state)
    if [[ "$state" == not-found ]]; then
      echo 'Service already uninstalled.'
      exit 0
    fi
    fragment=$(systemctl show "$service_name" --property=FragmentPath --value)
    if [[ "$fragment" != "$unit_path" ]]; then
      echo "Refusing to remove a service outside $unit_path: $fragment" >&2
      exit 1
    fi
    as_root systemctl stop "$service_name"
    as_root systemctl disable "$service_name"
    as_root rm --force -- "$unit_path"
    as_root systemctl daemon-reload
    echo 'Service uninstalled; boot startup disabled. Project, configuration, database and logs preserved.'
    ;;
  health)
    cd -- "$repo_dir"
    exec node --env-file-if-exists=.env dist/scripts/health.js
    ;;
  *)
    echo 'Usage: bash scripts/service.sh {start|stop|restart|status|health|uninstall}' >&2
    exit 2
    ;;
esac
