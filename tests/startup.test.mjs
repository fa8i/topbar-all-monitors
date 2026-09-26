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

    connectObject(...args) {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2)
            this.handlers.push({name: args[i], callback: args[i + 1], owner});
    }

    disconnectObject(owner) {
        this.handlers = this.handlers.filter(handler => handler.owner !== owner);
    }

    emit(name) {
        for (const handler of [...this.handlers]) {
            if (handler.name === name)
                handler.callback();
        }
    }
}

class Actor extends Signals {
    children = [];

    constructor(properties = {}) {
        super();
        Object.assign(this, properties);
    }

    add_child(actor) { this.children.push(actor); }
    remove_child(actor) { this.children.splice(this.children.indexOf(actor), 1); }
    set_name(name) { this.name = name; }
    has_allocation() { return this.allocated ?? false; }
    get_style_class_name() { return ''; }
    set_style_class_name() {}
    destroy() { this.destroyed = true; }
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
        panel: new Actor(),
        ctrlAltTabManager: {removeGroup() {}},
    };
    const context = vm.createContext({
        Clutter: {Orientation: {VERTICAL: 1}},
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
        St: {BoxLayout: Actor},
        Extension: class {},
        Main: main,
        Panel: {Panel: class extends Actor {
            _init() { layoutManager.panelBox.add_child(this); }
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
