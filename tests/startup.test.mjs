import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the real extension lifecycle without requiring a running Shell.
const source = readFileSync(new URL(
    '../topbar-all-monitors@fa8i.github.io/extension.js', import.meta.url
), 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');

class Signals {
    handlers = [];

    connect(name, callback) {
        this.handlers.push({name, callback, owner: null});
    }

    connectObject(...args) {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2)
            this.handlers.push({name: args[i], callback: args[i + 1], owner});
    }

    disconnectObject(owner) {
        this.handlers = this.handlers.filter(handler => handler.owner !== owner);
    }

    emit(name, ...args) {
        let result;
        for (const handler of [...this.handlers]) {
            if (handler.name === name)
                result = handler.callback(this, ...args);
        }
        return result;
    }
}

class Actor extends Signals {
    children = [];
    actions = [];
    forwardedEvents = [];
    visible = true;

    constructor(properties = {}) {
        super();
        Object.assign(this, properties);
    }

    _init(properties = {}) { Object.assign(this, properties); }
    add_child(actor) { this.insert_child_at_index(actor, this.children.length); }
    insert_child_at_index(actor, index) {
        this.children.splice(index, 0, actor);
        actor.parent = this;
        this.emit('child-added', actor);
    }
    remove_child(actor) {
        this.children.splice(this.children.indexOf(actor), 1);
        actor.parent = null;
        this.emit('child-removed', actor);
    }
    set_child_at_index(actor, index) {
        this.children.splice(this.children.indexOf(actor), 1);
        this.children.splice(index, 0, actor);
    }
    get_children() { return [...this.children]; }
    get_first_child() { return this.children[0] ?? null; }
    get_parent() { return this.parent ?? null; }
    get_actions() { return this.actions; }
    add_action(action) { this.actions.push(action); }
    event(event) {
        this.forwardedEvents.push(event);
        return true;
    }
    set_name(name) { this.name = name; }
    has_allocation() { return this.allocated ?? false; }
    get_style_class_name() { return ''; }
    set_style_class_name() {}
    destroy() {
        this.destroyed = true;
        this.emit('destroy');
        this.parent?.remove_child(this);
    }
}

class ClickGesture extends Signals {
    enabled = true;
    set_recognize_on_press(recognizeOnPress) { this.recognizeOnPress = recognizeOnPress; }
}

class Menu extends Signals {
    isOpen = false;

    constructor(sourceActor) {
        super();
        this.sourceActor = sourceActor;
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.emit('open-state-changed', this.isOpen);
    }

    close() {
        if (this.isOpen)
            this.toggle();
    }
}

function createIndicator({gesture = true} = {}) {
    const button = new Actor();
    button.menu = new Menu(button);
    if (gesture) {
        const clickGesture = new ClickGesture();
        clickGesture.connect('recognize', () => button.menu.toggle());
        button.add_action(clickGesture);
    }
    const container = new Actor();
    container.add_child(button);
    return {button, container};
}

function createPanelBoxes(panel, statusArea) {
    panel._leftBox = new Actor();
    panel._centerBox = new Actor();
    panel._rightBox = new Actor();
    panel.statusArea = statusArea;
    for (const indicator of Object.values(statusArea))
        panel._rightBox.add_child(indicator.container);
    return panel;
}

function getSecondaryPanel(layoutManager) {
    return [...layoutManager.chrome][0].children[0];
}

function createShell(startingUp) {
    const idleCallbacks = new Map();
    let nextIdleId = 1;
    function flushIdle() {
        for (const [id, callback] of idleCallbacks) {
            idleCallbacks.delete(id);
            callback();
        }
    }
    const layoutManager = Object.assign(new Signals(), {
        _startingUp: startingUp,
        primaryIndex: 0,
        monitors: [
            {index: 0, x: 0, y: 100, width: 1600, height: 900},
            {index: 1, x: 1600, y: 0, width: 2400, height: 1350},
        ],
        panelBox: new Actor(),
        chrome: new Set(),
        chromeParams: new Map(),
        struts: new Set(),
        addChrome(actor, params = {}) {
            // A styling extension can discover an actor as soon as it is added.
            assert.equal(actor.children.length, 1, 'publish a fully assembled panel');
            const [panel] = actor.children;
            const monitor = this.monitors[panel._monitorIndex];
            assert.equal(actor.x, monitor.x);
            assert.equal(actor.y, monitor.y);
            assert.equal(actor.width, monitor.width);
            assert.notEqual(actor.name, 'panelBox', 'unallocated panels are not discoverable');
            this.chrome.add(actor);
            this.chromeParams.set(actor, params);
        },
        removeChrome(actor) {
            this.chrome.delete(actor);
            this.struts.delete(actor);
        },
        untrackChrome() {},
        trackChrome(actor, params) {
            assert.equal(actor.name, 'panelBox');
            assert.equal(actor.children[0].has_allocation(), true);
            assert.equal(params.affectsStruts, true);
            assert.equal(params.trackFullscreen, true);
            this.struts.add(actor);
        },
        findMonitorForActor(actor) {
            return this.monitors[actor.has_allocation() ? actor._monitorIndex : this.primaryIndex];
        },
        allocatePanels() {
            for (const box of this.chrome) {
                box.allocated = true;
                const [panel] = box.children;
                panel.allocated = true;
                panel.vfunc_allocate();
            }
            flushIdle();
        },
    });
    const main = {
        layoutManager,
        panel: createPanelBoxes(new Actor(), {
            a11y: {container: new Actor({visible: true})},
        }),
        ctrlAltTabManager: {removeGroup() {}},
    };
    const context = vm.createContext({
        Clutter: {
            Orientation: {VERTICAL: 1},
            Clone: Actor,
            ClickGesture,
            EventType: {TOUCH_BEGIN: 9},
            EVENT_PROPAGATE: false,
        },
        GLib: {
            idle_add(_priority, callback) {
                const id = nextIdleId++;
                idleCallbacks.set(id, callback);
                return id;
            },
            Source: {remove: id => idleCallbacks.delete(id)},
            SOURCE_REMOVE: false,
            PRIORITY_DEFAULT_IDLE: 200,
        },
        GObject: {
            registerClass: (...args) => class extends args.at(-1) {
                constructor(...args) { super(); this._init(...args); }
            },
        },
        St: {BoxLayout: Actor, Bin: Actor, Widget: Actor},
        Extension: class {},
        Main: main,
        Panel: {Panel: class extends Actor {
            _init() {
                createPanelBoxes(this, {
                    a11y: {container: new Actor({visible: true})},
                    dwellClick: {container: new Actor({visible: true})},
                });
                layoutManager.panelBox.add_child(this);
            }
            vfunc_allocate() {}
        }},
    });
    const extension = vm.runInContext(
        `${source}\nnew TopBarAllMonitorsExtension();`, context
    );
    return {extension, layoutManager, main, flushIdle, idleCallbacks};
}

test('startup and early monitor changes wait for stable stage coordinates', () => {
    const {extension, layoutManager} = createShell(true);
    extension.enable();
    layoutManager.emit('monitors-changed');
    assert.equal(layoutManager.chrome.size, 0);

    layoutManager._startingUp = false;
    layoutManager.emit('startup-complete');
    assert.equal(layoutManager.chrome.size, 1);
    assert.equal([...layoutManager.chrome][0].width, 2400);
    layoutManager.allocatePanels();
    assert.equal([...layoutManager.chrome][0].name, 'panelBox');
    extension.disable();
});

test('disable before startup completes cancels deferred panel creation', () => {
    const {extension, layoutManager} = createShell(true);
    extension.enable();
    extension.disable();
    layoutManager._startingUp = false;
    layoutManager.emit('startup-complete');
    layoutManager.emit('monitors-changed');
    assert.equal(layoutManager.chrome.size, 0);
    assert.equal(layoutManager.handlers.length, 0);
});

test('enable after startup, change primary monitor, disable and re-enable', () => {
    const {extension, layoutManager, main} = createShell(false);
    extension.enable();
    const original = [...layoutManager.chrome][0];
    assert.equal(original.width, 2400);

    layoutManager.primaryIndex = 1;
    layoutManager.emit('monitors-changed');
    assert.equal(original.destroyed, true);
    assert.equal(layoutManager.chrome.size, 1);
    assert.equal([...layoutManager.chrome][0].width, 1600);

    extension.disable();
    assert.equal(layoutManager.chrome.size, 0);
    assert.equal(main.panel.handlers.length, 0);
    extension.enable();
    assert.equal(layoutManager.chrome.size, 1);
    extension.disable();
});

test('disconnecting the secondary monitor removes its panel', () => {
    const {extension, layoutManager} = createShell(false);
    extension.enable();
    layoutManager.monitors.pop();
    layoutManager.emit('monitors-changed');
    assert.equal(layoutManager.chrome.size, 0);
    extension.disable();
});

test('styling discovery waits for allocation even when enabled after startup', () => {
    const {extension, layoutManager, flushIdle} = createShell(false);
    extension.enable();
    const box = [...layoutManager.chrome][0];
    const [panel] = box.children;
    panel.vfunc_allocate();
    flushIdle();
    assert.notEqual(box.name, 'panelBox');
    assert.equal(layoutManager.findMonitorForActor(panel).index, 0);

    layoutManager.allocatePanels();
    assert.equal(box.name, 'panelBox');
    assert.equal(layoutManager.findMonitorForActor(panel).index, 1);
    assert.equal(panel.handlers.length, 0, 'allocation listener is removed after publication');
    extension.disable();
});

test('disable cancels publication queued by an allocation notification', () => {
    const {extension, layoutManager, idleCallbacks, flushIdle} = createShell(false);
    extension.enable();
    const box = [...layoutManager.chrome][0];
    box.children[0].vfunc_allocate();
    assert.equal(idleCallbacks.size, 1);
    extension.disable();
    assert.equal(idleCallbacks.size, 0);
    flushIdle();
    assert.notEqual(box.name, 'panelBox');
    assert.equal(layoutManager.chrome.size, 0);
});

test('struts are reserved only once the panel is discoverable', () => {
    const {extension, layoutManager} = createShell(false);
    extension.enable();
    const box = [...layoutManager.chrome][0];
    // Blur My Shell looks for panelBox on workareas-changed, so reserving
    // space before the rename would hide the panel from it.
    assert.equal(layoutManager.chromeParams.get(box).affectsStruts, undefined);
    layoutManager.allocatePanels();
    assert.equal(layoutManager.struts.has(box), true);
    extension.disable();
});

test('publication retries after a relayout that keeps the same allocation', () => {
    const {extension, layoutManager, flushIdle} = createShell(false);
    extension.enable();
    const box = [...layoutManager.chrome][0];
    const [panel] = box.children;
    box.allocated = panel.allocated = true;
    panel.vfunc_allocate();
    // Another relayout is queued before the idle runs.
    box.allocated = panel.allocated = false;
    flushIdle();
    assert.notEqual(box.name, 'panelBox');

    // The relayout ends with the same geometry: no notify::allocation.
    box.allocated = panel.allocated = true;
    panel.vfunc_allocate();
    flushIdle();
    assert.equal(box.name, 'panelBox');
    assert.equal(layoutManager.struts.has(box), true);
    extension.disable();
});

test('publication waits for the panel to be detected on its own monitor', () => {
    const {extension, layoutManager, flushIdle} = createShell(false);
    extension.enable();
    const box = [...layoutManager.chrome][0];
    const [panel] = box.children;
    const findMonitorForActor = layoutManager.findMonitorForActor;
    layoutManager.findMonitorForActor = () => layoutManager.monitors[0];
    box.allocated = panel.allocated = true;
    panel.vfunc_allocate();
    flushIdle();
    assert.notEqual(box.name, 'panelBox');
    assert.equal(layoutManager.struts.has(box), false);

    layoutManager.findMonitorForActor = findMonitorForActor;
    panel.vfunc_allocate();
    flushIdle();
    assert.equal(box.name, 'panelBox');
    assert.equal(layoutManager.struts.has(box), true);
    extension.disable();
});

test('indicator visibility follows the primary panel', () => {
    const {extension, layoutManager, main} = createShell(false);
    const source = main.panel.statusArea.a11y.container;
    source.visible = false;
    extension.enable();
    const [panel] = [...layoutManager.chrome][0].children;
    const target = panel.statusArea.a11y.container;
    assert.equal(target.visible, false);
    assert.equal(panel.statusArea.dwellClick.container.visible, true,
        'indicators missing from the primary panel keep their own visibility');

    source.visible = true;
    source.emit('notify::visible');
    assert.equal(target.visible, true);

    extension.disable();
    assert.equal(source.handlers.length, 0);
});

test('extension items on the primary panel are mirrored in place', () => {
    const {extension, layoutManager, main} = createShell(false);
    const {container} = createIndicator();
    main.panel._rightBox.insert_child_at_index(container, 0);
    extension.enable();

    const panel = getSecondaryPanel(layoutManager);
    const [mirror, a11y, dwellClick] = panel._rightBox.children;
    assert.equal(mirror.source, container);
    assert.equal(a11y, panel.statusArea.a11y.container,
        'built-in indicators keep their own instance');
    assert.equal(dwellClick, panel.statusArea.dwellClick.container);
    assert.equal(panel._rightBox.children.filter(child => child.source).length, 1);
    extension.disable();
});

test('mirrors follow items added, hidden and removed later', () => {
    const {extension, layoutManager, main, flushIdle} = createShell(false);
    extension.enable();
    const panel = getSecondaryPanel(layoutManager);

    const {container, button} = createIndicator();
    main.panel._leftBox.add_child(container);
    assert.equal(panel._leftBox.children.length, 0, 'changes are batched');
    flushIdle();
    const [mirror] = panel._leftBox.children;
    assert.equal(mirror.source, container);

    button.visible = false;
    button.emit('notify::visible');
    assert.equal(mirror.visible, false);
    button.visible = true;
    button.emit('notify::visible');
    assert.equal(mirror.visible, true);

    main.panel._leftBox.remove_child(container);
    flushIdle();
    assert.equal(panel._leftBox.children.length, 0);
    assert.equal(mirror.destroyed, true);
    extension.disable();
});

test('mirrored menus open from the secondary panel', () => {
    const {extension, layoutManager, main} = createShell(false);
    const {container, button} = createIndicator();
    main.panel._rightBox.add_child(container);
    extension.enable();
    const [mirror] = getSecondaryPanel(layoutManager)._rightBox.children
        .filter(child => child.source);

    mirror.actions[0].emit('recognize');
    assert.equal(button.menu.isOpen, true);
    assert.equal(button.menu.sourceActor, mirror);

    button.menu.close();
    assert.equal(button.menu.sourceActor, button);
    extension.disable();
});

test('items without a click gesture receive forwarded events', () => {
    const {extension, layoutManager, main} = createShell(false);
    const {container, button} = createIndicator({gesture: false});
    main.panel._rightBox.add_child(container);
    extension.enable();
    const [mirror] = getSecondaryPanel(layoutManager)._rightBox.children
        .filter(child => child.source);

    const press = {type: () => 0};
    assert.equal(mirror.emit('button-press-event', press), true);
    assert.deepEqual(button.forwardedEvents, [press]);
    assert.equal(button.menu.sourceActor, mirror);

    button.emit('captured-event');
    assert.equal(button.menu.sourceActor, button,
        'the original button takes its menu back');
    extension.disable();
});

test('disable closes mirrored menus and stops following the primary panel', () => {
    const {extension, layoutManager, main, idleCallbacks} = createShell(false);
    const {container, button} = createIndicator();
    main.panel._rightBox.add_child(container);
    extension.enable();
    const [mirror] = getSecondaryPanel(layoutManager)._rightBox.children
        .filter(child => child.source);
    mirror.actions[0].emit('recognize');

    main.panel._leftBox.add_child(createIndicator().container);
    extension.disable();
    assert.equal(button.menu.isOpen, false);
    assert.equal(button.menu.sourceActor, button);
    assert.equal(mirror.destroyed, true);
    assert.equal(idleCallbacks.size, 0);
    for (const box of [main.panel._leftBox, main.panel._centerBox, main.panel._rightBox])
        assert.equal(box.handlers.length, 0);
});
