FROM fedora:45@sha256:a7d72ba2745b100a3351087472e5ee7b2450af7cf331e7673007e3817612839c

RUN dnf -y --setopt=install_weak_deps=False install \
        gnome-shell-51.1 mutter-51.1 dbus-daemon mesa-dri-drivers \
        python3-gobject gtk4 procps-ng \
    && dnf clean all

ENV HOME=/tmp/topbar-home \
    XDG_RUNTIME_DIR=/tmp/topbar-runtime \
    XDG_CURRENT_DESKTOP=GNOME \
    LIBGL_ALWAYS_SOFTWARE=1

ENTRYPOINT ["bash", "/src/tests/gnome51/session.sh"]
