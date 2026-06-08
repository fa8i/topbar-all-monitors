import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';

const PANEL_BOX_NAME = 'topbarAllMonitorsPanelBox';

const SecondaryPanel = GObject.registerClass(
class SecondaryPanel extends Panel.Panel {
    _init(monitorIndex, panelBox) {
        super._init();

        this._monitorIndex = monitorIndex;

        Main.layoutManager.panelBox.remove_child(this);
        panelBox.add_child(this);

    }

    vfunc_get_preferred_width(_forHeight) {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];

        if (monitor)
            return [0, monitor.width];

        return [0, 0];
    }

    destroy() {
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

        this.actor = new St.BoxLayout({
            name: PANEL_BOX_NAME,
            style_class: 'topbar-all-monitors-panel-box',
            orientation: Clutter.Orientation.VERTICAL,
            clip_to_allocation: true,
            reactive: true,
        });

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: true,
            trackFullscreen: true,
        });

        this.update(monitor);

        this.panel = new SecondaryPanel(monitorIndex, this.actor);
    }

    update(monitor) {
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, -1);
    }

    destroy() {
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
