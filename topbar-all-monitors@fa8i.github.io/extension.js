import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';

const PANEL_BOX_NAME = 'panelBox';

const menuSources = new WeakMap();

const MirroredItem = GObject.registerClass(
class MirroredItem extends St.Widget {
    _init(source) {
        super._init({
            reactive: true,
            track_hover: true,
        });

        this.source = source;
        this._anchor = {};
        this._clone = new Clutter.Clone({source});
        this.add_child(this._clone);

        const child = source.get_first_child?.();
        this._button = child?.menu ? child : source;

        for (const actor of new Set([source, this._button]))
            actor.connectObject('notify::visible', () => this._syncVisible(), this);
        this._syncVisible();

        source.connectObject('notify::allocation', () => this.queue_relayout(), this);

        this.connect('notify::hover', () => this._syncHover());

        const gestures = this._button.get_actions().filter(action =>
            action instanceof Clutter.ClickGesture && action.enabled);

        if (gestures.length > 0) {
            const gesture = new Clutter.ClickGesture();
            gesture.set_recognize_on_press(true);
            gesture.connect('recognize', () => {
                this._anchorMenu();
                for (const sourceGesture of gestures)
                    sourceGesture.emit('recognize');
            });
            this.add_action(gesture);
        } else {
            this.connect('button-press-event',
                (_actor, event) => this._forwardEvent(event, true));
            this.connect('button-release-event',
                (_actor, event) => this._forwardEvent(event));
            this.connect('touch-event', (_actor, event) => this._forwardEvent(
                event, event.type() === Clutter.EventType.TOUCH_BEGIN));
        }

        this.connect('scroll-event',
            (_actor, event) => this._forwardEvent(event));

        this.connect('notify::mapped', () => {
            if (!this.mapped)
                this._releaseMenu(true);
        });
        this.connect('destroy', () => {
            this._releaseMenu(true);
            if (this.hover && this._button instanceof St.Widget)
                this._button.hover = false;
        });
    }

    vfunc_get_preferred_width(forHeight) {
        if (!this.source.has_allocation())
            return this.source.get_preferred_width(forHeight);

        const [width] = this.source.get_allocation_box().get_size();
        return [width, width];
    }

    vfunc_get_preferred_height(forWidth) {
        if (!this.source.has_allocation())
            return this.source.get_preferred_height(forWidth);

        const [, height] = this.source.get_allocation_box().get_size();
        return [height, height];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        if (!this.source.has_allocation() && !this.source.mapped) {
            const height = box.get_height();
            const [, width] = this.source.get_preferred_width(height);
            const sourceBox = this.source.get_allocation_box();
            sourceBox.set_size(width, height);
            this.source.allocate(sourceBox);
        }

        const [width, height] = this.source.get_allocation_box().get_size();
        const cloneBox = new Clutter.ActorBox();
        cloneBox.set_origin(
            Math.round((box.get_width() - width) / 2),
            Math.round((box.get_height() - height) / 2));
        cloneBox.set_size(width, height);
        this._clone.allocate(cloneBox);
    }

    _syncVisible() {
        this.visible = this.source.visible && this._button.visible;
    }

    _syncHover() {
        if (this._button instanceof St.Widget)
            this._button.hover = this.hover;
    }

    _forwardEvent(event, anchor = false) {
        if (anchor)
            this._anchorMenu();

        return this._button.event(event, false);
    }

    _anchorMenu() {
        const menu = this._button.menu;
        if (!menu || menu.isOpen)
            return;

        if (!menuSources.has(menu))
            menuSources.set(menu, menu.sourceActor);

        this._releaseMenu();
        menu.sourceActor = this;
        this._anchoredMenu = menu;

        menu.connectObject('open-state-changed', (_menu, open) => {
            if (!open)
                this._releaseMenu();
        }, this._anchor);
        this._button.connectObject('captured-event', () => {
            this._releaseMenu();
            return Clutter.EVENT_PROPAGATE;
        }, this._anchor);
    }

    _releaseMenu(close = false) {
        const menu = this._anchoredMenu;
        if (!menu)
            return;

        this._anchoredMenu = null;
        menu.disconnectObject(this._anchor);
        this._button.disconnectObject(this._anchor);

        if (menu.sourceActor !== this)
            return;

        if (close && menu.isOpen)
            menu.close();
        menu.sourceActor = menuSources.get(menu);
    }
});

const SecondaryPanel = GObject.registerClass({
    Signals: {'allocated': {}},
}, class SecondaryPanel extends Panel.Panel {
    _init(monitorIndex, panelBox) {
        super._init();

        this._monitorIndex = monitorIndex;

        Main.layoutManager.panelBox.remove_child(this);
        panelBox.add_child(this);

        Main.panel.connectObject(
            'notify::style-class',
            () => this._syncStyleClass(),
            this
        );

        this._syncStyleClass();
        this._mirrorIndicatorVisibility();
        this._mirrorMainPanelItems();
    }

    _syncStyleClass() {
        this.set_style_class_name(Main.panel.get_style_class_name());
    }

    _mirrorIndicatorVisibility() {
        this._mirroredContainers = [];

        for (const [role, indicator] of Object.entries(this.statusArea)) {
            const source = Main.panel.statusArea[role]?.container;
            const target = indicator.container;
            if (!source || source === target)
                continue;

            const sync = () => {
                target.visible = source.visible;
            };
            source.connectObject('notify::visible', sync, this);
            this._mirroredContainers.push(source);
            sync();
        }
    }

    _getMirroredBoxes() {
        return [
            [Main.panel._leftBox, this._leftBox],
            [Main.panel._centerBox, this._centerBox],
            [Main.panel._rightBox, this._rightBox],
        ];
    }

    _mirrorMainPanelItems() {
        this._mirrors = new Map();
        this._syncMirrorsId = 0;

        for (const [sourceBox] of this._getMirroredBoxes()) {
            sourceBox.connectObject(
                'child-added', () => this._queueSyncMirrors(),
                'child-removed', () => this._queueSyncMirrors(),
                this
            );
        }

        this._syncMirrors();
    }

    _queueSyncMirrors() {
        if (this._syncMirrorsId)
            return;

        this._syncMirrorsId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncMirrorsId = 0;
            this._syncMirrors();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncMirrors() {
        const nativeContainers = new Map();
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            const own = this.statusArea[role];
            if (own && own !== indicator)
                nativeContainers.set(indicator.container, own.container);
        }

        const mirroredSources = new Set();
        for (const [sourceBox, box] of this._getMirroredBoxes()) {
            sourceBox.get_children().forEach((source, index) => {
                let target = nativeContainers.get(source);

                if (!target) {
                    mirroredSources.add(source);
                    target = this._mirrors.get(source);
                    if (!target) {
                        target = new MirroredItem(source);
                        this._mirrors.set(source, target);
                    }
                }

                if (target.get_parent() === box) {
                    box.set_child_at_index(target, index);
                } else {
                    target.get_parent()?.remove_child(target);
                    box.insert_child_at_index(target, index);
                }
            });
        }

        for (const [source, mirror] of this._mirrors) {
            if (mirroredSources.has(source))
                continue;

            this._mirrors.delete(source);
            mirror.destroy();
        }
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
        Main.panel.disconnectObject(this);
        for (const source of this._mirroredContainers)
            source.disconnectObject(this);
        this._mirroredContainers = [];

        if (this._syncMirrorsId) {
            GLib.Source.remove(this._syncMirrorsId);
            this._syncMirrorsId = 0;
        }
        for (const [sourceBox] of this._getMirroredBoxes())
            sourceBox.disconnectObject(this);
        for (const mirror of this._mirrors.values())
            mirror.destroy();
        this._mirrors.clear();
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
