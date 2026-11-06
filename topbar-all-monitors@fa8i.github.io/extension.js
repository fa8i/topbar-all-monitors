import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {PanelSignals} from './panelSignals.js';
import {SecondaryQuickSettings} from './secondaryQuickSettings.js';

const PANEL_BOX_NAME = 'panelBox';

const SecondaryPanel = GObject.registerClass({
    Signals: {'allocated': {}},
}, class SecondaryPanel extends Panel.Panel {
    _init(monitorIndex, panelBox) {
        const connections = new PanelSignals(
            () => [GObject.Object.prototype, Signals.EventEmitter.prototype,
                Main.messageTray, Main.sessionMode,
                Shell.AppSystem.get_default(), ...Main.messageTray.getSources()],
            (emitter, id) => emitter instanceof GObject.Object
                ? GObject.signal_handler_is_connected(emitter, id)
                : emitter.signalHandlerIsConnected(id),
            emitter => emitter === Main.messageTray || !(emitter instanceof Clutter.Actor),
            {api: GLib, remove: id => GLib.MainContext.default().find_source_by_id(id)?.destroy()},
            {prototype: Gio.DBusProxy.prototype, createCancellable: () => new Gio.Cancellable()}
        );
        this._nativeConnections = connections;
        try {
            connections.run(() => super._init());
        } catch (error) {
            connections.close();
            throw error;
        }

        this._monitorIndex = monitorIndex;

        Main.layoutManager.panelBox.remove_child(this);
        panelBox.add_child(this);

        Main.panel.connectObject(
            'notify::style-class',
            () => this._syncStyleClass(),
            this
        );

        this._syncStyleClass();

        // Panel._init() follows future overview signals. A panel created after
        // startup or a monitor change must also inherit the current state.
        if (Main.panel.has_style_pseudo_class('overview'))
            this.add_style_pseudo_class('overview');
    }

    _syncStyleClass() {
        this.set_style_class_name(Main.panel.get_style_class_name());
    }

    _ensureIndicator(role) {
        if (role === 'quickSettings' && !this.statusArea[role])
            this.statusArea[role] = new SecondaryQuickSettings(this._nativeConnections);
        return super._ensureIndicator(role);
    }

    vfunc_get_preferred_width(_forHeight) {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];

        return [0, monitor?.width ?? 0];
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);

        // notify::allocation only fires when the box changes; a relayout that
        // keeps the same geometry must still retry publication.
        this.emit('allocated');
    }

    destroy() {
        this._nativeConnections.close();
        Main.panel.disconnectObject(this);
        Main.ctrlAltTabManager.removeGroup(this);

        super.destroy();
    }

    _getDraggableWindowForPosition(stageX) {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows();
        const monitor = Main.layoutManager.monitors[this._monitorIndex];

        if (!monitor)
            return null;

        const allWindowsByStacking =
            global.display.sort_windows_by_stacking(windows).reverse();

        return allWindowsByStacking.find(metaWindow => {
            const rect = metaWindow.get_frame_rect();

            return metaWindow.get_monitor() === this._monitorIndex &&
                metaWindow.showing_on_its_workspace() &&
                metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                metaWindow.maximized_vertically &&
                stageX > rect.x &&
                stageX < rect.x + rect.width;
        });
    }
});

class SecondaryPanelBox {
    constructor(monitorIndex, monitor) {
        this.monitorIndex = monitorIndex;
        this._publishIdleId = 0;

        this.actor = new St.BoxLayout({
            name: 'topbarAllMonitorsPanelBox',
            style_class: 'topbar-all-monitors-panel-box',
            orientation: Clutter.Orientation.VERTICAL,
            clip_to_allocation: true,
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
        });

        this.panel = new SecondaryPanel(monitorIndex, this.actor);
        this.panel.connectObject(
            'allocated',
            () => this._queuePublishPanel(),
            this.actor
        );

        Main.layoutManager.addChrome(this.actor);
    }

    _queuePublishPanel() {
        if (this._publishIdleId)
            return;

        // Wait for allocation and the previous panel's strut removal.
        this._publishIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._publishIdleId = 0;
            this._publishPanel();
            return GLib.SOURCE_REMOVE;
        });
    }

    _publishPanel() {
        if (!this.actor.has_allocation() || !this.panel.has_allocation())
            return;

        const monitor = Main.layoutManager.findMonitorForActor(this.panel);
        if (monitor?.index !== this.monitorIndex)
            return;

        // Allow styling extensions to discover the panel once its geometry is valid.
        this.panel.disconnectObject(this.actor);
        this.actor.set_name(PANEL_BOX_NAME);

        // Trigger work-area discovery after publishing the panel.
        Main.layoutManager.untrackChrome(this.actor);
        Main.layoutManager.trackChrome(this.actor, {
            affectsStruts: true,
            trackFullscreen: true,
        });
    }

    destroy() {
        if (this._publishIdleId) {
            GLib.Source.remove(this._publishIdleId);
            this._publishIdleId = 0;
        }

        this.panel.destroy();
        this.panel = null;

        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.actor = null;
    }
}

export default class TopBarAllMonitorsExtension extends Extension {
    enable() {
        this._panels = [];
        Main.layoutManager.connectObject(
            'startup-complete',
            () => this._rebuildPanels(),
            'monitors-changed',
            () => this._rebuildPanels(),
            this
        );

        this._rebuildPanels();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);

        this._destroyPanels();
    }

    _rebuildPanels() {
        this._destroyPanels();

        // The startup animation temporarily transforms monitor coordinates.
        if (Main.layoutManager._startingUp)
            return;

        const primaryIndex = Main.layoutManager.primaryIndex;

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            if (i === primaryIndex)
                continue;

            const monitor = Main.layoutManager.monitors[i];
            this._panels.push(new SecondaryPanelBox(i, monitor));
        }
    }

    _destroyPanels() {
        for (const panel of this._panels)
            panel.destroy();

        this._panels = [];
    }
}
