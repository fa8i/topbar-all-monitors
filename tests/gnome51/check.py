"""Assertions against a real, private GNOME Shell 51.1 D-Bus session."""
import json
import os
from pathlib import Path
import subprocess
import time

from gi.repository import Gio, GLib

UUID = "topbar-all-monitors@fa8i.github.io"
results_dir = Path(os.environ.get("TOPBAR_RESULTS_DIR", "/results"))
expected_version = os.environ.get("TOPBAR_SHELL_VERSION", "51.1")
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
checks = []


def evaluate(expression):
    script = ("(() => {"
              f"const ext = Main.extensionManager.lookup({json.dumps(UUID)});"
              "const app = ext?.stateObj;"
              "const win = global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === 'Topbar integration window');"
              f"return ({expression});" + "})()")
    ok, result = bus.call_sync(
        "org.gnome.Shell", "/org/gnome/Shell", "org.gnome.Shell", "Eval",
        GLib.Variant("(s)", (script,)), GLib.VariantType.new("(bs)"),
        Gio.DBusCallFlags.NONE, 5000, None).unpack()
    if not ok:
        raise RuntimeError(result or "Eval is not ready")
    return json.loads(result)


def wait_for(expression, timeout=20):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = evaluate(expression)
            if last:
                return last
        except (GLib.Error, RuntimeError, ValueError) as error:
            last = str(error)
        time.sleep(0.2)
    raise AssertionError(f"Timed out: {expression}\nLast result: {last}")


def check(name, condition):
    if not condition:
        print(f"FAIL {name}", flush=True)
        raise AssertionError(name)
    checks.append(name)
    print(f"PASS {name}", flush=True)


def snapshot():
    return evaluate("""({state: ext.state, error: ext.error,
        monitors: Main.layoutManager.monitors,
        primary: Main.layoutManager.primaryIndex,
        panels: app._panels.map(p => ({monitor: p.monitorIndex,
            name: p.actor.name, x: p.actor.x, y: p.actor.y,
            width: p.actor.width, height: p.actor.height,
            published: p._publishIdleId === 0 && p.actor.name === 'panelBox',
            detectedMonitor: Main.layoutManager.findMonitorForActor(p.panel)?.index,
            native: Object.keys(p.panel.statusArea),
            workArea: (() => { const r = Main.layoutManager.getWorkAreaForMonitor(p.monitorIndex);
                return {x: r.x, y: r.y, width: r.width, height: r.height}; })()
        }))})""")


def validate_panels(name):
    wait_for("ext?.state === 1 && app._panels.length === Main.layoutManager.monitors.length - 1 && "
             "app._panels.every(p => p.actor.name === 'panelBox' && p._publishIdleId === 0)")
    # Work-area updates are deferred independently of panel publication.
    wait_for("app._panels.every(p => Main.layoutManager.getWorkAreaForMonitor(p.monitorIndex).y > p.actor.y)")
    data = snapshot()
    check(name, all(
        p["monitor"] != data["primary"]
        and p["detectedMonitor"] == p["monitor"]
        and p["width"] == data["monitors"][p["monitor"]]["width"]
        and {"activities", "dateMenu", "quickSettings"}.issubset(p["native"])
        and p["workArea"]["y"] >= p["y"] + p["height"]
        for p in data["panels"]))
    return data


def change_layout(scale=1.0, primary=0, count=2):
    state = bus.call_sync(
        "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
        "org.gnome.Mutter.DisplayConfig", "GetCurrentState", None, None,
        Gio.DBusCallFlags.NONE, 5000, None).unpack()
    serial, monitors, _, _ = state
    logical = []
    x = 0
    for index, (spec, modes, _) in enumerate(monitors[:count]):
        connector = spec[0]
        mode = next((m for m in modes if m[-1].get("is-current")), modes[0])
        monitor_scale = scale if index == 0 else 1.0
        logical.append((x, 0, monitor_scale, 0, index == primary,
                        [(connector, mode[0], {})]))
        x += round(mode[1] / monitor_scale)
    bus.call_sync(
        "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
        "org.gnome.Mutter.DisplayConfig", "ApplyMonitorsConfig",
        GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (
            serial, 1, logical, {"layout-mode": GLib.Variant("u", 1)})),
        None, Gio.DBusCallFlags.NONE, 5000, None)
    wait_for(f"Main.layoutManager.monitors.length === {count} && Main.layoutManager.primaryIndex === {primary}")
    time.sleep(0.5)


runtime_version = subprocess.check_output(["gnome-shell", "--version"], text=True).strip()
assert runtime_version == f"GNOME Shell {expected_version}", runtime_version
mutter_command = (["rpm", "-q", "mutter"] if expected_version == "51.1" else
                  ["dpkg-query", "-W", "-f=${Version}", "libmutter-18-0"])
report = {"shell": runtime_version,
          "mutter": subprocess.check_output(mutter_command, text=True).strip(),
          "checks": checks}
window_process = None
try:
    wait_for("!Main.layoutManager._startingUp && ext?.state === 1", timeout=45)
    check("version validation remains enabled", evaluate(
        "!global.settings.get_boolean('disable-extension-version-validation')"))
    report["initial"] = validate_panels("startup creates native panels with correct geometry and struts")

    # Exercise a service that can finish after panel teardown. The private
    # container may have no NetworkManager daemon; the delay is deterministic
    # in either case and does not change the host's networking.
    evaluate("import('gi://NM').then(({default: NM}) => import('gi://GLib').then(({default: GLib}) => { global.topbarNM = NM; global.topbarNMOriginal = NM.Client.new_async; global.topbarNMCalls = 0; NM.Client.new_async = async (...args) => { global.topbarNMCalls++; const client = await global.topbarNMOriginal(...args); await new Promise(resolve => GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1200, resolve)); return client; }; return true; }))")
    evaluate("(app._rebuildPanels(), true)")
    wait_for("global.topbarNMCalls > 0")
    evaluate(f"Main.extensionManager.disableExtension({json.dumps(UUID)})")
    wait_for("ext.state === 2 && app._panels.length === 0")
    time.sleep(1.6)
    evaluate("(global.topbarNM.Client.new_async = global.topbarNMOriginal, true)")
    evaluate(f"Main.extensionManager.enableExtension({json.dumps(UUID)})")
    validate_panels("late NetworkManager completion after disable is safely cancelled")

    for role in ("dateMenu", "quickSettings"):
        evaluate(f"(app._panels[0].panel.statusArea.{role}.menu.open(), true)")
        wait_for(f"app._panels[0].panel.statusArea.{role}.menu.isOpen")
        # QuickSettingsMenu.actor is a zero-size overlay wrapper at (0, 0).
        # Its BoxPointer is the visible popup whose monitor must be checked.
        wait_for(f"Main.layoutManager.findMonitorForActor(app._panels[0].panel.statusArea.{role}.menu._boxPointer)?.index === app._panels[0].monitorIndex")
        check(f"{role} menu opens on the secondary monitor", True)
        evaluate(f"(app._panels[0].panel.statusArea.{role}.menu.close(), true)")

    evaluate("(Main.overview.show(), true)")
    wait_for("Main.overview.visible")
    check("secondary panel follows overview styling", evaluate(
        "app._panels[0].panel.has_style_pseudo_class('overview')"))
    evaluate("(Main.overview.hide(), true)")
    wait_for("!Main.overview.visible")

    if expected_version == "51.1":
        # GNOME 50 handles these keys using vfuncs, not the new binding pool.
        check("secondary panel has the inherited GNOME 51 key controller", evaluate(
            "app._panels[0].panel.get_actions().some(a => a.get_name() === 'Clutter shortcuts key controller')"))
        check("GNOME 51 Escape binding accepts the secondary panel", evaluate(
            "Object.getPrototypeOf(app._panels[0].panel.constructor).get_binding_pool().activate(0xff1b, 0, app._panels[0].panel)"))

    change_layout(scale=1.5)
    report["mixedScale"] = validate_panels("150% / 100% layout preserves panel geometry and struts")

    window_code = """
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk
app = Gtk.Application(application_id='org.example.TopbarIntegration')
def activate(app):
    window = Gtk.ApplicationWindow(application=app, title='Topbar integration window')
    window.set_default_size(640, 480)
    window.set_child(Gtk.Label(label='GNOME 51.1 virtual monitor test'))
    window.present()
app.connect('activate', activate)
app.run([])
"""
    window_process = subprocess.Popen(
        ["python3", "-c", window_code],
        env={**os.environ, "WAYLAND_DISPLAY": "wayland-0"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for("!!win")
    wait_for("win.get_compositor_private()?.mapped")
    evaluate("(win.activate(global.get_current_time()), win.move_to_monitor(app._panels[0].monitorIndex), true)")
    wait_for("win.get_monitor() === app._panels[0].monitorIndex")
    evaluate("(win.maximize(), true)")
    wait_for("win?.maximized_vertically && win.get_monitor() === app._panels[0].monitorIndex")
    wait_for("win.get_frame_rect().y >= app._panels[0].actor.y + app._panels[0].actor.height")
    check("a real maximized Wayland window stays below the secondary bar", True)
    check("drag selection finds the real maximized window on its monitor", evaluate(
        "app._panels[0].panel._getDraggableWindowForPosition(win.get_frame_rect().x + win.get_frame_rect().width / 2) === win"))
    evaluate("(win.make_fullscreen(), true)")
    wait_for("win.is_fullscreen() && !app._panels[0].actor.visible")
    check("fullscreen hides the secondary bar", True)
    evaluate("(win.unmake_fullscreen(), true)")
    wait_for("!win.is_fullscreen() && app._panels[0].actor.visible")
    check("leaving fullscreen restores the secondary bar", True)

    screenshot_ok, _ = bus.call_sync(
        "org.gnome.Shell.Screenshot", "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot", "Screenshot",
        GLib.Variant("(bbs)", (False, False, str(results_dir / "desktop.png"))),
        None, Gio.DBusCallFlags.NONE, 10000, None).unpack()
    check("compositor screenshot captured", screenshot_ok)

    window_process.terminate()
    window_process.wait(timeout=5)
    window_process = None
    change_layout(scale=1.5, primary=1)
    report["switchedPrimary"] = validate_panels("changing primary monitor rebuilds the secondary panel")
    change_layout(count=1)
    wait_for("app._panels.length === 0")
    check("single-monitor layout removes secondary panels", True)
    change_layout()
    validate_panels("restoring two monitors recreates the secondary panel")

    evaluate("import('resource:///org/gnome/shell/ui/messageTray.js').then(({Source}) => { global.topbarLifecycleSource = new Source({title: 'Top Bar lifecycle test'}); Main.messageTray.add(global.topbarLifecycleSource); return true; })")
    evaluate("(global.topbarLifecycleSource.notify('count'), true)")

    evaluate("(() => { for (let i = 0; i < 3; i++) app._rebuildPanels(); return true; })()")
    validate_panels("rapid panel rebuilds cancel deferred native indicator setup")

    for cycle in range(3):
        evaluate("(global.topbarRetiredConnections = app._panels[0].panel._nativeConnections, true)")
        evaluate(f"Main.extensionManager.disableExtension({json.dumps(UUID)})")
        wait_for("ext.state === 2 && app._panels.length === 0")
        check(f"disable cycle {cycle + 1} removes panels and chrome", evaluate(
            "Main.layoutManager._trackedActors.every(a => !a.actor.has_style_class_name('topbar-all-monitors-panel-box'))"))
        check(f"disable cycle {cycle + 1} disconnects native service subscriptions", evaluate(
            "global.topbarRetiredConnections._connections.length === 0 && global.topbarRetiredConnections._managedConnections.size === 0 && global.topbarRetiredConnections._sources.size === 0"))
        evaluate("(Main.messageTray.emit('queue-changed'), global.topbarLifecycleSource.notify('count'), Main.sessionMode.emit('updated'), true)")
        evaluate("import('gi://Shell').then(({default: Shell}) => { Shell.AppSystem.get_default().emit('installed-changed'); return true; })")
        evaluate(f"Main.extensionManager.enableExtension({json.dumps(UUID)})")
        validate_panels(f"enable cycle {cycle + 1} restores exactly one secondary panel")

    evaluate("(global.topbarLifecycleSource.destroy(), true)")

    check("extension manager reports ACTIVE without an error", evaluate("ext.state === 1 && !ext.error"))
    report["final"] = snapshot()
    # Asynchronous native callbacks can fail without marking the extension ERROR.
    # Do not certify a build solely from the extension manager's state.
    time.sleep(1)
    shell_log = (results_dir / "shell.log").read_text()
    check("Shell log has no JavaScript errors or disposed-object criticals",
          "JS ERROR:" not in shell_log and "Gjs-CRITICAL" not in shell_log)
    report["passed"] = True
except Exception as error:
    report["passed"] = False
    report["failure"] = str(error)
    raise
finally:
    if window_process is not None:
        window_process.terminate()
        window_process.wait(timeout=5)
    (results_dir / "result.json").write_text(json.dumps(report, indent=2) + "\n")
