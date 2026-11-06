# GNOME Shell 51 compatibility

Target: GNOME Shell **51.1** and Mutter **51.1**, retaining GNOME Shell 50.
Related report: [issue #6](https://github.com/fa8i/topbar-all-monitors/issues/6).

## Source audit

This audit compares upstream tags **50.1** (the development desktop) and
**51.1** (the reported environment), rather than inferring compatibility from
unchanged import names. The [GNOME 51 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)
was also checked.

| Surface used by this extension | Change in GNOME 51 | Decision |
| --- | --- | --- |
| `Panel.Panel` subclass construction | The export is now a class registered in a static block, replacing the `registerClass()` expression. `_init()`, panel placement and status-area creation remain compatible. | Keep the registered subclass and native indicators. |
| Panel keyboard handling | Escape moved from `vfunc_key_press_event()` to an `unfocus` binding. Activities uses bindings for Return/Space instead of its old key event override. Clutter installs a key controller when an actor type or an ancestor has bindings. | Inherit upstream handling; do not copy the old event overrides. Check the inherited controller and Escape binding in the real compositor. |
| Panel allocation and dragging | `vfunc_allocate()`, `_getDraggableWindowForPosition(stageX)` and the drag call site retain their contracts. | Keep the per-monitor width and window-selection overrides. |
| `LayoutManager` chrome and work areas | `_updateRegions()` drops obsolete popup-window bookkeeping and simplifies strut discovery. `addChrome`, `trackChrome`, `untrackChrome`, monitor discovery and strut parameters retain their contracts. `UiActor` additionally queues relayout when stage size changes. | Keep publication after valid allocation and monitor detection, followed by strut tracking. Exercise monitor layout changes and mixed scaling. |
| Startup lifecycle | `_startingUp`, `startup-complete` and `monitors-changed` remain available. | Keep deferred creation and cancellation on disable. These are internal APIs and still need runtime coverage. |
| Extension manager | Enable/disable setting changes are queued and serialized. A thenable returned by `disable()` is explicitly rejected. | Keep synchronous cleanup. Test through the actual extension manager, waiting for state transitions. |
| `St.BoxLayout` | The deprecated `vertical` property and its accessors are removed. | Already uses `orientation: Clutter.Orientation.VERTICAL`; no port required. |
| `Meta.Window` | Relevant window accessors remain available; `MetaMaximizeFlags` moves to the shared enum header. | Existing monitor, frame, type and maximization checks remain compatible. |
| `ctrlAltTabManager.removeGroup()` | No change in the compared module. | Keep explicit secondary panel group removal. |
| Native popup menus | `open()` and `close()` now accept an options object instead of a positional animation enum. | Production code does not call these methods; native GNOME indicators handle the new API. Shared integration tests use the compatible default arguments. |

Other porting-guide changes (removed `pointerWatcher`, shader effects, old
backend accessor, DBus proxy factory usage and renamed button masks) are not
used by this extension. The implementation already uses ES modules and does
not override the calendar's removed event handling.

Sources at the audited tags:

- [Panel 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/panel.js), [Panel 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/panel.js)
- [Layout 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/layout.js), [Layout 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/layout.js)
- [Extension manager 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/extensionSystem.js), [Extension manager 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/extensionSystem.js)
- [Box layout 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/src/st/st-box-layout.c), [Box layout 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/src/st/st-box-layout.c)
- [Window API 50.1](https://github.com/GNOME/mutter/blob/50.1/src/meta/window.h), [Window API 51.1](https://github.com/GNOME/mutter/blob/51.1/src/meta/window.h)
- [Clutter actor 51.1](https://github.com/GNOME/mutter/blob/51.1/clutter/clutter/clutter-actor.c), [PopupMenu 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/popupMenu.js)
- [CtrlAltTab 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/ctrlAltTab.js), [CtrlAltTab 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/ctrlAltTab.js)

The audit does not identify a removed API requiring a JavaScript port. Runtime
testing did expose an initial-state problem: `Panel._init()` only listens for
future overview signals, so a panel constructed while overview is already
visible misses its `overview` pseudo-class. Secondary panels now copy that
initial state from the primary panel and continue using upstream signals.
A Node regression test covers creation and rebuilding during overview.

The candidate declares support for `50` and `51`; the major-version entry also
covers 51.1. Release tags such as `v0.2.6` belong to Git. Metadata omits
`version` and `version-name` so GNOME Extensions assigns and displays its own
integer submission version. The lifecycle correction now passes the isolated
50.1 and 51.1 compositor checks, plus the fresh-login smoke test in the user's
GNOME 50.1 desktop, as described below.

## Isolated real-compositor test

```bash
./scripts/test-gnome51.sh
```

Requires Docker. Builds a Fedora 45 image with GNOME Shell and Mutter pinned
to **51.1**, then starts a real Wayland compositor using software rendering
and two virtual monitors. The runner refuses other Shell/Mutter versions.
Version validation remains enabled.

The container has a private home and private system/session buses. It does
not mount the host desktop, buses, GPU or home directory, use privileged mode,
or install the candidate into the host. The repository is mounted read-only;
the running container has networking disabled. A test-only helper enables
Shell's Eval interface inside the private session and is never packaged.

Checks cover native panel creation, allocation and work-area reservation,
calendar and Quick Settings menu placement, overview styling, GNOME 51 key
bindings, 150%/100% monitor scaling, a real maximized Wayland window, window
selection for dragging, fullscreen hiding/restoration, changing the primary
monitor, disabling and restoring an output, and repeated extension-manager
enable/disable cycles. It also checks the Shell log for asynchronous errors.
Disabling a virtual output tests layout changes, not physical cable hotplug.

The script prints the directory containing `shell.log`, `session.log`,
`desktop.png` and `result.json`,
including actual runtime versions, assertions, geometry and work areas.
Builds need network access and approximately 1 GB for installed dependencies.
To reuse an existing image, set `TOPBAR_GNOME51_IMAGE` to its name.

Missing desktop daemons can produce container environment warnings in the
Shell log. Inspect these separately from extension errors. This headless
test does not certify physical display drivers, hardware controls, pointer
and keyboard interaction, screen locking through GDM, or third-party styling
extensions. Run the existing Node lifecycle tests as a separate check; they
are synthetic and do not substitute for this compositor test.

## Lifecycle correction and validation (2026-11-06)

`PanelSignals` gives native components a lifetime bounded by the secondary
panel. It records ordinary signal handlers, tracks managed owners and supplies
a panel-local owner for ownerless `connectObject()` calls. Teardown disconnects
these before destroying widgets. Native GLib idle/timeout sources are cancelled,
and pending D-Bus proxy initialization has a panel-owned cancellable. Proxy
completion callbacks execute in the same scope and do not run after teardown.

This adapter temporarily wraps public connection/scheduling methods during
synchronous construction and owned callbacks, restoring every original property
descriptor in `finally`. It does not leave hooks installed between main-loop
iterations or alter the primary panel's widget instances. This is a deliberate
compatibility mechanism, not a change to GNOME's installed source. Native
components and their asynchronous behavior must be audited again for future
Shell versions.

The native Quick Settings initializer continues after asynchronous module
imports, outside the panel constructor. `SecondaryQuickSettings` therefore
loads modules first and constructs independent native indicators inside the
scope. It preserves GNOME 50/51's indicator/menu ordering and inherited menu
behavior, and cancels deferred setup when destroyed. No primary-panel actor,
menu or third-party indicator is cloned or shared.

Validation of the corrected candidate:

- 20 Node lifecycle/ownership regression tests pass.
- 27 integration assertions pass in the installed GNOME Shell 50.1 / Mutter
  50.1 headless compositor, using a private home and session bus.
- 29 integration assertions pass in the GNOME Shell 51.1 / Mutter 51.1 container.
- Both tests include late notification sources, notification count changes,
  application-system and session-mode events after disable, rapid rebuilds,
  repeated enable/disable, actual maximized/fullscreen Wayland windows and a
  final log check. Neither corrected run contains JavaScript errors,
  disposed-object criticals or invalid source/handler warnings.

Run `python3 scripts/test-gnome50.py` on the Ubuntu 50.1 development machine,
or `./scripts/test-gnome51.sh` for the container test. Local reports are saved
in `artifacts/gnome50.1-fixed/` and `artifacts/gnome51-fixed/`.

The candidate is installed locally with a backup under
`~/.local/state/topbar-all-monitors/`. After logout/login on 2026-11-06, the
one-shot `scripts/verify-desktop.py` check passed in the user's GNOME 50.1
desktop (Shell PID 49150). It verified the candidate identity/file hashes and
completed two disable/real-notification/enable cycles through public D-Bus
APIs. The extension remained ACTIVE with no extension errors, JavaScript
criticals or disposed-object accesses during the check. The verifier restored
the enabled state and removed its autostart entry; it did not enable Eval or
close applications. Evidence is saved in `artifacts/desktop-fixed/` and beside
the deployment manifest at
`~/.local/state/topbar-all-monitors/candidate-20261106-094936/`.

The real-desktop check is a smoke test, not a claim to have visually verified
every theme or hardware interaction. No session was forcibly restarted and
no GitHub/GNOME Extensions release has been published.

### First real desktop check and NetworkManager follow-up

The first login loaded the expected 0.2.6 candidate and completed the two
notification/enable-disable cycles. Its journal check correctly failed:
`network.Indicator._getClient()` awaits `NM.Client.new_async()` and then a
Polkit permission. These continuations are not D-Bus proxy initializer
callbacks, so the earlier proxy cancellation adapter did not cover them.
An NM client could finish after panel teardown, touching retired toggles.

`SecondaryNetwork` now bounds both awaits and connectivity rechecks with
`PanelSignals.runAsync()`. Each operation gets its own cancellable, executes
successful continuations within the panel's connection scope and ignores
late results without attaching subscriptions or updating retired actors.
It leaves service objects to their normal reference lifecycle. It retains native
network widgets and instantiates an independent native captive-portal handler;
it does not share the primary panel's menu or connection state.

The integration suite now deliberately delays NM client completion, waits
until the secondary client request has started, disables the extension and
lets the delayed result arrive. This reproduces the missing timing case
regardless of service speed or whether the test machine has real networking.
The new candidate passes that regression in 50.1 and 51.1. The failed desktop
report is preserved under `artifacts/desktop-first-run/`. The corrected
revision subsequently passed the fresh-session desktop check described above.

## Original validation failure (historical, 2026-11-04)

The candidate passes 10 Node lifecycle tests and 23 functional assertions in
a real GNOME Shell 51.1 / Mutter 51.1 headless Wayland compositor. A screenshot
also confirms both bars and the maximized test window. However, log inspection
exposes an existing native date-menu teardown problem, so the final log gate
fails and the candidate must not be described as fully validated.

`MessagesIndicator` connects to the global message tray using ordinary
`connect()` calls without keeping/disconnecting the handler IDs. Destroying
the icon disposes `_settings`; later notification events still reach
`_updateCount()` / `_sync()` and throw because `_settings` is null.
`EventsSection` and `WorldClocksSection` also keep ordinary connections to
`Shell.AppSystem`, and disposed-object criticals appear after panel rebuilds.
The same connections exist in both audited versions:

- [Date menu 50.1](https://github.com/GNOME/gnome-shell/blob/50.1/js/ui/dateMenu.js)
- [Date menu 51.1](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/dateMenu.js)

The extension manager can still report ACTIVE with no recorded extension
error because these exceptions occur later in native callbacks. This is
distinct from absent-daemon warnings in the container. Do not hide these
exceptions or patch the primary panel globally as a version workaround.
Before publishing, secondary native components need an explicit lifecycle
strategy for these global subscriptions; merely adding guards would leave
the subscriptions and their retained objects alive.

### Confirmed baseline on GNOME 50.1

The same failures were reproduced using the installed GNOME Shell **50.1**
binary and the **unmodified v0.2.5** extension (commit
`b58ccc3a92251c6b73293f55d4a04a3d94b89cbb`). The headless compositor had two
virtual monitors, a private temporary home/config/cache/runtime and a private
session bus. It used the host system bus for desktop services; the user's
running compositor, installed extension and settings were not modified.

Before disabling the extension, explicitly emitting the message tray's
`queue-changed` signal produced zero new JavaScript errors. After disabling
through the extension manager, emitting the same signal produced one error
from `MessagesIndicator._sync()` because `_settings` had been disposed.
Emitting the application system's `installed-changed` signal then reached
destroyed `EventsSection` and `WorldClocksSection` objects. These were
controlled signal emissions against real native objects, not simulated
actors. The extension manager still recorded no error.

The baseline also confirmed that startup with overview visible gives the
primary panel the `overview` pseudo-class while the secondary lacks it.
That initialization issue is fixed in the candidate, independently of the
remaining subscription cleanup.

Local evidence is saved in `artifacts/gnome50.1-baseline/`: `result.json`,
`shell.log` and the separate logs from the two post-disable signal emissions.

The installed Shexli 0.2.1 reports one separate finding, `EGO-M-004`, because
its metadata rule hardcodes `major > 50` as an implausible future release.
This is an outdated analyzer limit, not evidence that 51 is invalid. No
analyzer rules or release metadata were altered to suppress the finding.

## Submission numbering correction (2026-11-06)

The initial ZIP included `version-name: "0.2.6"`. GNOME Extensions assigned
submission **7**, but displayed the supplied name in the public versions table.
The review page confirms both values: `0.2.6 (7)` at
https://extensions.gnome.org/review/77976. The submission is awaiting review.

Both maintenance branches now omit `version-name`. Packaging rejects manual
`version` or `version-name` fields, preserving the existing integer display
convention. The verifier identifies a deployed candidate through the deployment
manifest's file hashes rather than a display name. The published `v0.2.6` tag
is retained to identify the ZIP already submitted; it is not silently moved.
The corrected ZIP is for a future submission: uploading it now would create
another submission, not rename the existing version 7.
