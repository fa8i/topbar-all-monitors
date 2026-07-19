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

## Compatibility

- GNOME Shell 50
- Wayland

The extension does not import, detect, modify, or depend directly on any
third-party extension.

## Limitations

- Per-monitor panel layouts are not currently configurable.
- Panel elements cannot currently be enabled or disabled independently for
  each monitor.
- Extensions that explicitly add their indicators only to `Main.panel` may
  remain limited to the primary monitor.

## Installation from git

```bash
git clone git@github.com:fa8i/topbar-all-monitors.git
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

## Support

You can support the development of Top Bar All Monitors through
[Buy Me a Coffee](https://buymeacoffee.com/fa8i).

## License

GPL-3.0-or-later.
