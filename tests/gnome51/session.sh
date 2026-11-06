#!/usr/bin/env bash
set -euo pipefail

if [[ "$(gnome-shell --version)" != "GNOME Shell 51.1" ]] ||
   [[ "$(rpm -q --qf '%{VERSION}' mutter)" != "51.1" ]]; then
    echo 'This test requires GNOME Shell and Mutter 51.1.' >&2
    exit 1
fi

mkdir -p "$HOME/.local/share/gnome-shell/extensions" "$XDG_RUNTIME_DIR" /results
chmod 700 "$XDG_RUNTIME_DIR"
cp -a /src/topbar-all-monitors@fa8i.github.io "$HOME/.local/share/gnome-shell/extensions/"

# Enable Eval only inside this disposable session. Never install this fixture
# or connect its D-Bus client to the user's desktop.
fixture="$HOME/.local/share/gnome-shell/extensions/topbar-test@local"
mkdir -p "$fixture"
cat > "$fixture/metadata.json" <<'EOF'
{"uuid":"topbar-test@local","name":"Isolated test driver","description":"Container test fixture","shell-version":["51"]}
EOF
cat > "$fixture/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class TestDriver extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() { global.context.unsafe_mode = false; }
}
EOF

mkdir -p /run/dbus
rm -f /run/dbus/pid /run/dbus/system_bus_socket
dbus-daemon --system --fork
# Package tmpfiles can create this empty directory without a running logind.
# Let Shell select its upstream dummy login manager in this headless container.
rmdir /run/systemd/seats 2>/dev/null || true

dbus-run-session -- bash -eu -c '
    gsettings set org.gnome.shell disable-extension-version-validation false
    gsettings set org.gnome.shell enabled-extensions '\''["topbar-all-monitors@fa8i.github.io", "topbar-test@local"]'\''
    gnome-shell --headless --wayland --no-x11 \
        --virtual-monitor 1920x1080 --virtual-monitor 2560x1440 \
        > /results/shell.log 2>&1 &
    shell_pid=$!
    trap '\''kill "$shell_pid" 2>/dev/null || true'\'' EXIT
    python3 /src/tests/gnome51/check.py
' 2>/results/session.log
