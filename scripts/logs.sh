#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-all-monitors@fa8i.github.io"
SINCE="${1:-10 minutes ago}"

journalctl -b --since "${SINCE}" -o cat /usr/bin/gnome-shell \
  | grep -iE "${UUID}|extension.js|JS ERROR|already disposed|size change" \
  | grep -v "Error while downloading update for extension" \
  || true
