#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-all-monitors@fa8i.github.io"
SINCE="${1:-10 minutes ago}"

journalctl -b --since "${SINCE}" -o cat /usr/bin/gnome-shell \
  | grep -iE "${UUID}|Top Bar All Monitors" \
  | grep -v "Error while downloading update for extension" \
  || true
