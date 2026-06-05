import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';

const EXTENSION_UUID = 'topbar-all-monitors@fa8i.github.io';
const DELAYED_REBUILD_SECONDS = 2;

export default class TopBarAllMonitorsExtension extends Extension {
    enable() {
        this._chromeActors = [];
        this._ownedMenus = [];
        this._signals = [];
        this._timeoutIds = [];
        this._menuSourceOverrides = new Map();

        this._createBars();
        this._scheduleRebuild(DELAYED_REBUILD_SECONDS);

        this._signals.push(
            Main.layoutManager.connect('monitors-changed', () => {
                this._rebuildBars();
            })
        );
    }

    disable() {
        this._removeTimeouts();
        this._disconnectSignals();
        this._destroyBars();
    }

    _scheduleRebuild(seconds) {
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._rebuildBars();
            this._timeoutIds = this._timeoutIds.filter(id => id !== timeoutId);

            return GLib.SOURCE_REMOVE;
        });

        GLib.Source.set_name_by_id(timeoutId, `[${EXTENSION_UUID}] delayed rebuild`);
        this._timeoutIds.push(timeoutId);
    }

    _removeTimeouts() {
        for (const timeoutId of this._timeoutIds) {
            try {
                GLib.source_remove(timeoutId);
            } catch (e) {
            }
        }

        this._timeoutIds = [];
    }

    _disconnectSignals() {
        for (const signalId of this._signals) {
            try {
                Main.layoutManager.disconnect(signalId);
            } catch (e) {
            }
        }

        this._signals = [];
    }

    _rebuildBars() {
        this._destroyBars();
        this._createBars();
    }

    _createBars() {
        const primaryIndex = Main.layoutManager.primaryIndex;

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            if (i === primaryIndex)
                continue;

            this._createBarForMonitor(Main.layoutManager.monitors[i]);
        }
    }

    _createBarForMonitor(monitor) {
        const panelHeight = Main.panel.height || 32;

        const strutActor = this._createStrutActor(monitor, panelHeight);
        this._addChrome(strutActor, {
            affectsStruts: true,
            trackFullscreen: false,
        });

        const bar = new St.BoxLayout({
            name: 'panel',
            style_class: 'panel topbar-all-monitors-panel',
            reactive: true,
            orientation: Clutter.Orientation.HORIZONTAL,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: panelHeight,
        });

        bar.set_position(monitor.x, monitor.y);
        bar.set_size(monitor.width, panelHeight);

        const leftBox = new St.BoxLayout({
            name: 'panelLeft',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });

        const centerBox = new St.BoxLayout({
            name: 'panelCenter',
            x_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const rightBox = new St.BoxLayout({
            name: 'panelRight',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });

        bar.add_child(leftBox);
        bar.add_child(centerBox);
        bar.add_child(rightBox);

        const activitiesButton = this._createActivitiesButton();
        leftBox.add_child(activitiesButton.container);

        const appsMenuButton = this._createAppsMenuButton();
        if (appsMenuButton)
            leftBox.add_child(appsMenuButton.container);

        const dateMenu = new DateMenuButton();
        Main.panel.menuManager.addMenu(dateMenu.menu);
        this._ownedMenus.push(dateMenu.menu);
        centerBox.add_child(dateMenu.container);

        const quickSettingsButton = this._createQuickSettingsButton();
        rightBox.add_child(quickSettingsButton.container);

        this._addChrome(bar, {
            affectsStruts: false,
            trackFullscreen: true,
        });
    }

    _createStrutActor(monitor, height) {
        const actor = new St.Widget({
            reactive: false,
            visible: true,
            opacity: 0,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height,
        });

        actor.set_position(monitor.x, monitor.y);
        actor.set_size(monitor.width, height);

        return actor;
    }

    _addChrome(actor, params) {
        Main.layoutManager.addChrome(actor, params);
        this._chromeActors.push(actor);
    }

    _createActivitiesButton() {
        const button = new PanelMenu.Button(0.0, 'Activities', true);
        const activities = Main.panel.statusArea.activities;

        const sourceActor = activities?.get_first_child?.();
        const fallbackActor = new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });

        button.add_child(this._createCloneBin(sourceActor, fallbackActor));

        const clickGesture = new Clutter.ClickGesture({
            recognize_on_press: true,
        });

        clickGesture.connect('recognize', () => {
            if (Main.overview.shouldToggleByCornerOrButton())
                Main.overview.toggle();
        });

        button.add_action(clickGesture);

        button.connect('scroll-event', (_actor, event) => {
            return Main.wm.handleWorkspaceScroll(event);
        });

        return button;
    }

    _createAppsMenuButton() {
        const appsMenu = Main.panel.statusArea['apps-menu'];

        if (!appsMenu?.menu)
            return null;

        const labelText = this._getLabelText(appsMenu.label_actor);

        if (!labelText)
            return null;

        const button = new PanelMenu.Button(1.0, labelText, true);

        button.add_child(new St.Label({
            text: labelText,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const clickGesture = new Clutter.ClickGesture({
            recognize_on_press: true,
        });

        clickGesture.connect('recognize', () => {
            this._toggleMenuFrom(appsMenu, button);
        });

        button.add_action(clickGesture);

        return button;
    }

    _createQuickSettingsButton() {
        const button = new PanelMenu.Button(0.0, 'Quick Settings', true);
        const quickSettings = Main.panel.statusArea.quickSettings;
        const indicators = quickSettings?._indicators;

        const fallbackActor = new St.Label({
            text: 'System',
            y_align: Clutter.ActorAlign.CENTER,
        });

        button.add_child(this._createCloneBin(indicators, fallbackActor));

        const clickGesture = new Clutter.ClickGesture({
            recognize_on_press: true,
        });

        clickGesture.connect('recognize', () => {
            this._toggleMenuFrom(quickSettings, button);
        });

        button.add_action(clickGesture);

        return button;
    }

    _createCloneBin(sourceActor, fallbackActor = null) {
        const bin = new St.Bin({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        if (!sourceActor) {
            if (fallbackActor)
                bin.set_child(fallbackActor);

            return bin;
        }

        let clone;

        try {
            clone = new Clutter.Clone({
                source: sourceActor,
                reactive: false,
            });
        } catch (e) {
            if (fallbackActor)
                bin.set_child(fallbackActor);

            return bin;
        }

        bin.set_child(clone);

        try {
            let width = sourceActor.width;
            let height = sourceActor.height;

            if (width <= 0) {
                const [, naturalWidth] = sourceActor.get_preferred_width(-1);
                width = naturalWidth;
            }

            if (height <= 0) {
                const [, naturalHeight] = sourceActor.get_preferred_height(-1);
                height = naturalHeight;
            }

            if (width > 0 && height > 0) {
                clone.set_size(width, height);
                bin.set_size(width, height);
            }
        } catch (e) {
        }

        /*
         * Break the link to external actors before this clone is destroyed.
         * The source actor belongs to GNOME Shell or another extension, so it
         * may already be disposed during shutdown.
         */
        bin.connect('destroy', () => {
            try {
                clone.source = null;
            } catch (e) {
            }
        });

        return bin;
    }

    _toggleMenuFrom(indicator, sourceActor) {
        if (!indicator?.menu)
            return;

        const menu = indicator.menu;

        if (menu.isOpen) {
            this._restoreMenuSource(menu);
            menu.close();
            return;
        }

        this._restoreMenuSource(menu);

        const originalSourceActor = menu.sourceActor;
        menu.sourceActor = sourceActor;

        const restoreSignalId = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                return;

            this._restoreMenuSource(menu);
        });

        this._menuSourceOverrides.set(menu, {
            originalSourceActor,
            sourceActor,
            restoreSignalId,
        });

        menu.open();
    }

    _restoreMenuSource(menu) {
        const record = this._menuSourceOverrides.get(menu);

        if (!record)
            return;

        try {
            menu.disconnect(record.restoreSignalId);
        } catch (e) {
        }

        try {
            if (menu.sourceActor === record.sourceActor)
                menu.sourceActor = record.originalSourceActor;
        } catch (e) {
        }

        this._menuSourceOverrides.delete(menu);
    }

    _restoreAllMenuSources() {
        for (const menu of [...this._menuSourceOverrides.keys()])
            this._restoreMenuSource(menu);
    }

    _removeOwnedMenus() {
        for (const menu of this._ownedMenus) {
            try {
                if (menu.isOpen)
                    menu.close();
            } catch (e) {
            }

            try {
                Main.panel.menuManager.removeMenu(menu);
            } catch (e) {
            }
        }

        this._ownedMenus = [];
    }

    _destroyBars() {
        this._restoreAllMenuSources();
        this._removeOwnedMenus();

        const actors = this._chromeActors;
        this._chromeActors = [];

        for (const actor of actors) {
            try {
                Main.layoutManager.removeChrome(actor);
            } catch (e) {
            }

            try {
                actor.destroy();
            } catch (e) {
            }
        }
    }

    _getLabelText(labelActor) {
        try {
            return labelActor?.text ?? '';
        } catch (e) {
            return '';
        }
    }
}
