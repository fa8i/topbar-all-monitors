#!/usr/bin/env python3
"""Run the installed Shell 50.1 in a private headless session, not the desktop."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

project = Path(__file__).resolve().parent.parent
root = Path(tempfile.mkdtemp(prefix="topbar-gnome50."))
extensions = root / "home/.local/share/gnome-shell/extensions"
extensions.mkdir(parents=True)
shutil.copytree(project / "topbar-all-monitors@fa8i.github.io",
                extensions / "topbar-all-monitors@fa8i.github.io")
fixture = extensions / "topbar-test@local"
fixture.mkdir()
(fixture / "metadata.json").write_text(
    '{"uuid":"topbar-test@local","name":"Private test driver",'
    '"description":"Isolated test fixture","shell-version":["50"]}')
(fixture / "extension.js").write_text(
    "import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';\n"
    "export default class Driver extends Extension {\n"
    "enable() { global.context.unsafe_mode = true; }\n"
    "disable() { global.context.unsafe_mode = false; }\n}\n")
(root / "runtime").mkdir(mode=0o700)
session = root / "session.sh"
session.write_text("""set -euo pipefail
gsettings set org.gnome.shell disable-extension-version-validation false
gsettings set org.gnome.shell enabled-extensions '["topbar-test@local", "topbar-all-monitors@fa8i.github.io"]'
gsettings set org.gnome.mutter experimental-features '["scale-monitor-framebuffer"]'
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1920x1080 --virtual-monitor 2560x1440 > "$TOPBAR_RESULTS_DIR/shell.log" 2>&1 &
shell_pid=$!
trap 'kill "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true' EXIT
/usr/bin/python3 "$TOPBAR_TEST_CHECK"
""")
environment = os.environ.copy()
for key in ("DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
            "SESSION_MANAGER", "XDG_SESSION_ID", "GNOME_SETUP_DISPLAY"):
    environment.pop(key, None)
environment.update(
    HOME=str(root / "home"), XDG_CONFIG_HOME=str(root / "home/.config"),
    XDG_DATA_HOME=str(root / "home/.local/share"),
    XDG_CACHE_HOME=str(root / "home/.cache"),
    XDG_STATE_HOME=str(root / "home/.local/state"),
    XDG_RUNTIME_DIR=str(root / "runtime"), XDG_CURRENT_DESKTOP="GNOME",
    XDG_SESSION_TYPE="wayland", GNOME_SHELL_SESSION_MODE="user",
    LIBGL_ALWAYS_SOFTWARE="1", TOPBAR_RESULTS_DIR=str(root),
    TOPBAR_SHELL_VERSION="50.1",
    TOPBAR_TEST_CHECK=str(project / "tests/gnome51/check.py"))
with (root / "session.log").open("w") as log:
    result = subprocess.run(["dbus-run-session", "--", "bash", str(session)],
                            env=environment, stdout=log, stderr=subprocess.STDOUT)
if (root / "result.json").exists():
    print((root / "result.json").read_text())
print(f"GNOME 50.1 test artifacts: {root}")
raise SystemExit(result.returncode)
