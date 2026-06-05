# Top Bar All Monitors

GNOME Shell extension that adds a functional top bar to secondary monitors.

Focused on GNOME Shell 50 and Wayland.

## Features

- Top bar on every non-primary monitor.
- Activities / Overview button.
- Clock and calendar menu.
- Quick Settings menu.
- Optional Apps Menu button when GNOME Apps Menu is enabled.
- Reserved space for maximized windows.
- Monitor hot-plug support.

## Versions

- [`main`](https://github.com/fa8i/topbar-all-monitors/tree/main): GNOME Shell 50

## Installation from git

    git clone git@github.com:fa8i/topbar-all-monitors.git
    cd topbar-all-monitors
    ./scripts/install-dev.sh

Then log out and log back in if GNOME Shell does not detect the extension.

Enable it with:

    gnome-extensions enable topbar-all-monitors@fa8i.github.io

## Package

    ./scripts/package.sh

The generated ZIP will be available in `dist/`.

## License

GPL-3.0-or-later.
