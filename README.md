# Top Bar All Monitors

Top Bar All Monitors is a GNOME Shell extension that adds a real, functional
top bar to every secondary monitor.

[Install Top Bar All Monitors from GNOME Extensions](https://extensions.gnome.org/extension/10094/top-bar-all-monitors/)

## Features

- Native GNOME Shell panel on every non-primary monitor.
- Activities and Overview button.
- Clock and calendar menu.
- Quick Settings menu and current system status indicators.
- Reserved workspace area for maximized windows.
- Fullscreen-aware panel behaviour.
- Automatic monitor hot-plug support.
- Styling synchronized with the main GNOME Shell panel.
- Improved compatibility with themes and panel styling extensions.

Secondary panels are created after GNOME Shell finishes its startup animation,
so styling extensions can identify their monitors using stable coordinates.

## GNOME versions and downloads

| GNOME Shell | Source branch | Supported session | Installation |
| --- | --- | --- | --- |
| 50 and 51 | [`main`](https://github.com/fa8i/topbar-all-monitors/tree/main) | Wayland | [GNOME Extensions](https://extensions.gnome.org/extension/10094/top-bar-all-monitors/) |

`main` contains the current implementation, tested on GNOME Shell 50.1 and
51.1. Check GNOME Extensions for the review status and availability of packages
for your Shell version. A supported version in Git may still be awaiting review
on the website.

When a newer GNOME release requires incompatible code, the previous compatible
implementation will be maintained in a named branch, such as `gnome-50-51`.
Those branches and their release downloads will be listed in this table. Versions
that share an implementation stay together; there is no separate branch for
every GNOME release.

The former `gnome-50-support` and `gnome-51-support` branches have been
consolidated into `main`. See [branch and release policy](docs/releases.md) for
maintenance rules and the relationship between Git tags and GNOME submissions.

The extension does not import, detect, modify, or depend directly on any
third-party extension.

## Limitations

- Per-monitor panel layouts are not currently configurable.
- Panel elements cannot currently be enabled or disabled independently for
  each monitor.
- Extensions that explicitly add their indicators only to `Main.panel` may
  remain limited to the primary monitor.

## Manual installation

Use GNOME Extensions for normal installation and updates. For manual stable
packages, use the installable ZIP attached to a [GitHub release](https://github.com/fa8i/topbar-all-monitors/releases)
when one is available for your Shell version. GitHub's automatic source archives
contain the repository and are not installable extension packages.

## Installation from git

This installs the current development code. For an older GNOME release, choose
the maintenance branch listed above before running the installation script.

```bash
git clone https://github.com/fa8i/topbar-all-monitors.git
cd topbar-all-monitors
./scripts/install-dev.sh
```

Then log out and log back in if GNOME Shell does not detect the extension.

Enable it with:

```bash
gnome-extensions enable topbar-all-monitors@fa8i.github.io
```

## Package

```bash
./scripts/package.sh
```

The generated ZIP will be available in `dist/`.

## Tests

Run the lifecycle regression tests with Node.js:

```bash
node --test tests/*.test.mjs
```

The tests use a simulated Shell with synthetic monitor data. They are not
included in the extension ZIP. Check visual effects separately in GNOME Shell.

For the GNOME 51.1 source audit and isolated compositor test instructions, see
[the compatibility notes](docs/gnome-51.md).

On an Ubuntu system with GNOME Shell 50.1, run the same integration checks in
a private headless session with `python3 scripts/test-gnome50.py`. This does
not install the candidate into the running desktop.

## Support

You can support the development of Top Bar All Monitors through
[Buy Me a Coffee](https://buymeacoffee.com/fa8i).

## License

GPL-3.0-or-later.
