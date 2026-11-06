#!/usr/bin/env python3
"""One-shot, next-login smoke test of an installed candidate using public D-Bus APIs."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

from gi.repository import Gio, GLib

UUID = "topbar-all-monitors@fa8i.github.io"
deployment_path = Path(sys.argv[1])
deployment = json.loads(deployment_path.read_text())
root = deployment_path.parent
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(destination, path, interface, method, parameters=None):
    return bus.call_sync(destination, path, interface, method, parameters, None,
                         Gio.DBusCallFlags.NONE, 10000, None).unpack()


def extension(method):
    return call("org.gnome.Shell.Extensions", "/org/gnome/Shell/Extensions",
                "org.gnome.Shell.Extensions", method, GLib.Variant("(s)", (UUID,)))


def info():
    return extension("GetExtensionInfo")[0]


def wait_state(state):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        current = info()
        if current.get("state") == state:
            return current
        if current.get("error"):
            raise RuntimeError(current["error"])
        time.sleep(0.5)
    raise RuntimeError(f"Extension did not reach state {state}: {current}")


def notify(body):
    return call("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
                "org.freedesktop.Notifications", "Notify",
                GLib.Variant("(susssasa{sv}i)", (
                    "Top Bar verification", 0, "dialog-information", "Top Bar All Monitors",
                    body, [], {"transient": GLib.Variant("b", True)}, 3000)))[0]


owner = call("org.freedesktop.DBus", "/org/freedesktop/DBus",
             "org.freedesktop.DBus", "GetNameOwner", GLib.Variant("(s)", ("org.gnome.Shell",)))[0]
shell_pid = call("org.freedesktop.DBus", "/org/freedesktop/DBus",
                 "org.freedesktop.DBus", "GetConnectionUnixProcessID",
                 GLib.Variant("(s)", (owner,)))[0]
if shell_pid == deployment["previousShellPid"]:
    print("Candidate installed; a new GNOME session is still required.")
    raise SystemExit(0)

result = {"shellPid": shell_pid, "checks": [], "passed": False}
restore_enabled = False
try:
    time.sleep(15)  # Let startup, themes and other extensions settle.
    result["initial"] = info()
    if result["initial"].get("state") != 1:
        raise RuntimeError("The candidate is not active; desktop preferences were left unchanged.")
    restore_enabled = True
    if result["initial"].get("version-name") != "0.2.6":
        raise RuntimeError("The running extension is not the installed 0.2.6 candidate.")
    for name, expected in deployment["hashes"].items():
        path = Path(deployment["installedPath"]) / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Installed file changed: {name}")
    result["checks"].append("fresh session loaded the expected candidate files")
    since = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    for cycle in range(2):
        extension("DisableExtension")
        wait_state(2)
        notification = notify(f"Verificando limpieza de conexiones ({cycle + 1}/2).")
        time.sleep(1)
        call("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
             "org.freedesktop.Notifications", "CloseNotification",
             GLib.Variant("(u)", (notification,)))
        extension("EnableExtension")
        wait_state(1)
        result["checks"].append(f"disable, real notification, enable cycle {cycle + 1}")
    time.sleep(2)
    errors = extension("GetExtensionErrors")[0]
    if errors:
        raise RuntimeError(str(errors))
    journal = subprocess.run([
        "journalctl", "--user", f"_PID={shell_pid}", "--since", since,
        "--no-pager", "-o", "cat"], text=True, capture_output=True, check=True).stdout
    (root / "desktop-journal.log").write_text(journal)
    if any(marker in journal for marker in ("JS ERROR:", "Gjs-CRITICAL", "already disposed")):
        raise RuntimeError("The desktop log contains JavaScript errors; inspect desktop-journal.log.")
    result["checks"].append("no extension errors or JavaScript criticals during the desktop test")
    result["final"] = info()
    result["passed"] = True
except Exception as error:
    result["failure"] = str(error)
finally:
    if restore_enabled:
        extension("EnableExtension")
    (root / "desktop-result.json").write_text(json.dumps(result, indent=2) + "\n")
    Path(deployment["autostartPath"]).unlink(missing_ok=True)
    try:
        notify("Verificación completada correctamente." if result["passed"] else
               "La verificación necesita revisión. El resultado se ha guardado localmente.")
    except GLib.Error:
        pass
